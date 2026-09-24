// Score regression (docs/plans/tier-0.md, D6): strategic value keeps using each
// client's own latest revenue year. This fixture stands in for the database
// dump in the WP1 acceptance list when no Postgres is available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import strategic from '../utils/strategic.cjs';

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
