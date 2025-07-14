/**
 * Client Portfolio Analysis Engine
 * Implements strategic value calculations and portfolio optimization algorithms
 */

/**
 * Derive contract status based on contract period and current date
 * @param {string} contractPeriod - Format: "M/D/YY-M/D/YY"
 * @returns {string} Status: 'IF' (In Force), 'D' (Done), 'P' (Proposal), 'H' (Hold)
 */
function deriveContractStatus(contractPeriod) {
  if (!contractPeriod || typeof contractPeriod !== 'string') {
    return 'H'; // Hold for invalid data
  }

  try {
    // Use current date: July 12, 2025 as specified in requirements
    const currentDate = new Date('2025-07-12');
    const [startStr, endStr] = contractPeriod.split('-');
    
    if (!startStr || !endStr) {
      return 'H';
    }

    // Parse dates - handle both MM/DD/YY and M/D/YY formats
    const startDate = new Date(startStr.trim());
    const endDate = new Date(endStr.trim());
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return 'H';
    }
    
    if (currentDate >= startDate && currentDate <= endDate) {
      return 'IF'; // In Force
    }
    if (endDate < currentDate) {
      return 'D'; // Done
    }
    if (startDate > currentDate) {
      return 'P'; // Proposal
    }
    
    return 'H'; // Hold (fallback)
  } catch (error) {
    console.warn('Error parsing contract period:', contractPeriod, error);
    return 'H';
  }
}

/**
 * Calculate strategic scores for all clients
 * @param {Array} clients - Array of client objects
 * @returns {Array} Clients with calculated scores
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
    
    // Revenue Score (0-10) - normalized by portfolio range
    const revenueScore = maxRevenue === minRevenue ? 5 : 
      ((avgRevenue - minRevenue) / (maxRevenue - minRevenue)) * 10;
    
    // Growth Score (CAGR normalized 0-10, centered around 0% growth = 5 points)
    const initialRevenue = parseFloat(client.revenue?.['2023']) || 1;
    const finalRevenue = parseFloat(client.revenue?.['2025']) || 0;
    const cagr = initialRevenue > 0 ? Math.pow(finalRevenue / initialRevenue, 1/2) - 1 : 0;
    const growthScore = Math.max(0, Math.min(10, (cagr + 0.5) * 10));
    
    // Efficiency Score (Revenue per hour - normalized by $1000/hour baseline)
    const timeCommitment = parseFloat(client.timeCommitment) || 1;
    const efficiencyScore = timeCommitment > 0 ? 
      Math.min(10, (avgRevenue / timeCommitment) / 1000) : 0;
    
    // Strategic Value Calculation
    const relationshipStrength = parseFloat(client.relationshipStrength) || 5;
    const strategicFitScore = parseFloat(client.strategicFitScore) || 5;
    const renewalProbability = parseFloat(client.renewalProbability) || 0.5;
    
    const conflictPenalty = {
      'High': 3,
      'Medium': 1, 
      'Low': 0
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
      strategicValue: Math.max(0, Math.round(strategicValue * 100) / 100)
    };
  });
}

/**
 * Optimize portfolio based on capacity constraints
 * @param {Array} clients - Array of client objects with strategic scores
 * @param {number} maxCapacity - Maximum available hours
 * @returns {Object} Optimization results
 */
function optimizePortfolio(clients, maxCapacity = 2000) {
  if (!clients || clients.length === 0) {
    return {
      clients: [],
      totalRevenue: 0,
      totalHours: 0,
      averageStrategicValue: 0,
      utilizationRate: 0
    };
  }

  // Filter eligible clients (In Force or Proposal) and sort by strategic value
  const eligibleClients = clients
    .filter(client => client.status === 'IF' || client.status === 'P')
    .filter(client => (parseFloat(client.timeCommitment) || 0) > 0)
    .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0));
  
  const optimal = [];
  let usedCapacity = 0;
  
  // Greedy algorithm: select highest value clients that fit
  for (const client of eligibleClients) {
    const timeCommitment = parseFloat(client.timeCommitment) || 0;
    if (usedCapacity + timeCommitment <= maxCapacity) {
      optimal.push(client);
      usedCapacity += timeCommitment;
    }
  }
  
  const totalRevenue = optimal.reduce((sum, client) => sum + (client.averageRevenue || 0), 0);
  const averageStrategicValue = optimal.length > 0 ? 
    optimal.reduce((sum, client) => sum + (client.strategicValue || 0), 0) / optimal.length : 0;
  
  return {
    clients: optimal,
    totalRevenue: Math.round(totalRevenue),
    totalHours: Math.round(usedCapacity),
    averageStrategicValue: Math.round(averageStrategicValue * 100) / 100,
    utilizationRate: Math.round((usedCapacity / maxCapacity) * 100),
    excludedClients: eligibleClients.length - optimal.length
  };
}

/**
 * Process raw CSV data into client objects
 * @param {Array} csvData - Raw CSV data from Papaparse
 * @returns {Array} Processed client objects
 */
function processCSVData(csvData) {
  if (!csvData || !Array.isArray(csvData)) {
    return [];
  }

  return csvData
    .filter(row => row.CLIENT && row.CLIENT.trim()) // Filter out empty rows
    .map(row => {
      const clientName = row.CLIENT.trim();
      const contractPeriod = row['Contract Period'] || '';
      
      // Parse revenue data
      const revenue = {
        2023: parseFloat(row['2023 Contracts']?.replace(/[$,]/g, '')) || 0,
        2024: parseFloat(row['2024 Contracts']?.replace(/[$,]/g, '')) || 0,
        2025: parseFloat(row['2025 Contracts']?.replace(/[$,]/g, '')) || 0
      };
      
      // Generate UUID (simple version for demo)
      const id = 'client_' + Math.random().toString(36).substr(2, 9);
      
      return {
        id,
        name: clientName,
        contractPeriod,
        status: deriveContractStatus(contractPeriod),
        revenue,
        // Default enhancement fields
        practiceArea: [],
        relationshipStrength: 5,
        conflictRisk: 'Medium',
        timeCommitment: 40, // Default 40 hours/month
        renewalProbability: 0.7,
        strategicFitScore: 5,
        notes: '',
        // Calculated fields (will be computed)
        strategicValue: 0,
        growthScore: 0,
        efficiencyScore: 0,
        averageRevenue: 0
      };
    });
}

/**
 * Validate client data and identify issues
 * @param {Array} clients - Array of client objects
 * @returns {Object} Validation results
 */
function validateClientData(clients) {
  const issues = [];
  const warnings = [];
  
  clients.forEach((client, index) => {
    // Check for zero revenue
    const totalRevenue = (client.revenue?.['2023'] || 0) + 
                        (client.revenue?.['2024'] || 0) + 
                        (client.revenue?.['2025'] || 0);
    
    if (totalRevenue === 0) {
      warnings.push(`Client "${client.name}" has zero revenue across all years`);
    }
    
    // Check for malformed contract periods
    if (!client.contractPeriod || !client.contractPeriod.includes('-')) {
      issues.push(`Client "${client.name}" has invalid contract period: "${client.contractPeriod}"`);
    }
    
    // Check for missing client name
    if (!client.name || client.name.trim() === '') {
      issues.push(`Row ${index + 1} has missing client name`);
    }
  });
  
  return {
    isValid: issues.length === 0,
    issues,
    warnings,
    clientCount: clients.length,
    validClients: clients.filter(c => c.name && c.name.trim())
  };
}

module.exports = {
  deriveContractStatus,
  calculateStrategicScores,
  optimizePortfolio,
  processCSVData,
  validateClientData
};

