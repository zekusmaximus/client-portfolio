// Two catalog checks, shared by the scripts that change the database outside
// the API and by tests/schema.test.mjs:
// - can deleting a user delete clients? (scripts/check-schema.cjs,
//   scripts/delete-user.cjs)
// - can deleting every client leave anything behind? (scripts/reset-book.cjs)
// Pure: the caller runs the SQL on its own connection, so tests can import this
// without a database.

// Every foreign key that references users, with its ON DELETE action as
// pg_constraint.confdeltype: 'c' cascade, 'n' set null, 'd' set default,
// 'r' restrict, 'a' no action.
const USER_FOREIGN_KEYS_SQL = `
  SELECT con.conrelid::regclass::text AS table_name,
         con.conname AS constraint_name,
         con.confdeltype AS on_delete,
         pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
   WHERE con.contype = 'f'
     AND con.confrelid = 'users'::regclass
   ORDER BY 1, 2`;

// How many clients each account created (user_id); a NULL username counts the
// clients with no account recorded, which includes every client the current
// code creates.
const CLIENTS_BY_ACCOUNT_SQL = `
  SELECT u.username, count(*)::int AS clients
    FROM clients c
    LEFT JOIN users u ON u.id = c.user_id
   GROUP BY u.username
   ORDER BY u.username NULLS LAST`;

/**
 * @param {Array<{ table_name: string, constraint_name: string, on_delete: string, definition: string }>} rows
 *   the rows of USER_FOREIGN_KEYS_SQL
 * @returns {{ ok: boolean, lines: string[] }} ok is false when any key cascades;
 *   one line per key, marked CASCADES or ok
 */
function checkUserForeignKeys(rows) {
  const lines = rows.map(
    (r) => `${r.on_delete === 'c' ? 'CASCADES' : 'ok'}  ${r.table_name}.${r.constraint_name}: ${r.definition}`
  );
  if (rows.length === 0) lines.push('No foreign key references users.');
  return { ok: rows.every((r) => r.on_delete !== 'c'), lines };
}

// Every foreign key that references clients, the same columns as
// USER_FOREIGN_KEYS_SQL. client_revenues.client_id is one; a production
// database may also hold V2__update_clients_schema.sql's revenues table.
// table_name is regclass output, quoted and schema-qualified where needed, so
// it can be used as a table reference.
const CLIENT_FOREIGN_KEYS_SQL = `
  SELECT con.conrelid::regclass::text AS table_name,
         con.conname AS constraint_name,
         con.confdeltype AS on_delete,
         pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
   WHERE con.contype = 'f'
     AND con.confrelid = 'clients'::regclass
   ORDER BY 1, 2`;

/**
 * Deleting every client removes the rows that reference them only through
 * ON DELETE CASCADE: any other action fails the delete or leaves rows behind.
 *
 * @param {Array<{ table_name: string, constraint_name: string, on_delete: string, definition: string }>} rows
 *   the rows of CLIENT_FOREIGN_KEYS_SQL
 * @returns {{ ok: boolean, lines: string[], refused: string[], otherTables: string[] }}
 *   ok is false when any key does not cascade; one line per key, marked ok or
 *   DOES NOT CASCADE; refused names those keys as table.constraint;
 *   otherTables lists, once each, the referencing tables other than clients
 *   itself and client_revenues
 */
function checkClientForeignKeys(rows) {
  const lines = rows.map(
    (r) => `${r.on_delete === 'c' ? 'ok' : 'DOES NOT CASCADE'}  ${r.table_name}.${r.constraint_name}: ${r.definition}`
  );
  if (rows.length === 0) lines.push('No foreign key references clients.');
  const refused = rows.filter((r) => r.on_delete !== 'c').map((r) => `${r.table_name}.${r.constraint_name}`);
  const otherTables = [...new Set(rows.map((r) => r.table_name))]
    .filter((table) => table !== 'clients' && table !== 'client_revenues');
  return { ok: refused.length === 0, lines, refused, otherTables };
}

/**
 * Did deleting every client do exactly that? `before` and `after` are the
 * book's counts inside the reset's transaction.
 *
 * @param {{ users: number, people: number }} before
 * @param {{ users: number, people: number, clients: number, revenueRows: number,
 *   others: Array<{ table: string, rows: number }> }} after
 *   revenueRows counts client_revenues; others the rows of every other table
 *   that references clients
 * @returns {{ ok: boolean, problems: string[] }} one problem per count that is
 *   not what it should be
 */
function checkBookReset(before, after) {
  const problems = [];
  const left = (rows, table) => {
    if (rows !== 0) problems.push(`${table} still holds ${rows} row${rows === 1 ? '' : 's'}`);
  };
  left(after.clients, 'clients');
  left(after.revenueRows, 'client_revenues');
  after.others.forEach(({ table, rows }) => left(rows, table));
  if (after.users !== before.users) problems.push(`accounts went from ${before.users} to ${after.users}`);
  if (after.people !== before.people) problems.push(`people went from ${before.people} to ${after.people}`);
  return { ok: problems.length === 0, problems };
}

module.exports = {
  USER_FOREIGN_KEYS_SQL,
  CLIENTS_BY_ACCOUNT_SQL,
  checkUserForeignKeys,
  CLIENT_FOREIGN_KEYS_SQL,
  checkClientForeignKeys,
  checkBookReset
};
