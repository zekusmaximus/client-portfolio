#!/usr/bin/env node

/**
 * Empty the book: delete every client and every revenue row, and keep the
 * accounts and the People list (docs/plans/people-and-second-chair.md, P7).
 *
 * Usage: node scripts/reset-book.cjs              print the counts, delete nothing
 *        node scripts/reset-book.cjs --confirm    delete every client
 *    or: npm run reset:book, npm run reset:book -- --confirm
 *
 * Without an argument: prints every foreign key that references clients, the
 * numbers of accounts, people, clients and revenue rows and the rows of any
 * other table that references clients, says nothing was deleted, and exits 1
 * so that it never reads as a successful reset. Any other argument: the usage
 * message and exit 1, without connecting to the database.
 *
 * With --confirm: one REPEATABLE READ transaction. It first locks clients
 * against writes (the page can still read), so a client saved during the reset
 * cannot survive it. Refuses, and changes nothing, while any foreign key to
 * clients is not ON DELETE CASCADE (utils/schemaCheck.cjs). Otherwise deletes
 * every client, which cascades to client_revenues and to any other referencing
 * table (production may still hold V2__update_clients_schema.sql's revenues),
 * and commits only if clients, client_revenues and every other referencing
 * table are then empty and the numbers of accounts and people are unchanged.
 * Prints what it removed and exits 0, or says why not and exits 1. An empty
 * book succeeds and removes 0.
 *
 * Run the backup by hand first (deploy/README.md 7.4). Where to run it: as
 * scripts/reset-password.cjs (the Render Shell, or locally with DATABASE_URL
 * set to the External Database URL and DATABASE_SSL=no-verify; deploy/README.md
 * 7.1 and 7.2). There is deliberately no API endpoint or button for this.
 */

require('dotenv').config();
const {
  CLIENT_FOREIGN_KEYS_SQL,
  checkClientForeignKeys,
  checkBookReset
} = require('../utils/schemaCheck.cjs');

const USAGE = [
  'Usage: node scripts/reset-book.cjs [--confirm]',
  '  without --confirm: print the counts and delete nothing',
  '  --confirm: delete every client and revenue row; accounts and people are kept'
];

const COUNTS_SQL = `
  SELECT (SELECT count(*) FROM users)::int AS users,
         (SELECT count(*) FROM people)::int AS people,
         (SELECT count(*) FROM clients)::int AS clients,
         (SELECT count(*) FROM client_revenues)::int AS "revenueRows"`;

// A waiting LOCK TABLE queues the page's writes behind it; give up rather
// than hold them for long.
const LOCK_TIMEOUT = '10s';

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// "a.b does not cascade", "a.b, c.d do not cascade"
const notCascading = (keys) => `${keys.join(', ')} ${keys.length === 1 ? 'does' : 'do'} not cascade`;

// The book as the transaction sees it. `tables` come from the catalog
// (checkClientForeignKeys), never from input.
async function readBook(client, tables) {
  const { rows: [counts] } = await client.query(COUNTS_SQL);
  const others = [];
  for (const table of tables) {
    const { rows: [{ rows }] } = await client.query(`SELECT count(*)::int AS rows FROM ${table}`);
    others.push({ table, rows });
  }
  return { ...counts, others };
}

async function preview(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const keys = checkClientForeignKeys((await client.query(CLIENT_FOREIGN_KEYS_SQL)).rows);
  const book = await readBook(client, keys.otherTables);
  await client.query('ROLLBACK');

  keys.lines.forEach((line) => console.log(line));
  console.log(`Accounts: ${book.users}`);
  console.log(`People: ${book.people}`);
  console.log(`Clients: ${book.clients}`);
  console.log(`Revenue rows: ${book.revenueRows}`);
  book.others.forEach(({ table, rows }) => console.log(`Rows of ${table}: ${rows}`));
  if (!keys.ok) {
    console.log(`--confirm will refuse while ${notCascading(keys.refused)}.`);
  }
  console.log('Nothing was deleted. Run again with --confirm to delete every client.');
  return 1;
}

async function resetBook(client) {
  const refuse = async (...messages) => {
    await client.query('ROLLBACK');
    messages.forEach((message) => console.error(message));
    return 1;
  };

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  // Before any query: a REPEATABLE READ snapshot is fixed by the first one, so
  // taking the lock first means the snapshot includes every write committed
  // before it. EXCLUSIVE lets plain reads through and blocks every write to
  // clients, and every insert into a table that references it (its foreign
  // key check locks the client row).
  await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  try {
    await client.query('LOCK TABLE clients IN EXCLUSIVE MODE');
  } catch (error) {
    if (error.code !== '55P03') throw error;
    return refuse(`Refused: another connection was still writing to clients after ${LOCK_TIMEOUT} (an import or a save in progress). Nothing was deleted. Try again in a minute.`);
  }

  const keys = checkClientForeignKeys((await client.query(CLIENT_FOREIGN_KEYS_SQL)).rows);
  if (!keys.ok) {
    return refuse(...keys.lines,
      `Refused: ${notCascading(keys.refused)}, so deleting the clients would fail or leave rows pointing at clients that no longer exist. Find out what those rows are first. Nothing was deleted.`);
  }

  const before = await readBook(client, keys.otherTables);
  await client.query('DELETE FROM clients');
  const after = await readBook(client, keys.otherTables);

  const check = checkBookReset(before, after);
  if (!check.ok) {
    return refuse(`Refused: after the delete, ${check.problems.join('; ')}. Nothing was deleted.`);
  }

  await client.query('COMMIT');
  const others = before.others.length === 0
    ? ''
    : ` (and ${before.others.map(({ table, rows }) => `${plural(rows, 'row')} of ${table}`).join(', ')})`;
  console.log(`Removed ${plural(before.clients, 'client')} and ${plural(before.revenueRows, 'revenue row')}${others}. Accounts: ${after.users} and people: ${after.people}, unchanged.`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.length === 1 && args[0] === '--confirm';
  if (args.length > 0 && !confirm) {
    USAGE.forEach((line) => console.error(line));
    return 1;
  }

  // Required after the argument check so a usage error does not need a database.
  const db = require('../db.cjs');
  try {
    const client = await db.pool.connect();
    try {
      return confirm ? await resetBook(client) : await preview(client);
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
    console.error('Reset failed:', error.message);
    process.exitCode = 1;
  });
