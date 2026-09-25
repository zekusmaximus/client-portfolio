const express = require('express');
const router = express.Router();
const db = require('./db.cjs');
const auth = require('./middleware/auth.cjs');
const { body, validationResult } = require('express-validator');
const { sanitizeRequestBody } = require('./middleware/validation.cjs');
const {
  processCSVData,
  validateClientData,
  calculateStrategicScores,
  optimizePortfolio
} = require('./clientAnalyzer.cjs');
const { extractRevenueYears, headerKeys, planRevenueWrites } = require('./utils/csvImport.cjs');
const { revenueObjectFromRows } = require('./utils/strategic.cjs');
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
router.use(sanitizeRequestBody);

// Helper function to decode HTML entities
function decodeHTMLEntities(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Helper to calculate strategic value for a single client
function calculateStrategicValue(client) {
  // 1. Convert qualitative fields
  const intensityScore = client.relationshipIntensity ?? 5;           // 1-10
  const crisisNeedsMap = { Low: 1, Medium: 5, High: 9 };
  const crisisScore = 10 - (crisisNeedsMap[client.crisisManagementNeeds] ?? 5);

  // 2. Quantitative defaults
  const revenueScore            = client.revenueScore           ?? 0;
  const growthScore             = client.growthScore            ?? 0;
  const strategicFitScore       = client.strategicFitScore      ?? 5;
  const renewalProbabilityScore = (client.renewalProbability ?? 0.7) * 10;

  // 3. Conflict penalty
  const conflictPenalty = { High: 3, Medium: 1, Low: 0 }[client.conflictRisk] ?? 1;

  // 4. Weighted formula
  const value = (
    revenueScore            * 0.20 +
    intensityScore          * 0.30 +
    strategicFitScore       * 0.15 +
    renewalProbabilityScore * 0.15 +
    crisisScore             * 0.10 +
    growthScore             * 0.10
  ) - conflictPenalty;

  return Math.max(0, Math.min(12, value));
}

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
          throw new Error(`Row ${i + 1}: Must be an object`);
        }
        
        // Check for required fields (CLIENT is minimum requirement)
        if (!row.CLIENT || typeof row.CLIENT !== 'string' || !row.CLIENT.trim()) {
          throw new Error(`Row ${i + 1}: CLIENT is required and must be a non-empty string`);
        }
        
        // Validate CLIENT length and pattern
        if (row.CLIENT.trim().length > 255) {
          throw new Error(`Row ${i + 1}: CLIENT must not exceed 255 characters`);
        }
        
        // Decode HTML entities for validation
        const decodedClient = decodeHTMLEntities(row.CLIENT.trim());
        
        if (!/^[a-zA-Z0-9\s\-.,&'()/]+$/.test(decodedClient)) {
          throw new Error(`Row ${i + 1}: CLIENT contains invalid characters`);
        }
      }
      
      return true;
    })
];

// Handle validation errors for CSV
const handleCSVValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));
    
    return res.status(400).json({
      error: 'CSV validation failed',
      details: errorMessages
    });
  }
  
  next();
};

// POST /api/data/process-csv
router.post('/process-csv', csvValidationRules, handleCSVValidationErrors, async (req, res) => {
  const client = db.pool.connect();
  
  try {
    const { csvData } = req.body;
    
    if (!csvData || !Array.isArray(csvData)) {
      return res.status(400).json({ 
        error: 'Invalid CSV data. Expected array of objects.' 
      });
    }

    // Process the CSV data
    // First, decode HTML entities in the raw CSV data
    const decodedCsvData = csvData.map(row => {
      const decodedRow = {};
      for (const [key, value] of Object.entries(row)) {
        decodedRow[key] = typeof value === 'string' ? decodeHTMLEntities(value) : value;
      }
      return decodedRow;
    });
    
    const clients = processCSVData(decodedCsvData);

    // The years the file covers, from its `YYYY Contracts` headers (D5)
    const revenueYears = extractRevenueYears(headerKeys(decodedCsvData));
    
    // Validate the processed data
    const validation = validateClientData(clients);
    
    // Calculate strategic scores
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Save to database using upsert logic
    await (await client).query('BEGIN');

    // Pre-fetch all existing clients to avoid N+1 queries
    const clientNames = clientsWithScores
      .map(c => c.name)
      .filter(n => typeof n === 'string' && n.trim().length > 0);
    
    // Map to store existing clients: Lowercase Name -> Client Object
    const existingClientsMap = new Map();
    
    if (clientNames.length > 0) {
      // Fetch all potential matches in one query
      // Using ANY($1) allows us to match against an array of lowercased names
      const { rows: allExistingClients } = await (await client).query(`
        SELECT id, name, practice_area, relationship_strength, conflict_risk,
               renewal_probability, strategic_fit_score, notes, primary_lobbyist,
               client_originator, lobbyist_team, interaction_frequency, relationship_intensity
        FROM clients 
        WHERE LOWER(name) = ANY($1)
      `, [clientNames.map(n => n.toLowerCase())]);

      allExistingClients.forEach(c => {
        if (c.name) {
          existingClientsMap.set(c.name.toLowerCase(), c);
        }
      });
    }

    let updatedCount = 0;
    let insertedCount = 0;

    // --- Pass 1: compute all field values and deduplicate by name ---
    // Later CSV rows for the same client name override earlier ones (matches original behaviour).
    const toUpdateMap = new Map(); // lowerName -> row data for bulk UPDATE
    const toInsertMap = new Map(); // lowerName -> row data for bulk INSERT
    const revenueDataMap = new Map(); // lowerName -> revenue object (last occurrence wins)

    for (const clientData of clientsWithScores) {
      const lowerName = (clientData.name || '').toLowerCase();
      const existingClient = existingClientsMap.get(lowerName);

      if (existingClient) {
        // Preserve manual enhancements (only if they were manually set and differ from defaults)
        const preservedPracticeArea = existingClient.practice_area && existingClient.practice_area.length > 0
          ? existingClient.practice_area
          : clientData.practiceArea || [];

        const preservedRelationshipStrength = existingClient.relationship_strength !== 5
          ? existingClient.relationship_strength
          : clientData.relationshipStrength || 5;

        const preservedConflictRisk = existingClient.conflict_risk !== 'Medium'
          ? existingClient.conflict_risk
          : clientData.conflictRisk || 'Medium';

        const preservedRenewalProbability = existingClient.renewal_probability !== 0.7
          ? existingClient.renewal_probability
          : clientData.renewalProbability || 0.7;

        const preservedStrategicFitScore = existingClient.strategic_fit_score !== 5
          ? existingClient.strategic_fit_score
          : clientData.strategicFitScore || 5;

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

        const preservedRelationshipIntensity = existingClient.relationship_intensity !== 5
          ? existingClient.relationship_intensity
          : clientData.relationshipIntensity || 5;

        toUpdateMap.set(lowerName, {
          id: existingClient.id,
          name: clientData.name || '',
          status: clientData.status || 'H',
          practiceArea: preservedPracticeArea,
          relationshipStrength: preservedRelationshipStrength,
          conflictRisk: preservedConflictRisk,
          renewalProbability: preservedRenewalProbability,
          strategicFitScore: preservedStrategicFitScore,
          notes: preservedNotes,
          primaryLobbyist: preservedPrimaryLobbyist,
          clientOriginator: preservedClientOriginator,
          lobbyistTeam: preservedLobbyistTeam,
          interactionFrequency: preservedInteractionFrequency,
          relationshipIntensity: preservedRelationshipIntensity
        });
      } else {
        toInsertMap.set(lowerName, {
          name: clientData.name || '',
          status: clientData.status || 'H',
          practiceArea: clientData.practiceArea || [],
          relationshipStrength: clientData.relationshipStrength || 5,
          conflictRisk: clientData.conflictRisk || 'Medium',
          renewalProbability: clientData.renewalProbability || 0.7,
          strategicFitScore: clientData.strategicFitScore || 5,
          notes: clientData.notes || '',
          primaryLobbyist: clientData.primaryLobbyist || '',
          clientOriginator: clientData.clientOriginator || '',
          lobbyistTeam: clientData.lobbyistTeam || [],
          interactionFrequency: clientData.interactionFrequency || '',
          relationshipIntensity: clientData.relationshipIntensity || 5
        });
      }

      if (clientData.revenue) {
        revenueDataMap.set(lowerName, clientData.revenue);
      }
    }

    // Map to collect returned rows by lowerName for revenue association
    const clientResultMap = new Map(); // lowerName -> returned DB row

    // --- Pass 2a: bulk UPDATE existing clients ---
    const updateRows = Array.from(toUpdateMap.values());
    if (updateRows.length > 0) {
      const params = [];
      const valuePlaceholders = [];
      let paramIndex = 1;
      for (const u of updateRows) {
        params.push(
          u.id, u.name, u.status, u.practiceArea, u.relationshipStrength,
          u.conflictRisk, u.renewalProbability, u.strategicFitScore,
          u.notes, u.primaryLobbyist, u.clientOriginator,
          u.lobbyistTeam, u.interactionFrequency, u.relationshipIntensity
        );
        valuePlaceholders.push(
          `($${paramIndex}::uuid, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}::text[], $${paramIndex+4}::numeric, $${paramIndex+5}, $${paramIndex+6}::numeric, $${paramIndex+7}::numeric, $${paramIndex+8}, $${paramIndex+9}, $${paramIndex+10}, $${paramIndex+11}::text[], $${paramIndex+12}, $${paramIndex+13}::numeric)`
        );
        paramIndex += 14;
      }
      const { rows: updatedRows } = await (await client).query(`
        UPDATE clients c SET
          name = v.name,
          status = v.status,
          practice_area = v.practice_area,
          relationship_strength = v.relationship_strength,
          conflict_risk = v.conflict_risk,
          renewal_probability = v.renewal_probability,
          strategic_fit_score = v.strategic_fit_score,
          notes = v.notes,
          primary_lobbyist = v.primary_lobbyist,
          client_originator = v.client_originator,
          lobbyist_team = v.lobbyist_team,
          interaction_frequency = v.interaction_frequency,
          relationship_intensity = v.relationship_intensity,
          updated_at = CURRENT_TIMESTAMP
        FROM (VALUES ${valuePlaceholders.join(',')}) AS v(
          id, name, status, practice_area, relationship_strength, conflict_risk,
          renewal_probability, strategic_fit_score, notes, primary_lobbyist,
          client_originator, lobbyist_team, interaction_frequency, relationship_intensity
        )
        WHERE c.id = v.id
        RETURNING c.*
      `, params);
      updatedRows.forEach(r => clientResultMap.set(r.name.toLowerCase(), r));
      updatedCount = updatedRows.length;
    }

    // --- Pass 2b: bulk INSERT new clients ---
    const insertRows = Array.from(toInsertMap.values());
    if (insertRows.length > 0) {
      const params = [];
      const valuePlaceholders = [];
      let paramIndex = 1;
      for (const ins of insertRows) {
        params.push(
          ins.name, ins.status, ins.practiceArea, ins.relationshipStrength,
          ins.conflictRisk, ins.renewalProbability, ins.strategicFitScore,
          ins.notes, ins.primaryLobbyist, ins.clientOriginator,
          ins.lobbyistTeam, ins.interactionFrequency, ins.relationshipIntensity
        );
        valuePlaceholders.push(
          `($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}::text[], $${paramIndex+3}::numeric, $${paramIndex+4}, $${paramIndex+5}::numeric, $${paramIndex+6}::numeric, $${paramIndex+7}, $${paramIndex+8}, $${paramIndex+9}, $${paramIndex+10}::text[], $${paramIndex+11}, $${paramIndex+12}::numeric)`
        );
        paramIndex += 13;
      }
      const { rows: insertedRows } = await (await client).query(`
        INSERT INTO clients (
          name, status, practice_area, relationship_strength, conflict_risk,
          renewal_probability, strategic_fit_score, notes, primary_lobbyist,
          client_originator, lobbyist_team, interaction_frequency, relationship_intensity
        )
        VALUES ${valuePlaceholders.join(',')}
        RETURNING *
      `, params);
      insertedRows.forEach(r => clientResultMap.set(r.name.toLowerCase(), r));
      insertedCount = insertedRows.length;
    }

    // --- Pass 3: revenue writes, year-agnostic (D5) ---
    // The file is authoritative for exactly the years its header names: an
    // amount > 0 upserts the (client, year) row, a blank or 0 cell deletes it,
    // and years absent from the file are untouched. History survives a
    // single-year import; a corrected sheet can still zero out a year.
    if (revenueYears.length === 0) {
      validation.warnings.push('No `YYYY Contracts` columns found; revenue not changed.');
    } else {
      const revenueClients = [];
      for (const [lowerName, revenue] of revenueDataMap) {
        const dbRow = clientResultMap.get(lowerName);
        if (!dbRow) continue;
        revenueClients.push({ id: dbRow.id, revenue });
      }
      const { upserts, deletes } = planRevenueWrites(revenueClients, revenueYears);

      if (upserts.length > 0) {
        const params = [];
        const valuePlaceholders = [];
        let paramIndex = 1;
        for (const [clientId, year, amount] of upserts) {
          params.push(clientId, year, amount);
          valuePlaceholders.push(`($${paramIndex}::uuid, $${paramIndex+1}::int, $${paramIndex+2}::numeric)`);
          paramIndex += 3;
        }
        // UNIQUE(client_id, year) in init-db.sql makes this a true upsert
        await (await client).query(`
          INSERT INTO client_revenues (client_id, year, revenue_amount)
          VALUES ${valuePlaceholders.join(',')}
          ON CONFLICT (client_id, year) DO UPDATE
            SET revenue_amount = EXCLUDED.revenue_amount,
                updated_at = CURRENT_TIMESTAMP
        `, params);
      }

      if (deletes.length > 0) {
        await (await client).query(`
          DELETE FROM client_revenues r
          USING unnest($1::uuid[], $2::int[]) AS d(client_id, year)
          WHERE r.client_id = d.client_id AND r.year = d.year
        `, [deletes.map(([clientId]) => clientId), deletes.map(([, year]) => year)]);
      }
    }

    await (await client).query('COMMIT');
    
    res.json({
      success: true,
      clients: clientsWithScores,
      validation,
      summary: {
        totalClients: clientsWithScores.length,
        updatedClients: updatedCount,
        newClients: insertedCount,
        revenueYears,
        totalRevenue: clientsWithScores.reduce((sum, c) => sum + (c.averageRevenue || 0), 0),
        statusBreakdown: {
          'Active': clientsWithScores.filter(c => c.status === 'Active' || c.status === 'IF').length,
          'Prospect': clientsWithScores.filter(c => c.status === 'Prospect' || c.status === 'P').length,
          'Former': clientsWithScores.filter(c => c.status === 'Former' || c.status === 'D').length,
          'Inactive': clientsWithScores.filter(c => c.status === 'Inactive' || c.status === 'H').length
        }
      }
    });

  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('CSV processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process CSV data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});

// POST /api/data/update-client
router.post('/update-client', (req, res) => {
  try {
    const { clients, updatedClient } = req.body;
    
    if (!clients || !Array.isArray(clients) || !updatedClient) {
      return res.status(400).json({ 
        error: 'Invalid request. Expected clients array and updatedClient object.' 
      });
    }

    // Calculate new strategic value for the updated client
    updatedClient.strategicValue = calculateStrategicValue(updatedClient);

    // Update the client in the array (replace old record)
    const updatedClients = clients.map(client =>
      client.id === updatedClient.id ? { ...client, ...updatedClient } : client
    );

    // Return the full updated clients array
    res.json({
      success: true,
      clients: updatedClients
    });

  } catch (error) {
    console.error('Client update error:', error);
    res.status(500).json({ 
      error: 'Failed to update client data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/data/optimize-portfolio
router.post('/optimize-portfolio', (req, res) => {
  try {
    const { clients, maxCapacity = 2000 } = req.body;
    
    if (!clients || !Array.isArray(clients)) {
      return res.status(400).json({ 
        error: 'Invalid request. Expected clients array.' 
      });
    }

    // Ensure clients have strategic scores
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Optimize the portfolio
    const optimization = optimizePortfolio(clientsWithScores, maxCapacity);
    
    res.json({
      success: true,
      optimization,
      parameters: {
        maxCapacity,
        totalEligibleClients: clientsWithScores.filter(c => 
          (c.status === 'IF' || c.status === 'P') && (parseFloat(c.timeCommitment) || 0) > 0
        ).length
      }
    });

  } catch (error) {
    console.error('Portfolio optimization error:', error);
    res.status(500).json({ 
      error: 'Failed to optimize portfolio',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/data/analytics
router.post('/analytics', (req, res) => {
  try {
    const { clients } = req.body;
    
    if (!clients || !Array.isArray(clients)) {
      return res.status(400).json({ 
        error: 'Invalid request. Expected clients array.' 
      });
    }

    // Calculate analytics
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Practice area breakdown
    const practiceAreas = {};
    clientsWithScores.forEach(client => {
      if (client.practiceArea && Array.isArray(client.practiceArea)) {
        client.practiceArea.forEach(area => {
          if (!practiceAreas[area]) {
            practiceAreas[area] = { count: 0, revenue: 0 };
          }
          practiceAreas[area].count++;
          practiceAreas[area].revenue += client.averageRevenue || 0;
        });
      }
    });
    
    // Revenue by status - using new status labels that match client cards
    const revenueByStatus = {
      'Active': 0, 'Prospect': 0, 'Inactive': 0, 'Former': 0
    };
    clientsWithScores.forEach(client => {
      const clientStatus = client.status;
      
      // Map old status codes to new labels if needed
      const statusMapping = {
        'IF': 'Active',
        'P': 'Prospect', 
        'D': 'Former',
        'H': 'Inactive'
      };
      
      const mappedStatus = statusMapping[clientStatus] || clientStatus || 'Prospect';
      
      if (Object.prototype.hasOwnProperty.call(revenueByStatus, mappedStatus)) {
        revenueByStatus[mappedStatus] += client.averageRevenue || 0; // averageRevenue already contains 2025 data only
      } else {
        revenueByStatus['Prospect'] += client.averageRevenue || 0; // Default fallback
      }
    });
    
    // Top clients by strategic value
    const topClients = clientsWithScores
      .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0))
      .slice(0, 10);
    
    res.json({
      success: true,
      analytics: {
        practiceAreas,
        revenueByStatus,
        topClients,
        totalRevenue: clientsWithScores.reduce((sum, c) => sum + (c.averageRevenue || 0), 0),
        averageStrategicValue: clientsWithScores.length > 0 ? 
          clientsWithScores.reduce((sum, c) => sum + (c.strategicValue || 0), 0) / clientsWithScores.length : 0
      }
    });

  } catch (error) {
    console.error('Analytics calculation error:', error);
    res.status(500).json({ 
      error: 'Failed to calculate analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Every client response comes from this one query: the client, its revenue
// rows and its three people (lead, second chair, originator). `where` is '' or
// a WHERE clause on c.
const clientsQuery = (where = '') => `
  SELECT
    c.*,
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
    relationshipStrength: client.relationship_strength || 5,
    conflictRisk: client.conflict_risk || 'Medium',
    renewalProbability: client.renewal_probability || 0.7,
    strategicFitScore: client.strategic_fit_score || 5,
    timeCommitment: client.time_commitment || 40,
  };
}

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

const assignmentRejected = (errors) => ({
  success: false,
  error: 'Validation failed',
  details: errors
});

// GET /api/data/clients - Get all clients with aggregated revenue data
router.get('/clients', async (req, res) => {
  try {
    const { rows } = await db.query(clientsQuery());

    // Calculate strategic scores for all clients before returning
    const clientsWithScores = calculateStrategicScores(rows.map(toApiClient));
    
    res.json({
      success: true,
      clients: clientsWithScores
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ 
      error: 'Failed to fetch clients',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/data/clients - Create new client with revenues
router.post('/clients', async (req, res) => {
  const client = db.pool.connect();
  
  try {
    await (await client).query('BEGIN');
    
    // The legacy retention columns (relationship_strength, relationship_intensity,
    // renewal_probability) and the phantom strategic_fit_score are retired: no
    // longer written here. They remain in the table (nullable / defaulted) until
    // a later V4 migration drops them, so existing rows are untouched.
    // People come as ids (lead_id, second_chair_id, originator_id,
    // originator_is_firm); the legacy primary_lobbyist, client_originator and
    // lobbyist_team are written from them and ignored in the body.
    const {
      name,
      status,
      practice_area,
      conflict_risk,
      notes,
      interaction_frequency,
      stickiness = null,
      high_maintenance = false,
      revenues = []
    } = req.body;

    const assignment = await resolveAssignment(await client, req.body);
    if (assignment.errors.length > 0) {
      await (await client).query('ROLLBACK');
      return res.status(400).json(assignmentRejected(assignment.errors));
    }
    const people = assignment.value;
    const legacy = assignment.legacy;

    // Insert client record
    const { rows: [newClient] } = await (await client).query(`
      INSERT INTO clients (
        name, status, practice_area, conflict_risk, notes, primary_lobbyist,
        client_originator, lobbyist_team, interaction_frequency,
        stickiness, high_maintenance,
        lead_id, second_chair_id, originator_id, originator_is_firm
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      name, status, practice_area, conflict_risk, notes, legacy.primary_lobbyist,
      legacy.client_originator, legacy.lobbyist_team, interaction_frequency,
      stickiness, high_maintenance,
      people.lead_id, people.second_chair_id, people.originator_id, people.originator_is_firm
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
      await (await client).query(query, params);
    }

    await (await client).query('COMMIT');
    
    // Fetch the complete client with revenues and people
    const { rows } = await db.query(clientsQuery('WHERE c.id = $1'), [newClient.id]);

    // Calculate strategic scores for the new client
    const clientsWithScores = calculateStrategicScores(rows.map(toApiClient));

    res.status(201).json({
      success: true,
      client: clientsWithScores[0]
    });
    
  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('Error creating client:', error);
    res.status(500).json({ 
      error: 'Failed to create client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});

// PUT /api/data/clients/:id - Update client with revenues
router.put('/clients/:id', async (req, res) => {
  const client = db.pool.connect();
  
  try {
    await (await client).query('BEGIN');
    
    const clientId = req.params.id;
    // Legacy retention columns (relationship_strength, relationship_intensity,
    // renewal_probability) and the phantom strategic_fit_score are retired and
    // intentionally left out of the SET clause — an edit no longer touches them,
    // preserving any existing values until a later V4 migration drops them.
    // People come as ids, as in POST; the legacy text is written from them.
    const {
      name,
      status,
      practice_area,
      conflict_risk,
      notes,
      interaction_frequency,
      stickiness = null,
      high_maintenance = false,
      revenues = []
    } = req.body;

    const assignment = await resolveAssignment(await client, req.body);
    if (assignment.errors.length > 0) {
      await (await client).query('ROLLBACK');
      return res.status(400).json(assignmentRejected(assignment.errors));
    }
    const people = assignment.value;
    const legacy = assignment.legacy;

    // Update client record
    const { rows: [updatedClient] } = await (await client).query(`
      UPDATE clients SET
        name = $1, status = $2, practice_area = $3, conflict_risk = $4,
        notes = $5, primary_lobbyist = $6, client_originator = $7,
        lobbyist_team = $8, interaction_frequency = $9,
        stickiness = $10, high_maintenance = $11,
        lead_id = $12, second_chair_id = $13, originator_id = $14,
        originator_is_firm = $15,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *
    `, [
      name, status, practice_area, conflict_risk,
      notes, legacy.primary_lobbyist, legacy.client_originator,
      legacy.lobbyist_team, interaction_frequency,
      stickiness, high_maintenance,
      people.lead_id, people.second_chair_id, people.originator_id,
      people.originator_is_firm,
      clientId
    ]);

    if (!updatedClient) {
      await (await client).query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }

    // Delete existing revenues
    await (await client).query('DELETE FROM client_revenues WHERE client_id = $1', [clientId]);

    // Insert new revenues in bulk
    if (revenues.length > 0) {
      const params = [];
      const valuePlaceholders = [];
      let paramIndex = 1;
      revenues.forEach(revenue => {
        params.push(clientId, revenue.year, revenue.revenue_amount);
        valuePlaceholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2})`);
        paramIndex += 3;
      });
      const query = `
        INSERT INTO client_revenues (client_id, year, revenue_amount)
        VALUES ${valuePlaceholders.join(',')}
      `;
      await (await client).query(query, params);
    }

    await (await client).query('COMMIT');
    
    // Fetch the complete updated client with revenues and people
    const { rows } = await db.query(clientsQuery('WHERE c.id = $1'), [clientId]);

    // Calculate strategic scores for the updated client
    const clientsWithScores = calculateStrategicScores(rows.map(toApiClient));

    res.json({
      success: true,
      client: clientsWithScores[0]
    });
    
  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('Error updating client:', error);
    res.status(500).json({ 
      error: 'Failed to update client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});

// DELETE /api/data/clients/:id - Delete client and associated revenues
router.delete('/clients/:id', async (req, res) => {
  const client = db.pool.connect();
  
  try {
    await (await client).query('BEGIN');
    
    const clientId = req.params.id;

    // First delete associated revenues
    await (await client).query('DELETE FROM client_revenues WHERE client_id = $1', [clientId]);

    // Then delete the client
    const { rowCount } = await (await client).query(
      'DELETE FROM clients WHERE id = $1', 
      [clientId]
    );

    if (rowCount === 0) {
      await (await client).query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }

    await (await client).query('COMMIT');
    
    res.status(204).end();
    
  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('Error deleting client:', error);
    res.status(500).json({ 
      error: 'Failed to delete client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});


module.exports = router;

