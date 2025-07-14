// src/api.js
// Centralized API client utility for the frontend

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Simple wrapper around fetch for POST requests to the backend API.
 * Automatically prefixes the endpoint with `${API_BASE_URL}/api`
 * and parses the JSON response. On non-2xx responses it throws
 * an Error so callers can handle it in try/catch blocks.
 *
 * @param {string} endpoint – Path after `/api`, e.g. '/data/process-csv'
 * @param {Record<string, unknown>} body – Request payload
 * @returns {Promise<any>} Parsed JSON returned by the backend
 */
async function post(endpoint, body) {
  // Ensure the endpoint starts with a leading slash
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const response = await fetch(`${API_BASE_URL}/api${normalized}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Try to read the body for more detailed error information
    let errorMessage = `API call to ${normalized} failed with status ${response.status}`;
    try {
      const text = await response.text();
      if (text) errorMessage += ` – ${text}`;
    } catch {
      /* ignore */
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export const apiClient = { post };

export default apiClient;