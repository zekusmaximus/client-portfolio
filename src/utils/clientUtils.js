/**
 * Utility functions for client data processing
 */

/**
 * Helper function to determine if a client is enhanced
 * A client is considered enhanced if they have detailed information beyond basic fields
 * @param {Object} client - The client object
 * @returns {boolean} - True if client has enhanced information
 */
export const isClientEnhanced = (client) => {
  if (!client) return false;
  
  // Check for enhanced fields beyond basic client information
  const hasEnhancedFields = (
    // Practice areas selected
    (client.practiceArea && client.practiceArea.length > 0) ||
    // Relationship metrics customized (assuming defaults are 5, 'Medium', 0.7)
    (client.relationshipStrength && client.relationshipStrength !== 5) ||
    (client.conflictRisk && client.conflictRisk !== 'Medium') ||
    (client.renewalProbability && client.renewalProbability !== 0.7) ||
    // Strategic metrics set
    (client.strategicFitScore && client.strategicFitScore > 0) ||
    // Team information added
    (client.primary_lobbyist && client.primary_lobbyist.trim() !== '') ||
    (client.client_originator && client.client_originator.trim() !== '') ||
    (client.lobbyist_team && client.lobbyist_team.length > 0) ||
    // Notes added
    (client.notes && client.notes.trim() !== '')
  );
  
  return hasEnhancedFields;
};

/**
 * Get the count of enhanced clients from a client array
 * @param {Array} clients - Array of client objects
 * @returns {number} - Count of enhanced clients
 */
export const getEnhancedClientCount = (clients) => {
  if (!clients || !Array.isArray(clients)) return 0;
  return clients.filter(client => isClientEnhanced(client)).length;
};

/**
 * Get the enhancement rate as a percentage
 * @param {Array} clients - Array of client objects
 * @returns {number} - Enhancement rate as a percentage (0-100)
 */
export const getEnhancementRate = (clients) => {
  if (!clients || !Array.isArray(clients) || clients.length === 0) return 0;
  const enhancedCount = getEnhancedClientCount(clients);
  return Math.round((enhancedCount / clients.length) * 100);
};
