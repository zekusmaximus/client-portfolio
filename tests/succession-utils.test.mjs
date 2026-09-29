// src/utils/successionUtils.js, the page's side of the succession metrics
// (docs/plans/people-and-second-chair.md, Phase 5; docs/plans/tier-2.md,
// WP7). The contact cadence is read from interaction_frequency, the column
// that exists, and counts once, through effort (S11 rule 2); conflict risk is
// a Low/Medium/High label, not a number. Since WP7 the page shows the
// server's figures: the Dashboard's and Stage 1's helpers read what each
// client carries, a 0 included, and compute only for a client from an API
// older than WP7 (withSuccessionMetrics). The rules themselves, and parity
// with the server's module, are in tests/succession.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTransitionComplexity,
  calculateSuccessionRisk,
  enhanceClientWithSuccessionMetrics,
  withSuccessionMetrics,
  groupClientsBySuccessionRisk,
  getHighestRiskClients,
  getSuccessionAnalytics,
} from '../src/utils/successionUtils.js';

// No practice area, so only the factors under test count
const base = { lead_id: 4, practiceArea: [] };

test('transition complexity counts the contact cadence from interaction_frequency, once, through effort', () => {
  const at = (cadence) => calculateTransitionComplexity({ ...base, interaction_frequency: cadence });
  // 0.4 × effort: Daily 5, Weekly 3, Monthly 2, Quarterly 1, As-Needed 0.5, unset 1.
  // Until WP7 the cadence also added 3, 2, 1, 0.5 or 0 on its own
  assert.equal(at('Daily'), 2);
  assert.equal(at('Weekly'), 1);
  assert.equal(at('Monthly'), 1);
  assert.equal(at('Quarterly'), 0);
  assert.equal(at('As-Needed'), 0);
  assert.equal(at(''), 0);
  assert.equal(calculateTransitionComplexity({ ...base, interactionFrequency: 'Daily' }), 2, 'the camelCase name too');
  // A field no client has does not count
  assert.equal(calculateTransitionComplexity({ ...base, communication_frequency: 'Daily' }), 0);
  // The API's effort, when the client carries it, is what counts
  assert.equal(calculateTransitionComplexity({ ...base, interaction_frequency: 'As-Needed', effort: 7.5 }), 3);
});

test('high conflict risk adds to complexity; the label is read, not parseFloat\'ed', () => {
  const at = (extra) => calculateTransitionComplexity({ ...base, interaction_frequency: 'Weekly', ...extra });
  assert.equal(at({ conflict_risk: 'High' }), 2, '1.2 + 1');
  assert.equal(at({ conflict_risk: 'high' }), 2);
  assert.equal(at({ conflictRisk: 'High' }), 2, 'the API also sends conflictRisk');
  assert.equal(at({ conflict_risk: 'Medium' }), 1);
  assert.equal(at({ conflict_risk: 'Low' }), 1);
  assert.equal(at({}), 1);
  assert.equal(at({ conflict_risk: '9' }), 1, 'a number is not a conflict label');
});

test('succession risk follows the complexity', () => {
  const calm = { ...base, second_chair_id: 8, stickiness: 5, conflict_risk: 'Low', interaction_frequency: 'As-Needed' };
  const busy = { ...calm, conflict_risk: 'High', interaction_frequency: 'Daily', high_maintenance: true, practiceArea: ['Energy'] };
  assert.ok(calculateSuccessionRisk(busy) > calculateSuccessionRisk(calm));
});

// A client as the store holds it: the server's figures, which this module
// would not compute (no lead, so it would say orphaned and risk 7 or more)
const fromServer = (id, relationshipType, transitionComplexity, successionRisk) =>
  ({ id, name: `Client ${id}`, lead: null, lead_id: null, stickiness: null, relationshipType, transitionComplexity, successionRisk });

test('the Dashboard\'s and Stage 1\'s helpers read what each client carries, a 0 included, and never recompute over it', () => {
  const clients = [
    fromServer(1, 'shared', 0, 1),
    fromServer(2, 'primary', 0, 3),
    fromServer(3, 'secondary', 4, 5),
    fromServer(4, 'secondary', 2, 8),
  ];
  const groups = groupClientsBySuccessionRisk(clients);
  assert.deepEqual([groups.low, groups.medium, groups.high].map((g) => g.map((c) => c.id)), [[1, 2], [3], [4]]);
  assert.deepEqual(getHighestRiskClients(clients, 2).map((c) => [c.id, c.successionRisk]), [[4, 8], [3, 5]]);
  const analytics = getSuccessionAnalytics(clients);
  assert.deepEqual(analytics.riskDistribution, { low: 2, medium: 1, high: 1 });
  assert.deepEqual(analytics.relationshipTypes, { shared: 1, primary: 1, secondary: 2 });
  // (0 + 0 + 4 + 2) ÷ 4 = 1.5. With `||`, each 0 was recomputed from the
  // client (orphaned, As-Needed: 0 here too, but anything on another client)
  assert.equal(analytics.averageComplexity, 1.5);
  const zero = fromServer(5, 'shared', 0, 1);
  const busy = { ...zero, interaction_frequency: 'Daily', high_maintenance: true, practiceArea: ['Healthcare'], conflict_risk: 'High' };
  assert.equal(calculateTransitionComplexity(busy), 6, 'what this module would compute');
  assert.equal(getSuccessionAnalytics([busy]).averageComplexity, 0, 'the 0 the client carries');
});

test('withSuccessionMetrics keeps the server\'s figures; from an older API, which sends none, it computes all three here, never a mix', () => {
  const server = fromServer(1, 'shared', 0, 1);
  assert.equal(withSuccessionMetrics(server), server, 'as it came');
  // An API older than WP7: the nested people and every field the rules read, no metrics
  const older = { id: 2, lead: { id: 4, name: 'Kevin' }, lead_id: 4, secondChair: null, originator: { id: 4, name: 'Kevin' }, originator_id: 4,
    stickiness: 2, interaction_frequency: 'Weekly', effort: 3, practiceArea: ['Energy'], conflict_risk: 'Low' };
  const filled = withSuccessionMetrics(older);
  assert.deepEqual(filled, { ...older, relationshipType: 'primary', transitionComplexity: 3, successionRisk: 7 });
  assert.deepEqual(filled, enhanceClientWithSuccessionMetrics(older));
  // One missing is none: all three are computed together
  const { successionRisk, ...partial } = server;
  assert.equal(successionRisk, 1);
  assert.deepEqual(withSuccessionMetrics(partial), enhanceClientWithSuccessionMetrics(partial));
  assert.equal(withSuccessionMetrics(null), null);
});
