// What a failed request logs (docs/plans/tier-3.md, WP2, candidate (c)):
// utils/errorLog.cjs, which every route's failure goes through. A failed
// query was logged whole (console.error(label, error)), PostgreSQL's `detail`
// included, which for a refused row prints the row, a client's note with it.
// First the helper, on errors shaped as pg's; then a scan of the server's
// files: no console call there logs anything but text, and each site
// section 4.1 of the plan lists logs through the helper.
// Pure: never import db.cjs, data.cjs, models/*, a route file or utils/jwt.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import errorLog from '../utils/errorLog.cjs';

const { LOGGED_FIELDS, errorFields, logError } = errorLog;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A refused row as pg's parser builds the error (pg-protocol's DatabaseError,
// every field PostgreSQL's ErrorResponse can carry)
function refusedRow(note) {
  const error = new pg.DatabaseError('new row for relation "clients" violates check constraint "clients_refuse"', 200, 'error');
  Object.assign(error, {
    severity: 'ERROR',
    code: '23514',
    detail: `Failing row contains (42, Acme, {Healthcare}, Low, ${note}, Kevin, ...).`,
    hint: 'A hint that quotes the statement',
    position: '17',
    internalPosition: '3',
    internalQuery: `SELECT '${note}'`,
    where: `SQL statement "UPDATE clients SET notes = '${note}'"`,
    schema: 'public',
    table: 'clients',
    column: 'notes',
    dataType: 'text',
    constraint: 'clients_refuse',
    file: 'execMain.c',
    line: '2012',
    routine: 'ExecConstraints',
  });
  return error;
}

test('errorFields: code, message, constraint, table and column, and nothing else of a refused row', () => {
  assert.deepEqual(LOGGED_FIELDS, ['code', 'message', 'constraint', 'table', 'column']);
  const note = `Private note ${Date.now()}`;
  assert.deepEqual(errorFields(refusedRow(note)), {
    code: '23514',
    message: 'new row for relation "clients" violates check constraint "clients_refuse"',
    constraint: 'clients_refuse',
    table: 'clients',
    column: 'notes',
  });
});

test('errorFields: each field only where it is set, as text or a number; never a stack, an object or a function', () => {
  // A failure in our own code: its message alone, no stack
  const bug = new TypeError("Cannot read properties of undefined (reading 'name')");
  assert.deepEqual(errorFields(bug), { message: "Cannot read properties of undefined (reading 'name')" });
  // Node's own errors carry a code
  assert.deepEqual(errorFields(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED', errno: -111, address: '127.0.0.1' })),
    { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' });
  // A field that is not text or a number is left out, whatever it holds
  assert.deepEqual(errorFields({ code: { row: 'secret' }, message: () => 'secret', table: ['secret'], column: Number.NaN }), {});
  // A thrown value that is not an object logs as its text
  assert.deepEqual(errorFields('boom'), { message: 'boom' });
  assert.deepEqual(errorFields(undefined), { message: 'undefined' });
  assert.deepEqual(errorFields(null), { message: 'null' });
});

test('logError: one line, the label then the fields as JSON; the row, the statement and the stack never reach it', () => {
  const lines = [];
  const log = (...args) => lines.push(args.join(' '));
  const note = `Private note ${Date.now()}`;
  logError('Error updating client', refusedRow(note), log);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'Error updating client: {"code":"23514","message":"new row for relation \\"clients\\" violates check constraint \\"clients_refuse\\"","constraint":"clients_refuse","table":"clients","column":"notes"}');
  const [label, json] = [lines[0].slice(0, lines[0].indexOf(': ')), lines[0].slice(lines[0].indexOf(': ') + 2)];
  assert.equal(label, 'Error updating client');
  assert.deepEqual(JSON.parse(json), errorFields(refusedRow(note)));
  for (const leak of [note, 'Failing row', 'SQL statement', 'execMain', 'ExecConstraints', 'at ']) {
    assert.ok(!lines[0].includes(leak), leak);
  }
  // console.error by default, with the same two arguments
  const original = console.error;
  const seen = [];
  console.error = (...args) => seen.push(args);
  try {
    logError('Error deleting client', new Error('gone'));
  } finally {
    console.error = original;
  }
  assert.deepEqual(seen, [['Error deleting client:', '{"message":"gone"}']]);
});

/* ------------------------------------------------------------------------ */
/*                       The server's files, scanned                         */
/* ------------------------------------------------------------------------ */

// The files a request runs through. utils/ is pure and queries nothing (its
// one console call, the transition plan's parser, logs a failure to parse the
// AI's text, not a query's); scripts/ print to the terminal that runs them.
const SERVER_FILES = [
  'server.cjs', 'db.cjs', 'data.cjs',
  ...['routes', 'models', 'middleware', 'services'].flatMap((dir) => readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.cjs')).sort().map((f) => `${dir}/${f}`)),
];

// Every console call in `source`, with its arguments as written: read up to
// the call's closing parenthesis, strings and template literals skipped over,
// and split at the top-level commas
function consoleCalls(source) {
  const calls = [];
  const start = /\bconsole\.(error|warn|log|info|debug)\(/g;
  for (let m = start.exec(source); m; m = start.exec(source)) {
    const args = [];
    let current = '';
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
        current += source.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if ('([{'.includes(ch)) depth += 1;
      if (')]}'.includes(ch)) depth -= 1;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
      i += 1;
    }
    args.push(current.trim());
    calls.push({ line: source.slice(0, m.index).split('\n').length, args: args.filter(Boolean) });
  }
  return calls;
}

// Text only: a string or template literal, or JSON.stringify of an object
// literal (the structured lines, which name each field). An error, or any
// other value, passed as an argument prints the whole object: JSON.stringify
// of a pg error prints its `detail` too.
const isText = (arg) => /^(['"`])[\s\S]*\1$/.test(arg) || /^JSON\.stringify\(\{[\s\S]*\}\)$/.test(arg);

test('no console call in the server\'s files logs anything but text: a failure goes through logError', () => {
  const found = [];
  for (const file of SERVER_FILES) {
    for (const call of consoleCalls(readFileSync(join(root, file), 'utf8'))) {
      for (const arg of call.args) {
        if (!isText(arg)) found.push(`${file}:${call.line}: ${arg}`);
      }
    }
  }
  assert.deepEqual(found, []);
  // The scan reads what it should: a call with an error in it is caught
  assert.deepEqual(consoleCalls("console.error('Error updating client:', error);").map((c) => c.args), [["'Error updating client:'", 'error']]);
  assert.deepEqual(consoleCalls('console.error(`x ${a}, (b)`, JSON.stringify({ a, b: f(c, d) }));').map((c) => c.args.map(isText)), [[true, true]]);
  assert.equal(isText('JSON.stringify(error)'), false);
});

test('each site the plan lists logs through logError: the client routes, the People list, sign-in, the transition plan and saved scenarios, Ask and the brief, and the server', () => {
  // docs/plans/tier-3.md, section 4.1 (c): data.cjs's seven, routes/people.cjs's
  // three, routes/auth.cjs's three, routes/scenarios.cjs's book read and
  // plan failure (and its saved scenarios' failed(), which logged the code
  // and message already), routes/ai.cjs's unexpected failure, and
  // server.cjs's error middleware and start-up
  const expected = {
    'data.cjs': 7,
    'routes/people.cjs': 3,
    'routes/auth.cjs': 3,
    'routes/scenarios.cjs': 3,
    'routes/ai.cjs': 1,
    'server.cjs': 2,
  };
  const counts = Object.fromEntries(Object.keys(expected).map((file) => [file,
    (readFileSync(join(root, file), 'utf8').match(/\blogError\(/g) || []).length]));
  assert.deepEqual(counts, expected);
});
