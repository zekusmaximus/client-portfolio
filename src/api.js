// src/api.js
// Centralized API client utility for the frontend

// Get API base URL and validate HTTPS in production
const getApiBaseUrl = () => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  
  // Enforce HTTPS in production environment
  if (import.meta.env.PROD && baseUrl && !baseUrl.startsWith('https://')) {
    console.error('Security Warning: API URL must use HTTPS in production');
    throw new Error('Insecure API configuration: HTTPS required in production');
  }
  
  return baseUrl;
};

const API_BASE_URL = getApiBaseUrl();

/**
 * Simple wrapper around fetch for POST requests to the backend API.
 * Automatically prefixes the endpoint with `${API_BASE_URL}/api`
 * and parses the JSON response. On non-2xx responses it throws
 * an Error so callers can handle it in try/catch blocks.
 * Uses credentials: 'include' to automatically send HTTP-only cookies.
 *
 * @param {string} endpoint – Path after `/api`, e.g. '/data/process-csv'
 * @param {Record<string, unknown>} body – Request payload
 * @returns {Promise<any>} Parsed JSON returned by the backend
 */
async function post(endpoint, body) {
  // Ensure the endpoint starts with a leading slash
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // Determine whether to prefix with `/api` to avoid double-prefixing when the
  // caller already includes it (e.g. '/api/auth/login').
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  // Build headers - no need for manual Authorization header with cookies
  const headers = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'POST',
    headers,
    credentials: 'include', // Include cookies in requests
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

/**
 * Generic GET helper mirroring the `post` wrapper but for retrieving data.
 * Uses credentials: 'include' to automatically send HTTP-only cookies.
 *
 * @param {string} endpoint – Path after `/api`, e.g. '/clients'
 * @returns {Promise<any>} Parsed JSON returned by the backend
 */
async function get(endpoint) {
  // Ensure the endpoint starts with a leading slash
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // Determine base path just like in `post`
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  // No need for manual Authorization header with cookies
  const headers = {};

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'GET',
    headers,
    credentials: 'include', // Include cookies in requests
  });

  if (!response.ok) {
    let errorMessage = `API GET to ${normalized} failed with status ${response.status}`;
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

/**
 * Generic PUT helper mirroring `post` but for updates.
 * Uses credentials: 'include' to automatically send HTTP-only cookies.
 *
 * @param {string} endpoint – Path after `/api`
 * @param {Record<string, unknown>} body – JSON payload
 * @returns {Promise<any>}
 */
async function put(endpoint, body) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  const headers = { 'Content-Type': 'application/json' };

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'PUT',
    headers,
    credentials: 'include', // Include cookies in requests
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = `API PUT to ${normalized} failed with status ${response.status}`;
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

/**
 * Generic DELETE helper for removing resources.
 * Uses credentials: 'include' to automatically send HTTP-only cookies.
 *
 * @param {string} endpoint – Path after `/api`
 * @returns {Promise<void>}
 */
async function del(endpoint) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  const headers = {};

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'DELETE',
    headers,
    credentials: 'include', // Include cookies in requests
  });

  if (!response.ok) {
    let errorMessage = `API DELETE to ${normalized} failed with status ${response.status}`;
    try {
      const text = await response.text();
      if (text) errorMessage += ` – ${text}`;
    } catch {
      /* ignore */
    }
    throw new Error(errorMessage);
  }

  // DELETE typically returns 204 No Content, so no JSON parsing needed
  return;
}

/**
 * The JSON body of a failed response, from an error thrown by the helpers
 * above (they fold the body into the Error message after the status), or null
 * when there is none.
 */
export function apiErrorBody(err) {
  const message = (err && err.message) || '';
  const start = message.indexOf('{');
  if (start === -1) return null;
  try {
    const body = JSON.parse(message.slice(start));
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null; // body was not JSON
  }
}

/**
 * Human-readable message for an error thrown by the helpers above. The backend
 * answers failures as `{ success: false, error: '...' }`. Pull the JSON `error`
 * back out when it is there; otherwise return the message as is.
 */
export function apiErrorMessage(err, fallback = 'Request failed') {
  const body = apiErrorBody(err);
  if (body && typeof body.error === 'string' && body.error) return body.error;
  if (body && typeof body.message === 'string' && body.message) return body.message;
  return (err && err.message) || fallback;
}

export const apiClient = { post, get, put, del };

export default apiClient;