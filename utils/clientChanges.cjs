// utils/clientChanges.cjs
//
// Who changed a client, and what (docs/plans/tier-2.md, S9 and S10, WP6).
// Every client write (the client form's POST, PUT and DELETE, the associate
// split's second-chair route and the import) reads the client it changes FOR
// UPDATE, writes, reads what it wrote, and inserts one client_changes row
// (init-db.sql) per client whose fields or revenue changed, in the write's own
// transaction: a change never lands without its row, and a failed insert fails
// the write. A write that changes nothing writes no row.
//
// Pure: no database and no environment, so tests can load it. data.cjs runs
// the SQL below. `changes` is { field: { from, to } } over the fields a partner
// sets, named as their columns, and revenue: { year: { from, to } }. The people
// are { id, name } with the name as the People list spelled it at the time,
// and compared by id, so a person's rename changes no client. Not compared,
// and never logged: the legacy text columns (derived from the people),
// updated_at and updated_by, the retired columns, status and user_id.
//
// "Not set" has several spellings, and the import writes the other one: the
// form leaves a blank cadence, note or practice-area list NULL where a blank
// import cell writes '' or {}; a stored $0 revenue row and no row both mean
// none (the year rule); NUMERIC comes back as text ('40000.00') where a body
// sends 40000. Each field is normalised before it is compared, so a book
// sheet imported back unchanged logs nothing. Practice areas compare as a set
// (the form appends them in the order they are ticked) and are logged sorted.

const { FIRM_TIME_ZONE } = require('./askPrompts.cjs');
const { parseAmount } = require('./csvImport.cjs');

const SOURCES = Object.freeze(['form', 'import', 'second-chair', 'delete']);

// The fields a partner sets, as their columns name them, in the order the
// client form's History shows them; revenue follows, by year
const FIELDS = Object.freeze([
  'name', 'lead_id', 'second_chair_id', 'originator_id', 'originator_is_firm', 'stickiness',
  'interaction_frequency', 'high_maintenance', 'conflict_risk', 'practice_area', 'notes',
]);
const PEOPLE_FIELDS = Object.freeze(['lead_id', 'second_chair_id', 'originator_id']);

const text = (value) => (typeof value === 'string' && value !== '' ? value : null);

/**
 * An amount to the cent, as NUMERIC(12, 2) stores the text pg sends for a JS
 * number (String(n)): rounded half away from zero on its decimal digits, so
 * 1000.555 is 1000.56 on both sides. Anything that is not a number is 0.
 */
function cents(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  const digits = String(Math.abs(n));
  const shifted = /e/i.test(digits) ? Math.abs(n) * 100 : Number(`${digits}e2`);
  return Math.sign(n) * Number(`${Math.round(shifted)}e-2`);
}

/**
 * Revenue rows ([{ year, revenue_amount }], as stored) as { year: amount },
 * amounts to the cent, only above 0: a $0 row and no row are both none. A year
 * on file twice takes its last row, as revenueObjectFromRows
 * (utils/strategic.cjs) reads it for the book.
 */
function revenueSnapshot(rows) {
  const byYear = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const year = Number(row?.year);
    if (!Number.isInteger(year) || year <= 0) continue;
    byYear[year] = cents(row.revenue_amount);
  }
  return Object.fromEntries(Object.entries(byYear).filter(([, amount]) => amount > 0));
}

const nameOf = (names, id) => {
  const name = names instanceof Map ? names.get(id) : names?.[id];
  return typeof name === 'string' ? name : null;
};

/**
 * A client as the history compares it: `row` is a clients row (as SELECT or
 * RETURNING gives it), `names` the People list's names by id (a Map or an
 * object), `revenues` the client's revenue rows, or undefined when the write
 * does not touch revenue (a PUT without `revenues`, the second-chair route),
 * in which case revenue is not compared.
 */
function clientSnapshot(row, { names = new Map(), revenues } = {}) {
  const person = (id) => (id === null || id === undefined ? null : { id: Number(id), name: nameOf(names, Number(id)) });
  const areas = Array.isArray(row.practice_area) ? row.practice_area.filter((a) => typeof a === 'string' && a !== '') : [];
  const snapshot = {
    name: text(row.name),
    lead_id: person(row.lead_id),
    second_chair_id: person(row.second_chair_id),
    originator_id: person(row.originator_id),
    originator_is_firm: row.originator_is_firm === true,
    stickiness: Number.isInteger(row.stickiness) ? row.stickiness : null,
    interaction_frequency: text(row.interaction_frequency),
    high_maintenance: row.high_maintenance === true,
    // The column's default, and what the page shows for a NULL (toApiClient)
    conflict_risk: text(row.conflict_risk) ?? 'Medium',
    practice_area: areas.length > 0 ? [...areas].sort() : null,
    notes: text(row.notes),
  };
  if (revenues !== undefined) snapshot.revenue = revenueSnapshot(revenues);
  return snapshot;
}

// A client that does not exist: before a create, after a delete
const NOTHING = Object.freeze({ ...Object.fromEntries(FIELDS.map((field) => [field, null])), revenue: {} });

const same = (field, a, b) => {
  if (PEOPLE_FIELDS.includes(field)) return (a?.id ?? null) === (b?.id ?? null);
  if (field === 'practice_area') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (a ?? null) === (b ?? null);
};

/**
 * What changed between two snapshots (clientSnapshot), or null when nothing
 * did. `before` null is a client created (every set field from null), `after`
 * null a client deleted (every set field to null). Revenue is compared only
 * when both sides carry it.
 */
function clientChanges(before, after) {
  const from = before || NOTHING;
  const to = after || NOTHING;
  const changes = {};
  for (const field of FIELDS) {
    if (!same(field, from[field], to[field])) changes[field] = { from: from[field] ?? null, to: to[field] ?? null };
  }
  if (from.revenue !== undefined && to.revenue !== undefined) {
    const years = [...new Set([...Object.keys(from.revenue), ...Object.keys(to.revenue)])].sort();
    const revenue = {};
    for (const year of years) {
      const a = from.revenue[year] ?? null;
      const b = to.revenue[year] ?? null;
      if (a !== b) revenue[year] = { from: a, to: b };
    }
    if (Object.keys(revenue).length > 0) changes.revenue = revenue;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * The import's revenue for one client once it has written a file (the year
 * rule, D5, as planRevenueWrites in utils/csvImport.cjs writes it): each of
 * the file's years set to its amount when above 0 and removed otherwise, every
 * other year as stored. `before` is a revenueSnapshot; `fileRevenue` the
 * row's { year: amount }.
 */
function importedRevenue(before, fileRevenue, fileYears) {
  const after = { ...before };
  const revenue = fileRevenue && typeof fileRevenue === 'object' ? fileRevenue : {};
  for (const year of fileYears || []) {
    const amount = cents(parseAmount(revenue[year]));
    if (amount > 0) after[year] = amount;
    else delete after[year];
  }
  return after;
}

// The client's updated_at to the microsecond, as text without a zone (the
// column has none): what the API sends as updated_at_exact and the page sends
// back as expected_updated_at. pg turns the column into a JS Date, which keeps
// milliseconds only and reads it in the server process's zone, so a Date
// never compares equal to what is stored; to_char with this pattern depends on
// no setting (no zone, no locale).
const UPDATED_AT_EXACT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US';
const updatedAtExactSql = (column) => `to_char(${column}, '${UPDATED_AT_EXACT_FORMAT}')`;
const UPDATED_AT_EXACT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

const TOKEN_MESSAGE = "expected_updated_at must be the client's updated_at_exact as the API sent it, or null.";

/**
 * PUT /api/data/clients/:id's `expected_updated_at` (S10): { present, value,
 * errors }. Absent (the older page, a direct request) is no check. Present, it
 * is the updated_at_exact the page loaded, or null for a client whose
 * updated_at is NULL; anything else is refused with a detail, never read as
 * absent, so a page sending the wrong thing cannot overwrite a newer save.
 */
function readExpectedUpdatedAt(body) {
  if (!body || typeof body !== 'object' || !('expected_updated_at' in body) || body.expected_updated_at === undefined) {
    return { present: false, value: null, errors: [] };
  }
  const value = body.expected_updated_at;
  if (value === null || (typeof value === 'string' && UPDATED_AT_EXACT.test(value))) {
    return { present: true, value, errors: [] };
  }
  return { present: true, value: null, errors: [{ field: 'expected_updated_at', message: TOKEN_MESSAGE }] };
}

/** Whether the stored updated_at_exact is the one the page loaded (IS NOT DISTINCT FROM). */
const isCurrent = (stored, expected) => (stored ?? null) === (expected ?? null);

// One statement for any number of rows: $1 is a JSON list of { client_id,
// client_name, changes }, $2 the account's id (the key only while the
// account exists: a session outlives a deleted account, since the JWT is not
// checked against users, and its change is saved with the username alone),
// $3 the username, $4 the source.
const INSERT_CHANGES_SQL = `
  INSERT INTO client_changes (client_id, client_name, changed_by, changed_by_username, source, changes)
  SELECT v.client_id, v.client_name, (SELECT id FROM users WHERE id = $2), $3::text, $4::text, v.changes
    FROM jsonb_to_recordset($1::jsonb) AS v(client_id text, client_name text, changes jsonb)`;

/**
 * INSERT_CHANGES_SQL's values. `entries` are { clientId, clientName, changes }
 * (entries without changes are left out); `user` the JWT payload
 * ({ userId, username }). Null when there is nothing to insert.
 */
function insertChangesParams(entries, user, source) {
  const rows = (entries || [])
    .filter((entry) => entry && entry.changes)
    .map(({ clientId, clientName, changes }) => ({
      client_id: String(clientId),
      client_name: typeof clientName === 'string' ? clientName : null,
      changes,
    }));
  if (rows.length === 0) return null;
  return [
    JSON.stringify(rows),
    Number.isInteger(user?.userId) ? user.userId : null,
    typeof user?.username === 'string' ? user.username : null,
    source,
  ];
}

// A client's history, newest first; and its latest row, for a 409
const CHANGE_COLUMNS = 'id, client_id, client_name, changed_by_username, source, changes, created_at';
const CLIENT_CHANGES_SQL = `
  SELECT ${CHANGE_COLUMNS}
    FROM client_changes
   WHERE client_id = $1
   ORDER BY created_at DESC, id DESC`;
const LATEST_CHANGE_SQL = `
  SELECT changed_by_username, source, created_at
    FROM client_changes
   WHERE client_id = $1
   ORDER BY created_at DESC, id DESC
   LIMIT 1`;

// When, as the firm reads a clock (America/New_York, as firmDate and
// firmMonth): "Sep 28, 2026, 4:34 PM". The page's copy is src/utils/clientHistory.js.
const firmTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: FIRM_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const firmTime = (when) => firmTimeFormat.format(new Date(when));

/**
 * The 409 of a stale PUT: { success: false, error, latest_change }, with who
 * saved last and when from the client's newest history row, or null when it
 * has none (a change made before WP6, or by an older API after a rollback).
 */
function conflictBody(latest) {
  const change = latest
    ? { changed_by_username: latest.changed_by_username ?? null, source: latest.source, created_at: latest.created_at }
    : null;
  const who = change
    ? `${change.changed_by_username || 'a former account'}${change.source === 'import' ? ' (an import)' : change.source === 'second-chair' ? ' (the associate split)' : ''}`
    : null;
  return {
    success: false,
    error: change
      ? `This client was saved after you opened it, by ${who} on ${firmTime(change.created_at)}. Nothing was saved.`
      : 'This client was saved after you opened it. Nothing was saved.',
    latest_change: change,
  };
}

module.exports = {
  SOURCES,
  FIELDS,
  PEOPLE_FIELDS,
  cents,
  revenueSnapshot,
  clientSnapshot,
  clientChanges,
  importedRevenue,
  UPDATED_AT_EXACT_FORMAT,
  updatedAtExactSql,
  readExpectedUpdatedAt,
  isCurrent,
  INSERT_CHANGES_SQL,
  insertChangesParams,
  CLIENT_CHANGES_SQL,
  LATEST_CHANGE_SQL,
  firmTime,
  conflictBody,
};
