/**
 * Strategic utility functions
 * Extracted from clientAnalyzer.cjs and claude.cjs (Stage 4 refactor)
 */

/**
 * Calculate strategic scores for all clients
 * @param {Array} clients
 * @returns {Array}
 */
function calculateStrategicScores(clients) {
  if (!clients || clients.length === 0) {
    return [];
  }

  // Calculate average revenues for normalization
  const revenues = clients.map(client => {
    const rev2023 = parseFloat(client.revenue?.['2023']) || 0;
    const rev2024 = parseFloat(client.revenue?.['2024']) || 0;
    const rev2025 = parseFloat(client.revenue?.['2025']) || 0;
    return (rev2023 + rev2024 + rev2025) / 3;
  });

  const maxRevenue = Math.max(...revenues);
  const minRevenue = Math.min(...revenues);

  return clients.map((client, index) => {
    const avgRevenue = revenues[index];

    // Revenue Score (0–10)
    const revenueScore = maxRevenue === minRevenue ? 5 :
      ((avgRevenue - minRevenue) / (maxRevenue - minRevenue)) * 10;

    // Growth Score (CAGR normalised 0–10)
    const initialRevenue = parseFloat(client.revenue?.['2023']) || 1;
    const finalRevenue = parseFloat(client.revenue?.['2025']) || 0;
    const cagr = initialRevenue > 0 ? Math.pow(finalRevenue / initialRevenue, 1 / 2) - 1 : 0;
    const growthScore = Math.max(0, Math.min(10, (cagr + 0.5) * 10));

    // Efficiency Score (Revenue / hour)
    const timeCommitment = parseFloat(client.timeCommitment) || 1;
    const efficiencyScore = timeCommitment > 0 ?
      Math.min(10, (avgRevenue / timeCommitment) / 1000) : 0;

    // Strategic Value
    const relationshipStrength = parseFloat(client.relationshipStrength) || 5;
    const strategicFitScore = parseFloat(client.strategicFitScore) || 5;
    const renewalProbability = parseFloat(client.renewalProbability) || 0.5;

    const conflictPenalty = {
      High: 3,
      Medium: 1,
      Low: 0,
    }[client.conflictRisk] || 1;

    const strategicValue = (
      (revenueScore * 0.30) +
      (growthScore * 0.20) +
      (relationshipStrength * 0.20) +
      (strategicFitScore * 0.15) +
      (renewalProbability * 10 * 0.10) +
      (efficiencyScore * 0.05)
    ) - conflictPenalty;

    return {
      ...client,
      averageRevenue: Math.round(avgRevenue),
      revenueScore: Math.round(revenueScore * 100) / 100,
      growthScore: Math.round(growthScore * 100) / 100,
      efficiencyScore: Math.round(efficiencyScore * 100) / 100,
      strategicValue: Math.max(0, Math.round(strategicValue * 100) / 100),
    };
  });
}

/**
 * Generate a portfolio summary
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
  calculateStrategicScores,
  generatePortfolioSummary,
};