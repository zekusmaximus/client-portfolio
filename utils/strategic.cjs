/**
 * Strategic scoring — single source of truth.
 *
 * This module is the ONLY implementation of strategic-value scoring in the
 * codebase. It is consumed by:
 *   - data.cjs            (via clientAnalyzer.cjs re-export) — the dashboard CRUD path
 *   - models/clientModel  (listWithMetrics / getWithMetrics) — the AI + scenarios path
 *   - claude.cjs          (generatePortfolioSummary)
 *
 * The functions are deliberately tolerant of both field-name conventions
 * (snake_case from the database, camelCase from the frontend) and of both
 * revenue shapes (a `revenues` array of {year, revenue_amount} rows, or a
 * `revenue` object keyed by year) so that every code path produces identical
 * numbers for the same client.
 *
 * Current formula (weights pending product review):
 *   strategicValue = revenueScore*0.50 + relationshipStrength*0.35
 *                    + renewalProbability(0-10)*0.15  -  conflictPenalty
 *   revenueScore   = min(10, mostRecentRevenue / 50000)   // $500k -> 10
 *   conflictPenalty: High=3, Medium=1, Low=0
 * Result is clamped to 0..10.
 */

/**
 * Resolve the most recent year's revenue for a client, accepting either a
 * `revenues` array (database shape) or a `revenue` object (frontend shape).
 * @param {Object} client
 * @param {Array} [revenues] - optional explicit revenues array
 * @returns {number}
 */
function getMostRecentRevenue(client, revenues) {
  const revArray = Array.isArray(revenues)
    ? revenues
    : Array.isArray(client.revenues)
      ? client.revenues
      : null;

  if (revArray && revArray.length > 0) {
    const latest = revArray.reduce((a, b) => (Number(b.year) > Number(a.year) ? b : a));
    return parseFloat(latest.revenue_amount) || 0;
  }

  if (client.revenue && typeof client.revenue === 'object') {
    const years = Object.keys(client.revenue)
      .map(Number)
      .filter((y) => !Number.isNaN(y));
    if (years.length > 0) {
      const latestYear = Math.max(...years);
      return parseFloat(client.revenue[latestYear]) || 0;
    }
  }

  return 0;
}

/**
 * Calculate strategic value (0-10) for a single client.
 * @param {Object} client
 * @param {Array} [revenues]
 * @returns {number}
 */
function calculateStrategicValue(client, revenues = []) {
  const mostRecentRevenue = getMostRecentRevenue(client, revenues);

  // Revenue Score (0-10) — normalized so $500k maps to 10.
  const revenueScore = Math.min(10, (parseFloat(mostRecentRevenue) || 0) / 50000);

  // Relationship strength (1-10). Accept snake_case or camelCase; default 5.
  const relationshipStrength =
    parseFloat(client.relationship_strength ?? client.relationshipStrength) || 5;

  // Renewal probability (0-1) -> 0-10. Default 0.5 (neutral).
  const renewalProbabilityScore =
    (parseFloat(client.renewal_probability ?? client.renewalProbability) || 0.5) * 10;

  // Conflict risk penalty. Default 'Medium'.
  const conflictRisk = client.conflict_risk ?? client.conflictRisk ?? 'Medium';
  const conflictPenalty = { High: 3, Medium: 1, Low: 0 }[conflictRisk] ?? 1;

  const strategicValue =
    revenueScore * 0.5 +
    relationshipStrength * 0.35 +
    renewalProbabilityScore * 0.15 -
    conflictPenalty;

  return Math.max(0, Math.min(10, strategicValue));
}

/**
 * Calculate strategic scores for a list of clients.
 * Adds `strategicValue` and `averageRevenue` (most-recent-year revenue, kept
 * under the historical field name for frontend compatibility).
 * @param {Array} clients
 * @returns {Array}
 */
function calculateStrategicScores(clients) {
  if (!clients || clients.length === 0) {
    return [];
  }

  return clients.map((client) => {
    const strategicValue = calculateStrategicValue(client, client.revenues);
    const currentRevenue = getMostRecentRevenue(client, client.revenues);

    return {
      ...client,
      averageRevenue: Math.round(currentRevenue),
      strategicValue: Math.round(strategicValue * 100) / 100,
    };
  });
}

/**
 * Generate a portfolio summary from scored clients.
 * @param {Array} clients
 * @returns {Object}
 */
function generatePortfolioSummary(clients) {
  const totalRevenue = clients.reduce((sum, c) => sum + (c.averageRevenue || 0), 0);
  const avgStrategicValue = clients.length > 0
    ? clients.reduce((sum, c) => sum + (c.strategicValue || 0), 0) / clients.length
    : 0;

  const statusBreakdown = clients.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  const practiceAreas = clients.reduce((acc, c) => {
    if (c.practiceArea && Array.isArray(c.practiceArea)) {
      c.practiceArea.forEach((area) => {
        acc[area] = (acc[area] || 0) + 1;
      });
    }
    return acc;
  }, {});

  const riskProfile = clients.reduce((acc, c) => {
    acc[c.conflictRisk || 'Unknown'] = (acc[c.conflictRisk || 'Unknown'] || 0) + 1;
    return acc;
  }, {});

  const topClients = clients
    .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0))
    .slice(0, 5)
    .map((c) => ({
      name: c.name,
      revenue: c.averageRevenue || 0,
      strategicValue: c.strategicValue || 0,
      status: c.status,
      practiceArea: c.practiceArea || [],
    }));

  return {
    totalClients: clients.length,
    totalRevenue,
    avgStrategicValue: avgStrategicValue.toFixed(2),
    statusBreakdown,
    practiceAreas,
    riskProfile,
    topClients,
  };
}

module.exports = {
  getMostRecentRevenue,
  calculateStrategicValue,
  calculateStrategicScores,
  generatePortfolioSummary,
};
