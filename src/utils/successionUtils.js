/**
 * Succession Planning Utility Functions
 * Provides computed metrics for client succession planning analysis
 */

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
  
  const relationshipStrength = parseFloat(client.relationship_strength) || 0;
  
  // Shared relationship: multiple team members AND strong relationship
  if (teamSize >= 2 && relationshipStrength >= 7) {
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
  
  // Base complexity from relationship intensity
  const relationshipIntensity = parseFloat(client.relationship_intensity) || 0;
  complexity += relationshipIntensity * 0.3;
  
  // Communication frequency factor
  const frequency = client.communication_frequency?.toLowerCase() || '';
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
  const practiceArea = client.practice_area?.toLowerCase() || '';
  const complexAreas = ['healthcare', 'energy', 'financial services'];
  if (complexAreas.some(area => practiceArea.includes(area))) {
    complexity += 1.5;
  }
  
  // High strategic fit adds complexity
  const strategicFit = parseFloat(client.strategic_fit_score) || 0;
  if (strategicFit >= 8) {
    complexity += 1;
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
  
  // Low relationship strength increases risk
  const relationshipStrength = parseFloat(client.relationship_strength) || 0;
  if (relationshipStrength < 6) {
    risk += (6 - relationshipStrength);
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