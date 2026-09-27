// src/utils/clientUtils.js: Client Details' "Enhanced" badge and its count
// (docs/plans/tier-2.md, S5, Tier 2 WP2): a client is enhanced when it has the
// brief's two quick picks, a Stickiness pick (an integer from 1 to 5, what
// the book counts as rated) and a cadence. Until WP2 the rule read
// strategicFitScore, which the API set to 5 for every client, so every client
// showed "Enhanced" and the rate was 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClientEnhanced, getEnhancedClientCount, getEnhancementRate } from '../src/utils/clientUtils.js';
import { ratedForStickiness } from '../src/utils/askTheBook.js';

// A client as GET /api/data/clients returned one before WP2: the retired
// columns and their aliases, the legacy people text, practice areas and notes
const API_CLIENT = {
  id: 7,
  name: 'Acme',
  practiceArea: ['Energy'],
  practice_area: ['Energy'],
  conflict_risk: 'High',
  conflictRisk: 'High',
  notes: 'A note',
  primary_lobbyist: 'Kevin',
  lobbyist_team: ['Kevin', 'Jay'],
  client_originator: 'Kevin',
  relationship_strength: 5,
  relationshipStrength: 5,
  renewal_probability: '0.70',
  renewalProbability: 0.7,
  strategic_fit_score: 5,
  strategicFitScore: 5,
  interaction_frequency: '',
  stickiness: null,
};

test('a stickiness pick and a cadence make a client enhanced; either alone does not', () => {
  assert.equal(isClientEnhanced({ stickiness: 3, interaction_frequency: 'Monthly' }), true);
  assert.equal(isClientEnhanced({ stickiness: 3, interaction_frequency: '' }), false);
  assert.equal(isClientEnhanced({ stickiness: 3 }), false);
  assert.equal(isClientEnhanced({ stickiness: null, interaction_frequency: 'Monthly' }), false);
  assert.equal(isClientEnhanced({ interaction_frequency: 'Monthly' }), false);
  for (const cadence of ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed']) {
    assert.equal(isClientEnhanced({ stickiness: 1, interaction_frequency: cadence }), true, cadence);
  }
  assert.equal(isClientEnhanced({ stickiness: 5, interactionFrequency: 'Weekly' }), true, 'either spelling');
  assert.equal(isClientEnhanced(null), false);
  assert.equal(isClientEnhanced(undefined), false);
});

test('only a pick the book counts as rated counts, and only one of the five cadences', () => {
  for (const stickiness of [0, 6, 2.5, '', 'high', undefined]) {
    assert.equal(isClientEnhanced({ stickiness, interaction_frequency: 'Weekly' }), false, String(stickiness));
  }
  assert.equal(isClientEnhanced({ stickiness: '4', interaction_frequency: 'Weekly' }), true, 'a pick as text');
  assert.equal(isClientEnhanced({ stickiness: 4, interaction_frequency: 'Fortnightly' }), false);
  assert.equal(isClientEnhanced({ stickiness: 4, interaction_frequency: 'weekly' }), false, 'as the scorer, case matters');
  // The same rule as the AI tab's "Rated for stickiness"
  for (const stickiness of [null, undefined, 0, 1, 2, 3, 4, 5, 6, 2.5, '3', '', 'x']) {
    const client = { stickiness, interaction_frequency: 'Monthly' };
    assert.equal(isClientEnhanced(client), ratedForStickiness([client]) === 1, String(stickiness));
  }
});

test('the fields every API client had no longer count: an unrated client without a cadence is Basic', () => {
  assert.equal(isClientEnhanced(API_CLIENT), false);
  assert.equal(isClientEnhanced({ ...API_CLIENT, stickiness: 2, interaction_frequency: 'Quarterly' }), true);
});

test('the count and the rate', () => {
  const clients = [
    { stickiness: 4, interaction_frequency: 'Weekly' },
    { stickiness: 2, interaction_frequency: 'As-Needed' },
    { stickiness: null, interaction_frequency: 'Weekly' },
    API_CLIENT,
  ];
  assert.equal(getEnhancedClientCount(clients), 2);
  assert.equal(getEnhancementRate(clients), 50);
  assert.equal(getEnhancedClientCount(null), 0);
  assert.equal(getEnhancementRate([]), 0);
});
