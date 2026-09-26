// POST /api/data/process-csv on a real server and database: the import sheet's
// people and judgment columns (docs/plans/people-and-second-chair.md, section 3
// and P8) written for exactly the columns a file has, and a file with any
// problem refused whole with the database unchanged.
//
// Needs SCHEMA_TEST_SERVER_URL, the superuser URL of a THROWAWAY PostgreSQL
// server (as tests/schema.test.mjs; CI's schema job sets it), and is skipped
// without it. It creates its own import_test_* database, starts server.cjs on
// it as a child process (never imported: data.cjs and db.cjs throw without
// their environment), adds an account with create-admin.cjs, signs in, and
// parses each file with PapaParse as the upload page does. The last tests run
// Phase 3's flow: Check file (dryRun), then scripts/reset-book.cjs on the
// suite's database, then the section 3 template into the empty book.
//
// The whole suite runs twice: on the tables init-db.sql creates, and on
// production's older tables (PRODUCTION_TABLES_SQL), created before
// init-db.sql runs, as they were on Render. init-db.sql's CREATE TABLE IF NOT
// EXISTS never replaced them, so production's ids are integers, not uuids; the
// first real import on Render failed on that ("column client_id is of type
// integer but expression is of type uuid").
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Papa from 'papaparse';
import validator from 'validator';
import escaping from '../utils/escaping.cjs';
import { clientFormData } from '../src/utils/clientForm.js';
import { sanitizeFormData } from '../src/utils/validation.js';
import { toPersonId } from '../src/utils/people.js';
import { departureModel } from '../src/utils/departure.js';
import { revenueForYear } from '../src/utils/revenue.js';
import { buildTransitionSheet } from '../src/utils/transitionPlans.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const template = readFileSync(new URL('../public/client-book-template.csv', import.meta.url), 'utf8');
const serverUrl = process.env.SCHEMA_TEST_SERVER_URL;
const execFileAsync = promisify(execFile);

const HEADER = 'CLIENT,2024 Contracts,2025 Contracts,2026 Contracts,Lead,Second Chair,Originator,Credit To Firm,Stickiness,Cadence,Handful,Conflict Risk,Practice Area,Notes';
const HEALTH = 'Example Health Network';
const ENERGY = 'Example Energy Coalition';

// The throwaway account's password, generated for each run and never written
// in the repository: random hex plus one character of each class the password
// policy requires (upper case, lower case, digit, symbol).
const generatedPassword = () => randomBytes(12).toString('hex') + ['A', 'a', '1', '!'].join('');

function urlFor(database) {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Resolves when the server has applied init-db.sql and is listening.
function startServer(env) {
  const child = spawn(process.execPath, ['server.cjs'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('Database tables initialized') && output.includes('Server running on port')) {
        clearTimeout(timer);
        resolve();
      }
      if (output.includes('Database initialization failed')) {
        clearTimeout(timer);
        reject(new Error(`init-db.sql failed:\n${output}`));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });
  return { child, ready };
}

// Production's users, clients and client_revenues as they predate init-db.sql:
// integer ids, and the client_revenues the original code wrote with plain
// INSERTs (no UNIQUE (client_id, year), no timestamps). init-db.sql then adds
// its columns and tables on top, as it does at every start on Render.
const PRODUCTION_TABLES_SQL = `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Prospect',
    practice_area TEXT[],
    relationship_strength INTEGER DEFAULT 5,
    conflict_risk VARCHAR(50) DEFAULT 'Medium',
    renewal_probability DECIMAL(3,2) DEFAULT 0.7,
    strategic_fit_score INTEGER DEFAULT 5,
    notes TEXT,
    primary_lobbyist VARCHAR(255),
    client_originator VARCHAR(255),
    lobbyist_team TEXT[],
    interaction_frequency VARCHAR(100),
    relationship_intensity INTEGER DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE client_revenues (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    revenue_amount NUMERIC(12, 2) NOT NULL
  );`;

const SHAPES = [
  { name: 'init-db.sql tables', tables: null, idType: 'uuid' },
  { name: "production's older tables", tables: PRODUCTION_TABLES_SQL, idType: 'integer' },
];

for (const shape of SHAPES)
describe(`the import on PostgreSQL (${shape.name})`, { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  const dbName = `import_test_${randomBytes(6).toString('hex')}`;
  let admin;
  let db;
  let server;
  let base;
  let cookie;
  let env;

  before(async () => {
    admin = new pg.Client({ connectionString: urlFor('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    if (shape.tables) {
      const setup = new pg.Client({ connectionString: urlFor(dbName) });
      await setup.connect();
      await setup.query(shape.tables);
      await setup.end();
    }
    env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: urlFor(dbName),
      DATABASE_SSL: 'false',
      JWT_SECRET: randomBytes(32).toString('hex'),
      ANTHROPIC_API_KEY: '',
      PORT: String(await freePort()),
    };
    base = `http://127.0.0.1:${env.PORT}`;
    server = startServer(env);
    await server.ready;

    db = new pg.Client({ connectionString: urlFor(dbName) });
    await db.connect();

    const account = { username: 'importer', password: generatedPassword() };
    await execFileAsync(process.execPath, ['create-admin.cjs', account.username, account.password], { cwd: repo, env });
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  });

  after(async () => {
    if (server) server.child.kill();
    await db?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin?.end();
  });

  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  // As the upload page does: PapaParse in header mode, then the rows as JSON;
  // `extra` is { dryRun: true } for Check file
  const importCsv = (text, extra = {}) => call('POST', '/api/data/process-csv', {
    csvData: Papa.parse(text, { header: true, skipEmptyLines: true }).data,
    ...extra,
  });

  const clientRow = async (name) => (await db.query(`
    SELECT c.*, lp.name AS lead, sp.name AS second_chair, op.name AS originator
      FROM clients c
      LEFT JOIN people lp ON lp.id = c.lead_id
      LEFT JOIN people sp ON sp.id = c.second_chair_id
      LEFT JOIN people op ON op.id = c.originator_id
     WHERE c.name = $1`, [name])).rows[0];

  const revenue = async (name) => Object.fromEntries((await db.query(`
    SELECT r.year, r.revenue_amount::float AS amount
      FROM client_revenues r JOIN clients c ON c.id = r.client_id
     WHERE c.name = $1 ORDER BY r.year`, [name])).rows.map((r) => [r.year, r.amount]));

  // Every client and revenue row, for "the database is unchanged"
  const snapshot = async () => ({
    clients: (await db.query('SELECT to_jsonb(c) AS row FROM clients c ORDER BY name')).rows,
    revenues: (await db.query('SELECT to_jsonb(r) AS row FROM client_revenues r ORDER BY client_id::text, year')).rows,
    people: (await db.query('SELECT * FROM people ORDER BY id')).rows,
  });

  test('the tables have this run\'s id type', async () => {
    const { rows } = await db.query(`
      SELECT table_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'clients' AND column_name = 'id')
           OR (table_name = 'client_revenues' AND column_name = 'client_id'))
       ORDER BY table_name`);
    assert.deepEqual(rows, [
      { table_name: 'client_revenues', data_type: shape.idType },
      { table_name: 'clients', data_type: shape.idType },
    ]);
  });

  test('the section 3 example imports leads, second chairs, originators and judgments', async () => {
    const { status, body } = await importCsv(template);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.summary.newClients, 2);
    assert.deepEqual(body.summary.revenueYears, [2024, 2025, 2026]);
    assert.deepEqual(body.summary.revenueTotals, { 2024: 60000, 2025: 106000, 2026: 157000 });
    assert.deepEqual(body.summary.sheetColumns, [
      'Lead', 'Second Chair', 'Originator', 'Credit To Firm', 'Stickiness', 'Cadence',
      'Handful', 'Conflict Risk', 'Practice Area', 'Notes',
    ]);

    const health = await clientRow(HEALTH);
    assert.equal(health.lead, 'Kevin');
    assert.equal(health.second_chair, 'Jay');
    assert.equal(health.originator, 'Jay');
    assert.equal(health.originator_is_firm, true);
    assert.equal(health.primary_lobbyist, 'Kevin');
    assert.deepEqual(health.lobbyist_team, ['Kevin', 'Jay']);
    assert.equal(health.client_originator, 'Firm');
    assert.equal(health.stickiness, 5);
    assert.equal(health.interaction_frequency, 'Weekly');
    assert.equal(health.high_maintenance, false);
    assert.equal(health.conflict_risk, 'Low');
    assert.deepEqual(health.practice_area, ['Healthcare']);
    assert.equal(health.notes, '');
    assert.deepEqual(await revenue(HEALTH), { 2024: 60000, 2025: 66000, 2026: 72000 });

    const energy = await clientRow(ENERGY);
    assert.equal(energy.lead, 'Paula');
    assert.equal(energy.second_chair, null);
    assert.equal(energy.originator, 'Paula');
    assert.equal(energy.originator_is_firm, false);
    assert.equal(energy.primary_lobbyist, 'Paula');
    assert.deepEqual(energy.lobbyist_team, ['Paula']);
    assert.equal(energy.client_originator, 'Paula');
    assert.equal(energy.stickiness, 3);
    assert.equal(energy.interaction_frequency, 'Monthly');
    assert.equal(energy.high_maintenance, true);
    assert.equal(energy.conflict_risk, 'Medium');
    assert.deepEqual(energy.practice_area, ['Energy', 'Environmental']);
    assert.equal(energy.notes, 'Renewal talks in spring');
    assert.deepEqual(await revenue(ENERGY), { 2025: 40000, 2026: 85000 });

    // The API: people nested and the legacy fields filled from them (P6)
    const { body: list } = await call('GET', '/api/data/clients');
    const apiHealth = list.clients.find((c) => c.name === HEALTH);
    assert.equal(apiHealth.lead.name, 'Kevin');
    // Contract status is retired (P13): no client the API returns carries it
    assert.equal(list.clients.length, 2);
    assert.ok(list.clients.every((c) => !('status' in c)), 'no client has a status key');
    assert.deepEqual(body.clients.flatMap((c) => Object.keys(c).filter((key) => /status|contract/i.test(key))), []);
    assert.equal(apiHealth.secondChair.name, 'Jay');
    assert.equal(apiHealth.originator.name, 'Jay');
    assert.equal(apiHealth.client_originator, 'Firm');

    // The People list's counts
    const { body: roster } = await call('GET', '/api/people');
    const count = (name) => {
      const p = roster.people.find((person) => person.name === name);
      return [p.lead_count, p.second_chair_count, p.originator_count];
    };
    assert.deepEqual(count('Kevin'), [1, 0, 0]);
    assert.deepEqual(count('Paula'), [1, 0, 1]);
    assert.deepEqual(count('Jay'), [0, 1, 1]);
    assert.deepEqual(count('Brendan'), [0, 0, 0]);
  });

  test('a bad lead, a bad Stickiness and a client named twice: refused whole, all three listed, nothing written', async () => {
    const before = await snapshot();
    const { status, body } = await importCsv([
      HEADER,
      `${HEALTH},,,"$99,000",Jhon,,,,5,Weekly,,Low,Healthcare,`,
      `${ENERGY},,,"$1",Paula,,,,9,Monthly,,Medium,Energy,`,
      'Brand New Client,,,"$5,000",Kevin,,,,3,Monthly,,Low,Other,',
      `${HEALTH.toUpperCase()},,,"$1",Kevin,,,,5,Weekly,,Low,Healthcare,`,
    ].join('\n'));

    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Nothing was imported: the file has 3 problems. Fix the rows below and upload it again.');
    assert.deepEqual(body.errors, [
      { row: 2, client: HEALTH, message: 'Lead "Jhon" is not on the People list.' },
      { row: 3, client: ENERGY, message: 'Stickiness "9" must be a whole number from 1 to 5, or blank.' },
      { row: 5, client: HEALTH.toUpperCase(), message: `"${HEALTH.toUpperCase()}" is also on row 2; each client may appear once in the file.` },
    ]);
    assert.deepEqual(await snapshot(), before);
  });

  test('a header problem refuses the file as row 1', async () => {
    const before = await snapshot();
    const { status, body } = await importCsv(`CLIENT,Second Chair\n${HEALTH},Anna\n`);
    assert.equal(status, 400);
    assert.deepEqual(body.errors.map((e) => e.row), [1]);
    assert.match(body.errors[0].message, /no Lead column/);
    assert.deepEqual(await snapshot(), before);
  });

  test('a file without the people and judgment columns leaves them untouched', async () => {
    const health = await clientRow(HEALTH);
    const { status, body } = await importCsv([
      'CLIENT,2026 Contracts',
      `${HEALTH},"$75,000"`,
      'Plain Client,"$10,000"',
    ].join('\n'));
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.summary.sheetColumns, []);
    assert.equal(body.summary.updatedClients, 1);
    assert.equal(body.summary.newClients, 1);

    const after = await clientRow(HEALTH);
    for (const column of [
      'lead_id', 'second_chair_id', 'originator_id', 'originator_is_firm', 'primary_lobbyist',
      'lobbyist_team', 'client_originator', 'stickiness', 'interaction_frequency',
      'high_maintenance', 'conflict_risk', 'practice_area', 'notes',
    ]) {
      assert.deepEqual(after[column], health[column], column);
    }
    // D5: 2026 updated, the years the file does not mention kept
    assert.deepEqual(await revenue(HEALTH), { 2024: 60000, 2025: 66000, 2026: 75000 });

    // A new client from such a file is as before this change: nobody assigned, the defaults
    const plain = await clientRow('Plain Client');
    assert.equal(plain.lead_id, null);
    assert.equal(plain.second_chair_id, null);
    assert.equal(plain.originator_id, null);
    assert.equal(plain.originator_is_firm, false);
    assert.equal(plain.primary_lobbyist, '');
    assert.deepEqual(plain.lobbyist_team, []);
    assert.equal(plain.client_originator, '');
    assert.equal(plain.stickiness, null);
    assert.equal(plain.high_maintenance, false);
    assert.equal(plain.conflict_risk, 'Medium');
    assert.deepEqual(plain.practice_area, []);
    assert.equal(plain.notes, '');
    assert.equal(plain.interaction_frequency, '');
  });

  test('blank cells in the columns a file has clear those fields', async () => {
    const { status, body } = await importCsv([
      HEADER,
      `${ENERGY},,"$40,000","$85,000",Paula,,,,,,,,,`,
    ].join('\n'));
    assert.equal(status, 200, JSON.stringify(body));

    const energy = await clientRow(ENERGY);
    assert.equal(energy.lead, 'Paula');
    assert.equal(energy.second_chair_id, null);
    assert.equal(energy.originator_id, null);
    assert.equal(energy.originator_is_firm, false);
    assert.equal(energy.stickiness, null);
    assert.equal(energy.interaction_frequency, '');
    assert.equal(energy.high_maintenance, false);
    assert.equal(energy.conflict_risk, 'Medium');
    assert.deepEqual(energy.practice_area, []);
    assert.equal(energy.notes, '');
    assert.equal(energy.primary_lobbyist, 'Paula');
    assert.deepEqual(energy.lobbyist_team, ['Paula']);
    assert.equal(energy.client_originator, '');
  });

  test('names match the People list decoded, in any case: an apostrophe survives the request sanitizer', async () => {
    const added = await call('POST', '/api/people', { name: "Mary O'Brien", role: 'associate' });
    assert.equal(added.status, 201, JSON.stringify(added.body));

    const { status, body } = await importCsv([
      'client,2026 contracts, LEAD ,second  chair,ORIGINATOR,credit to firm',
      `${HEALTH},"$75,000",kevin,mary o'brien,Firm,`,
    ].join('\n'));
    assert.equal(status, 400, 'a lower-case CLIENT header is refused, as before this change');
    assert.match(JSON.stringify(body), /CLIENT is required/);

    const ok = await importCsv([
      'CLIENT,2026 Contracts, LEAD ,second  chair,ORIGINATOR,credit to firm',
      `${HEALTH},"$75,000",kevin,mary o'brien,Firm,`,
    ].join('\n'));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    const health = await clientRow(HEALTH);
    assert.equal(health.lead, 'Kevin');
    assert.equal(health.second_chair, "Mary O'Brien");
    assert.equal(health.originator_id, null);
    assert.equal(health.originator_is_firm, true);
    assert.deepEqual(health.lobbyist_team, ['Kevin', "Mary O'Brien"]);
    assert.equal(health.client_originator, 'Firm');
    // Columns the file lacks: kept
    assert.equal(health.stickiness, 5);
    assert.deepEqual(health.practice_area, ['Healthcare']);
  });

  test('a new lead who is the stored second chair is refused when the file has no Second Chair column', async () => {
    let result = await importCsv(`CLIENT,Lead,Second Chair\n${ENERGY},Paula,Brendan\n`);
    assert.equal(result.status, 200, JSON.stringify(result.body));

    const before = await snapshot();
    result = await importCsv(`CLIENT,Lead\n${ENERGY},Brendan\n`);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body.errors, [{
      row: 2,
      client: ENERGY,
      message: 'Second Chair (Brendan, kept: the file has no Second Chair column): The second chair cannot be the lead.',
    }]);
    assert.deepEqual(await snapshot(), before);

    // A lead-only file keeps the stored second chair and rewrites the legacy text from both
    result = await importCsv(`CLIENT,Lead\n${ENERGY},Kevin\n`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const energy = await clientRow(ENERGY);
    assert.equal(energy.lead, 'Kevin');
    assert.equal(energy.second_chair, 'Brendan');
    assert.deepEqual(energy.lobbyist_team, ['Kevin', 'Brendan']);
  });

  test('a person the import assigned cannot then be deactivated (P5 counts imported clients)', async () => {
    const brendan = (await db.query("SELECT id FROM people WHERE name = 'Brendan'")).rows[0];
    const { status, body } = await call('PUT', `/api/people/${brendan.id}`, { active: false });
    assert.equal(status, 409);
    assert.match(body.error, /second chair on 1 client/);
  });

  // Each person's [leads, second chairs, originated], from the People list
  const peopleCounts = async () => {
    const { status, body } = await call('GET', '/api/people');
    assert.equal(status, 200);
    return Object.fromEntries(body.people.map((p) => [p.name, [p.lead_count, p.second_chair_count, p.originator_count]]));
  };

  const runResetBook = async (...args) => {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/reset-book.cjs', ...args], { cwd: repo, env });
      return { code: 0, stdout, stderr };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };

  test('Check file (dryRun) writes nothing and answers exactly what the import would', async () => {
    // The page asks /api/health before a check (no sign-in)
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health.features, ['check-file', 'transition-plan-roster', 'second-chair-assign', 'ai-book']);

    const before = await snapshot();
    const countsBefore = await peopleCounts();

    // A file that changes an existing client's people, judgments and revenue and adds a client
    const good = [
      HEADER,
      `${HEALTH},"$1","$2","$3",Paula,Kevin,Firm,,4,Daily,Y,High,Energy,changed`,
      'Dry Run Client,,,"$9,000",Joe,Mike,Joe,,2,Quarterly,,Low,Other,',
    ].join('\n');
    const dry = await importCsv(good, { dryRun: true });
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.success, true);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.clients, undefined);
    assert.equal(dry.body.summary.totalClients, 2);
    assert.deepEqual(dry.body.summary.revenueYears, [2024, 2025, 2026]);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await peopleCounts(), countsBefore);

    // A refused file: the same 400 and the same list as the import, nothing written
    const bad = [
      HEADER,
      `${HEALTH},,,"$1",Nobody,,,,5,Weekly,,Low,Healthcare,`,
      `${ENERGY},,,"$1",Paula,Paula,,,3,Hourly,,Medium,Energy,`,
    ].join('\n');
    const dryBad = await importCsv(bad, { dryRun: true });
    assert.equal(dryBad.status, 400);
    assert.deepEqual(dryBad.body.errors.map((e) => e.row), [2, 3, 3]);
    const realBad = await importCsv(bad);
    assert.equal(realBad.status, 400);
    assert.deepEqual(dryBad.body, realBad.body);
    assert.deepEqual(await snapshot(), before);

    // dryRun must be a boolean: a string is refused, not read either way
    const stringFlag = await importCsv(good, { dryRun: 'true' });
    assert.equal(stringFlag.status, 400);
    assert.match(JSON.stringify(stringFlag.body), /dryRun must be true or false/);
    assert.deepEqual(await snapshot(), before);

    // The import of the same file, against the same book, reports what the check reported
    const real = await importCsv(good, { dryRun: false });
    assert.equal(real.status, 200, JSON.stringify(real.body));
    assert.equal(real.body.dryRun, undefined);
    assert.deepEqual(real.body.summary, dry.body.summary);
    // validation.validClients carries ids processCSVData generates per request
    const stable = ({ isValid, issues, warnings, clientCount }) => ({ isValid, issues, warnings, clientCount });
    assert.deepEqual(stable(real.body.validation), stable(dry.body.validation));
    assert.equal((await clientRow('Dry Run Client')).lead, 'Joe');
    assert.equal((await clientRow(HEALTH)).lead, 'Paula');
  });

  test('Phase 3: reset-book empties the book while partners stay signed in, and the template imports into it', async () => {
    // The old book: every client the tests above imported, plus three with a
    // revenue year the new sheet does not have
    const old = await importCsv([
      'CLIENT,2023 Contracts,2024 Contracts,Lead,Second Chair',
      'Old Book One,"$10,000","$11,000",Mike,Jay',
      'Old Book Two,"$20,000",,Jeff,',
      'Old Book Three,,"$30,000",Brendan,Paula',
    ].join('\n'));
    assert.equal(old.status, 200, JSON.stringify(old.body));

    const { rows: [book] } = await db.query(`
      SELECT (SELECT count(*) FROM clients)::int AS clients,
             (SELECT count(*) FROM client_revenues)::int AS revenues,
             (SELECT count(*) FROM users)::int AS users,
             (SELECT count(*) FROM people)::int AS people`);
    assert.ok(book.clients >= 7 && book.revenues > 0, JSON.stringify(book));
    const peopleBefore = (await db.query('SELECT * FROM people ORDER BY id')).rows;
    const usersBefore = (await db.query('SELECT * FROM users ORDER BY id')).rows;
    assert.ok(Object.values(await peopleCounts()).some((c) => c.some((n) => n > 0)));

    // Runbook step 4: read the counts, then confirm
    let result = await runResetBook();
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`^Clients: ${book.clients}$`, 'm'));
    assert.match(result.stdout, new RegExp(`^Revenue rows: ${book.revenues}$`, 'm'));
    assert.match(result.stdout, /^Nothing was deleted\. Run again with --confirm to delete every client\.$/m);

    result = await runResetBook('--confirm');
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(
      `^Removed ${book.clients} clients and ${book.revenues} revenue rows\\. Accounts: ${book.users} and people: ${book.people}, unchanged\\.$`, 'm'));
    assert.deepEqual((await db.query('SELECT * FROM people ORDER BY id')).rows, peopleBefore);
    assert.deepEqual((await db.query('SELECT * FROM users ORDER BY id')).rows, usersBefore);

    // Same session: the book is empty, every People count is 0, and the P5 blocks lift
    const clients = await call('GET', '/api/data/clients');
    assert.equal(clients.status, 200);
    assert.deepEqual(clients.body.clients, []);
    const counts = await peopleCounts();
    assert.equal(Object.keys(counts).length, book.people);
    assert.ok(Object.values(counts).every((c) => c.every((n) => n === 0)), JSON.stringify(counts));
    const brendan = (await db.query("SELECT id FROM people WHERE name = 'Brendan'")).rows[0];
    let change = await call('PUT', `/api/people/${brendan.id}`, { active: false });
    assert.equal(change.status, 200, JSON.stringify(change.body));
    change = await call('PUT', `/api/people/${brendan.id}`, { active: true });
    assert.equal(change.status, 200, JSON.stringify(change.body));

    // Runbook steps 2 and 5 on the empty book: check the sheet, then import it
    const check = await importCsv(template, { dryRun: true });
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM clients')).rows[0].n, 0);

    const imported = await importCsv(template);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.deepEqual(imported.body.summary.revenueTotals, check.body.summary.revenueTotals);
    assert.equal(imported.body.summary.newClients, 2);
    assert.equal(imported.body.summary.updatedClients, 0);

    const { body: list } = await call('GET', '/api/data/clients');
    assert.deepEqual(list.clients.map((c) => [c.name, c.lead?.name, c.secondChair?.name ?? null]).sort(), [
      [ENERGY, 'Paula', null],
      [HEALTH, 'Kevin', 'Jay'],
    ]);
    assert.deepEqual(await revenue(HEALTH), { 2024: 60000, 2025: 66000, 2026: 72000 });
    assert.deepEqual(await revenue(ENERGY), { 2025: 40000, 2026: 85000 });
    const { rows: [{ years }] } = await db.query('SELECT array_agg(DISTINCT year ORDER BY year) AS years FROM client_revenues');
    assert.deepEqual(years, [2024, 2025, 2026], 'no 2023 row survived the reset');

    const after = await peopleCounts();
    assert.deepEqual(after.Kevin, [1, 0, 0]);
    assert.deepEqual(after.Paula, [1, 0, 1]);
    assert.deepEqual(after.Jay, [0, 1, 1]);
    assert.deepEqual(after.Brendan, [0, 0, 0]);
  });

  // Tier 1 WP2 (docs/plans/tier-1.md, section 7): the book as the AI sees it,
  // built by utils/book.cjs from listWithMetrics on this table shape, right
  // after the section 3 template was imported into the empty book above
  test('WP2: GET /api/ai/book lists every imported client once and each person\'s lead count as the People list counts it; 401 without sign-in', async () => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.ok(health.features.includes('ai-book'));
    const anonymous = await fetch(`${base}/api/ai/book`);
    assert.equal(anonymous.status, 401);

    const { status, body } = await call('GET', '/api/ai/book');
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(Object.keys(body).sort(), ['chars', 'clientCount', 'estimatedTokens', 'peopleCount', 'reportingYear', 'success', 'text']);
    assert.equal(body.success, true);
    assert.equal(body.reportingYear, 2026);
    assert.equal(body.chars, body.text.length);
    assert.equal(body.estimatedTokens, Math.round(body.text.length / 4));

    // Every client once, in the book's client table
    const { body: list } = await call('GET', '/api/data/clients');
    assert.equal(body.clientCount, list.clients.length);
    const tableRows = (from, to) => {
      const part = body.text.slice(body.text.indexOf(from), to ? body.text.indexOf(to) : undefined);
      return part.split('\n')
        .filter((line) => line.startsWith('| ') && !line.startsWith('| ---') && !/^\| (Name|Client|Year) \|/.test(line))
        .map((line) => line.slice(2, -2).split(' | '));
    };
    const clients = tableRows('## Clients');
    assert.deepEqual(clients.map((c) => c[0]).sort(), list.clients.map((c) => c.name).sort());
    assert.deepEqual(clients.map((c) => c.slice(0, 3)).sort(), [[ENERGY, 'Paula', 'none'], [HEALTH, 'Kevin', 'Jay']]);

    // Each person the book lists: lead and second-chair counts as the People list's
    const counts = await peopleCounts();
    const people = tableRows('## People', '## Totals');
    const listed = Object.entries(counts).filter(([, [leads, seconds]]) => leads > 0 || seconds > 0).map(([name]) => name);
    for (const name of listed) assert.ok(people.some((p) => p[0].replace(/ \(inactive\)$/, '') === name), `${name} is listed`);
    for (const [name, leads, , , , seconds] of people) {
      const [leadCount, secondCount] = counts[name.replace(/ \(inactive\)$/, '')];
      assert.equal(leads === 'n/a' ? 0 : Number(leads.split(' ')[0]), leadCount, `${name}'s lead count`);
      assert.equal(Number(seconds.split(' ')[0]), secondCount, `${name}'s second-chair count`);
    }
    assert.equal(body.peopleCount, people.length);

    // The Energy Coalition's note stays out; no uuid is in the text (an
    // integer id is a number like any other, so only the uuids are checked)
    assert.ok(!body.text.includes('Renewal talks in spring'));
    if (shape.idType === 'uuid') for (const c of list.clients) assert.ok(!body.text.includes(String(c.id)), `no id: ${c.id}`);
  });

  // Contract status is retired (docs/plans/people-and-second-chair.md, P13):
  // Contract Period is not read, clients.status is neither read nor written,
  // and no client the API returns carries it.
  const P13_NAMES = ['P13 Alpha', 'P13 Beta', 'P13 Gamma'];
  const yearsOnly = [
    'CLIENT,2025 Contracts,2026 Contracts',
    'P13 Alpha,"$10,000","$12,000"',
    'P13 Beta,,"$5,000"',
    'P13 Gamma,"$7,500",$1',
  ].join('\n');
  // The same file with a Contract Period column: a period, DONE and a blank
  const withPeriod = [
    'CLIENT,Contract Period,2025 Contracts,2026 Contracts',
    'P13 Alpha,1/1/26-12/31/26,"$10,000","$12,000"',
    'P13 Beta,DONE,,"$5,000"',
    'P13 Gamma,,"$7,500",$1',
  ].join('\n');

  // The three clients' rows without ids and timestamps, and their revenue by year
  const p13Rows = async () => ({
    clients: (await db.query(`
      SELECT to_jsonb(c) - 'id' - 'created_at' - 'updated_at' AS row
        FROM clients c WHERE name = ANY($1) ORDER BY name`, [P13_NAMES])).rows,
    revenues: Object.fromEntries(await Promise.all(P13_NAMES.map(async (name) => [name, await revenue(name)]))),
  });
  const deleteP13 = () => db.query('DELETE FROM clients WHERE name = ANY($1)', [P13_NAMES]);
  const noStatusKeys = (clients) => clients.flatMap((c) => Object.keys(c).filter((key) => /status|contract/i.test(key)));

  test('P13 (a) and (b): a file with CLIENT and the years only, and the same file with Contract Period, write identical rows', async () => {
    await deleteP13();
    const a = await importCsv(yearsOnly);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(a.body.validation.issues, []);
    assert.deepEqual(a.body.validation.warnings, []);
    assert.equal(a.body.summary.newClients, 3);
    assert.deepEqual(a.body.summary.revenueTotals, { 2025: 17500, 2026: 17001 });
    assert.deepEqual(noStatusKeys(a.body.clients), []);
    const fromYearsOnly = await p13Rows();
    assert.deepEqual(fromYearsOnly.revenues, {
      'P13 Alpha': { 2025: 10000, 2026: 12000 },
      'P13 Beta': { 2026: 5000 },
      'P13 Gamma': { 2025: 7500, 2026: 1 },
    });

    // Check file on the Contract Period file answers the same way and writes nothing
    const before = await snapshot();
    const check = await importCsv(withPeriod, { dryRun: true });
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.equal(check.body.dryRun, true);
    assert.deepEqual(check.body.validation.issues, []);
    assert.deepEqual(check.body.validation.warnings, []);
    assert.deepEqual(await snapshot(), before);

    // Inserted from the Contract Period file: the same rows as from the years-only file
    await deleteP13();
    const b = await importCsv(withPeriod);
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(b.body.validation.issues, []);
    assert.deepEqual(b.body.validation.warnings, []);
    assert.deepEqual(b.body.summary, a.body.summary);
    assert.deepEqual(noStatusKeys(b.body.clients), []);
    assert.deepEqual(await p13Rows(), fromYearsOnly);

    // Updated from it: still the same rows, and the stored status is not written
    await db.query("UPDATE clients SET status = 'P13-SENTINEL' WHERE name = ANY($1)", [P13_NAMES]);
    const sentinel = await p13Rows();
    const again = await importCsv(withPeriod);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.summary.updatedClients, 3);
    assert.deepEqual(await p13Rows(), sentinel);
    assert.ok(sentinel.clients.every(({ row }) => row.status === 'P13-SENTINEL'));
  });

  test('P13 (c): PUT with a stray status succeeds and does not write the column', async () => {
    const { rows: [row] } = await db.query('SELECT id, lead_id, second_chair_id FROM clients WHERE name = $1', [HEALTH]);
    await db.query("UPDATE clients SET status = 'P13-SENTINEL' WHERE id = $1", [row.id]);

    const { status, body } = await call('PUT', `/api/data/clients/${row.id}`, {
      name: HEALTH,
      status: 'IF',
      practice_area: ['Healthcare'],
      conflict_risk: 'Low',
      notes: 'edited with a stale page',
      interaction_frequency: 'Weekly',
      stickiness: 5,
      high_maintenance: false,
      lead_id: row.lead_id,
      second_chair_id: row.second_chair_id,
      originator_id: null,
      originator_is_firm: true,
      revenues: [{ year: 2026, revenue_amount: 72000 }],
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal('status' in body.client, false);
    assert.equal(body.client.notes, 'edited with a stale page');

    const stored = await clientRow(HEALTH);
    assert.equal(stored.status, 'P13-SENTINEL');
    assert.equal(stored.notes, 'edited with a stale page');
  });

  test('P13 (d): POST with a stray status succeeds, and neither the response nor the list carries a status', async () => {
    const paula = (await db.query("SELECT id FROM people WHERE name = 'Paula'")).rows[0];
    const { status, body } = await call('POST', '/api/data/clients', {
      name: 'P13 Posted',
      status: 'Former',
      practice_area: ['Other'],
      conflict_risk: 'Medium',
      notes: '',
      interaction_frequency: 'Monthly',
      stickiness: 3,
      high_maintenance: false,
      lead_id: paula.id,
      second_chair_id: null,
      originator_id: null,
      originator_is_firm: false,
      revenues: [{ year: 2026, revenue_amount: 1000 }],
    });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.client.name, 'P13 Posted');
    assert.equal('status' in body.client, false);
    // Not written: the column keeps its init-db.sql default
    assert.equal((await clientRow('P13 Posted')).status, 'Prospect');

    const { body: list } = await call('GET', '/api/data/clients');
    assert.ok(list.clients.length >= 6);
    assert.deepEqual(noStatusKeys(list.clients), []);
  });

  // Phase 5 (docs/plans/people-and-second-chair.md, section 8): Stage 2's AI
  // plans send the roster of people staying, checked against the People list
  // before anything reaches the model; the accepted plan is applied with an
  // import sheet of CLIENT, Lead and Second Chair, through Check file and Upload.
  test('Phase 5: the transition plan takes this run\'s client ids and checks every roster name against the People list', async () => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.ok(health.features.includes('transition-plan-roster'));

    const { body: list } = await call('GET', '/api/data/clients');
    const client = list.clients.find((c) => c.name === HEALTH);
    assert.equal(typeof client.id, shape.idType === 'integer' ? 'number' : 'string');
    const { body: everyone } = await call('GET', '/api/people');
    const zero = { count: 0, revenue: 0, effort: 0 };
    const entry = (name) => ({ name, role: 'partner', lead: zero, second: zero });
    const staying = everyone.people.filter((p) => p.active && p.name !== 'Kevin').map((p) => entry(p.name));
    assert.ok(staying.some((p) => p.name === "Mary O'Brien"), 'an apostrophe goes through the request sanitizer');
    const stage1Data = { departing: [{ name: 'Kevin', role: 'partner' }], impactData: { totalRevenueAtRisk: 1 } };
    const plan = (roster) => call('POST', '/api/scenarios/transition-plan', { client, stage1Data, roster });

    // Every check passes; without a key the model is never called
    let res = await plan(staying);
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.error, 'AI is not configured on the server (missing API key).');

    res = await plan([...staying, entry('Nobody')]);
    assert.deepEqual([res.status, res.body.error], [400, 'Not on the People list: Nobody.']);
    res = await plan([...staying, entry('Kevin')]);
    assert.deepEqual([res.status, res.body.error], [400, 'Leaving, so not on the roster: Kevin.']);
    res = await plan(undefined);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^roster must list/);
  });

  // Tier 1 WP1: the AI Advisor's three routes read the book through
  // models/clientModel.cjs (listWithMetrics, getWithMetrics) before calling
  // the model, so on this table shape each gets as far as the missing key.
  // Production's older client_revenues has no contract_end_date column, and a
  // query that read it answered 500 here before any AI call.
  test("the AI Advisor's routes read the book on this table shape and stop at the missing key (503)", async () => {
    const { body: list } = await call('GET', '/api/data/clients');
    const client = list.clients.find((c) => c.name === HEALTH);
    const notConfigured = 'AI is not configured on the server (missing API key).';
    for (const [path, body] of [
      ['/api/claude/analyze-portfolio', {}],
      ['/api/claude/strategic-advice', { query: 'Who carries the most?' }],
      ['/api/claude/client-recommendations', { clientId: client.id, includePortfolio: true }],
    ]) {
      const res = await call('POST', path, body);
      assert.deepEqual([res.status, res.body.error], [503, notConfigured], `${path}: ${JSON.stringify(res.body)}`);
    }
  });

  test('Phase 5: a transition sheet (CLIENT, Lead, Second Chair) changes the two seats and nothing else; the partner who left can then be deactivated', async () => {
    const kevin = (await db.query("SELECT id FROM people WHERE name = 'Kevin'")).rows[0];
    const { rows: touched } = await db.query(`
      SELECT c.name, lp.name AS lead, sp.name AS second_chair
        FROM clients c
        LEFT JOIN people lp ON lp.id = c.lead_id
        LEFT JOIN people sp ON sp.id = c.second_chair_id
       WHERE c.lead_id = $1 OR c.second_chair_id = $1
       ORDER BY c.name`, [kevin.id]);
    assert.ok(touched.length > 0);
    const blocked = await call('PUT', `/api/people/${kevin.id}`, { active: false });
    assert.equal(blocked.status, 409, 'P5: Kevin still holds a seat');

    // The sheet the Scenarios export writes: Joe leads Kevin's clients; a seat
    // Kevin held, or one Joe would hold twice, goes to Mary O'Brien
    const quote = (text) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const planned = touched.map((c) => {
      const lead = c.lead === 'Kevin' ? 'Joe' : c.lead;
      const second = c.second_chair === 'Kevin' || c.second_chair === lead ? "Mary O'Brien" : (c.second_chair || '');
      return { name: c.name, lead, second };
    });
    const sheet = ['CLIENT,Lead,Second Chair', ...planned.map((c) => [c.name, c.lead, c.second].map(quote).join(','))].join('\n');

    // Everything but the two seats and the legacy text they write
    const rest = async () => ({
      clients: (await db.query(`
        SELECT to_jsonb(c) - 'lead_id' - 'second_chair_id' - 'primary_lobbyist' - 'lobbyist_team' - 'updated_at' AS row
          FROM clients c ORDER BY name`)).rows,
      revenues: (await db.query('SELECT to_jsonb(r) AS row FROM client_revenues r ORDER BY client_id::text, year')).rows,
      people: (await db.query('SELECT * FROM people ORDER BY id')).rows,
    });
    const before = await rest();
    const everything = await snapshot();

    const check = await importCsv(sheet, { dryRun: true });
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.deepEqual(check.body.summary.sheetColumns, ['Lead', 'Second Chair']);
    assert.deepEqual(await snapshot(), everything, 'Check file writes nothing');

    const upload = await importCsv(sheet);
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    assert.deepEqual(await rest(), before, 'nothing but the seats changed');
    for (const c of planned) {
      const row = await clientRow(c.name);
      assert.equal(row.lead, c.lead, c.name);
      assert.equal(row.second_chair, c.second || null, c.name);
      assert.deepEqual(row.lobbyist_team, [row.lead, row.second_chair].filter(Boolean), 'the legacy text follows');
    }

    // Kevin holds no seat now, so P5 lets him go
    const counts = await peopleCounts();
    assert.deepEqual(counts.Kevin.slice(0, 2), [0, 0]);
    const done = await call('PUT', `/api/people/${kevin.id}`, { active: false });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.person.active, false);
  });

  // Phase 6 (docs/plans/people-and-second-chair.md, section 9, P9): the
  // associate split writes one client's second chair and nothing else
  test('Phase 6: PUT /api/data/clients/:id/second-chair sets one seat, checks P3 and the seat the page saw, and nothing else changes', async () => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.ok(health.features.includes('second-chair-assign'));

    const { rows: [target] } = await db.query(`
      SELECT c.id::text AS id, c.name, lp.name AS lead, c.lead_id
        FROM clients c JOIN people lp ON lp.id = c.lead_id
       WHERE c.second_chair_id IS NULL AND lp.active
       ORDER BY c.name LIMIT 1`);
    assert.ok(target, 'a client with a lead and no second chair');
    const mary = (await db.query("SELECT id FROM people WHERE name = 'Mary O''Brien'")).rows[0].id;
    const kevin = (await db.query("SELECT id FROM people WHERE name = 'Kevin'")).rows[0].id;
    const assign = (id, body) => call('PUT', `/api/data/clients/${id}/second-chair`, body);

    // Everything but the seat, its legacy text and the timestamp
    const rest = async () => ({
      clients: (await db.query(`
        SELECT to_jsonb(c) - 'second_chair_id' - 'lobbyist_team' - 'updated_at' AS row FROM clients c ORDER BY name`)).rows,
      others: (await db.query('SELECT to_jsonb(c) AS row FROM clients c WHERE c.id::text <> $1 ORDER BY name', [target.id])).rows,
      revenues: (await db.query('SELECT to_jsonb(r) AS row FROM client_revenues r ORDER BY client_id::text, year')).rows,
      people: (await db.query('SELECT * FROM people ORDER BY id')).rows,
    });
    const before = await rest();

    let res = await assign(target.id, { second_chair_id: mary, expected_second_chair_id: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.client.secondChair.name, "Mary O'Brien");
    assert.equal(String(res.body.client.id), target.id);
    let row = await clientRow(target.name);
    assert.equal(row.second_chair, "Mary O'Brien");
    assert.deepEqual(row.lobbyist_team, [target.lead, "Mary O'Brien"], 'the legacy text follows the seat');
    assert.deepEqual(await rest(), before, 'nothing but the seat changed');

    // The seat changed since the page loaded: refused, nothing written
    res = await assign(target.id, { second_chair_id: mary, expected_second_chair_id: null });
    assert.deepEqual([res.status, res.body.error], [409, "This client's second chair changed since the page loaded. Reload the page and try again."]);

    // P3: never the lead, never someone inactive or unknown
    res = await assign(target.id, { second_chair_id: target.lead_id, expected_second_chair_id: mary });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.details, [{ field: 'second_chair_id', message: 'The second chair cannot be the lead.' }]);
    res = await assign(target.id, { second_chair_id: kevin, expected_second_chair_id: mary });
    assert.deepEqual([res.status, res.body.details[0].message], [400, 'The second chair must be an active person on the People list.']);
    res = await assign(target.id, { second_chair_id: 999999, expected_second_chair_id: mary });
    assert.equal(res.status, 400);
    assert.equal((await clientRow(target.name)).second_chair, "Mary O'Brien", 'refusals write nothing');

    // A malformed request, and clients that do not exist (either id type)
    res = await assign(target.id, { second_chair_id: mary });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /expected_second_chair_id/);
    for (const missing of ['999999', '3f2b8c1e-0000-4000-8000-000000000000', 'not-an-id']) {
      res = await assign(missing, { second_chair_id: mary, expected_second_chair_id: null });
      assert.equal(res.status, 404, missing);
    }

    // Clearing the seat
    res = await assign(target.id, { second_chair_id: null, expected_second_chair_id: mary });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    row = await clientRow(target.name);
    assert.deepEqual([row.second_chair_id, row.lobbyist_team], [null, [target.lead]]);
    assert.deepEqual(await rest(), before);
  });

  // A client saved through the client form is stored HTML-escaped by
  // sanitizeRequestBody (review 4.9), once per save. The import matches stored
  // names unescaped, so it updates that client instead of adding a second one
  // with the plain name, and writes the sheet's spelling back.
  test('a client re-saved through PUT with & and an apostrophe in its name is updated by the next import, not duplicated', async () => {
    // The SQL the import matches with and the JavaScript that keys the rows agree
    const samples = [
      'Barnes &amp; Noble Education Fund', 'O&#x27;Brien Trust', 'O&amp;#x27;Brien Trust', '&amp;amp;amp;',
      '&quot;&lt;&gt;&#x2F;&#x5C;&#96;', '&amp;lt;', 'plain & simple', '',
      ...[0, 1, 2, 3].map((times) => Array.from({ length: times }).reduce((out) => validator.escape(out), `A&B 'C' "D" <E> F/G \\H \`I\``)),
    ];
    for (const text of samples) {
      const { rows: [row] } = await db.query(`SELECT ${escaping.unescapeStoredSql('$1::text')} AS out`, [text]);
      assert.equal(row.out, escaping.unescapeStored(text), JSON.stringify(text));
    }

    const BARNES = 'Barnes & Noble Education Fund';
    const OBRIEN = "O'Brien Trust";
    const sheet = [
      'CLIENT,2026 Contracts,Lead',
      `${BARNES},"$40,000",Paula`,
      `${OBRIEN},"$25,000",Jeff`,
    ].join('\n');
    const bookSize = async () => Number((await db.query('SELECT count(*) FROM clients')).rows[0].count);
    const storedName = async (id) => (await db.query('SELECT name FROM clients WHERE id::text = $1', [id])).rows[0].name;

    let result = await importCsv(sheet);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual([result.body.summary.updatedClients, result.body.summary.newClients], [0, 2]);
    const ids = {};
    for (const name of [BARNES, OBRIEN]) {
      ids[name] = (await db.query('SELECT id::text AS id FROM clients WHERE name = $1', [name])).rows[0].id;
    }

    // Saved as the client form saves: every field as the page holds it
    const save = async (id, name) => {
      const { body: list } = await call('GET', '/api/data/clients');
      const c = list.clients.find((x) => String(x.id) === id);
      const res = await call('PUT', `/api/data/clients/${id}`, {
        name,
        practice_area: c.practiceArea,
        conflict_risk: c.conflict_risk,
        notes: c.notes || '',
        interaction_frequency: c.interaction_frequency || 'As-Needed',
        stickiness: c.stickiness,
        high_maintenance: c.high_maintenance === true,
        lead_id: c.lead_id,
        second_chair_id: c.second_chair_id,
        originator_id: c.originator_id,
        originator_is_firm: c.originator_is_firm === true,
        revenues: c.revenues.map((r) => ({ year: r.year, revenue_amount: Number(r.revenue_amount) })),
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return c.name;
    };
    await save(ids[BARNES], BARNES);
    await save(ids[OBRIEN], OBRIEN);
    // A second save sending the name as it is stored, as a direct request can
    // (the page's name pattern refuses the `;`): escaped again
    assert.equal(await save(ids[OBRIEN], await storedName(ids[OBRIEN])), 'O&#x27;Brien Trust');
    assert.equal(await storedName(ids[BARNES]), 'Barnes &amp; Noble Education Fund');
    assert.equal(await storedName(ids[OBRIEN]), 'O&amp;#x27;Brien Trust');

    // Check file: both matched, nothing written
    const size = await bookSize();
    const before = await snapshot();
    const check = await importCsv(sheet, { dryRun: true });
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.deepEqual([check.body.summary.updatedClients, check.body.summary.newClients], [2, 0]);
    assert.deepEqual(await snapshot(), before);

    // The same sheet again: both updated, none created, the sheet's spelling written back
    result = await importCsv(sheet);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual([result.body.summary.updatedClients, result.body.summary.newClients], [2, 0]);
    assert.equal(await bookSize(), size);
    assert.equal(await storedName(ids[BARNES]), BARNES);
    assert.equal(await storedName(ids[OBRIEN]), OBRIEN);
    assert.deepEqual(await revenue(BARNES), { 2026: 40000 });
    assert.deepEqual(await revenue(OBRIEN), { 2026: 25000 });
    assert.equal((await clientRow(BARNES)).id.toString(), ids[BARNES]);
    assert.equal((await clientRow(OBRIEN)).id.toString(), ids[OBRIEN]);

    // Two stored clients with one name (a duplicate the old matching made):
    // refused, nothing written, until a partner deletes one
    const paula = (await db.query("SELECT id FROM people WHERE name = 'Paula'")).rows[0].id;
    const posted = await call('POST', '/api/data/clients', {
      name: BARNES,
      practice_area: ['Education'],
      conflict_risk: 'Medium',
      notes: '',
      interaction_frequency: 'Monthly',
      stickiness: 3,
      high_maintenance: false,
      lead_id: paula,
      second_chair_id: null,
      originator_id: null,
      originator_is_firm: false,
      revenues: [{ year: 2026, revenue_amount: 40000 }],
    });
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    assert.equal(posted.body.client.name, 'Barnes &amp; Noble Education Fund');
    const withDuplicate = await snapshot();
    const refused = await importCsv(sheet);
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.deepEqual(refused.body.errors, [{
      row: 2,
      client: BARNES,
      message: `The book has 2 clients named "${BARNES}", so the import cannot tell which one to update. On Client Details, delete the one you do not want, then upload the file again.`,
    }]);
    assert.deepEqual(await snapshot(), withDuplicate);

    const deleted = await fetch(`${base}/api/data/clients/${posted.body.client.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(deleted.status, 204);
    result = await importCsv(sheet);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual([result.body.summary.updatedClients, result.body.summary.newClients], [2, 0]);
    assert.equal(await bookSize(), size);
  });

  // The page's side of the same escaping: the client form fills its fields
  // unescaped (src/utils/clientForm.js), so saving a client again stores the
  // same text; and Scenarios' transition sheet writes client names unescaped
  // (src/utils/transitionPlans.js), so Check file and the import read them.
  test('the form saves an escaped name again unchanged, and a transition sheet for it passes Check file and imports', async () => {
    const BARNES = 'Barnes & Noble Education Fund';
    const listed = async () => (await call('GET', '/api/data/clients')).body.clients;
    const barnesId = String((await listed()).find((c) => escaping.unescapeStored(c.name) === BARNES).id);
    const stored = async () => (await db.query('SELECT name, notes FROM clients WHERE id::text = $1', [barnesId])).rows[0];

    // As ClientEnhancementForm's save and the store's formatClientForAPI send it
    const formSave = async (form) => {
      const sent = sanitizeFormData(form);
      const res = await call('PUT', `/api/data/clients/${barnesId}`, {
        name: sent.name,
        practice_area: sent.practiceArea,
        conflict_risk: sent.conflict_risk,
        notes: sent.notes,
        lead_id: toPersonId(form.lead_id),
        second_chair_id: toPersonId(form.second_chair_id),
        originator_id: toPersonId(form.originator_id),
        originator_is_firm: form.originator_is_firm === true,
        interaction_frequency: sent.interaction_frequency,
        stickiness: sent.stickiness,
        high_maintenance: sent.high_maintenance === true,
        revenues: sent.revenues
          .filter((r) => r.year && r.revenue_amount)
          .map((r) => ({ year: parseInt(r.year, 10), revenue_amount: parseFloat(r.revenue_amount) })),
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    const openForm = async () => clientFormData((await listed()).find((c) => String(c.id) === barnesId));

    // A partner types notes with an ampersand and a `<` (which DOMPurify escapes before the server does) and saves
    const typedNotes = 'R&D < 5% of "budget"';
    await formSave({ ...(await openForm()), practiceArea: ['Education'], notes: typedNotes });
    const first = await stored();
    assert.equal(first.name, 'Barnes &amp; Noble Education Fund');
    // Saved twice more with only the stickiness changed: shown as typed, stored unchanged
    for (const stickiness of [2, 4]) {
      const form = await openForm();
      assert.deepEqual([form.name, form.notes], [BARNES, typedNotes]);
      await formSave({ ...form, stickiness });
      assert.deepEqual(await stored(), first);
    }

    // Paula, who leads it, leaves; the plan for it is approved and exported as the page exports it
    const { body: { people } } = await call('GET', '/api/people');
    const paula = people.find((p) => p.name === 'Paula');
    const clients = await listed();
    const model = departureModel({ people, clients, departingIds: [paula.id], revenueOf: (c) => revenueForYear(c, 2026), choices: {} });
    const decision = model.decisions.find((d) => String(d.client.id) === barnesId);
    assert.ok(decision?.lead.after, 'a partner who is staying can lead it');
    const sheet = buildTransitionSheet(model.decisions, { [barnesId]: { status: 'approved' } });
    assert.equal(sheet.rows.length, 1);
    assert.ok(sheet.csv.includes(`\r\n${BARNES},${decision.lead.after.name},`), sheet.csv);

    const size = (await listed()).length;
    const before = await snapshot();
    const check = await importCsv(sheet.csv, { dryRun: true });
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.deepEqual([check.body.summary.updatedClients, check.body.summary.newClients], [1, 0]);
    assert.deepEqual(await snapshot(), before);

    const result = await importCsv(sheet.csv);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual([result.body.summary.updatedClients, result.body.summary.newClients], [1, 0]);
    assert.equal((await listed()).length, size);
    const row = await clientRow(BARNES);
    assert.equal(String(row.id), barnesId);
    assert.equal(row.lead, decision.lead.after.name);
    assert.equal(row.second_chair, decision.secondChair.after ? decision.secondChair.after.name : null);
    assert.equal(row.notes, first.notes, 'the sheet has no Notes column: kept');
  });
});
