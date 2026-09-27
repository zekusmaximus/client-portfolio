// server.cjs on a throwaway PostgreSQL database, for the suites that test it
// over HTTP: tests/import-db.test.mjs and tests/routes.test.mjs (docs/plans/
// tier-2.md, WP1). Moved here from import-db so both start servers, build the
// production shape and sign in the same way.
//
// Never imports server.cjs, db.cjs, data.cjs, models/* or utils/jwt.cjs: they
// throw at load time without their environment. Each server runs as a child
// process with the environment the suite gives it.
//
// SCHEMA_TEST_SERVER_URL is the superuser URL of a THROWAWAY PostgreSQL server,
// without a database name; the suites skip their database tests without it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const serverUrl = process.env.SCHEMA_TEST_SERVER_URL;
const execFileAsync = promisify(execFile);

// A throwaway account's password, generated for each run and never written in
// the repository: random hex plus one character of each class the password
// policy requires (upper case, lower case, digit, symbol).
export const generatedPassword = () => randomBytes(12).toString('hex') + ['A', 'a', '1', '!'].join('');

// SCHEMA_TEST_SERVER_URL with `database` as its database
export function urlFor(database) {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Starts server.cjs with `env`. `ready` resolves when the server has applied
// init-db.sql and is listening; with { database: false }, when it is listening
// after its database check failed (development mode carries on without one).
// `output` is everything it has written so far, for its structured log lines.
export function startServer(env, { database = true } = {}) {
  const child = spawn(process.execPath, ['server.cjs'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    const onData = (chunk) => {
      output += chunk;
      const listening = output.includes('Server running on port');
      const failed = output.includes('Database initialization failed');
      if (database && listening && output.includes('Database tables initialized')) {
        clearTimeout(timer);
        resolve();
      }
      if (database && failed) {
        clearTimeout(timer);
        reject(new Error(`init-db.sql failed:\n${output}`));
      }
      if (!database && listening && failed) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });
  return { child, ready, get output() { return output; } };
}

// Polls `check` until it returns something truthy, or fails after `ms`
export async function waitFor(check, what, ms = 10000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Production's users, clients and client_revenues as they predate init-db.sql:
// integer ids, and the client_revenues the original code wrote with plain
// INSERTs (no UNIQUE (client_id, year), no timestamps). init-db.sql then adds
// its columns and tables on top, as it does at every start on Render.
export const PRODUCTION_TABLES_SQL = `
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

// The two table shapes every HTTP suite runs on: init-db.sql's (uuid ids) and
// production's older tables (integer ids), created before init-db.sql runs,
// as they were on Render
export const SHAPES = [
  { name: 'init-db.sql tables', tables: null, idType: 'uuid' },
  { name: "production's older tables", tables: PRODUCTION_TABLES_SQL, idType: 'integer' },
];

// Adds an account with create-admin.cjs, as a partner is added on Render
export async function addAccount(env, account) {
  await execFileAsync(process.execPath, ['create-admin.cjs', account.username, account.password], { cwd: repo, env });
}

// The Cookie header that carries a response's cookies
export const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

// Signs in at `base` and returns the session's Cookie header
export async function signIn(base, account) {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  assert.equal(login.status, 200, `sign-in as ${account.username}`);
  return cookieOf(login);
}
