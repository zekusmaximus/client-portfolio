// src/utils/successionUtils.js (docs/plans/people-and-second-chair.md,
// Phase 5, the fixes found in the trace): the contact cadence is read from
// interaction_frequency, the column that exists, and conflict risk is a
// Low/Medium/High label, not a number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTransitionComplexity,
  calculateSuccessionRisk,
} from '../src/utils/successionUtils.js';

// Effort 0 and no practice area, so only the factors under test count
const base = { effort: 0, practiceArea: [], stickinessScore: 5 };

test('transition complexity counts the contact cadence from interaction_frequency', () => {
  const at = (cadence) => calculateTransitionComplexity({ ...base, interaction_frequency: cadence });
  assert.equal(at('Daily'), 3);
  assert.equal(at('Weekly'), 2);
  assert.equal(at('Monthly'), 1);
  assert.equal(at('Quarterly'), 1, '0.5 rounds to 1');
  assert.equal(at('As-Needed'), 0);
  assert.equal(at(''), 0);
  assert.equal(calculateTransitionComplexity({ ...base, interactionFrequency: 'Daily' }), 3, 'the camelCase name too');
  // The old read: a field no client has, so the cadence never counted
  assert.equal(calculateTransitionComplexity({ ...base, communication_frequency: 'Daily' }), 0);
});

test('high conflict risk adds to complexity; the label is read, not parseFloat\'ed', () => {
  const at = (extra) => calculateTransitionComplexity({ ...base, interaction_frequency: 'Weekly', ...extra });
  assert.equal(at({ conflict_risk: 'High' }), 3);
  assert.equal(at({ conflict_risk: 'high' }), 3);
  assert.equal(at({ conflictRisk: 'High' }), 3, 'the API also sends conflictRisk');
  assert.equal(at({ conflict_risk: 'Medium' }), 2);
  assert.equal(at({ conflict_risk: 'Low' }), 2);
  assert.equal(at({}), 2);
  assert.equal(at({ conflict_risk: '9' }), 2, 'a number is not a conflict label');
});

test('succession risk follows the fixed complexity', () => {
  const calm = { ...base, conflict_risk: 'Low', interaction_frequency: 'As-Needed', primary_lobbyist: 'Kevin', lobbyist_team: ['Kevin', 'Anna'] };
  const busy = { ...calm, conflict_risk: 'High', interaction_frequency: 'Daily' };
  assert.ok(calculateSuccessionRisk(busy) > calculateSuccessionRisk(calm));
});
