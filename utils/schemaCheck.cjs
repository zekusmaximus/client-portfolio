// Can deleting a user delete clients? Shared by scripts/check-schema.cjs,
// scripts/delete-user.cjs and tests/schema.test.mjs. Pure: the caller runs the
// SQL on its own connection, so tests can import this without a database.

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

module.exports = { USER_FOREIGN_KEYS_SQL, CLIENTS_BY_ACCOUNT_SQL, checkUserForeignKeys };
