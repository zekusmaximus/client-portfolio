/**
 * CSV import helpers: pure functions, no database access.
 *
 * Year rule (docs/plans/tier-0.md, D5): a CSV is authoritative for exactly the
 * years its header contains, as `YYYY Contracts` columns. For each client and
 * each of those years, an amount > 0 upserts the (client, year) row, a blank
 * or 0 cell deletes it, and years the file does not mention are left alone.
 * That preserves history when a single-year sheet is imported and still lets
 * a corrected sheet zero out a year.
 *
 * Nothing in this file knows which years exist; `2026 Contracts` needs no
 * code change, and neither will `2027 Contracts`.
 */

const { EFFORT_BY_CADENCE } = require('./strategic.cjs');
const { validateAssignment, legacyText } = require('./people.cjs');

const REVENUE_HEADER = /^\s*((?:19|20)\d{2})\s+contracts?\s*$/i;

/**
 * The year named by a `YYYY Contracts` header, or null when the header is not
 * a revenue column. Case-insensitive; surrounding whitespace and the singular
 * `Contract` are tolerated.
 */
function revenueYearOfHeader(header) {
  if (typeof header !== 'string') return null;
  const match = header.match(REVENUE_HEADER);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Sorted, de-duplicated integer years for every header that names a revenue
 * column.
 */
function extractRevenueYears(headers) {
  const years = new Set();
  for (const header of headers || []) {
    const year = revenueYearOfHeader(header);
    if (year !== null) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Union of the keys of every row. With Papaparse in header mode every row
 * carries the header's keys, so this is the header; taking the union also
 * covers a short first row.
 */
function headerKeys(rows) {
  const keys = new Set();
  for (const row of rows || []) {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach((key) => keys.add(key));
    }
  }
  return [...keys];
}

/**
 * Parse a revenue cell. Strips `$`, `,` and whitespace; parentheses mean
 * negative; blank, missing or non-numeric cells are 0. Numbers pass through.
 */
function parseAmount(cell) {
  if (cell === null || cell === undefined) return 0;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : 0;

  let text = String(cell).replace(/[$,\s]/g, '');
  if (text === '') return 0;

  let sign = 1;
  const parenthesised = text.match(/^\((.*)\)$/);
  if (parenthesised) {
    sign = -1;
    text = parenthesised[1];
  }

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return 0;
  const amount = parseFloat(text);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  return sign * amount;
}

/**
 * Plan the revenue writes for one import (D5).
 *
 * @param {Array<{id: string, revenue: Object}>} clients - `revenue` maps year → amount
 * @param {number[]} years - the years the file's header covered
 * @returns {{upserts: Array<[string, number, number]>, deletes: Array<[string, number]>}}
 *   `upserts` are (client_id, year, amount) for present years with amount > 0;
 *   `deletes` are (client_id, year) for present years with a blank, 0 or
 *   non-positive amount. Years absent from `years` produce no write at all.
 *   Each (client, year) pair appears at most once, so one INSERT ... ON
 *   CONFLICT statement can carry every upsert.
 */
function planRevenueWrites(clients, years) {
  const upserts = new Map();
  const deletes = new Map();
  const fileYears = [...new Set(
    (years || []).map((year) => parseInt(year, 10)).filter(Number.isInteger)
  )];

  for (const client of clients || []) {
    if (!client || client.id === null || client.id === undefined) continue;
    const revenue = client.revenue && typeof client.revenue === 'object' ? client.revenue : {};

    for (const year of fileYears) {
      const amount = parseAmount(revenue[year]);
      const key = `${client.id}|${year}`;
      if (amount > 0) {
        upserts.set(key, [client.id, year, amount]);
        deletes.delete(key);
      } else {
        deletes.set(key, [client.id, year]);
        upserts.delete(key);
      }
    }
  }

  return { upserts: [...upserts.values()], deletes: [...deletes.values()] };
}

/**
 * Each year's total of the amounts an import writes: planRevenueWrites'
 * upserts summed by year, to the cent. Every year in `years` appears, 0 when no
 * client has an amount for it. Check file and the import report these so a
 * partner can compare them with the sheet's column sums (the page totals only
 * the reporting year).
 *
 * @param {Array<[string, number, number]>} upserts [clientId, year, amount]
 * @param {number[]} years the file's years
 * @returns {Record<number, number>}
 */
function revenueTotals(upserts, years) {
  const totals = Object.fromEntries((years || []).map((year) => [year, 0]));
  for (const [, year, amount] of upserts || []) {
    totals[year] = Math.round(((totals[year] || 0) + amount) * 100) / 100;
  }
  return totals;
}

// --- The import sheet's people and judgment columns --------------------------
//
// docs/plans/people-and-second-chair.md, section 3 and P8. Like the revenue
// years, the file is authoritative for exactly the columns it has: a column it
// lacks leaves that field alone on existing clients, and a blank cell in a
// column it has clears the field. Any problem (a name that does not resolve, a
// value outside a column's vocabulary, a client named twice, a malformed
// header) refuses the whole file; data.cjs writes nothing and answers 400 with
// every problem, one { row, client, message } each.

// The optional columns, in the sheet's order. Headers match case-insensitively
// and trimmed, with runs of spaces read as one.
const SHEET_COLUMNS = [
  { key: 'lead', header: 'Lead' },
  { key: 'secondChair', header: 'Second Chair' },
  { key: 'originator', header: 'Originator' },
  { key: 'creditToFirm', header: 'Credit To Firm' },
  { key: 'stickiness', header: 'Stickiness' },
  { key: 'cadence', header: 'Cadence' },
  { key: 'handful', header: 'Handful' },
  { key: 'conflictRisk', header: 'Conflict Risk' },
  { key: 'practiceArea', header: 'Practice Area' },
  { key: 'notes', header: 'Notes' },
];
const PEOPLE_KEYS = ['lead', 'secondChair', 'originator', 'creditToFirm'];
const HEADER_OF = Object.fromEntries(SHEET_COLUMNS.map(({ key, header }) => [key, header]));

// The vocabularies. Cadence is the scorer's own list; the practice areas are
// the client form's.
const CADENCES = Object.keys(EFFORT_BY_CADENCE);
const CONFLICT_RISKS = ['Low', 'Medium', 'High'];
const PRACTICE_AREAS = [
  'Healthcare', 'Municipal', 'Corporate', 'Energy', 'Financial', 'Education',
  'Transportation', 'Environmental', 'Technology', 'Real Estate', 'Non-Profit', 'Other',
];
const FIRM = 'firm';

// The first row of data is row 2: the header is row 1, as in a spreadsheet.
const HEADER_ROW = 1;
const rowNumberOf = (index) => index + 2;

const squash = (text) => String(text).trim().replace(/\s+/g, ' ');
const normalizeHeader = (header) => squash(header).toLowerCase();
const COLUMN_BY_HEADER = new Map(SHEET_COLUMNS.map(({ key, header }) => [normalizeHeader(header), key]));

/**
 * Find the optional columns among a file's headers.
 * Returns `{ columns, errors }`: `columns` maps each present column's key
 * (`lead`, `secondChair`, ...) to the header as the file spells it; `errors`
 * are sentences about the header itself. A column given twice is an error, in
 * any spelling, including PapaParse's rename of an exact repeat (`Lead_1`).
 * Second Chair, Originator and Credit To Firm need a Lead column: every client
 * a file assigns people to gets its lead from the same file.
 */
function findSheetColumns(headers) {
  const columns = {};
  const errors = [];
  const seen = {};
  for (const header of headers || []) {
    if (typeof header !== 'string') continue;
    const normalized = normalizeHeader(header);
    let key = COLUMN_BY_HEADER.get(normalized);
    const renamed = key ? null : normalized.match(/^(.*)_\d+$/);
    if (renamed) key = COLUMN_BY_HEADER.get(renamed[1]);
    if (!key) continue;
    (seen[key] = seen[key] || []).push(header);
    if (!renamed && !(key in columns)) columns[key] = header;
  }
  for (const { key, header } of SHEET_COLUMNS) {
    if (seen[key] && seen[key].length > 1) {
      errors.push(`The header has ${seen[key].length} ${header} columns (${seen[key].map((h) => `"${h}"`).join(', ')}); keep one.`);
    }
  }
  const needLead = PEOPLE_KEYS.filter((key) => key !== 'lead' && key in columns);
  if (needLead.length > 0 && !('lead' in columns)) {
    errors.push(`The file has ${needLead.map((key) => HEADER_OF[key]).join(', ')} but no Lead column; add Lead, the lead partner for every client.`);
  }
  return { columns, errors };
}

const cellText = (row, header) => {
  const value = row && header !== undefined ? row[header] : undefined;
  return value === null || value === undefined ? '' : squash(value);
};

// `Y` (any case) is true and blank false; anything else is undefined.
function parseYes(text) {
  if (text === '') return false;
  if (text.toLowerCase() === 'y') return true;
  return undefined;
}

// The canonical spelling of `text` in `list`, ignoring case; undefined if absent.
const canonical = (list, text) => list.find((item) => item.toLowerCase() === text.toLowerCase());

/**
 * Read one row's optional columns. Only the columns in `columns` are read.
 * Returns `{ values, people, errors }`:
 * - `values`: the judgment fields under their database column names, one key
 *   per present column: `stickiness` (1-5 or null), `interaction_frequency`
 *   (a cadence or ''), `high_maintenance`, `conflict_risk` (blank is Medium),
 *   `practice_area` (an array), `notes`.
 * - `people`: the raw cells of the present people columns, by key, for
 *   resolveSheetPeople.
 * - `errors`: sentences, one per value outside its column's vocabulary.
 */
function readSheetRow(row, columns = {}) {
  const values = {};
  const people = {};
  const errors = [];
  const present = (key) => key in columns;
  const text = (key) => cellText(row, columns[key]);

  for (const key of PEOPLE_KEYS) {
    if (present(key)) people[key] = text(key);
  }

  if (present('stickiness')) {
    const v = text('stickiness');
    if (v === '') values.stickiness = null;
    else if (/^[1-5]$/.test(v)) values.stickiness = Number(v);
    else errors.push(`Stickiness "${v}" must be a whole number from 1 to 5, or blank.`);
  }

  if (present('cadence')) {
    const v = text('cadence');
    const found = v === '' ? '' : canonical(CADENCES, v);
    if (found === undefined) errors.push(`Cadence "${v}" must be one of ${CADENCES.join(', ')}, or blank.`);
    else values.interaction_frequency = found;
  }

  if (present('handful')) {
    const v = text('handful');
    const flag = parseYes(v);
    if (flag === undefined) errors.push(`Handful "${v}" must be Y or blank.`);
    else values.high_maintenance = flag;
  }

  if (present('conflictRisk')) {
    const v = text('conflictRisk');
    const found = v === '' ? 'Medium' : canonical(CONFLICT_RISKS, v);
    if (found === undefined) errors.push(`Conflict Risk "${v}" must be Low, Medium or High, or blank.`);
    else values.conflict_risk = found;
  }

  if (present('practiceArea')) {
    const areas = [];
    const unknown = [];
    for (const piece of text('practiceArea').split(';').map(squash).filter(Boolean)) {
      const found = canonical(PRACTICE_AREAS, piece);
      if (found === undefined) unknown.push(piece);
      else if (!areas.includes(found)) areas.push(found);
    }
    if (unknown.length > 0) {
      errors.push(`Practice Area ${unknown.map((a) => `"${a}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on the list: ${PRACTICE_AREAS.join(', ')} (separate several with ;).`);
    } else {
      values.practice_area = areas;
    }
  }

  if (present('notes')) {
    // Notes keep their own spacing; only the ends are trimmed.
    const raw = row ? row[columns.notes] : undefined;
    values.notes = raw === null || raw === undefined ? '' : String(raw).trim();
  }

  return { values, people, errors };
}

/**
 * Resolve one row's people against the People list (P3, P4, P8) and check the
 * result with validateAssignment, the rule the client form uses.
 *
 * @param {Object} cells - readSheetRow's `people`: the present columns' cells
 * @param {Array} roster - every person, `{ id, name, role, active }`
 * @param {Object|null} existing - the client's stored `second_chair_id`,
 *   `originator_id` and `originator_is_firm`, or null for a new client; used
 *   for a column the file lacks, which leaves that field as it is
 * @returns {null|{ values, legacy, errors }} null when the file has no Lead
 *   column (it assigns no people). `values` are the four columns to write,
 *   `legacy` the text columns to store with them (P6), `errors` sentences.
 */
function resolveSheetPeople(cells = {}, roster = [], existing = null) {
  if (cells.lead === undefined) return null;

  const byName = new Map(roster.map((person) => [person.name.toLowerCase(), person]));
  const byId = new Map(roster.map((person) => [person.id, person]));
  const errors = [];
  const unresolved = new Set();

  // A name's person id; null for blank, NaN (matches nobody) for an unknown name.
  const resolve = (key, field) => {
    const name = cells[key];
    if (!name) return null;
    const person = byName.get(name.toLowerCase());
    if (person) return person.id;
    errors.push(`${HEADER_OF[key]} "${name}" is not on the People list.`);
    unresolved.add(field);
    return NaN;
  };
  const kept = (field) => (existing && existing[field] != null ? existing[field] : null);

  const input = { lead_id: resolve('lead', 'lead_id') };
  input.second_chair_id = cells.secondChair !== undefined ? resolve('secondChair', 'second_chair_id') : kept('second_chair_id');

  // "Firm" in Originator: no person, and the credit is the firm's.
  const firmOriginator = cells.originator !== undefined && cells.originator.toLowerCase() === FIRM;
  if (cells.originator === undefined) input.originator_id = kept('originator_id');
  else input.originator_id = firmOriginator ? null : resolve('originator', 'originator_id');

  if (cells.creditToFirm !== undefined) {
    const flag = parseYes(cells.creditToFirm);
    if (flag === undefined) errors.push(`Credit To Firm "${cells.creditToFirm}" must be Y or blank.`);
    input.originator_is_firm = flag === true || firmOriginator;
  } else {
    input.originator_is_firm = firmOriginator || (existing ? existing.originator_is_firm === true : false);
  }

  const result = validateAssignment(input, roster);
  const described = {
    lead_id: () => (cells.lead ? `Lead "${cells.lead}"` : 'Lead (blank)'),
    second_chair_id: () => {
      if (cells.secondChair !== undefined) return cells.secondChair ? `Second Chair "${cells.secondChair}"` : 'Second Chair (blank)';
      const current = byId.get(input.second_chair_id);
      return `Second Chair (${current ? current.name : 'current'}, kept: the file has no Second Chair column)`;
    },
    originator_id: () => `Originator "${cells.originator}"`,
  };
  for (const error of result.errors) {
    if (unresolved.has(error.field)) continue;
    const who = described[error.field] ? described[error.field]() : error.field;
    errors.push(`${who}: ${error.message}`);
  }

  return {
    values: result.value,
    legacy: legacyText({ ...result, originatorIsFirm: result.value.originator_is_firm }),
    errors,
  };
}

/**
 * Check a parsed file before anything is written (P8).
 *
 * @param {Array} clients - processCSVData's output (each has `name`,
 *   `rowNumber` and `sheet`, readSheetRow's result)
 * @param {Object} options
 * @param {string[]} [options.headerErrors] - findSheetColumns' `errors`
 * @param {Array} [options.roster] - the People list
 * @param {Map} [options.existingByName] - stored clients by lower-case name
 * @returns {{ errors: Array<{row, client, message}>, people: Map }} `errors`
 *   sorted by row, header problems first as row 1; `people` maps a row
 *   number to resolveSheetPeople's result for every row that assigns people.
 */
function checkSheet(clients = [], { headerErrors = [], roster = [], existingByName = new Map() } = {}) {
  const errors = headerErrors.map((message) => ({ row: HEADER_ROW, client: '', message }));
  const people = new Map();
  const firstRowByName = new Map();

  for (const client of clients) {
    const name = client.name || '';
    const lowerName = name.toLowerCase();
    const add = (message) => errors.push({ row: client.rowNumber, client: name, message });

    // Names match existing clients regardless of case, so they must be unique that way
    if (firstRowByName.has(lowerName)) {
      add(`"${name}" is also on row ${firstRowByName.get(lowerName)}; each client may appear once in the file.`);
    } else {
      firstRowByName.set(lowerName, client.rowNumber);
    }

    const sheet = client.sheet || { people: {}, errors: [] };
    sheet.errors.forEach(add);

    const resolved = resolveSheetPeople(sheet.people, roster, existingByName.get(lowerName) || null);
    if (resolved) {
      resolved.errors.forEach(add);
      people.set(client.rowNumber, resolved);
    }
  }

  errors.sort((a, b) => a.row - b.row);
  return { errors, people };
}

// The client columns every import writes, with their SQL types, in the order
// of data.cjs's bulk UPDATE and INSERT. The sheet's optional columns add
// theirs only when the file has them, so a column the file lacks is never in
// the SET list and stays as it is; the other judgment columns (cadence,
// conflict risk, practice area, notes) are in the base list and carry the
// preserved value when absent, as before this change.
const IMPORT_WRITE_COLUMNS = [
  ['name', 'text'], ['status', 'text'], ['practice_area', 'text[]'],
  ['relationship_strength', 'numeric'], ['conflict_risk', 'text'],
  ['renewal_probability', 'numeric'], ['strategic_fit_score', 'numeric'],
  ['notes', 'text'], ['primary_lobbyist', 'text'], ['client_originator', 'text'],
  ['lobbyist_team', 'text[]'], ['interaction_frequency', 'text'],
  ['relationship_intensity', 'numeric'],
];
const PEOPLE_WRITE_COLUMNS = [
  ['lead_id', 'int'], ['second_chair_id', 'int'], ['originator_id', 'int'], ['originator_is_firm', 'boolean'],
];

/** The `[column, sqlType]` pairs an import writes, for findSheetColumns' `columns`. */
function importWriteColumns(columns = {}) {
  return [
    ...IMPORT_WRITE_COLUMNS,
    ...('stickiness' in columns ? [['stickiness', 'smallint']] : []),
    ...('handful' in columns ? [['high_maintenance', 'boolean']] : []),
    ...('lead' in columns ? PEOPLE_WRITE_COLUMNS : []),
  ];
}

/**
 * A bulk VALUES list: one tuple per row, each cell `row[column]` as a typed
 * placeholder. Returns `{ sql, params }`; the typed placeholders let a NULL
 * in the first row still carry its column's type.
 */
function valuesList(rows, columns) {
  const params = [];
  const tuples = rows.map((row) => `(${columns.map(([column, type]) => {
    params.push(row[column]);
    return `$${params.length}::${type}`;
  }).join(', ')})`);
  return { sql: tuples.join(', '), params };
}

module.exports = {
  revenueYearOfHeader,
  extractRevenueYears,
  headerKeys,
  parseAmount,
  planRevenueWrites,
  revenueTotals,
  SHEET_COLUMNS,
  CADENCES,
  CONFLICT_RISKS,
  PRACTICE_AREAS,
  rowNumberOf,
  findSheetColumns,
  readSheetRow,
  resolveSheetPeople,
  checkSheet,
  importWriteColumns,
  valuesList,
};
