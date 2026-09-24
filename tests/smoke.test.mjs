// Smoke test: proves the runner works and freezes the current scoring formula.
// Import CommonJS modules with a default import. Never import db.cjs, data.cjs,
// models/*, or utils/jwt.cjs here: they throw at load time without
// DATABASE_URL / JWT_SECRET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import strategic from '../utils/strategic.cjs';

test('calculateStrategicValue: $250k revenue, stickiness 4, Low conflict scores 6.25', () => {
  const client = {
    revenues: [{ year: 2025, revenue_amount: 250000 }],
    stickiness: 4,
    conflict_risk: 'Low',
  };
  // Same call shape as calculateStrategicScores: the revenue rows are passed
  // explicitly.
  const value = strategic.calculateStrategicValue(client, client.revenues);
  // revenueScore 5.0 * 0.5 + stickiness 7.5 * 0.5 - conflict 0 = 6.25
  assert.equal(value, 6.25);
});

test('calculateStrategicValue(client) with one argument honours client.revenues', () => {
  const client = {
    revenues: [{ year: 2025, revenue_amount: 250000 }],
    stickiness: 4,
    conflict_risk: 'Low',
  };
  // WP1 dropped the `revenues = []` default, which used to shadow
  // client.revenues and score the revenue as 0 (see the WP0 PR notes).
  assert.equal(strategic.calculateStrategicValue(client), 6.25);
});
