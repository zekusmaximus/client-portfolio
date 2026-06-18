/**
 * Succession Planning Utility Functions
 * Provides computed metrics for client succession planning analysis
 */

import { safeFrequencyToLowerCase, safePracticeAreaToArray } from './dataUtils';
import { resolveStickinessScore, resolveEffort, MAX_EFFORT } from './clientMetrics';

/**
 * Derives the relationship type based on client's lobbyist structure
 * @param {Object} client - Client data object
 * @returns {string} 'orphaned', 'shared', 'primary', or 'secondary'
 */
export const deriveRelationshipType = (client) => {
  if (!client) return 'secondary';
  
  // Check if client has no primary lobbyist
  if (!client.primary_lobbyist || client.primary_lobbyist.trim() === '') {
    return 'orphaned';
  }
  
  // Parse lobbyist team (handle both array and string formats)
  let teamSize = 1; // Default to 1 for primary lobbyist
  if (client.lobbyist_team) {
    if (Array.isArray(client.lobbyist_team)) {
      teamSize = client.lobbyist_team.length;
    } else if (typeof client.lobbyist_team === 'string') {
      // Split by common delimiters and filter empty values
      const team = client.lobbyist_team.split(/[,;|\n]/).filter(member => member.trim() !== '');
      teamSize = team.length > 0 ? team.length : 1;
    }
  }
  
  // Stickiness (0–10) now stands in for the retired relationship_strength.
  // A high-stickiness client is firmly anchored to the firm, so when it's also
  // serviced by a team we treat the relationship as "shared".
  const stickinessScore = resolveStickinessScore(client);

  // Shared relationship: multiple team members AND a strong, anchored relationship
  if (teamSize >= 2 && stickinessScore >= 7) {
    return 'shared';
  }
  
  // Primary relationship: client originator is primary lobbyist AND small team
  if (client.primary_lobbyist === client.client_originator && teamSize <= 1) {
    return 'primary';
  }
  
  // All other cases are secondary
  return 'secondary';
};

/**
 * Calculates transition complexity score based on multiple factors
 * @param {Object} client - Client data object
 * @returns {number} Complexity score from 1-10
 */
export const calculateTransitionComplexity = (client) => {
  if (!client) return 1;
  
  let complexity = 0;

  // Base complexity from engagement load. This used to read the 1–10
  // relationship_intensity slider (× 0.3 ⇒ 0.3–3.0). That field is retired in
  // favor of `effort` (cadence + handful flag, ~0.5–7.5 work units), so we
  // normalize effort back onto a 0–10 scale and keep the same 0.3 weight —
  // preserving the original contribution range rather than just swapping vars.
  const effort = resolveEffort(client);
  const engagement = Math.min(10, (effort / MAX_EFFORT) * 10);
  complexity += engagement * 0.3;

  // Communication frequency factor
  const frequency = safeFrequencyToLowerCase(client.communication_frequency);
  const frequencyScores = {
    'daily': 3,
    'weekly': 2,
    'monthly': 1,
    'quarterly': 0.5,
    'as-needed': 0,
    'as needed': 0
  };
  complexity += frequencyScores[frequency] || 0;
  
  // Complex practice areas
  const practiceAreas = safePracticeAreaToArray(client.practice_area).map(area => area.toLowerCase());
  
  const complexAreas = ['healthcare', 'energy', 'financial services'];
  if (practiceAreas.some(area => complexAreas.some(complexArea => area.includes(complexArea)))) {
    complexity += 1.5;
  }
  
  // High conflict risk adds complexity
  const conflictRisk = parseFloat(client.conflict_risk) || 0;
  if (conflictRisk >= 7) {
    complexity += 1;
  }
  
  // Cap at 10 and round to integer
  return Math.min(Math.round(complexity), 10);
};

/**
 * Calculates succession risk score based on relationship factors
 * @param {Object} client - Client data object
 * @returns {number} Risk score from 1-10
 */
export const calculateSuccessionRisk = (client) => {
  if (!client) return 5;
  
  let risk = 0;
  
  // Base risk from relationship type
  const relationshipType = deriveRelationshipType(client);
  const typeRiskScores = {
    'primary': 3,
    'secondary': 2,
    'shared': 1,
    'orphaned': 5
  };
  risk += typeRiskScores[relationshipType] || 2;
  
  // Low stickiness increases risk. Stickiness (0–10) replaces the retired
  // relationship_strength: a loosely-held client (cold / transactional) is the
  // easiest to lose in a transition, so it carries the most succession risk.
  // Mirrors the old `strength < 6 ⇒ +(6 - strength)` curve on the new scale.
  const stickinessScore = resolveStickinessScore(client);
  if (stickinessScore < 6) {
    risk += (6 - stickinessScore);
  }
  
  // Complexity factor
  const transitionComplexity = calculateTransitionComplexity(client);
  risk += transitionComplexity * 0.3;
  
  // Cap at 10 and round to integer
  return Math.min(Math.round(risk), 10);
};

/**
 * Enhances a client object with all succession planning metrics
 * @param {Object} client - Client data object
 * @returns {Object} Enhanced client with succession metrics
 */
export const enhanceClientWithSuccessionMetrics = (client) => {
  if (!client) return client;
  
  return {
    ...client,
    relationshipType: deriveRelationshipType(client),
    transitionComplexity: calculateTransitionComplexity(client),
    successionRisk: calculateSuccessionRisk(client)
  };
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
    const riskScore = client.successionRisk || calculateSuccessionRisk(client);
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
      successionRisk: client.successionRisk || calculateSuccessionRisk(client)
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
    const type = client.relationshipType || deriveRelationshipType(client);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  
  const avgComplexity = clients.reduce((sum, client) => {
    return sum + (client.transitionComplexity || calculateTransitionComplexity(client));
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