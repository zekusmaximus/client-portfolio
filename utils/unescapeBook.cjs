// utils/unescapeBook.cjs
//
// The pure half of scripts/unescape-book.cjs (docs/plans/tier-2.md, S8, WP5):
// which stored client text is HTML-escaped, what the repair writes instead,
// and what it must refuse. No I/O and no env, so tests can import it; the
// script reads the rows and writes the result in one transaction.
//
// Until WP5 a request sanitizer HTML-escaped every string a client write sent
// (validator.escape, once per save; the form's DOMPurify pass escaped a note
// holding `<` once more), so a client saved through the form was stored as
// `Barnes &amp; Noble` in clients.name, clients.notes and, before the People
// list (`ca89493`), the legacy people text. The repair applies
// unescapeStored (utils/escaping.cjs) to exactly those columns. "Escaped"
// means unescapeStored changes the value: it cannot tell a typed literal
// `&amp;` from an escape (S8 accepts this; nor can the display decoders).
// unescapeStored is idempotent, so a second repair changes nothing.

const { unescapeStored } = require('./escaping.cjs');

// The columns of clients the repair rewrites, in the order it reports them.
// lobbyist_team is TEXT[] on both table shapes, repaired element by element.
const REPAIR_COLUMNS = ['name', 'notes', 'primary_lobbyist', 'client_originator', 'lobbyist_team'];

// Text an HTML decoder could read as a character reference (`&amp;`, `&#169;`,
// `&#x27;`, `&nbsp;`). The preview reports it where the repair leaves it, and
// in every other text column, without changing it. ENTITY_LIKE_SQL is the same
// pattern for PostgreSQL's `~`.
const ENTITY_LIKE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
const ENTITY_LIKE_SQL = '&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);';

/** A column's value as the repair writes it: unescapeStored on text, on each element of an array; null as it is. */
function repairValue(value) {
  if (Array.isArray(value)) return value.map(repairValue);
  return typeof value === 'string' ? unescapeStored(value) : value;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const entityLike = (value) => {
  if (Array.isArray(value)) return value.some(entityLike);
  return typeof value === 'string' && ENTITY_LIKE.test(value);
};

/**
 * The repair of every client row ({ id, name, notes, primary_lobbyist,
 * client_originator, lobbyist_team }; the id as text).
 * @returns {{
 *   changes: Array<{ id, before, after, columns }>,  one per client with escaped text; `columns` the ones it changes
 *   total: number,                                   the clients the repair changes (changes.length)
 *   byColumn: Object<string, number>,                the clients each column changes, every column listed
 *   repaired: Array<Object>,                         every row as it is after the repair
 *   leftovers: Array<{ id, name, column }>,          entity-like text the repair leaves (not an escape it can undo)
 * }}
 */
function planRepair(rows = []) {
  const changes = [];
  const byColumn = Object.fromEntries(REPAIR_COLUMNS.map((column) => [column, 0]));
  const repaired = [];
  const leftovers = [];
  for (const row of rows) {
    const after = { ...row };
    const columns = [];
    for (const column of REPAIR_COLUMNS) {
      after[column] = repairValue(row[column]);
      if (!same(after[column], row[column])) {
        columns.push(column);
        byColumn[column] += 1;
      }
      if (entityLike(after[column])) leftovers.push({ id: row.id, name: after.name, column });
    }
    repaired.push(after);
    if (columns.length > 0) {
      const pick = (source) => Object.fromEntries(REPAIR_COLUMNS.map((column) => [column, source[column]]));
      changes.push({ id: row.id, before: pick(row), after: pick(after), columns });
    }
  }
  return { changes, total: changes.length, byColumn, repaired, leftovers };
}

/**
 * Names two or more clients share regardless of case: the import's rule
 * (indexStoredClients, utils/csvImport.cjs, compares unescapeStored names in
 * lower case), so the rows before the repair and after it give the same
 * groups. Each group lists its clients as { id, name } (the name as the row
 * holds it) in the rows' order; `name` is its first client's name unescaped.
 * @returns {Array<{ name: string, clients: Array<{ id, name }> }>}
 */
function sharedNames(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    if (typeof row.name !== 'string') continue;
    const key = unescapeStored(row.name).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: String(row.id), name: row.name });
  }
  return [...groups.values()]
    .filter((clients) => clients.length > 1)
    .map((clients) => ({ name: unescapeStored(clients[0].name), clients }));
}

/**
 * Whether the repair may commit: the clients it changed equal the count the
 * partner confirmed (the preview's), nothing is left to repair once it has
 * written, and no two clients share a name regardless of case.
 * @param {number} confirmed - the count given with --confirm
 * @param {{ total }} plan - planRepair of the rows before the writes
 * @param {Array} after - the rows as the transaction reads them after the writes
 * @returns {{ ok: boolean, problems: string[] }}
 */
function checkRepair(confirmed, plan, after) {
  const problems = [];
  if (plan.total !== confirmed) {
    problems.push(`${plan.total} ${plan.total === 1 ? 'client holds' : 'clients hold'} escaped text, not the ${confirmed} confirmed`);
  }
  const left = planRepair(after).total;
  if (left > 0) problems.push(`${left} ${left === 1 ? 'client' : 'clients'} would still hold escaped text`);
  const shared = sharedNames(after);
  if (shared.length > 0) {
    problems.push(`${shared.length === 1 ? 'a name is' : `${shared.length} names are`} shared regardless of case (${shared.map((group) => `"${group.name}": ${group.clients.length} clients`).join('; ')})`);
  }
  return { ok: problems.length === 0, problems };
}

module.exports = {
  REPAIR_COLUMNS,
  ENTITY_LIKE,
  ENTITY_LIKE_SQL,
  repairValue,
  planRepair,
  sharedNames,
  checkRepair,
};
