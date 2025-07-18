/**
 * Client Portfolio Analysis Engine
 * Implements strategic value calculations and portfolio optimization algorithms
 */

// Helper function to decode HTML entities
function decodeHTMLEntities(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Derive contract status based on contract period and current date
 * @param {string} contractPeriod - Format: "M/D/YY-M/D/YY", "Expired M/D/YY", or "expires M/D/YY"
 * @returns {string} Status: 'IF' (In Force), 'D' (Done), 'P' (Proposal), 'H' (Hold)
 */
function deriveContractStatus(contractPeriod) {
  if (!contractPeriod || typeof contractPeriod !== 'string') {
    return 'H'; // Hold for invalid data
  }

  try {
    // Use current date: July 12, 2025 as specified in requirements
    const currentDate = new Date();
    
    // Handle "Expired" format
    if (contractPeriod.toLowerCase().startsWith('expired')) {
      return 'D'; // Done - already expired
    }
    
    // Handle "expires DATE" format
    if (contractPeriod.toLowerCase().startsWith('expires')) {
      const dateMatch = contractPeriod.match(/expires\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (dateMatch) {
        const expiryDate = new Date(dateMatch[1]);
        if (!isNaN(expiryDate.getTime())) {
          return expiryDate < currentDate ? 'D' : 'IF'; // Done if expired, In Force if still valid
        }
      }
      return 'H'; // Hold if we can't parse the date
    }
    
    // Handle standard "START-END" format
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
 * Calculate strategic value for a single client
 * @param {Object} client - Client object with basic information
 * @param {Array} revenues - Array of revenue objects with year and revenue_amount
 * @returns {number} Strategic value score (0-10)
 */
function calculateStrategicValue(client, revenues = []) {
  // Get the most recent year's revenue as primary financial input
  const mostRecentRevenue = revenues.length > 0 ? 
    revenues.reduce((latest, current) => 
      current.year > latest.year ? current : latest
    ).revenue_amount : 0;
  
  // Revenue Score (0-10) - normalized by $500k baseline
  const revenueScore = Math.min(10, (parseFloat(mostRecentRevenue) || 0) / 50000);
  
  // Relationship Strength (1-10, direct mapping) - default to 5 for neutral
  const relationshipStrength = parseFloat(client.relationship_strength) || 5;
  
  // Strategic Fit Score (1-10, direct mapping) - default to 5 for neutral
  const strategicFitScore = parseFloat(client.strategic_fit_score) || 5;
  
  // Renewal Probability (0-1, normalized to 0-10) - default to 0.5 for neutral
  const renewalProbabilityScore = (parseFloat(client.renewal_probability) || 0.5) * 10;
  
  // Conflict Risk Penalty - default to 'Medium' if null/undefined
  const conflictRisk = client.conflict_risk ?? 'Medium';
  const conflictPenalty = {
    'High': 3,
    'Medium': 1, 
    'Low': 0
  }[conflictRisk] ?? 1;
  
  // Re-balanced weights emphasizing revenue and relationship (removed strategic fit score)
  const strategicValue = (
    (revenueScore * 0.50) +           // Increased from 0.40
    (relationshipStrength * 0.35) +   // Increased from 0.30
    (renewalProbabilityScore * 0.15)  // Increased from 0.10
  ) - conflictPenalty;
  
  return Math.max(0, Math.min(10, strategicValue));
}

/**
 * Calculate strategic scores for all clients
 * @param {Array} clients - Array of client objects with revenues
 * @returns {Array} Clients with calculated scores
 */
function calculateStrategicScores(clients) {
  if (!clients || clients.length === 0) {
    return [];
  }
  
  return clients.map(client => {
    const revenues = client.revenues || [];
    const strategicValue = calculateStrategicValue(client, revenues);
    
    // Use 2025 revenue as the primary revenue figure (most recent year)
    let currentRevenue = 0;
    
    // Handle CSV format (client.revenue object)
    if (client.revenue && typeof client.revenue === 'object') {
      currentRevenue = parseFloat(client.revenue['2025']) || 0;
    }
    // Handle database format (client.revenues array)
    else if (revenues.length > 0) {
      const revenue2025 = revenues.find(rev => rev.year === 2025);
      currentRevenue = revenue2025 ? parseFloat(revenue2025.revenue_amount) || 0 : 0;
    }
    
    return {
      ...client,
      averageRevenue: Math.round(currentRevenue), // Keep field name for compatibility but use 2025 revenue
      strategicValue: Math.round(strategicValue * 100) / 100
    };
  });
}

/**
 * Optimize portfolio based on capacity constraints
 * @param {Array} clients - Array of client objects with strategic scores
 * @param {number} maxCapacity - Maximum available hours (deprecated but kept for compatibility)
 * @returns {Object} Optimization results
 */
function optimizePortfolio(clients, maxCapacity = 2000) {
  if (!clients || clients.length === 0) {
    return {
      clients: [],
      totalRevenue: 0,
      averageStrategicValue: 0,
      clientCount: 0
    };
  }

  // Filter eligible clients (In Force or Proposal) and sort by strategic value
  const eligibleClients = clients
    .filter(client => client.status === 'IF' || client.status === 'P')
    .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0));
  
  // Since timeCommitment is removed, we'll return top clients by strategic value
  const optimal = eligibleClients.slice(0, Math.min(eligibleClients.length, 50)); // Top 50 clients
  
  const totalRevenue = optimal.reduce((sum, client) => sum + (client.averageRevenue || 0), 0);
  const averageStrategicValue = optimal.length > 0 ? 
    optimal.reduce((sum, client) => sum + (client.strategicValue || 0), 0) / optimal.length : 0;
  
  return {
    clients: optimal,
    totalRevenue: Math.round(totalRevenue),
    averageStrategicValue: Math.round(averageStrategicValue * 100) / 100,
    clientCount: optimal.length,
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
      const clientName = decodeHTMLEntities(row.CLIENT.trim());
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
        renewalProbability: 0.7,
        strategicFitScore: 5,
        notes: '',
        // Calculated fields (will be computed)
        strategicValue: 0,
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
    // Valid formats: "M/D/YY-M/D/YY", "Expired M/D/YY", "expires M/D/YY"
    const hasValidFormat = client.contractPeriod && (
      client.contractPeriod.includes('-') || 
      client.contractPeriod.toLowerCase().startsWith('expired') ||
      client.contractPeriod.toLowerCase().startsWith('expires')
    );
    
    if (!hasValidFormat) {
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
  calculateStrategicValue,
  calculateStrategicScores,
  optimizePortfolio,
  processCSVData,
  validateClientData
};

