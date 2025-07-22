/**
 * Text utilities for proper HTML entity decoding and text processing
 */

/**
 * Decode HTML entities in text strings
 * Handles common entities like &#x27; (apostrophe), &#x2F; (slash), etc.
 */
export const decodeHtmlEntities = (text) => {
  if (!text || typeof text !== 'string') return text || '';
  
  try {
    // Create a temporary DOM element to decode HTML entities
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  } catch (error) {
    // Fallback: manually decode common entities
    console.warn('Error decoding HTML entities, using fallback:', error);
    return text
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&#x5C;/g, "\\")
      .replace(/&#x22;/g, '"')
      .replace(/&#x26;/g, "&")
      .replace(/&#x3C;/g, "<")
      .replace(/&#x3E;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
};

/**
 * Safe text processing that handles null/undefined values
 */
export const safeText = (text, fallback = '') => {
  if (text === null || text === undefined) return fallback;
  return decodeHtmlEntities(String(text));
};

/**
 * Process client name to ensure proper display
 */
export const formatClientName = (name) => {
  const decoded = safeText(name, 'Unknown Client');
  // Additional formatting if needed (trim, capitalize, etc.)
  return decoded.trim();
};

/**
 * Process partner name to ensure proper display
 */
export const formatPartnerName = (name) => {
  const decoded = safeText(name, 'Unknown Partner');
  return decoded.trim();
};

/**
 * Process practice area names
 */
export const formatPracticeArea = (area) => {
  const decoded = safeText(area, '');
  return decoded.trim();
};