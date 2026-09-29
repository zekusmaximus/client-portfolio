/**
 * Succession planning metrics: each client's relationship type, transition
 * complexity and succession risk.
 *
 * Since Tier 2 WP7 (docs/plans/tier-2.md, S11) the server computes them
 * (utils/succession.cjs) and every client response carries them, as it
 * carries strategicValue and effort; the Dashboard, the client list and
 * Scenarios show those. This module is the page's copy of the same rules,
 * used for two things only:
 *   - the client form's live preview, which works on the form's state before
 *     anything is saved (people as select values, the raw Stickiness pick);
 *   - a client from an API older than WP7, which sends no metrics
 *     (withSuccessionMetrics): the page publishes before Render deploys, and
 *     a rollback of the API sends none.
 * tests/succession.test.mjs holds it equal to the server's, figure for
 * figure, on the fixture books and on seeded random books. Change one side,
 * change the other, with each sum in the same order.
 *
 * The rules (S11): orphaned without a lead; primary when the lead is the
 * recorded originator and there is no second chair, whatever the firm credit
 * says; shared when there is a second chair and stickiness is 7 or more of 10;
 * otherwise secondary. Cadence counts once, through effort. Practice areas
 * from practiceArea or practice_area. An unrated client's stickiness term is
 * the scorer's stand-in, 40 / 9 (UNRATED_STICKINESS), not a rating.
 */

import { safePracticeAreaToArray } from './dataUtils.js';
import { resolveStickinessScore, resolveEffort, MAX_EFFORT } from './clientMetrics.js';

// Held equal to utils/succession.cjs. 'Financial', the form's practice area,
// does not contain 'financial services' and adds nothing (as it always has;
// a change is Jeff's to make, on both sides)
export const COMPLEX_AREAS = ['healthcare', 'energy', 'financial services'];
const TYPE_RISK = { primary: 3, secondary: 2, shared: 1, orphaned: 5 };

// A person's id as text, or null: the nested person's (the API's lead,
// secondChair and originator), else the id field (the form's select value,
// '' for none)
const personId = (nested, id) => {
  const value = nested && typeof nested === 'object' && nested.id !== null && nested.id !== undefined ? nested.id : id;
  return value === null || value === undefined || value === '' ? null : String(value);
};

/** A client's practice areas, from practiceArea or practice_area: the form holds practiceArea. */
export const practiceAreasOf = (client) => safePracticeAreaToArray(client?.practiceArea ?? client?.practice_area);

/**
 * What the rules read. Stickiness (0 to 10) comes from the raw pick, never
 * the API's stickinessScore, which is rounded (4.44 for the stand-in); the
 * server reads the pick too.
 */
export const successionInputs = (client = {}) => ({
  leadId: personId(client.lead, client.lead_id),
  secondChairId: personId(client.secondChair, client.second_chair_id),
  originatorId: personId(client.originator, client.originator_id),
  stickiness: resolveStickinessScore({ stickiness: client.stickiness }),
  effort: resolveEffort(client),
  practiceAreas: practiceAreasOf(client),
  conflictRisk: client.conflict_risk ?? client.conflictRisk,
});

/**
 * True when the client has no Stickiness pick, so its succession risk rests
 * on the stand-in, not a rating: Stage 2's badge says "not rated" beside it.
 */
export const stickinessNotRated = (client) => {
  const n = parseFloat(client?.stickiness);
  return Number.isNaN(n);
};

const conflictLabel = (risk) => (typeof risk === 'string' ? risk.trim().toLowerCase() : '');

const relationshipTypeOf = (inputs) => {
  if (inputs.leadId === null) return 'orphaned';
  if (inputs.secondChairId !== null && inputs.stickiness >= 7) return 'shared';
  if (inputs.originatorId !== null && inputs.originatorId === inputs.leadId && inputs.secondChairId === null) return 'primary';
  return 'secondary';
};

const transitionComplexityOf = (inputs) => {
  let complexity = 0;

  // Engagement: effort on a 0 to 10 scale, weighted 0.3. The cadence is in
  // effort already; until WP7 it was also added on its own
  const engagement = Math.min(10, (inputs.effort / MAX_EFFORT) * 10);
  complexity += engagement * 0.3;

  const areas = inputs.practiceAreas.map((area) => area.toLowerCase());
  if (areas.some((area) => COMPLEX_AREAS.some((complexArea) => area.includes(complexArea)))) {
    complexity += 1.5;
  }

  if (conflictLabel(inputs.conflictRisk) === 'high') {
    complexity += 1;
  }

  return Math.min(Math.round(complexity), 10);
};

const successionRiskOf = (inputs, type, complexity) => {
  let risk = 0;
  risk += TYPE_RISK[type] || 2;
  if (inputs.stickiness < 6) {
    risk += (6 - inputs.stickiness);
  }
  risk += complexity * 0.3;
  return Math.min(Math.round(risk), 10);
};

/**
 * The relationship type: 'orphaned', 'shared', 'primary' or 'secondary'.
 * @param {Object} client - a client as the API sends it, or the form's state
 */
export const deriveRelationshipType = (client) => {
  if (!client) return 'secondary';
  return relationshipTypeOf(successionInputs(client));
};

/**
 * Transition complexity, 0 to 10.
 * @param {Object} client - a client as the API sends it, or the form's state
 */
export const calculateTransitionComplexity = (client) => {
  if (!client) return 1;
  return transitionComplexityOf(successionInputs(client));
};

/**
 * Succession risk, 1 to 10.
 * @param {Object} client - a client as the API sends it, or the form's state
 */
export const calculateSuccessionRisk = (client) => {
  if (!client) return 5;
  const inputs = successionInputs(client);
  return successionRiskOf(inputs, relationshipTypeOf(inputs), transitionComplexityOf(inputs));
};

/**
 * The client with its three metrics computed here (the form's preview).
 * @param {Object} client - Client data object
 * @returns {Object} Enhanced client with succession metrics
 */
export const enhanceClientWithSuccessionMetrics = (client) => {
  if (!client) return client;
  const inputs = successionInputs(client);
  const relationshipType = relationshipTypeOf(inputs);
  const transitionComplexity = transitionComplexityOf(inputs);
  return {
    ...client,
    relationshipType,
    transitionComplexity,
    successionRisk: successionRiskOf(inputs, relationshipType, transitionComplexity)
  };
};

const hasServerMetrics = (client) =>
  client.relationshipType !== undefined && client.transitionComplexity !== undefined && client.successionRisk !== undefined;

/**
 * A client from the API as the store keeps it: the server's three metrics as
 * they came (WP7), or, from an API older than WP7, which sends none, the same
 * rules computed here from the nested people it does send. Never a mix.
 */
export const withSuccessionMetrics = (client) => {
  if (!client || hasServerMetrics(client)) return client;
  return enhanceClientWithSuccessionMetrics(client);
};

/**
 * Returns appropriate badge variant based on succession risk level
 * @param {number} riskScore - Risk score from 1-10
 * @returns {string} Badge variant ('default', 'secondary', 'destructive')
 */
export const getSuccessionRiskVariant = (riskScore) => {
  if (riskScore <= 3) return 'default'; // Green (low risk)
  if (riskScore <= 6) return 'secondary'; // Yellow (medium risk)
  return 'destructive'; // Red (high risk)
};

/**
 * Returns color class for relationship type display
 * @param {string} type - Relationship type
 * @returns {string} Tailwind color class
 */
export const getRelationshipTypeColor = (type) => {
  const colorMap = {
    'primary': 'bg-blue-100 text-blue-800',
    'secondary': 'bg-gray-100 text-gray-800',
    'shared': 'bg-green-100 text-green-800',
    'orphaned': 'bg-red-100 text-red-800'
  };
  return colorMap[type] || 'bg-gray-100 text-gray-800';
};

// A metric as the client carries it, computed here only when it has none. A
// 0 is a value (transition complexity is 0 for an As-Needed client with no
// complex area and no High conflict risk), so `??`, never `||`
const riskOf = (client) => client.successionRisk ?? calculateSuccessionRisk(client);
const complexityOf = (client) => client.transitionComplexity ?? calculateTransitionComplexity(client);
const typeOf = (client) => client.relationshipType ?? deriveRelationshipType(client);

/**
 * Groups clients by succession risk level
 * @param {Array} clients - Array of client objects
 * @returns {Object} Clients grouped by risk level
 */
export const groupClientsBySuccessionRisk = (clients) => {
  const groups = {
    low: [],
    medium: [],
    high: []
  };

  clients.forEach(client => {
    const riskScore = riskOf(client);
    if (riskScore <= 3) {
      groups.low.push(client);
    } else if (riskScore <= 6) {
      groups.medium.push(client);
    } else {
      groups.high.push(client);
    }
  });

  return groups;
};

/**
 * Returns the highest risk clients for dashboard attention
 * @param {Array} clients - Array of client objects
 * @param {number} limit - Maximum number of clients to return
 * @returns {Array} Top N highest risk clients
 */
export const getHighestRiskClients = (clients, limit = 5) => {
  return clients
    .map(client => ({
      ...client,
      successionRisk: riskOf(client)
    }))
    .sort((a, b) => b.successionRisk - a.successionRisk)
    .slice(0, limit);
};

/**
 * Gets succession analytics summary for the entire portfolio
 * @param {Array} clients - Array of client objects
 * @returns {Object} Analytics summary
 */
export const getSuccessionAnalytics = (clients) => {
  const riskGroups = groupClientsBySuccessionRisk(clients);
  const relationshipTypes = clients.reduce((acc, client) => {
    const type = typeOf(client);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const avgComplexity = clients.reduce((sum, client) => {
    return sum + complexityOf(client);
  }, 0) / clients.length;

  return {
    riskDistribution: {
      low: riskGroups.low.length,
      medium: riskGroups.medium.length,
      high: riskGroups.high.length
    },
    relationshipTypes,
    averageComplexity: Math.round(avgComplexity * 10) / 10,
    highestRiskClients: getHighestRiskClients(clients),
    totalClients: clients.length
  };
};
