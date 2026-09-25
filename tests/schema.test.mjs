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

const { USER_FOREIGN_KEYS_SQL, checkUserForeignKeys } = schemaCheck;
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

// Foreign keys on clients (there is one: user_id).
async function clientKeys(db) {
  const { rows } = await db.query(`
    SELECT oid::bigint::text AS oid, conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'f' AND conrelid = 'clients'::regclass`);
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
