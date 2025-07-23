/**
 * Utility functions for safe data handling and transformation
 */

/**
 * Safely converts practice area data to an array of strings
 * @param {*} practiceAreaData - Practice area data from database or API
 * @returns {string[]} Array of practice area strings
 */
export const safePracticeAreaToArray = (practiceAreaData) => {
  if (!practiceAreaData) {
    return [];
  }
  
  // If it's already an array
  if (Array.isArray(practiceAreaData)) {
    return practiceAreaData.filter(area => area && typeof area === 'string');
  }
  
  // If it's a string, wrap it in an array
  if (typeof practiceAreaData === 'string') {
    return [practiceAreaData];
  }
  
  // For any other type, return empty array
  return [];
};

/**
 * Safely converts communication frequency to lowercase string
 * @param {*} frequency - Frequency data from database or API
 * @returns {string} Lowercase frequency string
 */
export const safeFrequencyToLowerCase = (frequency) => {
  if (!frequency || typeof frequency !== 'string') {
    return '';
  }
  return frequency.toLowerCase();
};

/**
 * Safely converts any text field to lowercase for comparison
 * @param {*} text - Text data to convert
 * @returns {string} Lowercase text or empty string
 */
export const safeTextToLowerCase = (text) => {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.toLowerCase();
};

/**
 * Enhanced client data with safe practice area handling
 * @param {Object} client - Client object from database
 * @returns {Object} Client object with safe practice area array
 */
export const enhanceClientWithSafePracticeArea = (client) => {
  if (!client) {
    return client;
  }
  
  return {
    ...client,
    practiceArea: safePracticeAreaToArray(client.practiceArea || client.practice_area)
  };
};

/**
 * Filters practice areas array for text search
 * @param {string[]} practiceAreas - Array of practice areas
 * @param {string} searchTerm - Search term to look for
 * @returns {boolean} True if any practice area matches the search term
 */
export const practiceAreaMatchesSearch = (practiceAreas, searchTerm) => {
  if (!practiceAreas || !Array.isArray(practiceAreas) || !searchTerm) {
    return false;
  }
  
  const lowerSearchTerm = searchTerm.toLowerCase();
  return practiceAreas.some(area => 
    area && typeof area === 'string' && area.toLowerCase().includes(lowerSearchTerm)
  );
};
