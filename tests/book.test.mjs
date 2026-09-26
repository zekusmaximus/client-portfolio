// The book as the AI sees it (docs/plans/tier-1.md, WP2; T3, T4, T5):
// utils/book.cjs, the server's port of the page's load arithmetic, held equal
// to the page's own modules (src/utils/load.js, src/utils/revenue.js) on the
// fixture book of tests/load.test.mjs and on 200 random books; then the text:
// deterministic, every client once, names decoded, no notes, defaults
// labelled as defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import book from '../utils/book.cjs';
import strategic from '../utils/strategic.cjs';
import {
  partnershipModel,
  SECOND_CHAIR_EFFORT_SHARE as PAGE_SHARE,
  formatMoney as pageMoney,
  formatEffort as pageEffort,
  formatRatio as pageRatio,
} from '../src/utils/load.js';
import { computeReportingYear, revenueForYear } from '../src/utils/revenue.js';
import { PEOPLE, CLIENTS, person } from './fixtures/books.mjs';

const { bookModel, renderBook, buildBook, reportingYear } = book;
const NOW = new Date('2026-09-26T12:00:00Z');

/* ------------------------------------------------------------------------ */
/*                                  Helpers                                  */
/* ------------------------------------------------------------------------ */

// A seeded generator (mulberry32), so every run builds the same random books
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const shuffle = (rand, list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// The two sides sum floats in different orders (the book sorts the clients
// first, so its text never depends on the order rows arrive in)
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const assertClose = (actual, expected, label) => {
  if (expected === null || actual === null) assert.equal(actual, expected, label);
  else assert.ok(close(actual, expected), `${label}: ${actual} vs ${expected}`);
};
const idSet = (clients) => clients.map((c) => String(c.id)).sort();

/** The page's picture of the same book, at the page's reporting year. */
function pageSide(people, clients, now) {
  const year = computeReportingYear(clients, now);
  return { year, model: partnershipModel(people, clients, (c) => revenueForYear(c, year)) };
}

function assertParity(people, clients, now, label) {
  const { year, model: page } = pageSide(people, clients, now);
  const server = bookModel({ people, clients, now });
  assert.equal(server.reportingYear, year, `${label}: reporting year`);
  assert.equal(server.rows.length, page.rows.length, `${label}: one row per person`);

  const rows = new Map(server.rows.map((r) => [r.person.id, r]));
  for (const p of page.rows) {
    const s = rows.get(p.person.id);
    const who = `${label}, ${p.person.name}`;
    assert.ok(s, `${who}: in the book's rows`);
    for (const seat of ['lead', 'second']) {
      assert.equal(s[seat].count, p[seat].count, `${who}: ${seat} count`);
      assert.deepEqual(idSet(s[seat].clients), idSet(p[seat].clients), `${who}: ${seat} clients`);
      assertClose(s[seat].revenue, p[seat].revenue, `${who}: ${seat} revenue`);
      assertClose(s[seat].effort, p[seat].effort, `${who}: ${seat} effort`);
      // What the page shows and what the book says
      assert.equal(book.formatMoney(s[seat].revenue), pageMoney(p[seat].revenue), `${who}: ${seat} revenue shown`);
      assert.equal(book.formatEffort(s[seat].effort), pageEffort(p[seat].effort), `${who}: ${seat} effort shown`);
    }
    for (const [ratios, name] of [['leadRatio', 'lead'], ['secondRatio', 'second']]) {
      for (const key of ['count', 'revenue', 'effort']) {
        assertClose(s[ratios][key], p[ratios][key], `${who}: ${name} ratio ${key}`);
        assert.equal(book.formatRatio(s[ratios][key]), pageRatio(p[ratios][key]), `${who}: ${name} ratio ${key} shown`);
      }
    }
  }

  for (const role of Object.keys(page.averages)) {
    const [s, p] = [server.averages[role], page.averages[role]];
    assert.equal(s.members, p.members, `${label}: ${role} members`);
    for (const seat of ['lead', 'second']) {
      for (const key of ['count', 'revenue', 'effort']) assertClose(s[seat][key], p[seat][key], `${label}: ${role} ${seat} ${key} average`);
    }
  }
  assert.equal(server.totals.clients, page.totals.clients);
  assertClose(server.totals.revenue, page.totals.revenue, `${label}: total revenue`);
  assertClose(server.totals.effort, page.totals.effort, `${label}: total effort`);
  assert.deepEqual(idSet(server.unled), idSet(page.unled), `${label}: unled`);
  assert.deepEqual(idSet(server.noSecondChair), idSet(page.noSecondChair), `${label}: no second chair`);
}

const ROLES = ['partner', 'emeritus', 'associate'];
const CADENCES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed', '', null];
const AREAS = ['Healthcare', 'Energy', 'Municipal', 'Education', 'Real Estate', 'Non-Profit'];
const hex = (rand, n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

/** A random book: roles, inactive people with seats, clients without a lead or second chair, several years. */
function randomBook(seed) {
  const rand = rng(seed);
  const people = Array.from({ length: 2 + Math.floor(rand() * 11) }, (_, i) =>
    person(i + 1, `${pick(rand, ['Ann', 'bob', 'Cy', "O'Neil", 'Dee', 'eve'])} ${i + 1}`,
      i === 0 ? 'partner' : pick(rand, [...ROLES, 'partner']), rand() > 0.2));
  const partners = people.filter((p) => p.role === 'partner');
  const uuids = rand() > 0.5;
  const clients = Array.from({ length: Math.floor(rand() * 41) }, (_, i) => {
    // Now and then a lead the People list does not have (the page counts it under the nested person)
    const lead = rand() < 0.1 ? null
      : rand() < 0.05 ? person(900 + i, `Stranger ${i}`, 'partner', true)
        : pick(rand, partners);
    const others = people.filter((p) => p.id !== lead?.id);
    const secondChair = rand() < 0.3 || others.length === 0 ? null : pick(rand, others);
    const revenues = [];
    for (const year of [2022, 2023, 2024, 2025, 2026]) {
      if (rand() < 0.5) continue;
      const amount = rand() < 0.1 ? 0 : Math.round(rand() * 50000000) / 100;
      revenues.push({ year: rand() < 0.2 ? String(year) : year, revenue_amount: rand() < 0.5 ? String(amount) : amount });
    }
    if (revenues.length === 0 && rand() < 0.5) revenues.push({ id: null, year: null, revenue_amount: null });
    const raw = {
      id: uuids ? `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-8${hex(rand, 3)}-${hex(rand, 12)}` : 1000 + i,
      name: `${pick(rand, ['Alpha', 'beta', 'Smith &amp; Co', 'Gamma'])} ${Math.floor(rand() * 20)}`,
      lead,
      secondChair,
      interaction_frequency: pick(rand, CADENCES),
      high_maintenance: rand() < 0.3,
      stickiness: rand() < 0.3 ? null : 1 + Math.floor(rand() * 5),
      practiceArea: shuffle(rand, AREAS).slice(0, Math.floor(rand() * 3)),
      revenues,
    };
    // Half as the API scores them (effort present), half derived from cadence
    return rand() < 0.5 ? strategic.calculateStrategicScores([raw])[0] : raw;
  });
  const now = new Date(Date.UTC(2023 + Math.floor(rand() * 5), Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)));
  return { people, clients, now, rand };
}

/* ------------------------------------------------------------------------ */
/*                         Parity with the page (T3)                         */
/* ------------------------------------------------------------------------ */

test('parity: the fixture book of tests/load.test.mjs, figure for figure', () => {
  assertParity(PEOPLE, CLIENTS, NOW, 'fixture');
  const model = bookModel({ people: PEOPLE, clients: CLIENTS, now: NOW });
  const row = (name) => model.rows.find((r) => r.person.name === name);
  // The figures tests/load.test.mjs pins for the page
  assert.deepEqual([row('Kevin').lead.count, row('Kevin').lead.revenue, row('Kevin').lead.effort], [2, 100000, 7.5]);
  assert.deepEqual([row('Kevin').second.count, row('Kevin').second.revenue], [1, 20000]);
  assertClose(row('Kevin').second.effort, 0.4, 'Kevin second-chair effort');
  assertClose(row('Anna').second.effort, 1.3, 'Anna second-chair effort');
  assert.equal(row('Jay').secondRatio.count, null);
  assert.equal(row('Jay').leadRatio.count, null);
  assert.equal(row('Kevin').revenuePerEffort, 100000 / 7.5);
  assert.deepEqual(model.totals, { clients: 6, revenue: 165000, effort: 13.5, revenuePerEffort: 165000 / 13.5 });
});

test('parity: the fixture book with an inactive second chair, a lead off the People list, and empty books', () => {
  const withSteve = [...CLIENTS, { id: 77, name: 'Legacy', lead: PEOPLE[3], secondChair: PEOPLE[9], effort: 2, revenues: [{ year: 2026, revenue_amount: '1000' }] }];
  assertParity(PEOPLE, withSteve, NOW, 'with Steve');
  const stranger = { id: 99, name: 'Zed', role: 'partner', active: true };
  assertParity(PEOPLE, [{ id: 'x', name: 'X', lead: stranger, secondChair: null, effort: 1, revenues: [] }], NOW, 'stranger');
  assertParity([], [], NOW, 'empty');
  assertParity(PEOPLE, [], NOW, 'no clients');
});

test('parity: 200 random books (roles, inactive people with seats, no lead or second chair, several years)', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const { people, clients, now } = randomBook(seed);
    assertParity(people, clients, now, `seed ${seed}`);
  }
});

test('reportingYear is computeReportingYear, and the two effort shares are one number', () => {
  assert.equal(book.SECOND_CHAIR_EFFORT_SHARE, PAGE_SHARE);
  assert.equal(book.SECOND_CHAIR_EFFORT_SHARE, 0.2);
  const edge = [
    [],
    [{ revenues: [] }],
    [{ revenues: [{ id: null, year: null, revenue_amount: null }] }],
    [{ revenues: [{ year: 2031, revenue_amount: '0' }, { year: 2024, revenue_amount: '1' }] }],
    [{ revenues: [{ year: '2025', revenue_amount: 5 }] }, null, { revenues: 'none' }],
    [{ revenues: [{ year: 2020.5, revenue_amount: 5 }, { year: -1, revenue_amount: 5 }] }],
  ];
  for (const clients of edge) {
    for (const now of [NOW, new Date('2031-01-01T00:00:00Z'), new Date('2019-06-30T00:00:00Z')]) {
      assert.equal(reportingYear(clients, now), computeReportingYear(clients, now), JSON.stringify(clients));
    }
  }
  for (let seed = 1; seed <= 200; seed += 1) {
    const { clients, now } = randomBook(seed);
    assert.equal(reportingYear(clients, now), computeReportingYear(clients, now), `seed ${seed}`);
  }
});

/* ------------------------------------------------------------------------ */
/*                              Determinism (T8)                             */
/* ------------------------------------------------------------------------ */

test('determinism: shuffled clients and people give identical text', () => {
  const fixture = renderBook(bookModel({ people: PEOPLE, clients: CLIENTS, now: NOW }));
  const rand = rng(7);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(renderBook(bookModel({ people: shuffle(rand, PEOPLE), clients: shuffle(rand, CLIENTS), now: NOW })), fixture);
  }
  for (let seed = 1; seed <= 50; seed += 1) {
    const { people, clients, now, rand: r } = randomBook(seed);
    const expected = renderBook(bookModel({ people, clients, now }));
    assert.equal(renderBook(bookModel({ people: shuffle(r, people), clients: shuffle(r, clients), now })), expected, `seed ${seed}`);
  }
});

test('determinism: two now values in the same reporting year give identical text', () => {
  // With revenue on file, the year comes from the book, whatever the date
  const a = renderBook(bookModel({ people: PEOPLE, clients: CLIENTS, now: new Date('2026-01-02T00:00:00Z') }));
  const b = renderBook(bookModel({ people: PEOPLE, clients: CLIENTS, now: new Date('2027-11-30T00:00:00Z') }));
  assert.equal(a, b);
  // Without, the year is now's: any two dates in it
  const noRevenue = CLIENTS.map((c) => ({ ...c, revenues: [] }));
  const c = renderBook(bookModel({ people: PEOPLE, clients: noRevenue, now: new Date('2026-01-02T12:00:00Z') }));
  const d = renderBook(bookModel({ people: PEOPLE, clients: noRevenue, now: new Date('2026-12-30T12:00:00Z') }));
  assert.equal(c, d);
  assert.match(c, /Reporting year 2026/);
  assert.doesNotMatch(renderBook(bookModel({ people: PEOPLE, clients: CLIENTS, now: NOW })), /20\d\d-\d\d-\d\d|Today/);
});

/* ------------------------------------------------------------------------ */
/*                              Content (T4, T5)                             */
/* ------------------------------------------------------------------------ */

const UUID = '3f2b8c1e-5d6a-4b7c-9e8f-0a1b2c3d4e5f';
const NOTE = 'ZEBRA-NOTE-7731 confidential settlement terms';
const byName = new Map(PEOPLE.map((p) => [p.name, p]));

// Clients as clientModel.listWithMetrics() returns them: every stored column
// (notes, user_id, the retired ones), revenues with jsonb_agg's null row for a
// client without revenue, and the scores from utils/strategic.cjs
const stored = (fields) => ({
  user_id: 424242,
  status: 'Prospect',
  notes: '',
  relationship_strength: 7,
  relationship_intensity: 8,
  renewal_probability: 0.93,
  strategic_fit_score: 6,
  primary_lobbyist: 'Legacy Text Lead',
  lobbyist_team: ['Legacy Text Lead'],
  client_originator: 'Legacy Text Originator',
  conflict_risk: 'Medium',
  interaction_frequency: 'Monthly',
  high_maintenance: false,
  stickiness: 3,
  practice_area: ['Energy'],
  originator: null,
  originator_is_firm: false,
  secondChair: null,
  created_at: '2026-03-04T05:06:07.000Z',
  ...fields,
});
const scored = (rows) => strategic.calculateStrategicScores(rows.map((c) => ({
  ...c,
  practiceArea: c.practice_area || [],
  conflictRisk: c.conflict_risk || 'Medium',
  relationshipStrength: c.relationship_strength || 5,
  renewalProbability: c.renewal_probability || 0.7,
})));
const rev = (pairs) => Object.entries(pairs).map(([year, amount]) => ({ id: 1, year: Number(year), revenue_amount: amount }));

const CONTENT_CLIENTS = scored([
  stored({ id: 987654, name: 'Smith &amp; Co', lead: byName.get('Kevin'), secondChair: byName.get('Jay'), notes: NOTE,
    stickiness: 1, revenues: rev({ 2025: 80000, 2026: 90000 }), practice_area: ['Healthcare'] }),
  stored({ id: UUID, name: 'Acme Holdings', lead: byName.get('Kevin'), stickiness: null, interaction_frequency: null,
    conflict_risk: null, revenues: rev({ 2026: 50000 }) }),
  stored({ id: 12, name: 'acme holdings', lead: byName.get('Paula'), secondChair: byName.get('Steve'), stickiness: 2,
    revenues: [{ id: null, year: null, revenue_amount: null }] }),
  stored({ id: 13, name: 'Northern &lt;Rail&gt; Board', lead: byName.get('Paula'), secondChair: byName.get('Anna'), stickiness: 5,
    originator: byName.get('Jay'), originator_is_firm: true, high_maintenance: true, interaction_frequency: 'Daily',
    revenues: rev({ 2024: 10000, 2026: 250000 }) }),
  stored({ id: 14, name: 'Orphan Trust', lead: null, stickiness: 4, originator: byName.get('Steve'), revenues: rev({ 2026: 20000 }) }),
]);

const contentBook = () => buildBook({ people: PEOPLE, clients: CONTENT_CLIENTS, now: NOW });
const clientRows = (bookText) => bookText.slice(bookText.indexOf('## Clients')).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Client |') && !l.startsWith('| ---'));
const cells = (line) => line.slice(2, -2).split(' | ');

test('content: every client once, by name regardless of case then id as text; integer and uuid ids both render', () => {
  const { text, clientCount } = contentBook();
  const rows = clientRows(text);
  assert.equal(clientCount, 5);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => cells(r)[0]), [
    'Acme Holdings', 'acme holdings', 'Northern <Rail> Board', 'Orphan Trust', 'Smith & Co',
  ]);
  // "12" < "3f2b..." as text, so the integer-id client comes first among the two Acmes...
  const swapped = buildBook({ people: PEOPLE, clients: CONTENT_CLIENTS.map((c) => (c.id === 12 ? { ...c, name: 'Acme Holdings' } : c)), now: NOW });
  assert.deepEqual(clientRows(swapped.text).slice(0, 2).map((r) => cells(r)[1]), ['Paula', 'Kevin']);
  // ...and no id is in the text
  assert.doesNotMatch(text, /987654|3f2b8c1e/);
});

test('content: names decoded (&amp; is &), and the people come from the nested lead, not the legacy text', () => {
  const { text } = contentBook();
  assert.match(text, /\| Smith & Co \| Kevin \| Jay \|/);
  assert.doesNotMatch(text, /&amp;|&lt;|&gt;|&#x27;/);
  assert.doesNotMatch(text, /Legacy Text/);
  assert.match(text, /\| Orphan Trust \| none \| none \| Steve \(inactive\) \|/);
  assert.match(text, /\| Northern <Rail> Board \| Paula \| Anna \| Firm \(originated by Jay\) \|/);
});

test('content: no notes, ids, dates, sign-in names, user_id or retired columns', () => {
  const { text } = contentBook();
  assert.ok(!text.includes('ZEBRA-NOTE-7731'), 'a note never appears');
  assert.doesNotMatch(text, /confidential settlement/);
  assert.doesNotMatch(text, /424242|Prospect|2026-03-04/);
  assert.doesNotMatch(text, /status|contract|relationship strength|relationship intensity|renewal|strategic fit|time commitment|user_id|username/i);
  // The retired columns' values do not leak into the stickiness either: an
  // unrated client with relationship_intensity 8 still reads "not rated"
  assert.match(clientRows(text).find((r) => r.startsWith('| Acme Holdings |')), /\| not rated \|/);
});

test('content: defaults read as defaults; an unrated client counts under unrated exposure, never as safe (T5)', () => {
  const { model, text } = contentBook();
  const acme = cells(clientRows(text).find((r) => r.startsWith('| Acme Holdings |')));
  const header = cells(text.split('\n').find((l) => l.startsWith('| Client |')));
  const col = (name) => acme[header.indexOf(name)];
  assert.equal(col('Stickiness'), 'not rated');
  assert.equal(col('Cadence'), 'not set');
  assert.equal(col('Conflict risk'), 'not set');
  assert.equal(col('Effort'), '1', 'the default effort is shown, labelled by its cadence');
  assert.equal(col('Revenue 2025'), '—', 'no revenue on file that year');
  assert.equal(col('Revenue 2024'), '—');

  // T5: thin = rated 1 or 2, by lead; not rated counted apart; rated 3 to 5 alone is "safe"
  const { thin, unrated, solid } = model.exposure;
  assert.deepEqual([thin.count, thin.revenue], [2, 90000]);
  assert.deepEqual(thin.byLead.map((e) => [e.person.name, e.count, e.revenue]), [['Kevin', 1, 90000], ['Paula', 1, 0]]);
  assert.deepEqual([unrated.count, unrated.revenue], [1, 50000]);
  assert.deepEqual(unrated.byLead.map((e) => [e.person.name, e.count, e.revenue]), [['Kevin', 1, 50000]]);
  assert.deepEqual([solid.count, solid.revenue], [2, 270000]);
  assert.match(text, /- Rated 1 or 2 \(thin\): 2 clients, \$90,000 in 2026 \(22% of the book's revenue\)\. By lead: Kevin 1 client, \$90,000; Paula 1 client, \$0\./);
  assert.match(text, /- Not rated \(unknown, not safe\): 1 client, \$50,000 in 2026 \(12% of the book's revenue\)\. By lead: Kevin 1 client, \$50,000\./);
  assert.match(text, /- Rated 3 to 5: 2 clients, \$270,000 in 2026/);
  // A client without a lead appears in exposure under "no lead"
  const noLead = buildBook({ people: PEOPLE, clients: CONTENT_CLIENTS.map((c) => (c.id === 14 ? { ...c, stickiness: 2 } : c)), now: NOW });
  assert.match(noLead.text, /By lead: Kevin 1 client, \$90,000; Paula 1 client, \$0; no lead 1 client, \$20,000\./);
});

test('content: the legend states the labels, the effort share, the defaults and the scorer\'s formula', () => {
  const { text } = contentBook();
  for (const label of ["5 Personal bond (won't leave)", '4 Strong, established', '3 Solid but transactional', '2 New / still shallow', '1 Cold (never met in person)']) {
    assert.ok(text.includes(label), label);
  }
  assert.match(text, /its second chair 20% of it\. Client counts and revenue count in full for both chairs\./);
  assert.match(text, /Daily 5, Weekly 3, Monthly 2, Quarterly 1, As-Needed 0\.5\. A handful \(every interaction is heavy\) multiplies it by 1\.5\./);
  assert.match(text, /Strategic value \(0 to 10\) = revenue score × 0\.5 \+ stickiness score × 0\.5 − conflict penalty/);
  assert.match(text, /÷ \$50,000, at most 10/);
  assert.match(text, /Stickiness score = \(pick − 1\) ÷ 4 × 10\. Conflict penalty: High 3, Medium 1, Low 0\./);
  assert.match(text, /cadence "not set" \(effort 1, and 1\.5 with a handful\)/);
  assert.match(text, /Clients not rated are counted separately and are never counted as safe\./);

  // The formula the legend states is the scorer's: a weight change in
  // utils/strategic.cjs fails here until the legend follows
  const legend = (revenue, pick, conflict) => Math.max(0, Math.min(10,
    Math.min(10, revenue / 50000) * 0.5 + ((pick - 1) / 4) * 10 * 0.5 - { High: 3, Medium: 1, Low: 0 }[conflict]));
  for (const revenue of [0, 25000, 100000, 499999, 500000, 2000000]) {
    for (const pick of [1, 2, 3, 4, 5]) {
      for (const conflict of ['Low', 'Medium', 'High']) {
        const client = { stickiness: pick, conflict_risk: conflict, revenues: [{ year: 2026, revenue_amount: revenue }] };
        assertClose(strategic.calculateStrategicValue(client), legend(revenue, pick, conflict), `${revenue} ${pick} ${conflict}`);
      }
    }
  }
  assert.equal(strategic.getEffort({}), 1, 'the default effort the legend states');
  assert.equal(strategic.getEffort({ high_maintenance: true }), 1.5);
});

test('content: an inactive person holding a seat is listed and marked inactive; an inactive person without one is not', () => {
  const { text, peopleCount, model } = contentBook();
  assert.match(text, /^\| Steve \(inactive\) \|/m);
  const extra = buildBook({ people: [...PEOPLE, person(11, 'Gone', 'associate', false)], clients: CONTENT_CLIENTS, now: NOW });
  assert.doesNotMatch(extra.text, /Gone/);
  // Nine active people and Steve
  assert.equal(peopleCount, 10);
  assert.equal(model.listed.length, 10);
  assert.match(text, /## People \(9 active people, and 1 inactive person who still holds a seat\)/);
});

test('content: each person\'s row carries the lead book and second-chair load with the page\'s figures', () => {
  const { text } = buildBook({ people: PEOPLE, clients: CLIENTS, now: NOW });
  // The fixture book: Kevin leads 2 ($100,000, effort 7.5), seconds 1 ($20,000, effort 0.4)
  assert.match(text, /^\| Kevin \| 2 \(2\.4×\) \| \$100,000 \(3\.8×\) \| 7\.5 \(3\.6×\) \| \$13,333 \| 1 \(6\.0×\) \| \$20,000 \(6\.0×\) \| 0\.4 \(6\.0×\) \| none \|$/m);
  assert.match(text, /^\| Jay \| n\/a \| n\/a \| n\/a \| n\/a \| 1 \(—\) \| \$60,000 \(—\) \| 0\.6 \(—\) \| none \|$/m);
  assert.match(text, /^Average over the active partners \(6\): lead clients 0\.8, revenue led \$26,667, lead effort 2\.1; /m);
  assert.match(text, /- With a lead and no second chair \(1\): Client 5\./);
  assert.match(text, /- Without a lead \(1; they count in no one's book\): Client 7\./);
  assert.match(text, /^\| 2025 \| \$70,000 \| 2 \|$/m);
  assert.match(text, /^\| 2026 \| \$165,000 \| 6 \|$/m);
});

test('an empty book renders a short text that says so', () => {
  const empty = buildBook({ people: PEOPLE, clients: [], now: NOW });
  assert.equal(empty.text, '# The book\n\nThe book has no clients yet, so there is nothing to show for 2026.\n');
  assert.deepEqual([empty.clientCount, empty.reportingYear, empty.chars, empty.estimatedTokens], [0, 2026, empty.text.length, Math.round(empty.text.length / 4)]);
});

test('buildBook: the size is characters, and the token figure is characters ÷ 4, rounded', () => {
  const built = contentBook();
  assert.equal(built.chars, built.text.length);
  assert.equal(built.estimatedTokens, Math.round(built.text.length / 4));
  assert.equal(book.CHARS_PER_TOKEN, 4);
  assert.equal(book.estimateTokens('abcdef'), 2);
});
