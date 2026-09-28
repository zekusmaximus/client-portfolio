#!/usr/bin/env node

/**
 * Repair the client text the request sanitizer stored HTML-escaped before
 * Tier 2 WP5 (docs/plans/tier-2.md, S8): `Barnes &amp; Noble` back to
 * `Barnes & Noble`, in clients.name, notes, primary_lobbyist,
 * client_originator and lobbyist_team (element by element), with
 * unescapeStored (utils/escaping.cjs), however many times it was escaped.
 *
 * Usage: node scripts/unescape-book.cjs                   list the escaped text, change nothing
 *        node scripts/unescape-book.cjs --confirm <n>     repair it; <n> is the preview's count
 *    or: npm run unescape:book, npm run unescape:book -- --confirm <n>
 *
 * Without an argument: for each column, the number of clients whose text is
 * escaped and a few of them as stored and as repaired (a note's text is never
 * printed, only its length); the number of clients to repair; the names two
 * or more clients share regardless of case (the import's rule); entity-like
 * text the repair leaves as it is; and any other text column of any table
 * holding entity-like text, which nothing changes. Ends with the exact
 * --confirm command, changes nothing, and exits 1 so that it never reads as a
 * repair. Any other argument: the usage message and exit 1, without
 * connecting to the database.
 *
 * With --confirm <n>: one REPEATABLE READ transaction that first locks
 * clients against writes (the page can still read; 10 s lock timeout), reads
 * every client, and refuses unless the clients holding escaped text are
 * exactly <n>. It writes the repaired text to those clients by id (compared
 * as text: production's ids are integers, init-db.sql's uuids), reads them
 * again, and commits only if nothing is left to repair and no two clients
 * share a name regardless of case; a name shared before the repair refuses
 * it too, as it refuses the import's row. updated_at is left as it is: the
 * repair restores what partners typed, and edit conflicts (WP6) will compare
 * it. Prints each client it changed and exits 0, or says why not, changes
 * nothing and exits 1. unescapeStored is idempotent, so a second run finds
 * nothing (`--confirm 0` then commits nothing and exits 0).
 *
 * Run it only on the API that stores text as typed (`plain-text` in
 * /api/health's features): an older API escapes every save again. Back up
 * first. Runbook: deploy/README.md 7.5. It runs where scripts/reset-book.cjs
 * runs (the Render Shell, or locally with DATABASE_URL set to the External
 * Database URL and DATABASE_SSL=no-verify; 7.1 and 7.2). Never from
 * init-db.sql, which runs at every start.
 */

require('dotenv').config();
const {
  REPAIR_COLUMNS,
  ENTITY_LIKE_SQL,
  planRepair,
  sharedNames,
  checkRepair
} = require('../utils/unescapeBook.cjs');

const USAGE = [
  'Usage: node scripts/unescape-book.cjs [--confirm <clients>]',
  '  without --confirm: list the escaped text and change nothing',
  '  --confirm <clients>: repair it; <clients> is the number the preview printed'
];

const ROWS_SQL = `
  SELECT id::text AS id, name, notes, primary_lobbyist, client_originator, lobbyist_team
    FROM clients
   ORDER BY clients.id`;

// Every text column of every table in public, text arrays included; the
// clients columns the repair rewrites are left out by the caller.
const TEXT_COLUMNS_SQL = `
  SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
   WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     AND (c.data_type IN ('text', 'character varying', 'character')
          OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar', '_bpchar')))
   ORDER BY c.table_name, c.ordinal_position`;

// As scripts/reset-book.cjs: a waiting LOCK TABLE queues the page's writes
// behind it, so give up rather than hold them for long.
const LOCK_TIMEOUT = '10s';
const EXAMPLES = 5;

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const show = (value) => JSON.stringify(value);
const length = (value) => (typeof value === 'string' ? value.length : 0);
const confirmCommand = (n) => `npm run unescape:book -- --confirm ${n}   (or: node scripts/unescape-book.cjs --confirm ${n})`;

// One column of one client, as stored and as repaired. A note's text is never
// printed (client notes stay out of logs and out of the AI, T4): its length.
function describe(change, column) {
  const { before, after } = change;
  if (column === 'notes') return `notes: ${length(before.notes)} characters -> ${length(after.notes)}`;
  return `${column}: ${show(before[column])} -> ${show(after[column])}`;
}

const label = (change) => `${change.id} ${show(change.after.name)}`;

function sharedLines(shared) {
  return shared.map(({ name, clients }) =>
    `  ${show(name)}: ${clients.map((c) => `${c.id} ${show(c.name)}`).join('; ')}`);
}

// Text columns outside the repair that hold entity-like text, counted and
// never changed. Table and column names come from the catalog, quoted.
async function otherColumns(client) {
  const { rows: columns } = await client.query(TEXT_COLUMNS_SQL);
  const found = [];
  for (const { table_name: table, column_name: column } of columns) {
    if (table === 'clients' && REPAIR_COLUMNS.includes(column)) continue;
    const { rows: [{ n }] } = await client.query(
      `SELECT count(*)::int AS n FROM ${client.escapeIdentifier(table)} WHERE ${client.escapeIdentifier(column)}::text ~ $1`,
      [ENTITY_LIKE_SQL]);
    if (n > 0) found.push({ table, column, n });
  }
  return found;
}

async function preview(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { rows } = await client.query(ROWS_SQL);
  const others = await otherColumns(client);
  await client.query('ROLLBACK');

  const plan = planRepair(rows);
  const shared = sharedNames(rows);
  console.log(`Clients: ${rows.length}`);
  console.log('Escaped text by column, as stored -> as --confirm writes it:');
  for (const column of REPAIR_COLUMNS) {
    const changes = plan.changes.filter((c) => c.columns.includes(column));
    console.log(`  ${column}: ${plural(changes.length, 'client')}${column === 'notes' && changes.length > 0 ? ' (the text is not printed)' : ''}`);
    changes.slice(0, EXAMPLES).forEach((c) =>
      console.log(`    ${column === 'notes' ? label(c) : c.id}: ${describe(c, column)}`));
    if (changes.length > EXAMPLES) console.log(`    and ${changes.length - EXAMPLES} more`);
  }
  console.log(`Clients to repair: ${plan.total}`);

  if (shared.length === 0) {
    console.log('Names two or more clients share regardless of case: none.');
  } else {
    console.log(`Names two or more clients share regardless of case (the import's rule, counting the repair): ${shared.length}`);
    sharedLines(shared).forEach((line) => console.log(line));
  }

  if (plan.leftovers.length === 0) {
    console.log('Entity-like text the repair leaves as it is: none.');
  } else {
    console.log(`Entity-like text the repair leaves as it is (not an escape it can undo): ${plural(plan.leftovers.length, 'value')}`);
    plan.leftovers.forEach((l) => console.log(`  ${l.id} ${show(l.name)}: ${l.column}`));
  }

  if (others.length === 0) {
    console.log('Other text columns holding entity-like text (never changed): none.');
  } else {
    console.log('Other text columns holding entity-like text (never changed):');
    others.forEach(({ table, column, n }) => console.log(`  ${table}.${column}: ${plural(n, 'row')}`));
  }

  if (shared.length > 0) {
    console.log('Nothing was changed. --confirm refuses while any name above is shared: on Client Details, delete the client you do not want, then run this again.');
  } else if (plan.total === 0) {
    console.log('Nothing was changed, and nothing is left to repair.');
  } else {
    console.log(`Nothing was changed. To repair the ${plural(plan.total, 'client')} above, run: ${confirmCommand(plan.total)}`);
  }
  return 1;
}

async function repair(client, confirmed) {
  const refuse = async (message) => {
    await client.query('ROLLBACK');
    console.error(message);
    return 1;
  };

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  // As scripts/reset-book.cjs: the lock before any query, so the snapshot
  // holds every write committed before it. EXCLUSIVE lets plain reads through
  // and blocks every write to clients.
  await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  try {
    await client.query('LOCK TABLE clients IN EXCLUSIVE MODE');
  } catch (error) {
    if (error.code !== '55P03') throw error;
    return refuse(`Refused: another connection was still writing to clients after ${LOCK_TIMEOUT} (an import or a save in progress). Nothing was changed. Try again in a minute.`);
  }

  const { rows } = await client.query(ROWS_SQL);
  const plan = planRepair(rows);
  if (plan.total !== confirmed) {
    return refuse(`Refused: ${plural(plan.total, 'client')} ${plan.total === 1 ? 'holds' : 'hold'} escaped text now, not the ${confirmed} confirmed. Nothing was changed. Run the preview again and confirm its count.`);
  }
  const shared = sharedNames(rows);
  if (shared.length > 0) {
    await client.query('ROLLBACK');
    console.error('Refused: two or more clients share a name regardless of case, so the import could not tell them apart. On Client Details, delete the client you do not want, then run the preview again. Nothing was changed.');
    sharedLines(shared).forEach((line) => console.error(line));
    return 1;
  }

  for (const change of plan.changes) {
    const { after } = change;
    const { rowCount } = await client.query(`
      UPDATE clients
         SET name = $2, notes = $3, primary_lobbyist = $4, client_originator = $5, lobbyist_team = $6
       WHERE id::text = $1`,
    [change.id, after.name, after.notes, after.primary_lobbyist, after.client_originator, after.lobbyist_team]);
    if (rowCount !== 1) {
      return refuse(`Refused: client ${change.id} was not updated. Nothing was changed.`);
    }
  }

  const { rows: written } = await client.query(ROWS_SQL);
  const check = checkRepair(confirmed, plan, written);
  if (!check.ok) {
    return refuse(`Refused: after the repair, ${check.problems.join('; ')}. Nothing was changed.`);
  }
  if (JSON.stringify(written) !== JSON.stringify(plan.repaired)) {
    return refuse('Refused: the rows read back differ from the repair written. Nothing was changed.');
  }

  await client.query('COMMIT');
  const counts = REPAIR_COLUMNS.map((column) => `${column} ${plan.byColumn[column]}`).join(', ');
  console.log(`Repaired ${plural(plan.total, 'client')} (${counts}); updated_at left as it was.`);
  plan.changes.forEach((c) => console.log(`  ${label(c)}: ${c.columns.map((column) => describe(c, column)).join('; ')}`));
  return 0;
}

// `--confirm <n>` with n a whole number written in digits, or nothing
function parseArgs(args) {
  if (args.length === 0) return { confirmed: null };
  if (args.length === 2 && args[0] === '--confirm' && /^\d{1,9}$/.test(args[1])) {
    return { confirmed: Number(args[1]) };
  }
  return null;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    USAGE.forEach((line) => console.error(line));
    return 1;
  }

  // Required after the argument check so a usage error does not need a database.
  const db = require('../db.cjs');
  try {
    const client = await db.pool.connect();
    try {
      return parsed.confirmed === null ? await preview(client) : await repair(client, parsed.confirmed);
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
    console.error('Repair failed:', error.message);
    process.exitCode = 1;
  });
