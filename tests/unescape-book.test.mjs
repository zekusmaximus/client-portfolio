// utils/unescapeBook.cjs, the pure half of scripts/unescape-book.cjs
// (docs/plans/tier-2.md, S8, WP5): which stored client text is escaped, what
// the repair writes instead, the names it refuses to leave shared, and that a
// second repair changes nothing. The script's database tests (both table
// shapes, the preview, --confirm, a wrong count, a shared name, a second run)
// are in tests/schema.test.mjs, which CI's schema job runs with PostgreSQL;
// this file has none, so npm test runs all of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'validator';
import repair from '../utils/unescapeBook.cjs';
import escaping from '../utils/escaping.cjs';
import rules from '../utils/clientRules.cjs';

const { REPAIR_COLUMNS, ENTITY_LIKE, ENTITY_LIKE_SQL, repairValue, planRepair, sharedNames, checkRepair } = repair;
const { unescapeStored } = escaping;

// validator.escape applied `times` times, as `times` saves stored it
const escaped = (text, times = 1) => Array.from({ length: times }).reduce((out) => validator.escape(out), text);

// Deterministic pseudo-random numbers (mulberry32), so a failure reproduces
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The rows the script reads (ROWS_SQL): id as text and the five columns
const row = (id, fields = {}) => ({
  id: String(id), name: `Client ${id}`, notes: null, primary_lobbyist: null, client_originator: null, lobbyist_team: null, ...fields,
});

// Stored as the client form and the request sanitizer left them before WP5
const BOOK = [
  row(1, {
    name: escaped('Barnes & Noble Education Fund'),
    // A note with `<`: DOMPurify serialized it, then the sanitizer escaped it
    notes: escaped('R&amp;D &lt; 5% of "budget"'),
    primary_lobbyist: 'Kevin',
    client_originator: 'Firm',
    lobbyist_team: ['Kevin', escaped("O'Brien")],
  }),
  row(2, { name: escaped("O'Brien Trust", 2), primary_lobbyist: escaped("O'Brien"), client_originator: escaped("O'Brien") }),
  row(3, { name: escaped('Health / Human Services'), notes: escaped('A&B', 3), primary_lobbyist: '' }),
  // Typed after WP5: plain, untouched
  row(4, { name: 'Plain & Simple', notes: 'R&D < 5%', lobbyist_team: [] }),
  // A note with a non-breaking space and `<`: DOMPurify wrote `&nbsp;`, which
  // is not an escape unescapeStored undoes
  row(5, { name: 'Nbsp Co', notes: escaped('a&nbsp;b &lt; c') }),
  // A literal entity a partner typed (or an import stored) after WP5
  row(6, { name: 'Typed Entity', notes: 'Copyright &#169; 2026' }),
];

test('the five columns of clients, in the order the script reports them', () => {
  assert.deepEqual(REPAIR_COLUMNS, ['name', 'notes', 'primary_lobbyist', 'client_originator', 'lobbyist_team']);
});

test('repairValue: unescapeStored on text, element by element on an array, null and other values as they are', () => {
  assert.equal(repairValue('Barnes &amp;amp; Noble'), 'Barnes & Noble');
  assert.deepEqual(repairValue(['Kevin', 'O&#x27;Brien', null, 'O&amp;#x27;Neil']), ['Kevin', "O'Brien", null, "O'Neil"]);
  assert.deepEqual(repairValue([]), []);
  for (const other of [null, undefined, 7, true]) assert.equal(repairValue(other), other);
});

test('planRepair: each escaped column once and two or more levels deep, a note with <, an escaped lobbyist_team; plain rows untouched; entity-like text it cannot undo reported', () => {
  const plan = planRepair(BOOK);
  assert.equal(plan.total, 4);
  assert.deepEqual(plan.byColumn, { name: 3, notes: 3, primary_lobbyist: 1, client_originator: 1, lobbyist_team: 1 });
  assert.deepEqual(plan.changes.map((c) => [c.id, c.columns]), [
    ['1', ['name', 'notes', 'lobbyist_team']],
    ['2', ['name', 'primary_lobbyist', 'client_originator']],
    ['3', ['name', 'notes']],
    ['5', ['notes']],
  ]);
  const [one, two, three, four, five, six] = plan.repaired;
  assert.deepEqual(one, row(1, {
    name: 'Barnes & Noble Education Fund', notes: 'R&D < 5% of "budget"', primary_lobbyist: 'Kevin', client_originator: 'Firm', lobbyist_team: ['Kevin', "O'Brien"],
  }));
  assert.deepEqual(two, row(2, { name: "O'Brien Trust", primary_lobbyist: "O'Brien", client_originator: "O'Brien" }));
  assert.deepEqual(three, row(3, { name: 'Health / Human Services', notes: 'A&B', primary_lobbyist: '' }));
  assert.deepEqual(four, BOOK[3]);
  assert.equal(five.notes, 'a&nbsp;b < c');
  assert.deepEqual(six, BOOK[5]);
  assert.deepEqual(plan.changes[0].before, Object.fromEntries(REPAIR_COLUMNS.map((c) => [c, BOOK[0][c]])));
  assert.deepEqual(plan.leftovers, [
    { id: '5', name: 'Nbsp Co', column: 'notes' },
    { id: '6', name: 'Typed Entity', column: 'notes' },
  ]);
  assert.deepEqual(planRepair([]), { changes: [], total: 0, byColumn: { name: 0, notes: 0, primary_lobbyist: 0, client_originator: 0, lobbyist_team: 0 }, repaired: [], leftovers: [] });
});

test('a second repair changes nothing: on the book, and on seeded random text escaped 0 to 4 times', () => {
  assert.equal(planRepair(planRepair(BOOK).repaired).total, 0);
  const next = random(5);
  const chars = "ab &<>\"'/\\`;#x0";
  for (let i = 0; i < 3000; i++) {
    const typed = Array.from({ length: Math.floor(next() * 24) }, () => chars[Math.floor(next() * chars.length)]).join('');
    const times = Math.floor(next() * 5);
    const stored = escaped(typed, times);
    const once = repairValue(stored);
    assert.equal(repairValue(once), once, JSON.stringify(stored));
    // Text with no `;` comes back exactly as typed
    if (!typed.includes(';')) assert.equal(once, typed, JSON.stringify(stored));
    const plan = planRepair([row(i, { name: stored, notes: stored, lobbyist_team: [stored, typed] })]);
    assert.equal(planRepair(plan.repaired).total, 0);
  }
});

test('unescapeStored is idempotent on any text, not only on escapes: entity fragments in random order', () => {
  const next = random(6);
  const pieces = ['&', 'amp;', '&amp;', '#x27;', '&#x27;', 'quot;', '&lt;', 'lt;', '&gt;', '#x2F;', '&#x5C;', '#96;', '&#96;', ';', '#', 'x', 'a', ' ', '&#169;', '&nbsp;'];
  for (let i = 0; i < 20000; i++) {
    const text = Array.from({ length: Math.floor(next() * 10) }, () => pieces[Math.floor(next() * pieces.length)]).join('');
    const once = unescapeStored(text);
    assert.equal(unescapeStored(once), once, JSON.stringify(text));
    assert.ok(!escaping.ESCAPES.some(([entity]) => once.includes(entity)), `no escape left in ${JSON.stringify(once)}`);
  }
});

test('sharedNames: names shared regardless of case, as the import compares them (unescaped), before or after the repair; none when every name is its own', () => {
  const rows = [
    row(10, { name: escaped('Barnes & Noble') }),
    row(2, { name: 'barnes & noble' }),
    row(3, { name: 'Acme' }),
    row(4, { name: 'ACME' }),
    row(5, { name: 'Other' }),
  ];
  const expected = [
    { name: 'Barnes & Noble', clients: [{ id: '10', name: 'Barnes &amp; Noble' }, { id: '2', name: 'barnes & noble' }] },
    { name: 'Acme', clients: [{ id: '3', name: 'Acme' }, { id: '4', name: 'ACME' }] },
  ];
  assert.deepEqual(sharedNames(rows), expected);
  assert.deepEqual(sharedNames(planRepair(rows).repaired).map((g) => [g.name, g.clients.map((c) => c.id)]), expected.map((g) => [g.name, g.clients.map((c) => c.id)]));
  assert.deepEqual(sharedNames(BOOK), []);
  assert.deepEqual(sharedNames([]), []);
});

test('checkRepair: commits only when the count is the one confirmed, nothing is left to repair and no name is shared', () => {
  const plan = planRepair(BOOK);
  assert.deepEqual(checkRepair(4, plan, plan.repaired), { ok: true, problems: [] });
  assert.deepEqual(checkRepair(3, plan, plan.repaired), { ok: false, problems: ['4 clients hold escaped text, not the 3 confirmed'] });
  assert.deepEqual(checkRepair(4, plan, BOOK).problems, ['4 clients would still hold escaped text']);
  const shared = [...plan.repaired, row(7, { name: 'PLAIN & SIMPLE' })];
  assert.deepEqual(checkRepair(4, plan, shared).problems, ['a name is shared regardless of case ("Plain & Simple": 2 clients)']);
  assert.deepEqual(checkRepair(0, planRepair([]), []), { ok: true, problems: [] });
});

test('ENTITY_LIKE: character references, not a bare & ; the SQL pattern is the same', () => {
  for (const text of ['&amp;', '&#169;', '&#x27;', '&#X2f;', '&nbsp;', 'a &lt; b']) assert.match(text, ENTITY_LIKE, text);
  for (const text of ['R&D', 'AT&T', 'a & b; c', '&;', '&#;', '&#x;', 'plain']) assert.doesNotMatch(text, ENTITY_LIKE, text);
  assert.equal(ENTITY_LIKE.source, ENTITY_LIKE_SQL.replace('(', '(?:'));
});

// Only clients.name, notes and the three legacy text columns can hold what the
// sanitizer escaped: the vocabulary columns' values have no character it
// changes, the People list and the AI routes never ran it (routes/people.cjs,
// routes/ai.cjs), and answerRow unescapes a plan's client name at save
test('the vocabulary columns hold nothing the sanitizer changed: every practice area, cadence and conflict risk escapes to itself', () => {
  for (const value of [...rules.PRACTICE_AREAS, ...rules.CADENCES, ...rules.CONFLICT_RISKS, 'Prospect', 'Active', 'Former']) {
    assert.equal(validator.escape(value), value, value);
  }
});
