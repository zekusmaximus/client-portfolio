/**
 * Utility functions for client data processing
 */

// The five cadences (the client form's, the import's `Cadence` column's and
// EFFORT_BY_CADENCE's in utils/strategic.cjs)
const CADENCES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed'];

/**
 * Whether a client has the brief's "two quick picks" (docs/plans/tier-2.md,
 * S5): a Stickiness pick, an integer from 1 to 5 (what the book and the AI
 * tab's "Rated for stickiness" count as rated), and a cadence. Client Details
 * shows such a client as "Enhanced". Until Tier 2 WP2 any client counted,
 * because the rule read strategicFitScore, which the API set to 5 for all.
 * @param {Object} client - The client object
 * @returns {boolean} - True if the client is rated for stickiness and has a cadence
 */
export const isClientEnhanced = (client) => {
  if (!client) return false;
  const pick = parseFloat(client.stickiness);
  const rated = Number.isInteger(pick) && pick >= 1 && pick <= 5;
  const cadence = client.interaction_frequency ?? client.interactionFrequency;
  return rated && CADENCES.includes(cadence);
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
