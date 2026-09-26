// clients.user_id must not cascade: deleting a user keeps every client and
// every revenue row (init-db.sql, docs/plans/tier-0.md section 12).
//
// The checkUserForeignKeys tests are pure and always run. The database tests
// need SCHEMA_TEST_SERVER_URL, the superuser URL of a THROWAWAY PostgreSQL
// server (CI's schema job sets it; locally, plan section 0.4), and are skipped
// without it. Each creates its own schema_test_* database and drops it; nothing
// else on the server is touched. init-db.sql is applied the way server.cjs
// applies it, as one multi-statement query. Never import db.cjs here: the
// scripts are run as child processes instead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import schemaCheck from '../utils/schemaCheck.cjs';

const { USER_FOREIGN_KEYS_SQL, checkUserForeignKeys, checkClientForeignKeys, checkBookReset } = schemaCheck;
const repo = fileURLToPath(new URL('..', import.meta.url));
const initSql = readFileSync(new URL('../init-db.sql', import.meta.url), 'utf8');
const serverUrl = process.env.SCHEMA_TEST_SERVER_URL;
const execFileAsync = promisify(execFile);

const SET_NULL = 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL';
const CASCADE = 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE';

// --- pure ------------------------------------------------------------------

test('checkUserForeignKeys: SET NULL passes, one line per key', () => {
  const result = checkUserForeignKeys([
    { table_name: 'clients', constraint_name: 'clients_user_id_fkey', on_delete: 'n', definition: SET_NULL },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [`ok  clients.clients_user_id_fkey: ${SET_NULL}`]);
});

test('checkUserForeignKeys: any cascading key fails and is marked', () => {
  const result = checkUserForeignKeys([
    { table_name: 'clients', constraint_name: 'clients_user_id_fkey', on_delete: 'c', definition: CASCADE },
    { table_name: 'notes', constraint_name: 'notes_user_id_fkey', on_delete: 'n', definition: SET_NULL },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /^CASCADES {2}clients\.clients_user_id_fkey/);
  assert.match(result.lines[1], /^ok {2}notes\.notes_user_id_fkey/);
});

test('checkUserForeignKeys: no key referencing users passes and says so', () => {
  assert.deepEqual(checkUserForeignKeys([]), { ok: true, lines: ['No foreign key references users.'] });
});

// --- PostgreSQL ------------------------------------------------------------

function urlFor(database) {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

// Runs fn(db, url) against a new empty database, then drops it.
async function withDatabase(fn) {
  const name = `schema_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  const db = new pg.Client({ connectionString: urlFor(name) });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    await db.connect();
    await fn(db, urlFor(name));
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

const applyInit = (db) => db.query(initSql);

// The constraint every database created before this change has: the inline
// `REFERENCES users(id) ON DELETE CASCADE`, which PostgreSQL names
// clients_user_id_fkey. `name` reproduces the same key under another name.
const makeLegacy = (db, name = 'clients_user_id_fkey') => db.query(
  `ALTER TABLE clients DROP CONSTRAINT clients_user_id_fkey,
     ADD CONSTRAINT ${name} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);

// Two partners; partner-a created three clients, partner-b one, and one has no
// account recorded, as every client the current code creates. Two revenue years each.
const seed = (db) => db.query(`
  INSERT INTO users (username, password_hash) VALUES ('partner-a', 'x'), ('partner-b', 'x');
  INSERT INTO clients (user_id, name)
  SELECT (SELECT id FROM users WHERE username = 'partner-a'), format('A%s', i) FROM generate_series(1, 3) AS i;
  INSERT INTO clients (user_id, name)
  VALUES ((SELECT id FROM users WHERE username = 'partner-b'), 'B1'), (NULL, 'Shared1');
  INSERT INTO client_revenues (client_id, year, revenue_amount)
  SELECT id, y, 1000 FROM clients CROSS JOIN generate_series(2024, 2025) AS y;
`);

async function counts(db) {
  const { rows: [row] } = await db.query(`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM clients)::int AS clients,
           (SELECT count(*) FROM client_revenues)::int AS revenues`);
  return row;
}

// Foreign keys from clients to users (there is one: user_id). The keys to
// people are covered by the people suite below.
async function clientKeys(db) {
  const { rows } = await db.query(`
    SELECT oid::bigint::text AS oid, conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE contype = 'f' AND conrelid = 'clients'::regclass AND confrelid = 'users'::regclass`);
  return rows;
}

async function userCheck(db) {
  return checkUserForeignKeys((await db.query(USER_FOREIGN_KEYS_SQL)).rows);
}

async function deletePartnerA(db) {
  await db.query("DELETE FROM users WHERE username = 'partner-a'");
}

// Runs a script against url; resolves to { code, stdout, stderr } whatever the exit code.
async function runScript(script, url, ...args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: 'false' },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

describe('init-db.sql on PostgreSQL', { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  test('a new database gets ON DELETE SET NULL, and a second start changes nothing', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      const [key, ...others] = await clientKeys(db);
      assert.deepEqual(others, []);
      assert.equal(key.conname, 'clients_user_id_fkey');
      assert.equal(key.definition, SET_NULL);

      await applyInit(db);
      assert.deepEqual(await clientKeys(db), [key], 'the constraint was dropped and re-added on a no-op start');
      assert.equal((await userCheck(db)).ok, true);
    });
  });

  test('an existing database: the old cascade deletes clients, the migration stops it', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      await seed(db);
      await makeLegacy(db);
      assert.deepEqual(await counts(db), { users: 2, clients: 5, revenues: 10 });

      // The fixture reproduces the defect: deleting partner-a takes its three
      // clients and their six revenue rows.
      assert.equal((await userCheck(db)).ok, false);
      await db.query('BEGIN');
      await deletePartnerA(db);
      assert.deepEqual(await counts(db), { users: 1, clients: 2, revenues: 4 });
      await db.query('ROLLBACK');

      // The next server start migrates it.
      await applyInit(db);
      const keys = await clientKeys(db);
      assert.deepEqual(keys.map((k) => [k.conname, k.definition]), [['clients_user_id_fkey', SET_NULL]]);
      assert.equal((await userCheck(db)).ok, true);

      await applyInit(db);
      assert.deepEqual(await clientKeys(db), keys, 'the constraint was dropped and re-added on a no-op start');

      // Deleting the user now keeps every client and revenue row; only the
      // user_id of the clients it created is cleared.
      await deletePartnerA(db);
      assert.deepEqual(await counts(db), { users: 1, clients: 5, revenues: 10 });
      const { rows } = await db.query(`
        SELECT c.name, u.username FROM clients c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.name`);
      assert.deepEqual(rows.map((r) => [r.name, r.username]), [
        ['A1', null], ['A2', null], ['A3', null], ['B1', 'partner-b'], ['Shared1', null],
      ]);
    });
  });

  test('a cascading key under another name is replaced by clients_user_id_fkey', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      await makeLegacy(db, 'clients_owner_fk');
      assert.deepEqual((await clientKeys(db)).map((k) => k.conname), ['clients_owner_fk']);

      await applyInit(db);
      assert.deepEqual((await clientKeys(db)).map((k) => [k.conname, k.definition]),
        [['clients_user_id_fkey', SET_NULL]]);
    });
  });

  test('check-schema and delete-user refuse on the old schema and work after the migration', async () => {
    await withDatabase(async (db, url) => {
      await applyInit(db);
      await seed(db);
      await makeLegacy(db);

      let result = await runScript('scripts/check-schema.cjs', url);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /^CASCADES {2}clients\.clients_user_id_fkey: .*ON DELETE CASCADE$/m);
      assert.match(result.stdout, /^ {2}partner-a: 3$/m);
      assert.match(result.stdout, /^ {2}\(no account recorded\): 1$/m);
      assert.match(result.stdout, /^FAIL: /m);

      result = await runScript('scripts/delete-user.cjs', url, 'partner-a');
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /Refused: deleting a user would delete the clients it created/);
      assert.deepEqual(await counts(db), { users: 2, clients: 5, revenues: 10 });

      await applyInit(db);

      result = await runScript('scripts/check-schema.cjs', url);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /^ok {2}clients\.clients_user_id_fkey: .*ON DELETE SET NULL$/m);
      assert.match(result.stdout, /^OK: /m);

      result = await runScript('scripts/delete-user.cjs', url, 'nobody');
      assert.equal(result.code, 1);
      assert.match(result.stderr, /^No such user$/m);

      result = await runScript('scripts/delete-user.cjs', url, 'partner-a');
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout,
        /^Deleted user partner-a\. Clients: 5, of which 3 had been created by this account and now have no user_id\. Revenue rows: 10\. Accounts left: 1\.$/m);
      assert.deepEqual(await counts(db), { users: 1, clients: 5, revenues: 10 });

      result = await runScript('scripts/delete-user.cjs', url, 'partner-b');
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Refused: this is the last account/);
      assert.deepEqual(await counts(db), { users: 1, clients: 5, revenues: 10 });
    });
  });
});

// --- stickiness: "not rated" survives a restart (Tier 1 WP2) ---------------

// init-db.sql runs at every start. Its stickiness backfill (from the legacy
// relationship_intensity, which defaults to 5 on every new row) once ran at
// every start too, and turned each unrated client into a 3 at the next one;
// the book (utils/book.cjs, T4 and T5) then counted it as rated and safe.
const stickiness = async (db) =>
  (await db.query('SELECT name, stickiness, relationship_intensity FROM clients ORDER BY name')).rows
    .map((r) => [r.name, r.stickiness, r.relationship_intensity]);

// Production's clients table before the stickiness column: the columns this
// test needs, with relationship_intensity defaulting to 5 as it does there
const PRE_STICKINESS_SQL = `
  CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL);
  CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    relationship_intensity INTEGER DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE client_revenues (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    revenue_amount NUMERIC(12, 2) NOT NULL
  );`;

describe('stickiness on PostgreSQL', { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  test('an unrated client stays unrated across restarts, and a rating stays as picked', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      // As the import and the client form write them: no relationship_intensity,
      // so the column's default of 5 applies
      await db.query(`INSERT INTO clients (name, stickiness) VALUES ('Unrated', NULL), ('Cold', 1), ('Bond', 5)`);
      const before = await stickiness(db);
      assert.deepEqual(before, [['Bond', 5, 5], ['Cold', 1, 5], ['Unrated', null, 5]]);

      await applyInit(db);
      await applyInit(db);
      assert.deepEqual(await stickiness(db), before);
    });
  });

  test('a database from before the stickiness column is seeded once from relationship_intensity, then left alone', async () => {
    await withDatabase(async (db) => {
      await db.query(PRE_STICKINESS_SQL);
      await db.query(`INSERT INTO clients (name, relationship_intensity) VALUES ('High', 8), ('Low', 1), ('Unknown', NULL)`);

      await applyInit(db);
      assert.deepEqual(await stickiness(db), [['High', 4, 8], ['Low', 1, 1], ['Unknown', null, null]]);

      // A partner clears one rating (a blank Stickiness cell): the next start keeps it cleared
      await db.query(`UPDATE clients SET stickiness = NULL WHERE name = 'High'`);
      await applyInit(db);
      assert.deepEqual(await stickiness(db), [['High', null, 8], ['Low', 1, 1], ['Unknown', null, null]]);
    });
  });
});

// --- people (docs/plans/people-and-second-chair.md, P1-P5) -----------------

// init-db.sql as it was before the people section: everything above its first
// line. Applying it to a new database gives a pre-plan schema; applying it to a
// migrated one is what a Render rollback to pre-plan code does at start.
const PEOPLE_MARKER = '-- People in the book';
const prePeopleSql = initSql.slice(0, initSql.indexOf(PEOPLE_MARKER));

const SEEDED = [
  ['Brendan', 'partner'], ['Jay', 'emeritus'], ['Jeff', 'partner'], ['Joe', 'partner'],
  ['Kevin', 'partner'], ['Mike', 'partner'], ['Paula', 'partner'],
];

async function roster(db) {
  const { rows } = await db.query('SELECT id, name, role, active FROM people ORDER BY name');
  return rows;
}

const personId = async (db, name) =>
  (await db.query('SELECT id FROM people WHERE name = $1', [name])).rows[0].id;

// Resolves to the SQLSTATE the statement fails with, or null if it succeeds.
async function sqlState(db, sql, params) {
  await db.query('SAVEPOINT s');
  try {
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT s');
    return null;
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    return error.code;
  }
}

test('init-db.sql still contains the people section marker the rollback tests cut at', () => {
  assert.ok(initSql.indexOf(PEOPLE_MARKER) > 0);
  assert.doesNotMatch(prePeopleSql, /people/i);
});

describe('people on PostgreSQL', { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  test('a new database has the seven people, and a second start adds nobody', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      const first = await roster(db);
      assert.deepEqual(first.map((p) => [p.name, p.role]), SEEDED);
      assert.ok(first.every((p) => p.active));

      await applyInit(db);
      assert.deepEqual(await roster(db), first);
    });
  });

  test('a rename and a new associate survive a restart; the seed does not return', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      await db.query("UPDATE people SET name = 'Joseph' WHERE name = 'Joe'");
      await db.query("INSERT INTO people (name, role) VALUES ('Anna', 'associate')");
      await applyInit(db);
      const names = (await roster(db)).map((p) => p.name);
      assert.ok(names.includes('Joseph') && names.includes('Anna'));
      assert.ok(!names.includes('Joe'));
      assert.equal(names.length, 8);
    });
  });

  test('names are unique regardless of case; roles are limited to the three', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      await db.query('BEGIN');
      assert.equal(await sqlState(db, "INSERT INTO people (name, role) VALUES ('kevin', 'associate')"), '23505');
      assert.equal(await sqlState(db, "INSERT INTO people (name, role) VALUES ('Anna', 'admin')"), '23514');
      assert.equal(await sqlState(db, "INSERT INTO people (name, role) VALUES ('Anna', 'associate')"), null);
      await db.query('ROLLBACK');
    });
  });

  test('a client refuses an unknown person and a second chair equal to the lead', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      const kevin = await personId(db, 'Kevin');
      const jay = await personId(db, 'Jay');
      await db.query('BEGIN');
      assert.equal(await sqlState(db, 'INSERT INTO clients (name, lead_id) VALUES ($1, 999999)', ['X']), '23503');
      assert.equal(await sqlState(db, 'INSERT INTO clients (name, second_chair_id) VALUES ($1, 999999)', ['X']), '23503');
      assert.equal(await sqlState(db, 'INSERT INTO clients (name, originator_id) VALUES ($1, 999999)', ['X']), '23503');
      assert.equal(await sqlState(db,
        'INSERT INTO clients (name, lead_id, second_chair_id) VALUES ($1, $2, $2)', ['X', kevin]), '23514');
      assert.equal(await sqlState(db,
        'INSERT INTO clients (name, lead_id, second_chair_id, originator_id, originator_is_firm) VALUES ($1, $2, $3, $3, true)',
        ['Y', kevin, jay]), null);
      assert.equal(await sqlState(db, 'DELETE FROM people WHERE id = $1', [jay]), '23503',
        'a person someone points at cannot be deleted');
      await db.query('ROLLBACK');
    });
  });

  test('a pre-plan database migrates with every client and revenue row intact', async () => {
    await withDatabase(async (db) => {
      await db.query(prePeopleSql);
      await seed(db);
      await db.query("UPDATE clients SET primary_lobbyist = 'Steve', lobbyist_team = ARRAY['Fritz', 'Zeke'], client_originator = 'Steve'");
      const before = await counts(db);

      await applyInit(db);
      assert.deepEqual(await counts(db), before);
      assert.equal((await roster(db)).length, 7);
      const { rows } = await db.query(`
        SELECT DISTINCT primary_lobbyist, lobbyist_team, client_originator,
               lead_id, second_chair_id, originator_id, originator_is_firm FROM clients`);
      assert.deepEqual(rows, [{
        primary_lobbyist: 'Steve', lobbyist_team: ['Fritz', 'Zeke'], client_originator: 'Steve',
        lead_id: null, second_chair_id: null, originator_id: null, originator_is_firm: false,
      }]);
    });
  });

  test('a rollback start (the pre-plan file on a migrated database) succeeds and keeps the people data', async () => {
    await withDatabase(async (db) => {
      await applyInit(db);
      await seed(db);
      const kevin = await personId(db, 'Kevin');
      const jay = await personId(db, 'Jay');
      await db.query('UPDATE clients SET lead_id = $1, second_chair_id = $2', [kevin, jay]);

      await db.query(prePeopleSql);
      const { rows } = await db.query('SELECT DISTINCT lead_id, second_chair_id FROM clients');
      assert.deepEqual(rows, [{ lead_id: kevin, second_chair_id: jay }]);
      assert.equal((await roster(db)).length, 7);

      await applyInit(db);
      assert.equal((await roster(db)).length, 7);
    });
  });
});

// --- reset-book (docs/plans/people-and-second-chair.md, P7 and Phase 3) ------

const CLIENT_CASCADE = 'FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE';
const CLIENT_NO_ACTION = 'FOREIGN KEY (client_id) REFERENCES clients(id)';
const CLIENT_SET_NULL = 'FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL';

test('checkClientForeignKeys: cascading keys pass; the other tables are listed once, without clients and client_revenues', () => {
  const result = checkClientForeignKeys([
    { table_name: 'client_revenues', constraint_name: 'client_revenues_client_id_fkey', on_delete: 'c', definition: CLIENT_CASCADE },
    { table_name: 'clients', constraint_name: 'clients_parent_fkey', on_delete: 'c', definition: 'FOREIGN KEY (parent_id) REFERENCES clients(id) ON DELETE CASCADE' },
    { table_name: 'revenues', constraint_name: 'revenues_client_id_fkey', on_delete: 'c', definition: CLIENT_CASCADE },
    { table_name: 'revenues', constraint_name: 'revenues_other_fkey', on_delete: 'c', definition: CLIENT_CASCADE },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.otherTables, ['revenues']);
  assert.deepEqual(result.lines[0], `ok  client_revenues.client_revenues_client_id_fkey: ${CLIENT_CASCADE}`);
  assert.equal(result.lines.length, 4);
});

test('checkClientForeignKeys: any key that does not cascade fails and is named', () => {
  const result = checkClientForeignKeys([
    { table_name: 'client_notes', constraint_name: 'client_notes_client_id_fkey', on_delete: 'a', definition: CLIENT_NO_ACTION },
    { table_name: 'client_revenues', constraint_name: 'client_revenues_client_id_fkey', on_delete: 'c', definition: CLIENT_CASCADE },
    { table_name: 'visits', constraint_name: 'visits_client_id_fkey', on_delete: 'n', definition: CLIENT_SET_NULL },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.refused, ['client_notes.client_notes_client_id_fkey', 'visits.visits_client_id_fkey']);
  assert.deepEqual(result.otherTables, ['client_notes', 'visits']);
  assert.deepEqual(result.lines, [
    `DOES NOT CASCADE  client_notes.client_notes_client_id_fkey: ${CLIENT_NO_ACTION}`,
    `ok  client_revenues.client_revenues_client_id_fkey: ${CLIENT_CASCADE}`,
    `DOES NOT CASCADE  visits.visits_client_id_fkey: ${CLIENT_SET_NULL}`,
  ]);
});

test('checkClientForeignKeys: no key referencing clients passes and says so', () => {
  assert.deepEqual(checkClientForeignKeys([]),
    { ok: true, lines: ['No foreign key references clients.'], refused: [], otherTables: [] });
});

test('checkBookReset: commits only on an empty book with the accounts and people unchanged', () => {
  const before = { users: 6, people: 7, clients: 142, revenueRows: 398, others: [{ table: 'revenues', rows: 12 }] };
  const empty = { users: 6, people: 7, clients: 0, revenueRows: 0, others: [{ table: 'revenues', rows: 0 }] };
  assert.deepEqual(checkBookReset(before, empty), { ok: true, problems: [] });

  assert.deepEqual(checkBookReset(before, { ...empty, clients: 1, revenueRows: 2, others: [{ table: 'revenues', rows: 3 }] }), {
    ok: false,
    problems: ['clients still holds 1 row', 'client_revenues still holds 2 rows', 'revenues still holds 3 rows'],
  });
  assert.deepEqual(checkBookReset(before, { ...empty, users: 5, people: 0 }), {
    ok: false,
    problems: ['accounts went from 6 to 5', 'people went from 7 to 0'],
  });
});

// V2__update_clients_schema.sql's revenues table, as production may still hold
// it: the file's steps 4 and 5. Its other steps alter clients, which
// init-db.sql has absorbed.
const v2Sql = readFileSync(new URL('../V2__update_clients_schema.sql', import.meta.url), 'utf8');
const V2_REVENUES_SQL = v2Sql.slice(v2Sql.indexOf('-- Step 4'), v2Sql.lastIndexOf('COMMIT'));

test('V2__update_clients_schema.sql still creates the cascading revenues table the reset tests use', () => {
  assert.match(V2_REVENUES_SQL, /^-- Step 4/);
  assert.match(V2_REVENUES_SQL, /CREATE TABLE revenues \(/);
  assert.match(V2_REVENUES_SQL, /REFERENCES clients\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(V2_REVENUES_SQL, /COMMIT/);
});

test('reset-book: any argument but --confirm prints the usage and exits 1 without a database', async () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  for (const args of [['--yes'], ['confirm'], ['--confirm', '--confirm'], ['--confirm', 'extra']]) {
    const result = await execFileAsync(process.execPath, ['scripts/reset-book.cjs', ...args], { cwd: repo, env })
      .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
      .catch((error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.stderr, /^Usage: node scripts\/reset-book\.cjs \[--confirm\]$/m);
    assert.doesNotMatch(result.stderr, /DATABASE_URL|Reset failed/);
  }
});

// Every row of the tables the reset reads, for "unchanged"
async function bookSnapshot(db) {
  const rows = async (sql) => (await db.query(sql)).rows;
  return {
    users: await rows('SELECT * FROM users ORDER BY id'),
    people: await rows('SELECT * FROM people ORDER BY id'),
    clients: await rows('SELECT to_jsonb(c) AS row FROM clients c ORDER BY id'),
    revenues: await rows('SELECT to_jsonb(r) AS row FROM client_revenues r ORDER BY id'),
  };
}

// seed()'s two accounts, five clients and ten revenue rows, with people
// assigned, an associate and an inactive former partner: nine people.
async function seedBook(db) {
  await seed(db);
  await db.query(`
    INSERT INTO people (name, role, active) VALUES ('Anna', 'associate', true), ('Steve', 'partner', false);
    UPDATE clients SET lead_id = (SELECT id FROM people WHERE name = 'Kevin'),
                       second_chair_id = (SELECT id FROM people WHERE name = 'Anna'),
                       originator_id = (SELECT id FROM people WHERE name = 'Steve'),
                       originator_is_firm = true;
  `);
}

const RESET_PREVIEW_LAST = /^Nothing was deleted\. Run again with --confirm to delete every client\.$/m;

describe('reset-book on PostgreSQL', { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  test('without an argument: prints the keys and the counts, deletes nothing, exits 1', async () => {
    await withDatabase(async (db, url) => {
      await applyInit(db);
      await seedBook(db);
      const before = await bookSnapshot(db);

      const result = await runScript('scripts/reset-book.cjs', url);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /^ok {2}client_revenues\.client_revenues_client_id_fkey: .*ON DELETE CASCADE$/m);
      assert.match(result.stdout, /^Accounts: 2$/m);
      assert.match(result.stdout, /^People: 9$/m);
      assert.match(result.stdout, /^Clients: 5$/m);
      assert.match(result.stdout, /^Revenue rows: 10$/m);
      assert.doesNotMatch(result.stdout, /^Rows of /m);
      assert.match(result.stdout, RESET_PREVIEW_LAST);
      assert.deepEqual(await bookSnapshot(db), before);
    });
  });

  test('--confirm: every client and revenue row goes; accounts and people are untouched', async () => {
    await withDatabase(async (db, url) => {
      await applyInit(db);
      await seedBook(db);
      const before = await bookSnapshot(db);

      const result = await runScript('scripts/reset-book.cjs', url, '--confirm');
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout,
        /^Removed 5 clients and 10 revenue rows\. Accounts: 2 and people: 9, unchanged\.$/m);

      const after = await bookSnapshot(db);
      assert.deepEqual(after.clients, []);
      assert.deepEqual(after.revenues, []);
      assert.deepEqual(after.users, before.users);
      assert.deepEqual(after.people, before.people);
    });
  });

  test("a legacy revenues table from V2 is counted, and emptied by its cascade", async () => {
    await withDatabase(async (db, url) => {
      await applyInit(db);
      await seedBook(db);
      await db.query(V2_REVENUES_SQL);
      await db.query('INSERT INTO revenues (client_id, year, revenue_amount) SELECT id, 2023, 500 FROM clients');

      let result = await runScript('scripts/reset-book.cjs', url);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /^ok {2}revenues\.revenues_client_id_fkey: FOREIGN KEY \(client_id\) REFERENCES clients\(id\) ON DELETE CASCADE$/m);
      assert.match(result.stdout, /^Rows of revenues: 5$/m);
      assert.match(result.stdout, RESET_PREVIEW_LAST);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM revenues')).rows[0].n, 5);

      result = await runScript('scripts/reset-book.cjs', url, '--confirm');
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout,
        /^Removed 5 clients and 10 revenue rows \(and 5 rows of revenues\)\. Accounts: 2 and people: 9, unchanged\.$/m);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM revenues')).rows[0].n, 0);
      assert.deepEqual(await counts(db), { users: 2, clients: 0, revenues: 0 });
    });
  });

  test('a foreign key to clients that does not cascade: refused, named, nothing deleted', async () => {
    await withDatabase(async (db, url) => {
      await applyInit(db);
      await seedBook(db);
      await db.query(`
        CREATE TABLE client_notes (id SERIAL PRIMARY KEY, client_id UUID REFERENCES clients(id), body TEXT);
        INSERT INTO client_notes (client_id, body) SELECT id, 'note' FROM clients;
        CREATE TABLE visits (id SERIAL PRIMARY KEY, client_id UUID REFERENCES clients(id) ON DELETE SET NULL);
      `);
      const before = await bookSnapshot(db);

      let result = await runScript('scripts/reset-book.cjs', url);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /^Rows of client_notes: 5$/m);
      assert.match(result.stdout, /^Rows of visits: 0$/m);
      assert.match(result.stdout,
        /^--confirm will refuse while client_notes\.client_notes_client_id_fkey, visits\.visits_client_id_fkey do not cascade\.$/m);

      result = await runScript('scripts/reset-book.cjs', url, '--confirm');
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /^DOES NOT CASCADE {2}client_notes\.client_notes_client_id_fkey: FOREIGN KEY \(client_id\) REFERENCES clients\(id\)$/m);
      assert.match(result.stderr, /^DOES NOT CASCADE {2}visits\.visits_client_id_fkey: .*ON DELETE SET NULL$/m);
      assert.match(result.stderr,
        /^Refused: client_notes\.client_notes_client_id_fkey, visits\.visits_client_id_fkey do not cascade, .* Nothing was deleted\.$/m);
      assert.doesNotMatch(result.stdout, /^Removed /m);
      assert.deepEqual(await bookSnapshot(db), before);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM client_notes')).rows[0].n, 5);
    });
  });

  test('an empty book: --confirm succeeds and removes 0', async () => {
    await withDatabase(async (db, url) => {
      await applyInit(db);
      const result = await runScript('scripts/reset-book.cjs', url, '--confirm');
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /^Removed 0 clients and 0 revenue rows\. Accounts: 0 and people: 7, unchanged\.$/m);
      assert.equal((await roster(db)).length, 7);
    });
  });
});
