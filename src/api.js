// src/api.js
// Centralized API client utility for the frontend

import usePortfolioStore from './portfolioStore';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Retrieve the auth token from Zustand store or, as a fallback, from localStorage
function getAuthToken() {
  try {
    const storeToken = usePortfolioStore?.getState?.().token;
    if (storeToken) return storeToken;
  } catch {
    /* ignore Zustand access errors */
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('authToken');
  }
  return null;
}

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

  // Determine whether to prefix with `/api` to avoid double-prefixing when the
  // caller already includes it (e.g. '/api/auth/login').
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  // Build headers and inject JWT automatically when present
  const headers = {
    'Content-Type': 'application/json',
  };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'POST',
    headers,
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
 *
 * @param {string} endpoint – Path after `/api`, e.g. '/clients'
 * @returns {Promise<any>} Parsed JSON returned by the backend
 */
async function get(endpoint) {
  // Ensure the endpoint starts with a leading slash
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // Determine base path just like in `post`
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  // Build headers and inject JWT automatically when present
  const headers = {};
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'GET',
    headers,
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
 *
 * @param {string} endpoint – Path after `/api`
 * @param {Record<string, unknown>} body – JSON payload
 * @returns {Promise<any>}
 */
async function put(endpoint, body) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  const headers = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'PUT',
    headers,
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
 *
 * @param {string} endpoint – Path after `/api`
 * @returns {Promise<void>}
 */
async function del(endpoint) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const basePath = normalized.startsWith('/api/') ? '' : '/api';

  const headers = {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${basePath}${normalized}`, {
    method: 'DELETE',
    headers,
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

// ---------- Domain-specific helpers for Phase 3 ----------
export const postClient   = (data)      => post('/clients', data);
export const putClient    = (id, data)  => put(`/clients/${id}`, data);
export const deleteClient = (id)        => del(`/clients/${id}`);
export const postRevenue  = (clientId, data) => post(`/clients/${clientId}/revenues`, data);
export const putRevenue   = (revenueId, data) => put(`/revenues/${revenueId}`, data);

export const apiClient = { post, get, put, del };

export default apiClient;