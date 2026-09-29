// Succession metrics on the server (docs/plans/tier-2.md, S11, WP7):
// utils/succession.cjs, which every client response and the transition plan
// use, and the page's copy in src/utils/successionUtils.js, which the client
// form's preview uses (and a page served by an API older than WP7). First the
// rules as Jeff approved them, each change against the page's old rules; then
// parity, figure for figure, on the fixture books and 300 seeded random
// books, from a client as the API sends it and from its entry in the book;
// then the form's preview against what the save returns.
// Pure: never import db.cjs, data.cjs, models/*, a route file or utils/jwt.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import succession from '../utils/succession.cjs';
import strategic from '../utils/strategic.cjs';
import book from '../utils/book.cjs';
import clientRules from '../utils/clientRules.cjs';
import {
  enhanceClientWithSuccessionMetrics,
  successionInputs as pageInputs,
  practiceAreasOf as pagePracticeAreasOf,
  COMPLEX_AREAS as PAGE_COMPLEX_AREAS,
  stickinessNotRated,
} from '../src/utils/successionUtils.js';
import { MAX_EFFORT as PAGE_MAX_EFFORT, UNRATED_STICKINESS as PAGE_UNRATED } from '../src/utils/clientMetrics.js';
import { clientFormData, clientRequestBody, revenuesToSend } from '../src/utils/clientForm.js';
import { sanitizeFormData } from '../src/utils/validation.js';
import { toPersonId } from '../src/utils/people.js';
import { PEOPLE as FIXTURE_PEOPLE, CLIENTS as FIXTURE_CLIENTS } from './fixtures/books.mjs';

const {
  successionMetrics,
  bookEntryMetrics,
  withSuccessionMetrics,
  successionInputs,
  metricsOf,
  practiceAreasOf,
  MAX_EFFORT,
  COMPLEX_AREAS,
  RELATIONSHIP_TYPES,
} = succession;
const { calculateStrategicScores, UNRATED_STICKINESS } = strategic;

const METRICS = ['relationshipType', 'transitionComplexity', 'successionRisk'];
const pick3 = (c) => Object.fromEntries(METRICS.map((k) => [k, c[k]]));
const page = (client) => pick3(enhanceClientWithSuccessionMetrics(client));

// People as the API nests them
const P = (id, name, role = 'partner', active = true) => ({ id, name, role, active });
const KEVIN = P(4, 'Kevin');
const PAULA = P(6, 'Paula');
const ANNA = P(8, 'Anna', 'associate');
const PEOPLE = [P(1, 'Brendan'), P(2, 'Jeff'), P(3, 'Joe'), KEVIN, P(5, 'Mike'), PAULA, P(7, 'Jay', 'emeritus'), ANNA, P(9, 'Ben', 'associate')];
const byId = new Map(PEOPLE.map((p) => [p.id, p]));

/**
 * A client as GET /api/data/clients sends it (toApiClient, then
 * calculateStrategicScores): the people nested and as ids, the legacy text
 * as stored (a client with a lead has it written from the people).
 */
function apiClient(fields = {}) {
  const row = {
    id: 1,
    name: 'Client',
    practice_area: [],
    conflict_risk: 'Medium',
    interaction_frequency: 'Monthly',
    stickiness: null,
    high_maintenance: false,
    lead_id: null,
    second_chair_id: null,
    originator_id: null,
    originator_is_firm: false,
    primary_lobbyist: '',
    lobbyist_team: [],
    client_originator: '',
    revenues: [],
    ...fields,
  };
  const client = {
    ...row,
    lead: byId.get(row.lead_id) ?? null,
    secondChair: byId.get(row.second_chair_id) ?? null,
    originator: byId.get(row.originator_id) ?? null,
    practiceArea: Array.isArray(row.practice_area) ? row.practice_area : [],
    conflictRisk: row.conflict_risk || 'Medium',
  };
  return calculateStrategicScores([client])[0];
}

// A client's metrics, from the server's module, with the page's agreeing
function both(fields) {
  const client = apiClient(fields);
  const server = successionMetrics(client);
  assert.deepEqual(page(client), server, `the page's module on ${JSON.stringify(fields)}`);
  return server;
}

/* ------------------------------------------------------------------------ */
/*                        The rules (S11, WP7's four)                        */
/* ------------------------------------------------------------------------ */

test('rule 1: the relationship type reads the people by id, never the legacy text', () => {
  const type = (fields) => both(fields).relationshipType;
  // Orphaned: no lead, even when the client keeps its stored legacy text (P6).
  // Until WP7 this client was primary: primary_lobbyist equalled client_originator
  assert.equal(type({ primary_lobbyist: 'Kevin', lobbyist_team: ['Kevin'], client_originator: 'Kevin' }), 'orphaned');
  assert.equal(type({ primary_lobbyist: 'Kevin', lobbyist_team: ['Kevin', 'Anna'], stickiness: 5 }), 'orphaned', 'not shared either');
  assert.equal(type({}), 'orphaned');

  // Primary: the lead is the recorded originator and there is no second chair
  assert.equal(type({ lead_id: 4, originator_id: 4 }), 'primary');
  // ... whatever the firm credit says (P4: the person stays recorded). Until
  // WP7 this was secondary: the legacy text said `Firm`, never the lead's name
  assert.equal(type({ lead_id: 4, originator_id: 4, originator_is_firm: true, client_originator: 'Firm' }), 'primary');
  // A firm credit with no originator recorded is not primary
  assert.equal(type({ lead_id: 4, originator_is_firm: true, client_originator: 'Firm' }), 'secondary');
  assert.equal(type({ lead_id: 4, originator_id: 6 }), 'secondary', 'someone else originated it');
  assert.equal(type({ lead_id: 4 }), 'secondary', 'no originator recorded');
  // A second chair takes it out of primary, at any stickiness below 7
  assert.equal(type({ lead_id: 4, originator_id: 4, second_chair_id: 8, stickiness: 3 }), 'secondary');

  // Shared: a second chair and stickiness 7 or more of 10, which is picks 4 and 5
  assert.equal(type({ lead_id: 4, second_chair_id: 8, stickiness: 4 }), 'shared');
  assert.equal(type({ lead_id: 4, second_chair_id: 8, stickiness: 5, originator_id: 4 }), 'shared');
  assert.equal(type({ lead_id: 4, second_chair_id: 8, stickiness: 3 }), 'secondary', '5 of 10');
  assert.equal(type({ lead_id: 4, second_chair_id: 8, stickiness: null }), 'secondary', 'an unrated client is never shared');
  assert.equal(type({ lead_id: 4, stickiness: 5 }), 'secondary', 'no second chair, not shared');
  // The legacy team text no longer counts: a lead and a stale two-name team
  // without a second chair is not shared
  assert.equal(type({ lead_id: 4, stickiness: 5, lobbyist_team: ['Kevin', 'Anna'] }), 'secondary');

  assert.deepEqual(RELATIONSHIP_TYPES, ['primary', 'secondary', 'shared', 'orphaned']);
});

test('rule 1: primary and shared are disjoint, and every client gets exactly one type', () => {
  for (const second of [null, 8]) {
    for (const originator of [null, 4, 6]) {
      for (const stickiness of [null, 1, 2, 3, 4, 5]) {
        const t = both({ lead_id: 4, second_chair_id: second, originator_id: originator, stickiness }).relationshipType;
        assert.ok(RELATIONSHIP_TYPES.includes(t));
        if (t === 'primary') assert.equal(second, null);
        if (t === 'shared') assert.equal(second, 8);
      }
    }
  }
});

test('rule 2: cadence counts once, through effort; an As-Needed client with nothing else scores 0', () => {
  const complexity = (fields) => both({ lead_id: 4, ...fields }).transitionComplexity;
  // effort ÷ 7.5 × 10 × 0.3 is 0.4 × effort. Until WP7 the cadence also added
  // 3, 2, 1, 0.5 or 0 on its own
  const byCadence = {
    Daily: 2, // 5 × 0.4 = 2 (was 5)
    Weekly: 1, // 1.2 (was 3)
    Monthly: 1, // 0.8 (was 2)
    Quarterly: 0, // 0.4 (was 1: 0.9)
    'As-Needed': 0, // 0.2 (was 0)
    '': 0, // unset: effort 1, 0.4 (was 0)
  };
  for (const [cadence, expected] of Object.entries(byCadence)) {
    assert.equal(complexity({ interaction_frequency: cadence }), expected, cadence || 'unset');
  }
  assert.equal(complexity({ interaction_frequency: 'Daily', high_maintenance: true }), 3, 'effort 7.5, the most: 3');
  assert.equal(complexity({ interaction_frequency: 'Quarterly', high_maintenance: true }), 1, 'effort 1.5: 0.6 rounds to 1');
  // The column is interaction_frequency; a field no client has does not count
  assert.equal(complexity({ interaction_frequency: null, communication_frequency: 'Daily' }), 0);
  assert.equal(MAX_EFFORT, 7.5);
  assert.equal(PAGE_MAX_EFFORT, MAX_EFFORT);
});

test('complexity: a complex practice area adds 1.5, High conflict risk 1; the label is read, not a number; the cap and rounding as before', () => {
  const complexity = (fields) => both({ lead_id: 4, interaction_frequency: 'Monthly', ...fields }).transitionComplexity;
  assert.equal(complexity({}), 1);
  assert.equal(complexity({ practice_area: ['Healthcare'] }), 2, '0.8 + 1.5 = 2.3');
  assert.equal(complexity({ practice_area: ['Energy', 'Municipal'] }), 2);
  assert.equal(complexity({ conflict_risk: 'High' }), 2, '0.8 + 1 = 1.8');
  assert.equal(complexity({ conflict_risk: 'high' }), 2, 'regardless of case');
  assert.equal(complexity({ conflict_risk: 'Low' }), 1);
  assert.equal(complexity({ conflict_risk: '9' }), 1, 'a number is not a conflict label');
  assert.equal(complexity({ practice_area: ['Healthcare'], conflict_risk: 'High' }), 3, '3.3');
  assert.equal(complexity({ interaction_frequency: 'Daily', high_maintenance: true, practice_area: ['Energy'], conflict_risk: 'High' }), 6, '3 + 1.5 + 1 = 5.5, the most any client reaches');
});

test('complexity: Financial, the form\'s practice area, is not a complex area, as it never was (Jeff\'s call; WP7\'s PR)', () => {
  assert.deepEqual(COMPLEX_AREAS, ['healthcare', 'energy', 'financial services']);
  assert.deepEqual(PAGE_COMPLEX_AREAS, COMPLEX_AREAS);
  assert.ok(clientRules.PRACTICE_AREAS.includes('Financial'));
  assert.ok(!clientRules.PRACTICE_AREAS.some((a) => a.toLowerCase().includes('financial services')), 'no vocabulary value holds it');
  const complexity = (areas) => both({ lead_id: 4, interaction_frequency: 'Monthly', practice_area: areas }).transitionComplexity;
  assert.equal(complexity(['Financial']), 1, 'no 1.5');
  assert.equal(complexity(['Financial Services']), 2, 'text holding it still counts (none since WP4\'s vocabulary)');
  // Which vocabulary values count at all
  const counted = clientRules.PRACTICE_AREAS.filter((a) => complexity([a]) === 2);
  assert.deepEqual(counted, ['Healthcare', 'Energy']);
});

test('rule 3: practice areas from practiceArea or practice_area, through one helper on each side', () => {
  const areas = ['Healthcare'];
  for (const client of [{ practiceArea: areas }, { practice_area: areas }, { practiceArea: areas, practice_area: [] }]) {
    assert.deepEqual(practiceAreasOf(client), areas, JSON.stringify(client));
    assert.deepEqual(pagePracticeAreasOf(client), areas, JSON.stringify(client));
  }
  for (const value of [null, undefined, '', 7, {}]) {
    assert.deepEqual(practiceAreasOf({ practice_area: value }), [], String(value));
    assert.deepEqual(pagePracticeAreasOf({ practice_area: value }), [], String(value));
  }
  assert.deepEqual(practiceAreasOf({ practice_area: 'Energy' }), ['Energy'], 'one text');
  assert.deepEqual(pagePracticeAreasOf({ practice_area: 'Energy' }), ['Energy']);
  assert.deepEqual(practiceAreasOf({ practiceArea: ['Energy', null, '', 3] }), ['Energy']);
  assert.deepEqual(pagePracticeAreasOf({ practiceArea: ['Energy', null, '', 3] }), ['Energy']);

  // The form holds practiceArea only. Until WP7 its preview read practice_area,
  // so a complex area never counted there
  const form = { lead_id: '4', practiceArea: ['Healthcare'], interaction_frequency: 'Monthly', stickiness: null };
  assert.equal(enhanceClientWithSuccessionMetrics(form).transitionComplexity, 2);
  assert.equal(successionMetrics(form).transitionComplexity, 2);
});

test('rule 4: an unrated client\'s stickiness term is the stand-in, exactly 40 / 9; both sides read the raw pick, never the rounded stickinessScore', () => {
  assert.equal(UNRATED_STICKINESS, 40 / 9);
  assert.equal(PAGE_UNRATED, UNRATED_STICKINESS);
  const unrated = apiClient({ lead_id: 4, stickiness: null });
  assert.equal(unrated.stickinessScore, 4.44, 'the API rounds it');
  assert.equal(successionInputs(unrated).stickiness, 40 / 9, 'the server reads the pick');
  assert.equal(pageInputs(unrated).stickiness, 40 / 9, 'and so does the page, whatever stickinessScore says');
  assert.equal(pageInputs({ ...unrated, stickinessScore: 9 }).stickiness, 40 / 9);
  // Secondary 2, stickiness 6 − 40/9 = 1.556, complexity 1 × 0.3: 3.856 rounds to 4
  assert.deepEqual(both({ lead_id: 4, stickiness: null }), { relationshipType: 'secondary', transitionComplexity: 1, successionRisk: 4 });
  // Picks 1 to 5 are 0, 2.5, 5, 7.5, 10 of 10; below 6 adds (6 − stickiness)
  const risk = (stickiness) => both({ lead_id: 4, stickiness }).successionRisk;
  assert.deepEqual([1, 2, 3, 4, 5].map(risk), [8, 6, 3, 2, 2]);

  // The page tells Stage 2 an unrated client's risk rests on the stand-in
  assert.equal(stickinessNotRated(unrated), true);
  assert.equal(stickinessNotRated({ stickiness: undefined }), true);
  assert.equal(stickinessNotRated({ stickiness: 3 }), false);
  assert.equal(stickinessNotRated({ stickiness: '3' }), false, 'as the scorer reads it');
});

test('rule 4: the rounded 4.44 and the exact 40 / 9 give the same integers for every type and complexity', () => {
  for (const type of RELATIONSHIP_TYPES) {
    for (let complexity = 0; complexity <= 10; complexity += 1) {
      const inputs = { leadId: '4', secondChairId: null, originatorId: null, effort: 1, practiceAreas: [], conflictRisk: 'Low' };
      const exact = succession.successionRiskOf({ ...inputs, stickiness: 40 / 9 }, type, complexity);
      const rounded = succession.successionRiskOf({ ...inputs, stickiness: 4.44 }, type, complexity);
      assert.equal(exact, rounded, `${type}, complexity ${complexity}`);
    }
  }
});

test('rounding: sums at x.5 round as the page always rounded them, on both sides', () => {
  // A pick of 2 (2.5 of 10) with complexity 0: 2 + 3.5 + 0 = 5.5, rounds up to 6
  assert.deepEqual(both({ lead_id: 4, originator_id: 6, stickiness: 2, interaction_frequency: 'As-Needed' }),
    { relationshipType: 'secondary', transitionComplexity: 0, successionRisk: 6 });
  // Daily without the handful flag: 5 ÷ 7.5 × 10 × 0.3 is 1.9999999999999998
  // in floating point, and with a complex area and High conflict risk the sum
  // is 4.5 exactly: complexity 5. Shared with pick 4: 1 + 0 + 5 × 0.3 = 2.5,
  // which rounds up to 3
  assert.equal((5 / 7.5) * 10 * 0.3, 1.9999999999999998);
  assert.deepEqual(both({ lead_id: 4, second_chair_id: 8, stickiness: 4, interaction_frequency: 'Daily', practice_area: ['Healthcare'], conflict_risk: 'High' }),
    { relationshipType: 'shared', transitionComplexity: 5, successionRisk: 3 });
  // The same client with a complex area only: 1.9999999999999998 + 1.5 is 3.5, rounds to 4
  assert.equal(both({ lead_id: 4, interaction_frequency: 'Daily', practice_area: ['Energy'] }).transitionComplexity, 4);
  // Orphaned with pick 1: 5 + 6 + 0.3 = 11.3, capped at 10
  assert.equal(both({ stickiness: 1, interaction_frequency: 'Weekly' }).successionRisk, 10);
});

/* ------------------------------------------------------------------------ */
/*                                  Parity                                   */
/* ------------------------------------------------------------------------ */

// A seeded generator (mulberry32), as tests/book.test.mjs
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
const choose = (rand, list) => list[Math.floor(rand() * list.length)];
const CADENCES = [...clientRules.CADENCES, '', null];
const AREAS = [...clientRules.PRACTICE_AREAS, 'Financial Services'];
const hex = (rand, n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

/** A random book as the API sends it: people as ids and nested, every field a write allows, legacy text as stored. */
function randomBook(seed) {
  const rand = rng(seed);
  const people = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, i) =>
    P(i + 1, `Person ${i + 1}`, i === 0 ? 'partner' : choose(rand, ['partner', 'partner', 'emeritus', 'associate']), rand() > 0.15));
  const partners = people.filter((p) => p.role === 'partner');
  const uuids = rand() > 0.5;
  const clients = Array.from({ length: Math.floor(rand() * 40) }, (_, i) => {
    const lead = rand() < 0.15 ? null : choose(rand, partners);
    const others = people.filter((p) => p.id !== lead?.id);
    const secondChair = lead && rand() < 0.6 ? choose(rand, others) : null;
    const originator = rand() < 0.3 ? null : rand() < 0.4 ? lead : choose(rand, people);
    const revenues = [2024, 2025, 2026].filter(() => rand() < 0.6)
      .map((year) => ({ year, revenue_amount: String(Math.round(rand() * 60000000) / 100) }));
    const row = {
      id: uuids ? `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-8${hex(rand, 3)}-${hex(rand, 12)}` : 100 + i,
      name: `Client ${i}`,
      practice_area: rand() < 0.1 ? null : AREAS.filter(() => rand() < 0.15),
      conflict_risk: choose(rand, ['Low', 'Medium', 'High', null]),
      interaction_frequency: choose(rand, CADENCES),
      stickiness: rand() < 0.3 ? null : 1 + Math.floor(rand() * 5),
      high_maintenance: rand() < 0.3,
      lead_id: lead ? lead.id : null,
      second_chair_id: secondChair ? secondChair.id : null,
      originator_id: originator ? originator.id : null,
      originator_is_firm: rand() < 0.3,
      // A client without a lead keeps whatever legacy text it had (P6)
      primary_lobbyist: lead ? lead.name : choose(rand, ['', 'Old Partner']),
      lobbyist_team: lead ? [lead, secondChair].filter(Boolean).map((p) => p.name) : choose(rand, [[], ['Old Partner', 'Other']]),
      client_originator: rand() < 0.5 ? 'Old Partner' : '',
      revenues,
    };
    const client = {
      ...row,
      lead,
      secondChair,
      originator,
      practiceArea: Array.isArray(row.practice_area) ? row.practice_area : [],
      conflictRisk: row.conflict_risk || 'Medium',
    };
    return calculateStrategicScores([client])[0];
  });
  const now = new Date(Date.UTC(2026, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)));
  return { people, clients, now };
}

function assertParity(people, clients, now, label) {
  const entries = new Map(book.bookModel({ people, clients, now }).clients.map((e) => [String(e.id), e]));
  for (const client of clients) {
    const server = successionMetrics(client);
    const who = `${label}, client ${client.id}`;
    assert.deepEqual(page(client), server, `${who}: the page's module`);
    // The same client before it was scored: effort from the cadence on both
    // sides, which is the effort it carries when the scorer set it (the
    // fixture book's efforts are set by hand)
    const { effort, stickinessScore, strategicValue, averageRevenue, ...raw } = client;
    assert.deepEqual(page(raw), successionMetrics(raw), `${who}: unscored`);
    if (effort === strategic.getEffort(client)) assert.deepEqual(successionMetrics(raw), server, `${who}: unscored, as scored`);
    // The transition plan's path: the book's entry for the client
    assert.deepEqual(bookEntryMetrics(entries.get(String(client.id))), server, `${who}: the book's entry`);
    // Rule 4: the API's rounded stickinessScore would give the same integers
    if (typeof stickinessScore === 'number') {
      assert.deepEqual(metricsOf({ ...successionInputs(client), stickiness: stickinessScore }), server, `${who}: 4.44 against 40 / 9`);
    }
  }
}

test('parity: the fixture book of tests/fixtures/books.mjs, on both sides and from the book\'s entries', () => {
  // The fixture's clients carry nested people and a precomputed effort, no ids, pick or cadence
  assertParity(FIXTURE_PEOPLE, FIXTURE_CLIENTS, new Date('2026-09-26T12:00:00Z'), 'fixture');
  assert.deepEqual(FIXTURE_CLIENTS.map((c) => successionMetrics(c).relationshipType),
    ['secondary', 'secondary', 'secondary', 'secondary', 'secondary', 'orphaned']);
  // The same clients as the API scores them, with picks and cadences
  const scored = FIXTURE_CLIENTS.map((c, i) => calculateStrategicScores([{
    ...c, lead_id: c.lead?.id ?? null, second_chair_id: c.secondChair?.id ?? null, originator: c.lead, originator_id: c.lead?.id ?? null,
    stickiness: [5, 4, null, 2, 1, 3][i], interaction_frequency: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed', null][i],
    practiceArea: [['Healthcare'], [], ['Energy'], ['Financial'], [], ['Healthcare']][i], conflict_risk: ['High', 'Low', 'Medium', 'High', 'Low', null][i],
  }])[0]);
  assertParity(FIXTURE_PEOPLE, scored, new Date('2026-09-26T12:00:00Z'), 'fixture, scored');
  assert.deepEqual(scored.map(successionMetrics), [
    { relationshipType: 'shared', transitionComplexity: 5, successionRisk: 3 },
    { relationshipType: 'shared', transitionComplexity: 1, successionRisk: 1 },
    { relationshipType: 'secondary', transitionComplexity: 2, successionRisk: 4 },
    { relationshipType: 'primary', transitionComplexity: 1, successionRisk: 7 },
    { relationshipType: 'secondary', transitionComplexity: 0, successionRisk: 8 },
    { relationshipType: 'orphaned', transitionComplexity: 2, successionRisk: 7 },
  ]);
});

test('parity: 300 seeded random books, figure for figure, from the API\'s clients, unscored clients and the book\'s entries', () => {
  let clients = 0;
  const seen = { types: new Set(), complexity: new Set(), risk: new Set() };
  for (let seed = 1; seed <= 300; seed += 1) {
    const { people, clients: book1, now } = randomBook(seed);
    assertParity(people, book1, now, `seed ${seed}`);
    clients += book1.length;
    for (const c of book1) {
      const m = successionMetrics(c);
      seen.types.add(m.relationshipType);
      seen.complexity.add(m.transitionComplexity);
      seen.risk.add(m.successionRisk);
    }
  }
  assert.ok(clients > 5000, `${clients} clients`);
  // The books reach every type and the ends of both scales
  assert.deepEqual([...seen.types].sort(), ['orphaned', 'primary', 'secondary', 'shared']);
  assert.ok(seen.complexity.has(0) && seen.complexity.has(6), [...seen.complexity].join());
  assert.ok(seen.risk.has(1) && seen.risk.has(10), [...seen.risk].join());
});

test('withSuccessionMetrics adds the three metrics and nothing else; the book\'s text is the same with or without them', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const { people, clients, now } = randomBook(seed);
    const withMetrics = withSuccessionMetrics(clients);
    withMetrics.forEach((c, i) => {
      assert.deepEqual(Object.keys(c).sort(), [...new Set([...Object.keys(clients[i]), ...METRICS])].sort());
      assert.deepEqual(pick3(c), successionMetrics(clients[i]));
    });
    // T8: the same data gives the same book, whether the clients carry them or not
    assert.equal(book.buildBook({ people, clients: withMetrics, now }).text, book.buildBook({ people, clients, now }).text, `seed ${seed}`);
  }
  const { text } = book.buildBook({ people: FIXTURE_PEOPLE, clients: withSuccessionMetrics(FIXTURE_CLIENTS), now: new Date('2026-09-26T12:00:00Z') });
  assert.doesNotMatch(text, /orphaned|secondary|[Ss]uccession|[Cc]omplexity/, 'no metric reaches the book');
});

/* ------------------------------------------------------------------------ */
/*                   The client form's preview and the save                  */
/* ------------------------------------------------------------------------ */

// What the API answers after the form saves `form`: the body the store sends
// (sanitizeFormData, toPersonId, revenuesToSend, clientRequestBody), stored
// as POST and PUT store it, then read back as toApiClient and the scorer give
// it, with the server's metrics
function saved(form, id = 7) {
  const sent = sanitizeFormData(form);
  const body = clientRequestBody({
    ...sent,
    lead_id: toPersonId(form.lead_id),
    second_chair_id: toPersonId(form.second_chair_id),
    originator_id: toPersonId(form.originator_id),
    originator_is_firm: form.originator_is_firm === true,
    revenues: revenuesToSend(sent.revenues).revenues,
  });
  return withSuccessionMetrics([apiClient({
    id,
    name: body.name,
    practice_area: body.practice_area,
    conflict_risk: body.conflict_risk,
    interaction_frequency: body.interaction_frequency,
    stickiness: body.stickiness,
    high_maintenance: body.high_maintenance,
    lead_id: body.lead_id,
    second_chair_id: body.second_chair_id,
    originator_id: body.originator_id,
    originator_is_firm: body.originator_is_firm,
    revenues: body.revenues.map((r) => ({ year: r.year, revenue_amount: r.revenue_amount.toFixed(2) })),
  })])[0];
}

// The preview as the form computes it: from its own state
const preview = (form) => page(form);

test('the form\'s preview equals what the save returns: an edit, through clientFormData', () => {
  const stored = apiClient({
    id: 7, name: 'Acme', lead_id: 4, second_chair_id: 8, originator_id: 4, stickiness: 4, interaction_frequency: 'Weekly',
    practice_area: ['Healthcare'], conflict_risk: 'High', revenues: [{ year: 2026, revenue_amount: '40000.00' }],
  });
  const form = clientFormData(stored);
  assert.deepEqual([form.lead_id, form.second_chair_id, form.practiceArea], ['4', '8', ['Healthcare']], 'ids as select values');
  assert.deepEqual(preview(form), pick3(saved(form)));
  assert.deepEqual(preview(form), successionMetrics(stored), 'saved unchanged, the client keeps its figures');

  // Each change the partner can make moves the preview as the save moves the client
  const edits = [
    { second_chair_id: '' },
    { stickiness: null },
    { stickiness: 1 },
    { originator_id: '', originator_is_firm: true },
    { second_chair_id: '', originator_is_firm: true },
    { lead_id: '6', second_chair_id: '' },
    { lead_id: '' , second_chair_id: '' },
    { interaction_frequency: 'Daily', high_maintenance: true },
    { practiceArea: ['Financial', 'Energy'] },
    { practiceArea: [], conflict_risk: 'Low', interaction_frequency: 'As-Needed' },
  ];
  for (const edit of edits) {
    const changed = { ...form, ...edit };
    assert.deepEqual(preview(changed), pick3(saved(changed)), JSON.stringify(edit));
  }
});

// WP6's candidate (a) (docs/plans/tier-2.md): the form filled a client with no
// cadence as As-Needed, so its preview, and the save, halved its effort (the
// unset cadence's 1 to 0.5) and could drop its complexity. It opens as Not
// set now: the preview is the client's own figures, and a save for another
// reason keeps them. Stored NULL (a POST without the field) or '' (the import)
test('the form\'s preview equals what the save returns: a client with no cadence stays unset, effort 1 (1.5 a handful), when saved for another reason', () => {
  for (const cadence of [null, '']) {
    for (const [handful, risk, effort, complexity] of [[false, 'Medium', 1, 0], [true, 'Medium', 1.5, 1], [true, 'High', 1.5, 2]]) {
      const label = JSON.stringify({ cadence, handful, risk });
      const stored = apiClient({
        id: 7, name: 'Unset Co', lead_id: 4, stickiness: null, interaction_frequency: cadence, high_maintenance: handful,
        conflict_risk: risk, revenues: [{ year: 2026, revenue_amount: '40000.00' }],
      });
      assert.deepEqual([stored.effort, successionMetrics(stored).transitionComplexity], [effort, complexity], label);
      const form = clientFormData(stored);
      assert.equal(form.interaction_frequency, '', label);
      assert.equal(pageInputs(form).effort, effort, `${label}: the preview's effort`);
      assert.deepEqual(preview(form), successionMetrics(stored), `${label}: opened, the client's own figures`);
      // Saved with only its Stickiness changed
      const rated = { ...form, stickiness: 4 };
      const after = saved(rated);
      assert.deepEqual([after.interaction_frequency, after.effort, after.transitionComplexity], ['', effort, complexity], `${label}: saved`);
      assert.deepEqual(preview(rated), pick3(after), `${label}: saved`);
    }
  }
});

test('the form\'s preview equals what the save returns: a new client, from an empty form', () => {
  const empty = clientFormData({}, new Date('2026-09-29T12:00:00Z'));
  assert.deepEqual(preview(empty), { relationshipType: 'orphaned', transitionComplexity: 0, successionRisk: 7 }, 'no lead yet');
  const filled = { ...empty, name: 'New Co', lead_id: '6', originator_id: '6', stickiness: 5, practiceArea: ['Energy'],
    interaction_frequency: 'Monthly', revenues: [{ year: 2026, revenue_amount: '12000' }] };
  assert.deepEqual(preview(filled), { relationshipType: 'primary', transitionComplexity: 2, successionRisk: 4 });
  assert.deepEqual(preview(filled), pick3(saved(filled)));
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = rng(seed);
    const id = () => (rand() < 0.3 ? '' : String(choose(rand, PEOPLE).id));
    const lead = rand() < 0.2 ? '' : String(choose(rand, PEOPLE.filter((p) => p.role === 'partner')).id);
    const second = id();
    const form = {
      ...empty,
      name: `Form ${seed}`,
      lead_id: lead,
      second_chair_id: second === lead ? '' : second,
      originator_id: id(),
      originator_is_firm: rand() < 0.3,
      stickiness: rand() < 0.3 ? null : 1 + Math.floor(rand() * 5),
      interaction_frequency: choose(rand, ['', ...clientRules.CADENCES]),
      high_maintenance: rand() < 0.3,
      practiceArea: clientRules.PRACTICE_AREAS.filter(() => rand() < 0.2),
      conflict_risk: choose(rand, clientRules.CONFLICT_RISKS),
    };
    assert.deepEqual(preview(form), pick3(saved(form)), `seed ${seed}`);
    assert.deepEqual(preview(form), successionMetrics(form), `seed ${seed}: the server's module on the form's state`);
  }
});
