// Score regression (docs/plans/tier-0.md, D6): strategic value keeps using each
// client's own latest revenue year. This fixture stands in for the database
// dump in the WP1 acceptance list when no Postgres is available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import strategic from '../utils/strategic.cjs';
import {
  UNRATED_STICKINESS as PAGE_UNRATED_STICKINESS,
  CONFLICT_PENALTY as PAGE_CONFLICT_PENALTY,
  REVENUE_WEIGHT as PAGE_REVENUE_WEIGHT,
  STICKINESS_WEIGHT as PAGE_STICKINESS_WEIGHT,
  mostRecentRevenue,
  resolveStickinessScore,
  resolveStrategicValue,
  strategicValueParts,
} from '../src/utils/clientMetrics.js';
import { CLIENTS as BOOK_CLIENTS } from './fixtures/books.mjs';

// The WP0 fixture, plus a client whose rows span 2025 and 2026.
const FIXTURE = [
  {
    name: 'WP0 client',
    revenues: [{ year: 2025, revenue_amount: 250000 }],
    stickiness: 4,
    conflict_risk: 'Low',
  },
  {
    name: 'Two-year client',
    revenues: [
      { year: 2025, revenue_amount: 100000 },
      { year: 2026, revenue_amount: 250000 },
    ],
    stickiness: 4,
    conflict_risk: 'Low',
  },
  {
    name: 'Rows out of order, strings from jsonb',
    revenues: [
      { year: '2026', revenue_amount: '60000.00' },
      { year: '2024', revenue_amount: '500000.00' },
    ],
    stickiness: 2,
    conflict_risk: 'High',
  },
];

test('the client\'s latest revenue year drives the score, whatever the reporting year', () => {
  const [wp0, twoYear, unordered] = FIXTURE;
  assert.equal(strategic.calculateStrategicValue(wp0, wp0.revenues), 6.25);
  // 2026's $250k → revenueScore 5.0; with 2025's $100k it would be 2.0 → 4.75
  assert.equal(strategic.calculateStrategicValue(twoYear, twoYear.revenues), 6.25);
  assert.equal(strategic.getMostRecentRevenue(twoYear), 250000);
  // 2026's $60k (1.2 * 0.5 = 0.6) + stickiness 2.5 * 0.5 (1.25) - High 3 → clamped to 0
  assert.equal(strategic.getMostRecentRevenue(unordered), 60000);
  assert.equal(strategic.calculateStrategicValue(unordered, unordered.revenues), 0);
});

test('calculateStrategicScores: the fixture scores are frozen', () => {
  const scored = strategic.calculateStrategicScores(FIXTURE);
  assert.deepEqual(
    scored.map((c) => ({ name: c.name, strategicValue: c.strategicValue, averageRevenue: c.averageRevenue })),
    [
      { name: 'WP0 client', strategicValue: 6.25, averageRevenue: 250000 },
      { name: 'Two-year client', strategicValue: 6.25, averageRevenue: 250000 },
      { name: 'Rows out of order, strings from jsonb', strategicValue: 0, averageRevenue: 60000 },
    ]
  );
});

test('revenueObjectFromRows round-trips every year on file', () => {
  const rows = [
    { year: 2024, revenue_amount: '10.50' },
    { year: 2026, revenue_amount: 0 },
    { year: '2027', revenue_amount: '300' },
  ];
  assert.deepEqual(strategic.revenueObjectFromRows(rows), { 2024: 10.5, 2026: 0, 2027: 300 });
  // the null row jsonb_agg yields for a client with no revenue, and non-arrays
  assert.deepEqual(strategic.revenueObjectFromRows([{ id: null, year: null, revenue_amount: null }]), {});
  assert.deepEqual(strategic.revenueObjectFromRows(null), {});
  assert.deepEqual(strategic.revenueObjectFromRows(undefined), {});
});

test('the revenue object shape scores identically to the rows it came from', () => {
  for (const client of FIXTURE) {
    const objectShaped = {
      stickiness: client.stickiness,
      conflict_risk: client.conflict_risk,
      revenue: strategic.revenueObjectFromRows(client.revenues),
    };
    assert.equal(
      strategic.calculateStrategicValue(objectShaped),
      strategic.calculateStrategicValue(client, client.revenues),
      client.name
    );
  }
});

/* ------------------------------------------------------------------------ */
/*        The retired columns and the unrated stand-in (Tier 2 WP2, S4)     */
/* ------------------------------------------------------------------------ */

// getStickiness as it was until Tier 2 WP2 (at 4a0f2a3), frozen here: the pick,
// else relationship_intensity, else relationship_strength with
// renewal_probability, else 5.
function legacyStickiness(client) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  };
  const explicit = num(client.stickiness);
  if (explicit !== null) return Math.max(0, Math.min(10, ((explicit - 1) / 4) * 10));
  const intensity = num(client.relationship_intensity ?? client.relationshipIntensity);
  if (intensity !== null) return Math.max(0, Math.min(10, ((intensity - 1) / 9) * 10));
  const strength = num(client.relationship_strength ?? client.relationshipStrength);
  const renewal = num(client.renewal_probability ?? client.renewalProbability);
  if (strength !== null || renewal !== null) {
    const sStrength = strength !== null ? ((strength - 1) / 9) * 10 : 5;
    const sRenewal = renewal !== null ? renewal * 10 : 5;
    return Math.max(0, Math.min(10, (sStrength + sRenewal) / 2));
  }
  return 5;
}
// The strategic value with the legacy stickiness and the unchanged weights
function legacyStrategicValue(client) {
  const revenueScore = Math.min(10, strategic.getMostRecentRevenue(client, client.revenues) / 50000);
  const penalty = { High: 3, Medium: 1, Low: 0 }[client.conflict_risk ?? client.conflictRisk ?? 'Medium'] ?? 1;
  return Math.max(0, Math.min(10, revenueScore * 0.5 + legacyStickiness(client) * 0.5 - penalty));
}

// What production's clients hold in the retired columns: the column defaults,
// on all 84 (Jeff's read-only count, 2026-09-27), and what every new row gets
const PRODUCTION_RETIRED = { relationship_intensity: 5, relationship_strength: 5, renewal_probability: '0.70', strategic_fit_score: 5 };

// Every client of the fixture books, and a grid of picks (none included),
// conflict risks and revenues, each stored as the database stores it
function fixtureClients() {
  const grid = [];
  for (const stickiness of [null, undefined, 1, 2, 3, 4, 5, '3']) {
    for (const conflict of ['Low', 'Medium', 'High', null, 'Unknown']) {
      for (const amount of [0, 30000, 250000, 900000]) {
        grid.push({ stickiness, conflict_risk: conflict, revenues: [{ year: 2026, revenue_amount: String(amount) }] });
      }
    }
  }
  return [...FIXTURE, ...BOOK_CLIENTS, ...grid].map((client) => ({ ...client, ...PRODUCTION_RETIRED }));
}

test('no score moves on the fixture books: stored with production\'s retired values, the stand-in scores as relationship_intensity 5 did', () => {
  const clients = fixtureClients();
  const scored = strategic.calculateStrategicScores(clients);
  assert.ok(clients.some((c) => c.stickiness === null || c.stickiness === undefined), 'unrated clients are in the set');
  clients.forEach((client, i) => {
    assert.equal(strategic.getStickiness(client), legacyStickiness(client), JSON.stringify(client));
    assert.equal(strategic.calculateStrategicValue(client), legacyStrategicValue(client), JSON.stringify(client));
    assert.equal(scored[i].strategicValue, Math.round(legacyStrategicValue(client) * 100) / 100);
    assert.equal(scored[i].stickinessScore, Math.round(legacyStickiness(client) * 100) / 100);
  });
  // Exactly the legacy value for relationship_intensity 5, not 4.44
  assert.equal(strategic.UNRATED_STICKINESS, 40 / 9);
  assert.equal(strategic.UNRATED_STICKINESS, ((5 - 1) / 9) * 10);
});

test('the retired columns are not read: an unrated client scores the stand-in whatever they hold, in either spelling', () => {
  for (const retired of [
    {},
    { relationship_intensity: 8, relationship_strength: 7, renewal_probability: 0.93, strategic_fit_score: 6 },
    { relationship_intensity: null, relationship_strength: 1, renewal_probability: 0.1 },
    { relationshipIntensity: 10, relationshipStrength: 10, renewalProbability: 1, strategicFitScore: 10 },
  ]) {
    const client = { stickiness: null, conflict_risk: 'Low', revenues: [{ year: 2026, revenue_amount: 100000 }], ...retired };
    assert.equal(strategic.getStickiness(client), 40 / 9, JSON.stringify(retired));
    assert.equal(strategic.calculateStrategicValue(client), 2 * 0.5 + (40 / 9) * 0.5, JSON.stringify(retired));
  }
  // A pick is read as before, whatever the retired columns hold
  assert.equal(strategic.getStickiness({ stickiness: 4, relationship_intensity: 1 }), 7.5);
});

test('the page\'s stickiness is the server\'s: the same stand-in, and the same score for every pick and none', () => {
  assert.equal(PAGE_UNRATED_STICKINESS, strategic.UNRATED_STICKINESS);
  for (const client of fixtureClients()) {
    assert.equal(resolveStickinessScore(client), strategic.getStickiness(client), JSON.stringify(client));
    // The API's client carries the server's rounded score, which the page prefers
    const [api] = strategic.calculateStrategicScores([client]);
    assert.equal(resolveStickinessScore(api), api.stickinessScore);
  }
  // Raw form state (the client form's live preview), rated and not
  assert.equal(resolveStickinessScore({ stickiness: null, interaction_frequency: 'Weekly' }), 40 / 9);
  assert.equal(resolveStickinessScore({ stickiness: 5 }), 10);
});

/* ------------------------------------------------------------------------ */
/*         The page's mirror of the score (Tier 3 WP6, U21 (a))              */
/* ------------------------------------------------------------------------ */

// docs/plans/tier-3.md, section 14: resolveStrategicValue (src/utils/
// clientMetrics.js) scores Scenarios' hypothetical client, which never
// reaches the API, so the weights live in two places, bound here: the mirror
// equal to calculateStrategicValue on every fixture client in three revenue
// shapes and on 3,000 random clients, the API's rounded figure preferred when
// a client carries one, and the mirror rounded as the API rounds.

// A client in the three revenue shapes the scorer reads: the API's rows, the
// page's `revenue` object, and empty rows beside an object (the rows are then
// nothing to read)
function revenueShapes(client) {
  const { revenues, ...rest } = client;
  const object = strategic.revenueObjectFromRows(revenues);
  return [
    { ...rest, revenues },
    { ...rest, revenue: object },
    { ...rest, revenues: [], revenue: object },
  ];
}

function assertMirror(client, where) {
  assert.equal(mostRecentRevenue(client), strategic.getMostRecentRevenue(client), `${where}: latest year's revenue`);
  assert.equal(mostRecentRevenue(client, client.revenues), strategic.getMostRecentRevenue(client, client.revenues), `${where}: latest year's revenue, rows given`);
  assert.equal(resolveStrategicValue(client), strategic.calculateStrategicValue(client), `${where}: strategic value`);
  assert.equal(resolveStrategicValue(client, client.revenues), strategic.calculateStrategicValue(client, client.revenues), `${where}: strategic value, rows given`);
  // The parts: the exact stickiness, the server's, and the formula from them
  const parts = strategicValueParts(client);
  assert.equal(parts.stickiness, strategic.getStickiness(client), `${where}: stickiness`);
  assert.equal(parts.revenue, strategic.getMostRecentRevenue(client), `${where}: revenue`);
  assert.equal(parts.value, resolveStrategicValue(client), `${where}: the parts' value`);
  // The API's client carries the rounded score, which the page prefers; the
  // mirror rounds to the same figure
  const [api] = strategic.calculateStrategicScores([client]);
  assert.equal(resolveStrategicValue(api), api.strategicValue, `${where}: the API's figure preferred`);
  assert.equal(Math.round(resolveStrategicValue(client) * 100) / 100, api.strategicValue, `${where}: rounded as the API rounds`);
}

test('the page\'s strategic value is the server\'s: the mirror equals calculateStrategicValue on the fixture clients in three revenue shapes, the API\'s rounded figure preferred', () => {
  assert.deepEqual(PAGE_CONFLICT_PENALTY, { High: 3, Medium: 1, Low: 0 });
  assert.equal(PAGE_REVENUE_WEIGHT + PAGE_STICKINESS_WEIGHT, 1);
  let count = 0;
  for (const client of fixtureClients()) {
    for (const shaped of revenueShapes(client)) {
      assertMirror(shaped, JSON.stringify(shaped));
      count += 1;
    }
  }
  assert.ok(count >= 3 * 150, `${count} clients checked`);
  // No revenue at all, the null row jsonb_agg yields, and no object
  for (const bare of [
    { stickiness: 4, conflict_risk: 'Low' },
    { stickiness: null, conflict_risk: 'High', revenues: [{ id: null, year: null, revenue_amount: null }] },
    { stickiness: 2, revenue: {} },
    { stickiness: 2, revenues: null, revenue: null },
  ]) assertMirror(bare, JSON.stringify(bare));
  // Raw form state and the sandbox's client: the raw pick, never a rounded score
  assert.equal(resolveStrategicValue({ stickiness: null, conflict_risk: 'Medium', revenues: [{ year: 2026, revenue_amount: 300000 }] }), 6 * 0.5 + (40 / 9) * 0.5 - 1);
  assert.equal(resolveStrategicValue({ stickiness: 4, conflict_risk: 'Low' }), 7.5 * 0.5);
  assert.equal(resolveStrategicValue({ stickiness: 2, conflict_risk: 'High', revenues: [{ year: 2026, revenue_amount: 30000 }] }), 0, 'kept at 0');
  assert.equal(resolveStrategicValue({ stickiness: 5, conflict_risk: 'Low', revenues: [{ year: 2026, revenue_amount: 900000 }] }), 10, 'kept at 10');
  assert.equal(resolveStrategicValue(null), 0);
});

test('the mirror on 3,000 seeded random clients: text amounts, out-of-range years, ties on year, the camelCase conflict risk and an unknown one', () => {
  let seed = 20261001;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const amount = () => pick([0, 1, 30000, 49999.99, 50000, 250000, 500000, 1000000000, 123.456]);
  for (let run = 0; run < 3000; run += 1) {
    const rows = Array.from({ length: Math.floor(random() * 5) }, () => ({
      year: pick([1800, 2024, 2025, 2026, '2026', 2200, '2025', 'abc', null]),
      revenue_amount: pick([amount(), String(amount()), `${amount()}.00`, 'x', null, '']),
    }));
    const client = {
      name: `R${run}`,
      stickiness: pick([null, undefined, 1, 2, 3, 4, 5, '3', '5', 0, 6, 2.5, 'x', '']),
      interaction_frequency: pick(['Daily', 'Weekly', '', null, 'Hourly']),
      high_maintenance: random() > 0.5,
      ...(random() > 0.5
        ? { conflict_risk: pick(['Low', 'Medium', 'High', null, 'Unknown', '']) }
        : { conflictRisk: pick(['Low', 'Medium', 'High', 'low', undefined]) }),
      ...(random() > 0.2 ? { revenues: rows } : {}),
      ...(random() > 0.6 ? { revenue: Object.fromEntries(rows.filter((r) => Number.isInteger(Number(r.year))).map((r) => [r.year, r.revenue_amount])) } : {}),
    };
    assertMirror(client, `run ${run}: ${JSON.stringify(client)}`);
  }
});
