/**
 * Text utilities for display: a fallback for a missing value, and a trim.
 *
 * Until Tier 2 WP5 these also decoded one level of HTML entities
 * (decodeHtmlEntities, through a textarea's innerHTML), because the API's
 * request sanitizer stored client text HTML-escaped. The API stores text as
 * typed since WP5's first PR, and scripts/unescape-book.cjs found nothing left
 * escaped in the book on 2026-09-28, so text is shown as stored: a literal
 * `&amp;` a partner typed reads as `&amp;`. React renders it as text.
 */

/**
 * Safe text processing that handles null/undefined values
 */
export const safeText = (text, fallback = '') => {
  if (text === null || text === undefined) return fallback;
  return String(text);
};

/**
 * Process client name to ensure proper display
 */
export const formatClientName = (name) => safeText(name, 'Unknown Client').trim();

/**
 * Process partner name to ensure proper display
 */
export const formatPartnerName = (name) => safeText(name, 'Unknown Partner').trim();

/**
 * Process practice area names
 */
export const formatPracticeArea = (area) => safeText(area, '').trim();
