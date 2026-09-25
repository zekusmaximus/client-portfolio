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
// parses each file with PapaParse as the upload page does.
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

const repo = fileURLToPath(new URL('..', import.meta.url));
const template = readFileSync(new URL('../public/client-book-template.csv', import.meta.url), 'utf8');
const serverUrl = process.env.SCHEMA_TEST_SERVER_URL;
const execFileAsync = promisify(execFile);

const HEADER = 'CLIENT,Contract Period,2024 Contracts,2025 Contracts,2026 Contracts,Lead,Second Chair,Originator,Credit To Firm,Stickiness,Cadence,Handful,Conflict Risk,Practice Area,Notes';
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

describe('the import on PostgreSQL', { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  const dbName = `import_test_${randomBytes(6).toString('hex')}`;
  let admin;
  let db;
  let server;
  let base;
  let cookie;

  before(async () => {
    admin = new pg.Client({ connectionString: urlFor('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const env = {
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

  // As the upload page does: PapaParse in header mode, then the rows as JSON
  const importCsv = (text) => call('POST', '/api/data/process-csv', {
    csvData: Papa.parse(text, { header: true, skipEmptyLines: true }).data,
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
    revenues: (await db.query('SELECT client_id, year, revenue_amount, updated_at FROM client_revenues ORDER BY client_id, year')).rows,
    people: (await db.query('SELECT * FROM people ORDER BY id')).rows,
  });

  test('the section 3 example imports leads, second chairs, originators and judgments', async () => {
    const { status, body } = await importCsv(template);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.summary.newClients, 2);
    assert.deepEqual(body.summary.revenueYears, [2024, 2025, 2026]);
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
    assert.equal(health.status, 'IF');
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
      `${HEALTH},1/1/26-12/31/26,,,"$99,000",Jhon,,,,5,Weekly,,Low,Healthcare,`,
      `${ENERGY},7/1/25-6/30/27,,,"$1",Paula,,,,9,Monthly,,Medium,Energy,`,
      'Brand New Client,1/1/26-12/31/26,,,"$5,000",Kevin,,,,3,Monthly,,Low,Other,',
      `${HEALTH.toUpperCase()},1/1/26-12/31/26,,,"$1",Kevin,,,,5,Weekly,,Low,Healthcare,`,
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
    const { status, body } = await importCsv(`CLIENT,Contract Period,Second Chair\n${HEALTH},1/1/26-12/31/26,Anna\n`);
    assert.equal(status, 400);
    assert.deepEqual(body.errors.map((e) => e.row), [1]);
    assert.match(body.errors[0].message, /no Lead column/);
    assert.deepEqual(await snapshot(), before);
  });

  test('a file without the people and judgment columns leaves them untouched', async () => {
    const health = await clientRow(HEALTH);
    const { status, body } = await importCsv([
      'CLIENT,Contract Period,2026 Contracts',
      `${HEALTH},1/1/26-12/31/26,"$75,000"`,
      'Plain Client,1/1/26-12/31/26,"$10,000"',
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
      `${ENERGY},7/1/25-6/30/27,,"$40,000","$85,000",Paula,,,,,,,,,`,
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
      'client,contract period,2026 contracts, LEAD ,second  chair,ORIGINATOR,credit to firm',
      `${HEALTH},1/1/26-12/31/26,"$75,000",kevin,mary o'brien,Firm,`,
    ].join('\n'));
    assert.equal(status, 400, 'a lower-case CLIENT header is refused, as before this change');
    assert.match(JSON.stringify(body), /CLIENT is required/);

    const ok = await importCsv([
      'CLIENT,Contract Period,2026 Contracts, LEAD ,second  chair,ORIGINATOR,credit to firm',
      `${HEALTH},1/1/26-12/31/26,"$75,000",kevin,mary o'brien,Firm,`,
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
    let result = await importCsv(`CLIENT,Contract Period,Lead,Second Chair\n${ENERGY},7/1/25-6/30/27,Paula,Brendan\n`);
    assert.equal(result.status, 200, JSON.stringify(result.body));

    const before = await snapshot();
    result = await importCsv(`CLIENT,Contract Period,Lead\n${ENERGY},7/1/25-6/30/27,Brendan\n`);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body.errors, [{
      row: 2,
      client: ENERGY,
      message: 'Second Chair (Brendan, kept: the file has no Second Chair column): The second chair cannot be the lead.',
    }]);
    assert.deepEqual(await snapshot(), before);

    // A lead-only file keeps the stored second chair and rewrites the legacy text from both
    result = await importCsv(`CLIENT,Contract Period,Lead\n${ENERGY},7/1/25-6/30/27,Kevin\n`);
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
});
