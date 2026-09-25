#!/usr/bin/env node

/**
 * Delete a partner's account without touching the book.
 *
 * Usage: node scripts/delete-user.cjs <username>
 *    or: npm run delete:user -- <username>
 *
 * One REPEATABLE READ transaction. Refuses, and changes nothing, when any
 * foreign key to users cascades (the check in scripts/check-schema.cjs), when
 * the username does not exist (exact match), or when it is the last account.
 * Otherwise deletes the user and commits only if the clients and
 * client_revenues counts are unchanged: the clients the account created keep
 * everything but user_id, which becomes NULL. Prints "Deleted user <name>" with
 * the counts and exits 0, or says why not and exits 1.
 *
 * Where to run it: as scripts/reset-password.cjs (deploy/README.md section 7).
 *
 * Sessions the partner already has stay valid until they expire, because the
 * JWT is not checked against users; rotating JWT_SECRET signs everyone out.
 */

require('dotenv').config();
const { USER_FOREIGN_KEYS_SQL, checkUserForeignKeys } = require('../utils/schemaCheck.cjs');

const COUNTS_SQL = `
  SELECT (SELECT count(*) FROM users)::int AS users,
         (SELECT count(*) FROM clients)::int AS clients,
         (SELECT count(*) FROM client_revenues)::int AS revenues`;

async function deleteUser(client, username) {
  const refuse = async (...messages) => {
    await client.query('ROLLBACK');
    messages.forEach((message) => console.error(message));
    return 1;
  };

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

  const { ok, lines } = checkUserForeignKeys((await client.query(USER_FOREIGN_KEYS_SQL)).rows);
  if (!ok) {
    return refuse(...lines,
      'Refused: deleting a user would delete the clients it created. Deploy the init-db.sql change first. Nothing was deleted.');
  }

  const { rows: [target] } = await client.query(
    'SELECT u.id, (SELECT count(*)::int FROM clients c WHERE c.user_id = u.id) AS created FROM users u WHERE u.username = $1',
    [username]
  );
  if (!target) return refuse('No such user');

  const before = (await client.query(COUNTS_SQL)).rows[0];
  if (before.users <= 1) return refuse('Refused: this is the last account. Nothing was deleted.');

  await client.query('DELETE FROM users WHERE id = $1', [target.id]);

  const after = (await client.query(COUNTS_SQL)).rows[0];
  if (after.clients !== before.clients || after.revenues !== before.revenues) {
    return refuse(
      `Refused: the delete changed clients from ${before.clients} to ${after.clients} and revenue rows from ${before.revenues} to ${after.revenues}. Nothing was deleted.`);
  }

  await client.query('COMMIT');
  console.log(`Deleted user ${username}. Clients: ${after.clients}, of which ${target.created} had been created by this account and now have no user_id. Revenue rows: ${after.revenues}. Accounts left: ${after.users}.`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: node scripts/delete-user.cjs <username>');
    return 1;
  }
  const [username] = args;

  // Required after the argument check so a usage error does not need a database.
  const db = require('../db.cjs');
  try {
    const client = await db.pool.connect();
    try {
      return await deleteUser(client, username);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await db.pool.end();
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('Delete failed:', error.message);
    process.exitCode = 1;
  });
