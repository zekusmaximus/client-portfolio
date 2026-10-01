const express = require('express');
const router = express.Router();
const db = require('./db.cjs');
const auth = require('./middleware/auth.cjs');
const { body, validationResult } = require('express-validator');
const { trimRequestBody } = require('./middleware/validation.cjs');
const {
  processCSVData,
  validateClientData,
  calculateStrategicScores
} = require('./clientAnalyzer.cjs');
const {
  extractRevenueYears,
  headerKeys,
  planRevenueWrites,
  revenueTotals,
  rowNumberOf,
  SHEET_COLUMNS,
  findSheetColumns,
  checkSheet,
  indexStoredClients,
  importWriteColumns,
  valuesList
} = require('./utils/csvImport.cjs');
const { unescapeStoredSql } = require('./utils/escaping.cjs');
const { NAME_MAX, NAME_PATTERN, isObjectBody, checkClient } = require('./utils/clientRules.cjs');
const {
  CLIENT_NAME_LOCK_SQL,
  givesNewName,
  SAME_NAME_SQL,
  sameNameParams,
  duplicateNameDetail
} = require('./utils/clientNames.cjs');
const { logError } = require('./utils/errorLog.cjs');
const { revenueObjectFromRows } = require('./utils/strategic.cjs');
const { withSuccessionMetrics } = require('./utils/succession.cjs');
const {
  clientSnapshot,
  clientChanges,
  revenueSnapshot,
  importedRevenue,
  updatedAtExactSql,
  readExpectedUpdatedAt,
  isCurrent,
  INSERT_CHANGES_SQL,
  insertChangesParams,
  CLIENT_CHANGES_SQL,
  LATEST_CHANGE_SQL,
  conflictBody
} = require('./utils/clientChanges.cjs');
const {
  parseId,
  validateAssignment,
  legacyText,
  CLIENT_PEOPLE_COLUMNS,
  CLIENT_PEOPLE_JOINS,
  CLIENT_PEOPLE_GROUP_BY,
  withPeopleFields
} = require('./utils/people.cjs');

// Apply authentication middleware to all routes
router.use(auth);
// Every string trimmed and otherwise stored as sent (docs/plans/tier-2.md, S8,
// WP5): no escaping, so an import cell and a form field are written as the
// partner typed them.
router.use(trimRequestBody);

// Validation for CSV processing
const csvValidationRules = [
  body('csvData')
    .isArray({ min: 1 })
    .withMessage('CSV data must be a non-empty array')
    .custom((csvData) => {
      if (!Array.isArray(csvData)) return true;
      
      // Validate each row has required structure
      for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];
        if (!row || typeof row !== 'object') {
          throw new Error(`Row ${rowNumberOf(i)}: Must be an object`);
        }
        
        // Check for required fields (CLIENT is minimum requirement)
        if (!row.CLIENT || typeof row.CLIENT !== 'string' || !row.CLIENT.trim()) {
          throw new Error(`Row ${rowNumberOf(i)}: CLIENT is required and must be a non-empty string`);
        }
        
        // Validate CLIENT length and pattern: the client form's
        // (utils/clientRules.cjs), on the name as the sheet spells it, which
        // is what the import stores
        const client = row.CLIENT.trim();
        if (client.length > NAME_MAX) {
          throw new Error(`Row ${rowNumberOf(i)}: CLIENT must not exceed 255 characters`);
        }
        
        if (!NAME_PATTERN.test(client)) {
          throw new Error(`Row ${rowNumberOf(i)}: CLIENT contains invalid characters`);
        }
      }
      
      return true;
    }),
  // Check file: a boolean, so that a string "false" can never be read as a dry run or "true" as an import
  body('dryRun')
    .optional()
    .custom((dryRun) => typeof dryRun === 'boolean')
    .withMessage('dryRun must be true or false')
];

// Handle validation errors for CSV. Each detail is { field, message }: until
// Tier 3 WP2 it also carried `value`, which for csvData is the whole file,
// notes included, sent back to the page that had just sent it (the page reads
// only the message)
const handleCSVValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // express-validator 7 names the field `path` (it was `param` in 6)
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg
    }));
    
    return res.status(400).json({
      error: 'CSV validation failed',
      details: errorMessages
    });
  }
  
  next();
};

const problems = (n) => `${n} problem${n === 1 ? '' : 's'}`;

// POST /api/data/process-csv
// Revenue follows the year rule (D5). The import sheet's people and judgment
// columns (docs/plans/people-and-second-chair.md, section 3, P8) are written
// for exactly the columns the file has. Any problem in the file refuses it
// whole: 400 { success: false, error, errors: [{ row, client, message }] },
// nothing written. With `dryRun: true` (the upload page's "Check file") every
// check and every write runs in the same transaction, which is then rolled
// back: the same 400 on any problem, or
// { success: true, dryRun: true, validation, summary } with nothing written.
//
// Who changed what (docs/plans/tier-2.md, S9, WP6): a matched client whose
// fields and revenue the file leaves as they are is not written at all (its
// updated_at stays, so a form left open on it still saves), and every client
// the import does change or create is logged as `import`, all in one insert
// in the import's transaction; Check file rolls those back with the rest.
// summary.updatedClients counts the stored clients the file names, as
// before; summary.changedClients those it changed.
router.post('/process-csv', csvValidationRules, handleCSVValidationErrors, async (req, res) => {
  const conn = await db.pool.connect();
  
  try {
    const { csvData, dryRun = false } = req.body;
    
    if (!csvData || !Array.isArray(csvData)) {
      return res.status(400).json({ 
        error: 'Invalid CSV data. Expected array of objects.' 
      });
    }

    // Process the CSV data: every cell as the sheet spells it. Until WP5 each
    // cell arrived escaped by the request sanitizer and was decoded here; the
    // cells now arrive as sent (trimmed), and are neither escaped nor decoded.
    const headers = headerKeys(csvData);
    const clients = processCSVData(csvData);

    // The years the file covers, from its `YYYY Contracts` headers (D5)
    const revenueYears = extractRevenueYears(headers);

    // The sheet's optional columns the file has, and any problem with its header
    const sheetColumns = findSheetColumns(headers);
    const { columns } = sheetColumns;
    const writeColumns = importWriteColumns(columns);
    
    // Validate the processed data
    const validation = validateClientData(clients);
    
    // Calculate strategic scores
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Save to database using upsert logic
    await conn.query('BEGIN');

    // The client-name lock (utils/clientNames.cjs, Tier 3 WP2, candidate
    // (g)), first, as the client form's POST and PUT take it: the import
    // creates a client for each name no stored client has, and only the
    // stored names it reads below can say which, so it holds the lock before
    // reading them. A form save giving a client one of those names at the
    // same moment then waits, and finds the name taken; Check file takes it
    // too, and rolls it back with the rest.
    await conn.query(CLIENT_NAME_LOCK_SQL);

    // The People list, when the file assigns people. FOR SHARE, as the client
    // writes below: routes/people.cjs cannot deactivate anyone or move a lead
    // out of the partner role until this import commits.
    const { rows: roster } = 'lead' in columns
      ? await conn.query('SELECT id, name, role, active FROM people ORDER BY id FOR SHARE')
      : { rows: [] };

    // Pre-fetch all existing clients to avoid N+1 queries
    const clientNames = clientsWithScores
      .map(c => c.name)
      .filter(n => typeof n === 'string' && n.trim().length > 0);
    
    // Stored clients by their name as the sheet spells it, lower case
    let stored = indexStoredClients([]);
    
    if (clientNames.length > 0) {
      // Fetch all potential matches in one query
      // Using ANY($1) allows us to match against an array of lowercased names.
      // A name saved through the client form before WP5 was stored
      // HTML-escaped by the request sanitizer (`Barnes &amp; Noble`), once
      // per save. scripts/unescape-book.cjs repaired the book (it found none
      // left, 2026-09-28); names are still compared unescaped, as
      // indexStoredClients keys them, as a guard for a restored backup, and
      // the update below writes the sheet's spelling.
      // FOR UPDATE: the values kept for columns the file lacks are written back
      // below, so a form save cannot land in between and be overwritten. Every
      // column, since each is compared with what the file would write (WP6).
      // In id order (Tier 3 WP10, candidate (aa)): a rename locks the clients
      // it rewrites in id order (routes/people.cjs), and until WP10 this read
      // locked them in the table's scan order, so an import without a Lead
      // column (which reads no person) and a rename of a person seated on
      // two of the file's clients, at the same moment, deadlocked whenever
      // the scan met the higher id first (40P01: the import's 500). With a
      // Lead column the FOR SHARE read above already waits for the rename.
      // PostgreSQL locks the rows above the sort (LockRows over Sort), and
      // the id is not cast: integer on production, uuid on init-db.sql's.
      const { rows: allExistingClients } = await conn.query(`
        SELECT *
        FROM clients 
        WHERE LOWER(${unescapeStoredSql('name')}) = ANY($1)
        ORDER BY id
        FOR UPDATE
      `, [clientNames.map(n => n.toLowerCase())]);

      stored = indexStoredClients(allExistingClients);
    }
    const existingClientsMap = stored.byName;

    // Refuse the whole file on any problem (P8): header, a client named twice
    // in the file or shared by two stored clients, a value outside its
    // column's vocabulary, a person who does not resolve.
    const check = checkSheet(clientsWithScores, {
      headerErrors: sheetColumns.errors,
      roster,
      existingByName: existingClientsMap,
      sharedNames: stored.shared
    });
    if (check.errors.length > 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Nothing was imported: the file has ${problems(check.errors.length)}. Fix the rows below and upload it again.`,
        errors: check.errors
      });
    }

    let updatedCount = 0;
    let changedCount = 0;
    let insertedCount = 0;

    // For the history (WP6): the People list's names, and the matched
    // clients' revenue as stored, read after their lock
    const { rows: nameRows } = await conn.query('SELECT id, name FROM people');
    const names = new Map(nameRows.map((p) => [p.id, p.name]));
    const revenueRowsByClient = async (ids) => {
      const byClient = new Map(ids.map((id) => [String(id), []]));
      if (ids.length === 0) return byClient;
      const { rows } = await conn.query(`
        SELECT client_id::text AS client_id, year, revenue_amount
          FROM client_revenues WHERE client_id::text = ANY($1::text[])`, [ids.map(String)]);
      rows.forEach((r) => byClient.get(r.client_id).push(r));
      return byClient;
    };
    const storedRevenue = await revenueRowsByClient([...existingClientsMap.values()].map((c) => c.id));

    // --- Pass 1: compute all field values ---
    // Names are unique in the file (checkSheet), so each client is written once.
    const toUpdateMap = new Map(); // lowerName -> row data for bulk UPDATE
    const toInsertMap = new Map(); // lowerName -> row data for bulk INSERT
    const revenueDataMap = new Map(); // lowerName -> revenue object

    for (const clientData of clientsWithScores) {
      const lowerName = (clientData.name || '').toLowerCase();
      const existingClient = existingClientsMap.get(lowerName);

      // The file's values for the sheet columns it has; the rest as before
      const judged = clientData.sheet ? clientData.sheet.values : {};
      const fromFile = (column, otherwise) => (column in judged ? judged[column] : otherwise);
      const assigned = check.people.get(clientData.rowNumber);
      const sheetOnly = {
        ...('stickiness' in columns ? { stickiness: judged.stickiness } : {}),
        ...('handful' in columns ? { high_maintenance: judged.high_maintenance } : {}),
        ...(assigned ? assigned.values : {})
      };

      if (existingClient) {
        // Preserve manual enhancements (only if they were manually set and differ from defaults)
        const preservedPracticeArea = existingClient.practice_area && existingClient.practice_area.length > 0
          ? existingClient.practice_area
          : clientData.practiceArea || [];

        const preservedConflictRisk = existingClient.conflict_risk !== 'Medium'
          ? existingClient.conflict_risk
          : clientData.conflictRisk || 'Medium';

        const preservedNotes = existingClient.notes && existingClient.notes.trim() !== ''
          ? existingClient.notes
          : clientData.notes || '';

        const preservedPrimaryLobbyist = existingClient.primary_lobbyist && existingClient.primary_lobbyist.trim() !== ''
          ? existingClient.primary_lobbyist
          : clientData.primaryLobbyist || '';

        const preservedClientOriginator = existingClient.client_originator && existingClient.client_originator.trim() !== ''
          ? existingClient.client_originator
          : clientData.clientOriginator || '';

        const preservedLobbyistTeam = existingClient.lobbyist_team && existingClient.lobbyist_team.length > 0
          ? existingClient.lobbyist_team
          : clientData.lobbyistTeam || [];

        const preservedInteractionFrequency = existingClient.interaction_frequency && existingClient.interaction_frequency.trim() !== ''
          ? existingClient.interaction_frequency
          : clientData.interactionFrequency || '';

        toUpdateMap.set(lowerName, {
          id: existingClient.id,
          name: clientData.name || '',
          practice_area: fromFile('practice_area', preservedPracticeArea),
          conflict_risk: fromFile('conflict_risk', preservedConflictRisk),
          notes: fromFile('notes', preservedNotes),
          primary_lobbyist: assigned ? assigned.legacy.primary_lobbyist : preservedPrimaryLobbyist,
          client_originator: assigned ? assigned.legacy.client_originator : preservedClientOriginator,
          lobbyist_team: assigned ? assigned.legacy.lobbyist_team : preservedLobbyistTeam,
          interaction_frequency: fromFile('interaction_frequency', preservedInteractionFrequency),
          ...sheetOnly
        });
      } else {
        toInsertMap.set(lowerName, {
          name: clientData.name || '',
          practice_area: fromFile('practice_area', clientData.practiceArea || []),
          conflict_risk: fromFile('conflict_risk', clientData.conflictRisk || 'Medium'),
          notes: fromFile('notes', clientData.notes || ''),
          primary_lobbyist: assigned ? assigned.legacy.primary_lobbyist : clientData.primaryLobbyist || '',
          client_originator: assigned ? assigned.legacy.client_originator : clientData.clientOriginator || '',
          lobbyist_team: assigned ? assigned.legacy.lobbyist_team : clientData.lobbyistTeam || [],
          interaction_frequency: fromFile('interaction_frequency', clientData.interactionFrequency || ''),
          ...sheetOnly
        });
      }

      if (clientData.revenue) {
        revenueDataMap.set(lowerName, clientData.revenue);
      }
    }

    // Each year's total of the file's amounts, over every client it names,
    // whether or not the import writes it (below)
    const totalsByYear = revenueTotals(
      planRevenueWrites([...revenueDataMap].map(([lowerName, revenue]) => ({ id: lowerName, revenue })), revenueYears).upserts,
      revenueYears
    );

    // A matched client the file leaves as it is is not written (WP6): its
    // stored fields and revenue against what the file would write, compared
    // as the history compares them (utils/clientChanges.cjs)
    updatedCount = toUpdateMap.size;
    for (const [lowerName, row] of toUpdateMap) {
      const existingClient = existingClientsMap.get(lowerName);
      const revenueBefore = revenueSnapshot(storedRevenue.get(String(existingClient.id)));
      const stored = { ...clientSnapshot(existingClient, { names }), revenue: revenueBefore };
      const planned = {
        ...clientSnapshot({ ...existingClient, ...row }, { names }),
        revenue: revenueDataMap.has(lowerName)
          ? importedRevenue(revenueBefore, revenueDataMap.get(lowerName), revenueYears)
          : revenueBefore
      };
      if (!clientChanges(stored, planned)) toUpdateMap.delete(lowerName);
    }

    // Map to collect returned rows by lowerName for revenue association
    const clientResultMap = new Map(); // lowerName -> returned DB row

    // --- Pass 2a: bulk UPDATE existing clients ---
    // Client ids (and, in pass 3, years) are compared as text. Production's
    // clients and client_revenues predate init-db.sql, whose CREATE TABLE IF
    // NOT EXISTS never replaced them: their ids are integers, init-db.sql's are
    // uuids, and the import must work on both.
    const updateRows = Array.from(toUpdateMap.values());
    let updatedRows = [];
    if (updateRows.length > 0) {
      const updateColumns = [['id', 'text'], ...writeColumns];
      const { sql, params } = valuesList(updateRows, updateColumns);
      params.push(accountId(req.user));
      ({ rows: updatedRows } = await conn.query(`
        UPDATE clients c SET
          ${writeColumns.map(([column]) => `${column} = v.${column}`).join(',\n          ')},
          updated_at = CURRENT_TIMESTAMP,
          updated_by = (SELECT id FROM users WHERE id = $${params.length})
        FROM (VALUES ${sql}) AS v(${updateColumns.map(([column]) => column).join(', ')})
        WHERE c.id::text = v.id
        RETURNING c.*
      `, params));
      updatedRows.forEach(r => clientResultMap.set(r.name.toLowerCase(), r));
      changedCount = updatedRows.length;
    }

    // --- Pass 2b: bulk INSERT new clients ---
    const insertRows = Array.from(toInsertMap.values());
    let insertedRows = [];
    if (insertRows.length > 0) {
      const { sql, params } = valuesList(insertRows, writeColumns);
      params.push(accountId(req.user));
      const columnNames = writeColumns.map(([column]) => column).join(', ');
      ({ rows: insertedRows } = await conn.query(`
        INSERT INTO clients (${columnNames}, updated_by)
        SELECT v.*, (SELECT id FROM users WHERE id = $${params.length})
          FROM (VALUES ${sql}) AS v(${columnNames})
        RETURNING *
      `, params));
      insertedRows.forEach(r => clientResultMap.set(r.name.toLowerCase(), r));
      insertedCount = insertedRows.length;
    }

    // --- Pass 3: revenue writes, year-agnostic (D5) ---
    // The file is authoritative for exactly the years its header names: an
    // amount > 0 sets the (client, year) row, a blank or 0 cell deletes it,
    // and years absent from the file are untouched. History survives a
    // single-year import; a corrected sheet can still zero out a year.
    // Written as the client form writes revenue: delete every (client, year)
    // the file names, then insert the positive amounts. No ON CONFLICT, which
    // needs UNIQUE (client_id, year), and no client_revenues.updated_at:
    // production's older table need not have either (see pass 2a).
    if (revenueYears.length === 0) {
      validation.warnings.push('No `YYYY Contracts` columns found; revenue not changed.');
    } else {
      // The clients written above; a matched client left as it is keeps its rows
      const revenueClients = [];
      for (const [lowerName, revenue] of revenueDataMap) {
        const dbRow = clientResultMap.get(lowerName);
        if (!dbRow) continue;
        revenueClients.push({ id: dbRow.id, revenue });
      }
      const { upserts, deletes } = planRevenueWrites(revenueClients, revenueYears);

      const pairs = [...upserts.map(([clientId, year]) => [clientId, year]), ...deletes];
      if (pairs.length > 0) {
        await conn.query(`
          DELETE FROM client_revenues r
          USING unnest($1::text[], $2::text[]) AS d(client_id, year)
          WHERE r.client_id::text = d.client_id AND r.year::text = d.year
        `, [pairs.map(([clientId]) => String(clientId)), pairs.map(([, year]) => String(year))]);
      }

      if (upserts.length > 0) {
        // Untyped placeholders: each takes its column's type, uuid or integer
        const params = [];
        const valuePlaceholders = [];
        for (const [clientId, year, amount] of upserts) {
          params.push(clientId, year, amount);
          valuePlaceholders.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
        }
        await conn.query(`
          INSERT INTO client_revenues (client_id, year, revenue_amount)
          VALUES ${valuePlaceholders.join(',')}
        `, params);
      }
    }

    // What each client written above changed, from its rows as stored
    // before and as written; a new client from nothing. One insert.
    const writtenRevenue = await revenueRowsByClient([...updatedRows, ...insertedRows].map((r) => r.id));
    const byId = new Map([...existingClientsMap.values()].map((c) => [String(c.id), c]));
    const after = (row) => clientSnapshot(row, { names, revenues: writtenRevenue.get(String(row.id)) });
    await logChanges(conn, [
      ...updatedRows.map((row) => ({
        clientId: row.id,
        clientName: row.name,
        changes: clientChanges(
          clientSnapshot(byId.get(String(row.id)), { names, revenues: storedRevenue.get(String(row.id)) }),
          after(row)
        )
      })),
      ...insertedRows.map((row) => ({ clientId: row.id, clientName: row.name, changes: clientChanges(null, after(row)) }))
    ], req.user, 'import');

    // Check file: every write above succeeded; undo them all
    await conn.query(dryRun ? 'ROLLBACK' : 'COMMIT');

    const summary = {
      totalClients: clientsWithScores.length,
      updatedClients: updatedCount,
      changedClients: changedCount,
      newClients: insertedCount,
      revenueYears,
      revenueTotals: totalsByYear,
      sheetColumns: SHEET_COLUMNS.filter(({ key }) => key in columns).map(({ header }) => header),
      totalRevenue: clientsWithScores.reduce((sum, c) => sum + (c.averageRevenue || 0), 0)
    };

    if (dryRun) {
      return res.json({ success: true, dryRun: true, validation, summary });
    }

    res.json({
      success: true,
      clients: clientsWithScores,
      validation,
      summary
    });

  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    logError('Error processing a CSV import', error);
    res.status(500).json({
      error: 'Failed to process CSV data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    conn.release();
  }
});

// Every client response comes from this one query: the client, its revenue
// rows and its three people (lead, second chair, originator). `where` is '' or
// a WHERE clause on c.
const clientsQuery = (where = '') => `
  SELECT
    c.*,
    ${updatedAtExactSql('c.updated_at')} AS updated_at_exact,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'year', r.year,
          'revenue_amount', r.revenue_amount
        ) ORDER BY r.year
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'
    ) AS revenues,
    ${CLIENT_PEOPLE_COLUMNS}
  FROM clients c
  LEFT JOIN client_revenues r ON r.client_id = c.id
  ${CLIENT_PEOPLE_JOINS}
  ${where}
  GROUP BY c.id, ${CLIENT_PEOPLE_GROUP_BY}
  ORDER BY c.created_at DESC
`;

// A joined client row in the shape the frontend expects: people nested and the
// legacy people fields filled from them (withPeopleFields), revenue by year for
// every row on file (year-agnostic), and the camelCase names the views read.
function toApiClient(row) {
  const client = withPeopleFields(row);
  return {
    ...client,
    revenue: revenueObjectFromRows(client.revenues),
    practiceArea: Array.isArray(client.practice_area) ? client.practice_area : [],
    conflictRisk: client.conflict_risk || 'Medium',
    timeCommitment: client.time_commitment || 40,
  };
}

// Joined client rows as every client response sends them: toApiClient, then
// the scorer's figures (strategicValue, stickinessScore, effort), then the
// succession metrics (relationshipType, transitionComplexity, successionRisk;
// utils/succession.cjs, docs/plans/tier-2.md, S11, WP7), which read the
// nested people and the scorer's effort. Kept out of calculateStrategicScores,
// which also scores the import's response rows (no people) and the AI's book.
const apiClients = (rows) => withSuccessionMetrics(calculateStrategicScores(rows.map(toApiClient)));

// Check a create or update's lead, second chair and originator against the
// People list, inside the write's transaction. The people it names are read
// FOR SHARE, so routes/people.cjs cannot deactivate one or move a lead out of
// the partner role until this write commits.
async function resolveAssignment(conn, body) {
  const ids = [body.lead_id, body.second_chair_id, body.originator_id]
    .map(parseId)
    .filter(Number.isInteger);
  const { rows: people } = ids.length > 0
    ? await conn.query('SELECT id, name, role, active FROM people WHERE id = ANY($1::int[]) FOR SHARE', [ids])
    : { rows: [] };
  const result = validateAssignment(body, people);
  return {
    ...result,
    legacy: legacyText({ ...result, originatorIsFirm: result.value.originator_is_firm })
  };
}

// The 400 of every client write: the fields' details (checkClient,
// utils/clientRules.cjs) and the people's (validateAssignment), each
// { field, message }
const validationFailed = (details) => ({
  success: false,
  error: 'Validation failed',
  details
});

// Who changed what (docs/plans/tier-2.md, S9, WP6; utils/clientChanges.cjs).
// Every client write reads the client it changes FOR UPDATE, writes, reads
// what it wrote, and logs one client_changes row per client that changed, in
// its own transaction: a failed insert fails the write. clients.updated_by is
// set with updated_at, to the signed-in account while it exists (the JWT is
// not checked against users, so a session can outlive its account).
const accountId = (user) => (Number.isInteger(user?.userId) ? user.userId : null);

// The client as stored, with its updated_at to the microsecond (S10). Ids
// compared as text: production's client ids are integers and init-db.sql's
// uuids. lockClient locks it until the write commits; readClient reads it
// without a lock, for a write that must lock the people first.
const CLIENT_ROW_SQL = `
  SELECT c.*, ${updatedAtExactSql('c.updated_at')} AS updated_at_exact
    FROM clients c
   WHERE c.id::text = $1`;
const readClient = async (conn, clientId) => (await conn.query(CLIENT_ROW_SQL, [clientId])).rows[0];
const lockClient = async (conn, clientId) => (await conn.query(`${CLIENT_ROW_SQL}
   FOR UPDATE`, [clientId])).rows[0];

// One name per client (utils/clientNames.cjs, Tier 3 WP2, candidate (g)):
// the 400 detail on `name` when another client already holds the name's key
// (regardless of case and unescaped, as the import matches names), or null.
// `clientId` is the client being written, as text, or null for a new one. Run
// only by a write holding CLIENT_NAME_LOCK_SQL, and only for a name checkClient
// accepted (a refused name has its detail already).
const nameTaken = async (conn, name, clientId) => {
  const { rows: [other] } = await conn.query(SAME_NAME_SQL, sameNameParams(name, clientId));
  return other ? duplicateNameDetail(other) : null;
};
const nameAccepted = (fieldErrors) => !fieldErrors.some((detail) => detail.field === 'name');

// A client's revenue rows, by its stored id (an untyped placeholder takes the
// column's type, uuid or integer)
const revenueRowsOf = async (conn, id) => (await conn.query(
  'SELECT year, revenue_amount FROM client_revenues WHERE client_id = $1', [id])).rows;

// The People list's names for the ids a change names, as they are now
const peopleNames = async (conn, ids) => {
  const wanted = [...new Set(ids.filter(Number.isInteger))];
  if (wanted.length === 0) return new Map();
  const { rows } = await conn.query('SELECT id, name FROM people WHERE id = ANY($1::int[])', [wanted]);
  return new Map(rows.map((p) => [p.id, p.name]));
};
const peopleIdsOf = (...rows) => rows.filter(Boolean)
  .flatMap((row) => [row.lead_id, row.second_chair_id, row.originator_id]);

// One statement for every client that changed; nothing when none did. A
// failure fails the write (the caller rolls back), and is rethrown without
// PostgreSQL's `detail`, which for a refused row prints the whole row, a
// note's text included; the caller logs it with logError, which reads only
// the fields copied here.
const logChanges = async (conn, entries, user, source) => {
  const params = insertChangesParams(entries, user, source);
  if (!params) return;
  try {
    await conn.query(INSERT_CHANGES_SQL, params);
  } catch (error) {
    const failure = new Error(`client_changes insert failed: ${error.message}`);
    failure.code = error.code;
    failure.constraint = error.constraint;
    failure.table = error.table;
    failure.column = error.column;
    throw failure;
  }
};

// GET /api/data/clients - Get all clients with aggregated revenue data
router.get('/clients', async (req, res) => {
  try {
    const { rows } = await db.query(clientsQuery());

    // Scored, with the succession metrics, before returning
    const clientsWithScores = apiClients(rows);
    
    res.json({
      success: true,
      clients: clientsWithScores
    });
  } catch (error) {
    logError('Error fetching clients', error);
    res.status(500).json({
      error: 'Failed to fetch clients',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/data/clients - Create new client with revenues
// The fields are checked (checkClient, utils/clientRules.cjs), then the
// people; any problem answers 400 validationFailed with both lists' details,
// the fields' first, and writes nothing. A body that is not an object answers
// its one detail before anything is read. A name another client already has,
// regardless of case and unescaped, is a detail on `name` among the fields'
// (Tier 3 WP2, candidate (g)), checked under the client-name lock, which the
// transaction takes first.
router.post('/clients', async (req, res) => {
  const fieldErrors = checkClient(req.body);
  if (!isObjectBody(req.body)) return res.status(400).json(validationFailed(fieldErrors));

  const conn = await db.pool.connect();

  try {
    await conn.query('BEGIN');
    // Before any name is read: a second save of the same name waits here
    // until this one commits, and then finds it (utils/clientNames.cjs)
    await conn.query(CLIENT_NAME_LOCK_SQL);

    // The legacy retention columns (relationship_strength, relationship_intensity,
    // renewal_probability) and the phantom strategic_fit_score are retired: no
    // longer written here. They remain in the table (nullable / defaulted) until
    // a later V4 migration drops them, so existing rows are untouched.
    // People come as ids (lead_id, second_chair_id, originator_id,
    // originator_is_firm); the legacy primary_lobbyist, client_originator and
    // lobbyist_team are written from them and ignored in the body. Contract
    // status is retired (P13): a `status` in the body is ignored, and the
    // column is never written.
    const {
      name,
      practice_area,
      conflict_risk,
      notes,
      interaction_frequency,
      stickiness = null,
      high_maintenance = false,
      revenues = []
    } = req.body;

    const taken = nameAccepted(fieldErrors) ? await nameTaken(conn, name, null) : null;
    const assignment = await resolveAssignment(conn, req.body);
    // The name's detail first, in the body's order (checkClient's name
    // detail, when there is one, is first already)
    const details = [...(taken ? [taken] : []), ...fieldErrors, ...assignment.errors];
    if (details.length > 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json(validationFailed(details));
    }
    const people = assignment.value;
    const legacy = assignment.legacy;

    // Insert client record
    const { rows: [newClient] } = await conn.query(`
      INSERT INTO clients (
        name, practice_area, conflict_risk, notes, primary_lobbyist,
        client_originator, lobbyist_team, interaction_frequency,
        stickiness, high_maintenance,
        lead_id, second_chair_id, originator_id, originator_is_firm, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                (SELECT id FROM users WHERE id = $15))
      RETURNING *
    `, [
      name, practice_area, conflict_risk, notes, legacy.primary_lobbyist,
      legacy.client_originator, legacy.lobbyist_team, interaction_frequency,
      stickiness, high_maintenance,
      people.lead_id, people.second_chair_id, people.originator_id, people.originator_is_firm,
      accountId(req.user)
    ]);

    // Insert revenue records in bulk
    if (revenues.length > 0) {
      const params = [];
      const valuePlaceholders = [];
      let paramIndex = 1;
      revenues.forEach(revenue => {
        params.push(newClient.id, revenue.year, revenue.revenue_amount);
        valuePlaceholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2})`);
        paramIndex += 3;
      });
      const query = `
        INSERT INTO client_revenues (client_id, year, revenue_amount)
        VALUES ${valuePlaceholders.join(',')}
      `;
      await conn.query(query, params);
    }

    // A new client is a change from nothing: every field it has, as written
    const names = await peopleNames(conn, peopleIdsOf(newClient));
    const after = clientSnapshot(newClient, { names, revenues: await revenueRowsOf(conn, newClient.id) });
    await logChanges(conn, [{ clientId: newClient.id, clientName: newClient.name, changes: clientChanges(null, after) }], req.user, 'form');

    await conn.query('COMMIT');
    
    // Fetch the complete client with revenues and people
    const { rows } = await db.query(clientsQuery('WHERE c.id = $1'), [newClient.id]);

    // Scored, with the succession metrics, as GET sends it
    const clientsWithScores = apiClients(rows);

    res.status(201).json({
      success: true,
      client: clientsWithScores[0]
    });
    
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    logError('Error creating client', error);
    res.status(500).json({
      error: 'Failed to create client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    conn.release();
  }
});

// PUT /api/data/clients/:id - Update client with revenues
// Checked as POST is, before the client is looked up: a body the rules refuse
// (the fields, `expected_updated_at`'s form, the people) answers 400 whatever
// the id. Then the client, read FOR UPDATE: 404 when there is none, and 409
// when `expected_updated_at` (S10, docs/plans/tier-2.md WP6) is not the
// updated_at_exact it holds now, with who saved it last and when (the newest
// client_changes row). A body without `expected_updated_at` (the older page,
// a direct request) is not checked, and is logged like any other. `revenues`
// is the client's whole revenue, as before; a body without it leaves the
// stored revenue as it is, and `revenues: []` clears it. A save that changes
// nothing writes nothing: no updated_at, no history row. A save that gives the
// client a name another client already has, regardless of case and unescaped,
// is refused with a detail on `name` among the fields' (Tier 3 WP2, candidate
// (g)); one that keeps its client's name is not, so two clients already
// sharing a name stay editable. That is a body refusal too: a missing id
// with a name another client has answers 400, not 404.
router.put('/clients/:id', async (req, res) => {
  const fieldErrors = checkClient(req.body);
  if (!isObjectBody(req.body)) return res.status(400).json(validationFailed(fieldErrors));
  const expected = readExpectedUpdatedAt(req.body);

  const conn = await db.pool.connect();

  try {
    await conn.query('BEGIN');
    // The client-name lock first, whether or not this save renames the
    // client: the name it keeps or changes is read below, and must not
    // change in between (utils/clientNames.cjs)
    await conn.query(CLIENT_NAME_LOCK_SQL);

    // Compared as text, as the second-chair route does: production's client
    // ids are integers and init-db.sql's uuids, so an id of the other type, or
    // a malformed one, matches nobody (404) instead of failing in PostgreSQL
    const clientId = String(req.params.id);
    // Legacy retention columns (relationship_strength, relationship_intensity,
    // renewal_probability) and the phantom strategic_fit_score are retired and
    // intentionally left out of the SET clause — an edit no longer touches them,
    // preserving any existing values until a later V4 migration drops them.
    // People come as ids, as in POST; the legacy text is written from them.
    // A `status` in the body is ignored, as in POST.
    const {
      name,
      practice_area,
      conflict_risk,
      notes,
      interaction_frequency,
      stickiness = null,
      high_maintenance = false,
      revenues
    } = req.body;

    // A name another client holds, unless the client keeps its own: read
    // without a lock (the lock below comes after the people's), which the
    // client-name lock makes safe, since no other write can change a
    // client's name until this one ends. No such client: its name is new.
    const stored = await readClient(conn, clientId);
    const taken = nameAccepted(fieldErrors) && givesNewName(stored?.name, name)
      ? await nameTaken(conn, name, clientId)
      : null;

    // The people are read FOR SHARE before the client is locked, as every
    // write does, so a rename (routes/people.cjs: the person, then its
    // clients) cannot deadlock with a save
    const assignment = await resolveAssignment(conn, req.body);
    const details = [...(taken ? [taken] : []), ...fieldErrors, ...expected.errors, ...assignment.errors];
    if (details.length > 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json(validationFailed(details));
    }
    const people = assignment.value;
    const legacy = assignment.legacy;

    // Read, compare, then write: the lock holds a second save of the same
    // client until this one commits, and that save then finds the new
    // updated_at and answers 409
    const before = await lockClient(conn, clientId);
    if (!before) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }
    if (expected.present && !isCurrent(before.updated_at_exact, expected.value)) {
      const { rows: [latest] } = await conn.query(LATEST_CHANGE_SQL, [String(before.id)]);
      await conn.query('ROLLBACK');
      return res.status(409).json(conflictBody(latest));
    }
    const revenueBefore = revenues !== undefined ? await revenueRowsOf(conn, before.id) : undefined;

    // Update client record
    const { rows: [updatedClient] } = await conn.query(`
      UPDATE clients SET
        name = $1, practice_area = $2, conflict_risk = $3,
        notes = $4, primary_lobbyist = $5, client_originator = $6,
        lobbyist_team = $7, interaction_frequency = $8,
        stickiness = $9, high_maintenance = $10,
        lead_id = $11, second_chair_id = $12, originator_id = $13,
        originator_is_firm = $14,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = (SELECT id FROM users WHERE id = $16)
      WHERE id::text = $15
      RETURNING *
    `, [
      name, practice_area, conflict_risk,
      notes, legacy.primary_lobbyist, legacy.client_originator,
      legacy.lobbyist_team, interaction_frequency,
      stickiness, high_maintenance,
      people.lead_id, people.second_chair_id, people.originator_id,
      people.originator_is_firm,
      clientId,
      accountId(req.user)
    ]);

    // Replace the revenue with the body's, when it has any. From here on the
    // client's id is the stored one, in untyped placeholders that take the
    // column's type, uuid or integer
    if (revenues !== undefined) {
      await conn.query('DELETE FROM client_revenues WHERE client_id = $1', [updatedClient.id]);
    }

    // Insert new revenues in bulk
    if (revenues !== undefined && revenues.length > 0) {
      const params = [];
      const valuePlaceholders = [];
      let paramIndex = 1;
      revenues.forEach(revenue => {
        params.push(updatedClient.id, revenue.year, revenue.revenue_amount);
        valuePlaceholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2})`);
        paramIndex += 3;
      });
      const query = `
        INSERT INTO client_revenues (client_id, year, revenue_amount)
        VALUES ${valuePlaceholders.join(',')}
      `;
      await conn.query(query, params);
    }

    // What changed, from the rows as stored before and after (a field left
    // out took the route's default, and revenue changed only if sent). None:
    // undo the write, so updated_at stays and no row is logged.
    const names = await peopleNames(conn, peopleIdsOf(before, updatedClient));
    const changes = clientChanges(
      clientSnapshot(before, { names, revenues: revenueBefore }),
      clientSnapshot(updatedClient, {
        names,
        revenues: revenues !== undefined ? await revenueRowsOf(conn, updatedClient.id) : undefined
      })
    );
    if (changes) {
      await logChanges(conn, [{ clientId: updatedClient.id, clientName: updatedClient.name, changes }], req.user, 'form');
      await conn.query('COMMIT');
    } else {
      await conn.query('ROLLBACK');
    }
    
    // Fetch the complete updated client with revenues and people
    const { rows } = await db.query(clientsQuery('WHERE c.id = $1'), [updatedClient.id]);

    // Scored, with the succession metrics, as GET sends it
    const clientsWithScores = apiClients(rows);

    res.json({
      success: true,
      client: clientsWithScores[0]
    });
    
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    logError('Error updating client', error);
    res.status(500).json({
      error: 'Failed to update client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    conn.release();
  }
});

// PUT /api/data/clients/:id/second-chair { second_chair_id, expected_second_chair_id }
// The associate split (docs/plans/people-and-second-chair.md, Phase 6, P9): a
// partner accepts a proposed second chair, and only that seat changes. The
// client's lead, originator, judgments and revenue are untouched; the legacy
// lobbyist_team text follows the seat (P6). `expected_second_chair_id` is the
// seat as the page saw it (null for none): if another partner filled it in
// the meantime, the answer is 409 and nothing is written. The second chair is
// checked as every write checks it (validateAssignment: an active person on
// the People list, not the lead). Ids are compared as text: production's
// client ids are integers. The change is logged as `second-chair` (WP6); a
// request that sets the seat the client already holds changes nothing and
// writes nothing, updated_at included.
//
// The locks are taken in a rename's order (Tier 3 WP2, candidate (b)): a
// rename (routes/people.cjs) locks the person, then the clients that name
// them, and every client write reads the people it assigns FOR SHARE before
// it locks the client. Until WP2 this route locked the client first, so an
// Accept and a rename of the client's lead at the same moment each held what
// the other needed, and PostgreSQL aborted one of them (40P01, a 500). Now the
// client is read without a lock (404 when there is none), the people it
// assigns (its lead and originator, and the new second chair) are read FOR
// SHARE, and only then is the client locked FOR UPDATE. If its lead or
// originator changed in between, the people checked are not its people any
// more: 409 with a message of its own, nothing written.
const SEAT_CHANGED = "This client's second chair changed since the page loaded. Reload the page and try again.";
const PEOPLE_CHANGED = "This client's lead or originator changed at the same moment, so nothing was written. Reload the page and try again.";
router.put('/clients/:id/second-chair', async (req, res) => {
  const body = req.body || {};
  const clientId = String(req.params.id);
  const expected = body.expected_second_chair_id === null ? null : parseId(body.expected_second_chair_id);
  // Both keys are required; `expected` is null only when the page sent null
  if (!('second_chair_id' in body) || Number.isNaN(expected) ||
      (body.expected_second_chair_id !== null && expected === null)) {
    return res.status(400).json({
      success: false,
      error: 'second_chair_id and expected_second_chair_id (a person id, or null for none) are required'
    });
  }

  const conn = await db.pool.connect();
  try {
    await conn.query('BEGIN');
    // Read, not locked: the people are locked first
    const current = await readClient(conn, clientId);
    if (!current) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    if ((current.second_chair_id ?? null) !== expected) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ success: false, error: SEAT_CHANGED });
    }
    if (current.lead_id === null) {
      await conn.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: 'This client has no lead yet. Give it a lead in Client Details first.'
      });
    }

    const assignment = await resolveAssignment(conn, {
      lead_id: current.lead_id,
      second_chair_id: body.second_chair_id,
      originator_id: current.originator_id,
      originator_is_firm: current.originator_is_firm
    });
    if (assignment.errors.length > 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json(validationFailed(assignment.errors));
    }

    // Now the client, locked until the write commits, as it is now: another
    // write may have landed since it was read (a rename's rewrite of its
    // legacy text, which this write keeps, or a change to its seats)
    const locked = await lockClient(conn, clientId);
    if (!locked) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    if ((locked.second_chair_id ?? null) !== expected) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ success: false, error: SEAT_CHANGED });
    }
    if (locked.lead_id !== current.lead_id || locked.originator_id !== current.originator_id) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ success: false, error: PEOPLE_CHANGED });
    }

    const { rows: [updated] } = await conn.query(`
      UPDATE clients
         SET second_chair_id = $1, lobbyist_team = $2, updated_at = CURRENT_TIMESTAMP,
             updated_by = (SELECT id FROM users WHERE id = $4)
       WHERE id::text = $3
       RETURNING *`,
      [assignment.value.second_chair_id, assignment.legacy.lobbyist_team, clientId, accountId(req.user)]);
    const names = await peopleNames(conn, peopleIdsOf(locked, updated));
    const changes = clientChanges(clientSnapshot(locked, { names }), clientSnapshot(updated, { names }));
    if (changes) {
      await logChanges(conn, [{ clientId: updated.id, clientName: updated.name, changes }], req.user, 'second-chair');
      await conn.query('COMMIT');
    } else {
      await conn.query('ROLLBACK');
    }

    const { rows } = await db.query(clientsQuery('WHERE c.id::text = $1'), [clientId]);
    res.json({ success: true, client: apiClients(rows)[0] });
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    logError('Error assigning a second chair', error);
    res.status(500).json({ success: false, error: 'Failed to assign the second chair' });
  } finally {
    conn.release();
  }
});

// DELETE /api/data/clients/:id - Delete client and associated revenues
// The client is read FOR UPDATE with its revenue and logged as `delete`
// (WP6): every field it had, from its value to null, with its name kept, so
// its history outlives it. No expected_updated_at: the plan gives DELETE none
// (docs/plans/tier-2.md, section 11), and the page asks before deleting.
router.delete('/clients/:id', async (req, res) => {
  const conn = await db.pool.connect();
  
  try {
    await conn.query('BEGIN');
    
    // Compared as text, as in PUT: an id of the other type, or a malformed
    // one, matches nobody (404)
    const clientId = String(req.params.id);

    const before = await lockClient(conn, clientId);
    if (!before) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }
    const revenueBefore = await revenueRowsOf(conn, before.id);
    const names = await peopleNames(conn, peopleIdsOf(before));

    // First delete associated revenues, then the client, by the stored id
    await conn.query('DELETE FROM client_revenues WHERE client_id = $1', [before.id]);
    await conn.query('DELETE FROM clients WHERE id = $1', [before.id]);

    const changes = clientChanges(clientSnapshot(before, { names, revenues: revenueBefore }), null);
    await logChanges(conn, [{ clientId: before.id, clientName: before.name, changes }], req.user, 'delete');

    await conn.query('COMMIT');
    
    res.status(204).end();
    
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    logError('Error deleting client', error);
    res.status(500).json({ 
      error: 'Failed to delete client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    conn.release();
  }
});

// GET /api/data/clients/:id/changes - a client's history (WP6), newest first:
// { success, changes: [{ id, client_id, client_name, changed_by_username,
// source, changes, created_at }] }. Read from client_changes alone, by the id
// as text: a deleted client's history answers as any other (it outlives the
// client, and ids are never reused), and an id with no history answers an
// empty list.
router.get('/clients/:id/changes', async (req, res) => {
  try {
    const { rows } = await db.query(CLIENT_CHANGES_SQL, [String(req.params.id)]);
    res.json({ success: true, changes: rows });
  } catch (error) {
    logError('Error fetching client changes', error);
    res.status(500).json({ success: false, error: 'Failed to load the client\'s history' });
  }
});

module.exports = router;

