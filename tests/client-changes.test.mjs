// Who changed what (docs/plans/tier-2.md, S9 and S10, WP6): the pure half,
// utils/clientChanges.cjs. The routes that write clients read the client
// FOR UPDATE, write, and log what clientChanges finds between the rows as
// stored before and after; tests/routes.test.mjs and tests/import-db.test.mjs
// run them on PostgreSQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import clientChangesModule from '../utils/clientChanges.cjs';
import csvImport from '../utils/csvImport.cjs';

const {
  SOURCES,
  FIELDS,
  cents,
  revenueSnapshot,
  clientSnapshot,
  clientChanges,
  importedRevenue,
  UPDATED_AT_EXACT_FORMAT,
  updatedAtExactSql,
  readExpectedUpdatedAt,
  isCurrent,
  insertChangesParams,
  firmTime,
  conflictBody,
} = clientChangesModule;
const { planRevenueWrites } = csvImport;

const NAMES = new Map([[1, 'Kevin'], [2, 'Joe'], [3, 'Jay'], [4, 'Paula']]);

// A clients row as SELECT * gives it, with a few columns the history ignores
const storedRow = (overrides = {}) => ({
  id: 42,
  name: 'Acme Energy',
  practice_area: ['Energy', 'Healthcare'],
  conflict_risk: 'Low',
  notes: 'A note',
  interaction_frequency: 'Monthly',
  stickiness: 3,
  high_maintenance: false,
  lead_id: 1,
  second_chair_id: 3,
  originator_id: 2,
  originator_is_firm: false,
  primary_lobbyist: 'Kevin',
  lobbyist_team: ['Kevin', 'Jay'],
  client_originator: 'Joe',
  status: 'Active',
  user_id: 7,
  updated_by: 7,
  relationship_strength: 5,
  relationship_intensity: 5,
  renewal_probability: '0.70',
  strategic_fit_score: 5,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});
const REVENUE = [{ year: 2025, revenue_amount: '40000.00' }, { year: 2026, revenue_amount: '55000.50' }];
const snap = (overrides = {}, revenues = REVENUE, names = NAMES) => clientSnapshot(storedRow(overrides), { names, revenues });

test('each field a partner sets is logged alone, from and to, when it is the only change', () => {
  const cases = [
    ['name', { name: 'Acme Power' }, 'Acme Energy', 'Acme Power'],
    ['lead_id', { lead_id: 4 }, { id: 1, name: 'Kevin' }, { id: 4, name: 'Paula' }],
    ['second_chair_id', { second_chair_id: null }, { id: 3, name: 'Jay' }, null],
    ['originator_id', { originator_id: 4 }, { id: 2, name: 'Joe' }, { id: 4, name: 'Paula' }],
    ['originator_is_firm', { originator_is_firm: true }, false, true],
    ['stickiness', { stickiness: 4 }, 3, 4],
    ['stickiness', { stickiness: null }, 3, null],
    ['interaction_frequency', { interaction_frequency: 'Weekly' }, 'Monthly', 'Weekly'],
    ['high_maintenance', { high_maintenance: true }, false, true],
    ['conflict_risk', { conflict_risk: 'High' }, 'Low', 'High'],
    ['practice_area', { practice_area: ['Energy'] }, ['Energy', 'Healthcare'], ['Energy']],
    ['notes', { notes: 'R&D < 5% of "budget"' }, 'A note', 'R&D < 5% of "budget"'],
    ['notes', { notes: '' }, 'A note', null],
  ];
  for (const [field, overrides, from, to] of cases) {
    assert.deepEqual(clientChanges(snap(), snap(overrides)), { [field]: { from, to } }, JSON.stringify(overrides));
  }
  // Every field is covered above
  assert.deepEqual([...new Set(cases.map(([field]) => field))].sort(), [...FIELDS].sort());
});

test('several fields and revenue change together, each logged once', () => {
  const changes = clientChanges(
    snap(),
    snap({ stickiness: 5, notes: null, lead_id: 2 }, [{ year: 2026, revenue_amount: '60000' }, { year: 2027, revenue_amount: 1000 }]),
  );
  assert.deepEqual(changes, {
    lead_id: { from: { id: 1, name: 'Kevin' }, to: { id: 2, name: 'Joe' } },
    stickiness: { from: 3, to: 5 },
    notes: { from: 'A note', to: null },
    revenue: {
      2025: { from: 40000, to: null },
      2026: { from: 55000.5, to: 60000 },
      2027: { from: null, to: 1000 },
    },
  });
});

test('nothing changed gives null: the same row, and every other spelling of "not set" the import and the form write', () => {
  assert.equal(clientChanges(snap(), snap()), null);
  // The form leaves NULL where a blank import cell writes '' or {}; the
  // column default Medium and NULL; high-maintenance NULL and false
  const blankForm = { notes: null, interaction_frequency: null, practice_area: null, conflict_risk: null, high_maintenance: null, stickiness: null };
  const blankImport = { notes: '', interaction_frequency: '', practice_area: [], conflict_risk: 'Medium', high_maintenance: false, stickiness: null };
  assert.equal(clientChanges(snap(blankForm), snap(blankImport)), null);
  assert.equal(clientChanges(snap(blankImport), snap(blankForm)), null);
  // Practice areas as a set: the form appends them in the order they are ticked
  assert.equal(clientChanges(snap({ practice_area: ['Healthcare', 'Energy'] }), snap()), null);
  // NUMERIC as text against the number a body sends; a $0 row and no row are both none
  assert.equal(clientChanges(
    snap({}, [{ year: 2025, revenue_amount: '40000.00' }, { year: 2024, revenue_amount: '0.00' }]),
    snap({}, [{ year: 2025, revenue_amount: 40000 }]),
  ), null);
  // The legacy text, updated_at, updated_by, user_id, status and the retired columns are not compared
  assert.equal(clientChanges(snap(), snap({
    primary_lobbyist: 'Someone', lobbyist_team: ['Someone'], client_originator: 'Firm', updated_at: new Date(), updated_by: null,
    user_id: null, status: 'Former', relationship_strength: 9, relationship_intensity: 1, renewal_probability: '0.10', strategic_fit_score: 1,
  })), null);
});

test('people are compared by id, with the name the People list gives at the time: a rename changes no client', () => {
  const renamed = new Map([...NAMES, [1, 'Kevin Renamed']]);
  assert.equal(clientChanges(snap({}, REVENUE, NAMES), snap({}, REVENUE, renamed)), null);
  const changes = clientChanges(snap({}, REVENUE, NAMES), snap({ lead_id: 2, second_chair_id: 1 }, REVENUE, renamed));
  assert.deepEqual(changes, {
    lead_id: { from: { id: 1, name: 'Kevin' }, to: { id: 2, name: 'Joe' } },
    second_chair_id: { from: { id: 3, name: 'Jay' }, to: { id: 1, name: 'Kevin Renamed' } },
  });
  // A person the list no longer names keeps the id, with no name
  assert.deepEqual(clientChanges(snap(), snap({ originator_id: 99 })).originator_id, { from: { id: 2, name: 'Joe' }, to: { id: 99, name: null } });
  // Names as an object work too
  assert.deepEqual(clientSnapshot(storedRow(), { names: { 1: 'Kevin' } }).lead_id, { id: 1, name: 'Kevin' });
});

test('revenue by year: only when both sides carry it; to the cent, as NUMERIC(12, 2) stores it', () => {
  // A PUT without revenues and the second-chair route do not read revenue
  assert.equal(clientChanges(clientSnapshot(storedRow(), { names: NAMES }), snap()), null);
  assert.equal(clientChanges(snap(), clientSnapshot(storedRow(), { names: NAMES })), null);
  assert.deepEqual(revenueSnapshot([{ year: 2025, revenue_amount: '1000.56' }, { year: '2026', revenue_amount: 0 }, { year: null, revenue_amount: 5 }]), { 2025: 1000.56 });
  // A year on file twice takes its last row, as revenueObjectFromRows does
  assert.deepEqual(revenueSnapshot([{ year: 2025, revenue_amount: 1 }, { year: 2025, revenue_amount: 2 }]), { 2025: 2 });
  assert.deepEqual(revenueSnapshot(undefined), {});
  for (const [value, expected] of [
    [1000.555, 1000.56], ['1000.555', 1000.56], [0.004, 0], [0.005, 0.01], ['40000.00', 40000], [30000.5, 30000.5],
    [1e-7, 0], [999999999.995, 1000000000], [-2.345, -2.35], ['abc', 0], [null, 0],
  ]) {
    assert.equal(cents(value), expected, String(value));
  }
});

test('a client created is every field it has, from null; deleted, every field it had, to null', () => {
  const created = clientChanges(null, snap({ second_chair_id: null, notes: '' }));
  assert.deepEqual(Object.keys(created).sort(), [
    'conflict_risk', 'high_maintenance', 'interaction_frequency', 'lead_id', 'name', 'originator_id', 'originator_is_firm',
    'practice_area', 'revenue', 'stickiness',
  ]);
  assert.deepEqual(created.name, { from: null, to: 'Acme Energy' });
  assert.deepEqual(created.high_maintenance, { from: null, to: false });
  assert.deepEqual(created.revenue, { 2025: { from: null, to: 40000 }, 2026: { from: null, to: 55000.5 } });
  assert.ok(FIELDS.filter((field) => field in created).every((field) => created[field].from === null));

  const deleted = clientChanges(snap(), null);
  assert.deepEqual(deleted.name, { from: 'Acme Energy', to: null });
  assert.deepEqual(deleted.second_chair_id, { from: { id: 3, name: 'Jay' }, to: null });
  assert.deepEqual(deleted.revenue, { 2025: { from: 40000, to: null }, 2026: { from: 55000.5, to: null } });
  assert.equal(Object.keys(deleted).length, FIELDS.length + 1, 'every field this client has set, and its revenue');
});

test('names and notes are logged as the row holds them: nothing decoded, a literal entity included (stored as typed since WP5)', () => {
  const changes = clientChanges(snap(), snap({ name: 'Barnes &amp; Noble', notes: 'Copyright &#169; 2026 & <b>' }));
  assert.deepEqual(changes, {
    name: { from: 'Acme Energy', to: 'Barnes &amp; Noble' },
    notes: { from: 'A note', to: 'Copyright &#169; 2026 & <b>' },
  });
  assert.deepEqual(clientChanges(snap({ name: "Smith & O'Brien /" }), snap({ name: "Smith & O'Brien /" })), null);
});

// A seeded generator, so a failure repeats
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('importedRevenue is what planRevenueWrites writes: on seeded random rows and files, each file year set above 0, removed otherwise, the rest kept', () => {
  const next = random(2026);
  const pick = (list) => list[Math.floor(next() * list.length)];
  for (let i = 0; i < 500; i += 1) {
    const stored = [2022, 2023, 2024, 2025, 2026].filter(() => next() < 0.5)
      .map((year) => ({ year, revenue_amount: pick(['0.00', '1000.00', '2500.50', '40000.00']) }));
    const fileYears = [2024, 2025, 2026, 2027].filter(() => next() < 0.6);
    const fileRevenue = Object.fromEntries(fileYears.map((year) => [year, pick([0, 0, 1000, 2500.5, 40000.004, 99.995])]));

    // What the import leaves: delete every (client, year) it names, insert the upserts
    const { upserts, deletes } = planRevenueWrites([{ id: 'c', revenue: fileRevenue }], fileYears);
    const touched = new Set([...upserts, ...deletes].map(([, year]) => year));
    const rows = [
      ...stored.filter((r) => !touched.has(r.year)),
      ...upserts.map(([, year, amount]) => ({ year, revenue_amount: amount })),
    ];
    assert.deepEqual(importedRevenue(revenueSnapshot(stored), fileRevenue, fileYears), revenueSnapshot(rows), JSON.stringify({ stored, fileRevenue }));
  }
  // A file with no year columns changes no revenue
  assert.deepEqual(importedRevenue({ 2025: 1 }, { 2025: 5 }, []), { 2025: 1 });
});

test('expected_updated_at: absent is no check; null or the exact text is a check; anything else is refused with a detail', () => {
  assert.deepEqual(readExpectedUpdatedAt({}), { present: false, value: null, errors: [] });
  assert.deepEqual(readExpectedUpdatedAt({ expected_updated_at: undefined }), { present: false, value: null, errors: [] });
  assert.deepEqual(readExpectedUpdatedAt(null), { present: false, value: null, errors: [] });
  assert.deepEqual(readExpectedUpdatedAt({ expected_updated_at: null }), { present: true, value: null, errors: [] });
  assert.deepEqual(readExpectedUpdatedAt({ expected_updated_at: '2026-09-28T20:34:00.006586' }),
    { present: true, value: '2026-09-28T20:34:00.006586', errors: [] });
  const refused = [{ field: 'expected_updated_at', message: "expected_updated_at must be the client's updated_at_exact as the API sent it, or null." }];
  // Among them what a page would send by mistake: the Date JSON gives (milliseconds, a zone)
  for (const value of ['2026-09-28T20:34:00.006Z', '2026-09-28T20:34:00.006', '2026-09-28 20:34:00.006586', '2026-09-28T20:34:00.006586+00',
    '', 'garbage', 1727555640006, true, {}, []]) {
    assert.deepEqual(readExpectedUpdatedAt({ expected_updated_at: value }), { present: true, value: null, errors: refused }, JSON.stringify(value));
  }
  assert.equal(isCurrent('2026-09-28T20:34:00.006586', '2026-09-28T20:34:00.006586'), true);
  assert.equal(isCurrent('2026-09-28T20:34:00.006586', '2026-09-28T20:34:00.006587'), false);
  assert.equal(isCurrent(null, null), true, 'a NULL updated_at IS NOT DISTINCT FROM null');
  assert.equal(isCurrent(null, '2026-09-28T20:34:00.006586'), false);
  assert.equal(isCurrent('2026-09-28T20:34:00.006586', null), false);
});

test('updated_at_exact is to_char to the microsecond, with no zone and no locale-dependent field', () => {
  assert.equal(UPDATED_AT_EXACT_FORMAT, 'YYYY-MM-DD"T"HH24:MI:SS.US');
  assert.equal(updatedAtExactSql('c.updated_at'), `to_char(c.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')`);
  assert.doesNotMatch(UPDATED_AT_EXACT_FORMAT, /TZ|OF|TM/);
});

test('insertChangesParams: one JSON list for the clients that changed, the account while it exists, the username and the source', () => {
  const params = insertChangesParams([
    { clientId: 42, clientName: 'Acme', changes: { stickiness: { from: 3, to: 4 } } },
    { clientId: 'b1c1', clientName: 'Other', changes: null },
    { clientId: '7f3c', clientName: 'Third', changes: { notes: { from: null, to: 'x' } } },
  ], { userId: 5, username: 'jeff' }, 'import');
  assert.deepEqual(JSON.parse(params[0]), [
    { client_id: '42', client_name: 'Acme', changes: { stickiness: { from: 3, to: 4 } } },
    { client_id: '7f3c', client_name: 'Third', changes: { notes: { from: null, to: 'x' } } },
  ]);
  assert.deepEqual(params.slice(1), [5, 'jeff', 'import']);
  assert.equal(insertChangesParams([{ clientId: 1, changes: null }], { userId: 5, username: 'jeff' }, 'form'), null);
  assert.equal(insertChangesParams([], null, 'form'), null);
  assert.deepEqual(insertChangesParams([{ clientId: 1, clientName: 'A', changes: {} }], {}, 'delete').slice(1), [null, null, 'delete']);
});

test('the sources are the table\'s CHECK in init-db.sql', () => {
  const init = readFileSync(new URL('../init-db.sql', import.meta.url), 'utf8');
  const check = /source VARCHAR\(20\) NOT NULL CHECK \(source IN \(([^)]*)\)\)/.exec(init);
  assert.ok(check, 'client_changes.source has its CHECK');
  assert.deepEqual(check[1].split(',').map((s) => s.trim().replace(/'/g, '')), [...SOURCES]);
});

test('a 409 names who saved last and when, in the firm\'s time zone; without a history row it says only that the client changed', () => {
  // 20:34 UTC is 4:34 PM in Connecticut in September (EDT) and 3:34 PM in January (EST)
  assert.equal(firmTime('2026-09-28T20:34:00.006Z'), 'Sep 28, 2026, 4:34 PM');
  assert.equal(firmTime(new Date('2026-01-15T20:34:00Z')), 'Jan 15, 2026, 3:34 PM');
  const created = new Date('2026-09-28T20:34:00.006Z');
  assert.deepEqual(conflictBody({ changed_by_username: 'jeff', source: 'form', created_at: created }), {
    success: false,
    error: 'This client was saved after you opened it, by jeff on Sep 28, 2026, 4:34 PM. Nothing was saved.',
    latest_change: { changed_by_username: 'jeff', source: 'form', created_at: created },
  });
  assert.match(conflictBody({ changed_by_username: 'paula', source: 'import', created_at: created }).error, /by paula \(an import\) on /);
  assert.match(conflictBody({ changed_by_username: 'paula', source: 'second-chair', created_at: created }).error, /by paula \(the associate split\) on /);
  assert.match(conflictBody({ changed_by_username: null, source: 'form', created_at: created }).error, /by a former account on /);
  assert.deepEqual(conflictBody(undefined), {
    success: false, error: 'This client was saved after you opened it. Nothing was saved.', latest_change: null,
  });
});

// T4 and T8 (docs/plans/tier-1.md): the history holds notes, and the same
// clients must give the same book, so nothing on the AI's path reads it. And
// ids are never reused, so a deleted client's history stays its own: nothing
// restarts a sequence or truncates a table.
test('nothing the AI reads touches client_changes; nothing truncates a table or restarts a sequence', () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const aiPath = [
    'utils/book.cjs', 'models/bookModel.cjs', 'models/clientModel.cjs', 'routes/ai.cjs', 'routes/scenarios.cjs',
    'utils/transitionPlan.cjs', 'utils/askPrompts.cjs', 'utils/aiAnswers.cjs', 'services/anthropic.cjs',
  ];
  for (const file of aiPath) assert.doesNotMatch(read(file), /client_changes|clientChanges/, file);
  const writers = [
    'init-db.sql', 'data.cjs', 'routes/people.cjs', 'scripts/reset-book.cjs', 'scripts/delete-user.cjs',
    'scripts/unescape-book.cjs', 'scripts/check-schema.cjs', 'create-admin.cjs', 'scripts/reset-password.cjs',
  ];
  for (const file of writers) assert.doesNotMatch(read(file), /\bTRUNCATE\b|RESTART IDENTITY|setval\(/i, file);
});
