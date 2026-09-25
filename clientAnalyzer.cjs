/**
 * Client Portfolio Analysis Engine
 * CSV processing and portfolio optimization.
 *
 * Strategic-value scoring lives in ./utils/strategic.cjs (single source of
 * truth) and is re-exported here for the data.cjs/CSV path. Do NOT reimplement
 * scoring in this file — keep one formula.
 */

const {
  calculateStrategicValue,
  calculateStrategicScores,
} = require('./utils/strategic.cjs');
const {
  extractRevenueYears,
  headerKeys,
  parseAmount,
  revenueYearOfHeader,
  rowNumberOf,
  findSheetColumns,
  readSheetRow,
} = require('./utils/csvImport.cjs');

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
 * Optimize portfolio based on capacity constraints
 * @param {Array} clients - Array of client objects with strategic scores
 * @param {number} _maxCapacity - Maximum available hours (deprecated but kept for compatibility)
 * @returns {Object} Optimization results
 */
function optimizePortfolio(clients, _maxCapacity = 2000) {
  if (!clients || clients.length === 0) {
    return {
      clients: [],
      totalRevenue: 0,
      averageStrategicValue: 0,
      clientCount: 0
    };
  }

  // Every client is eligible; sort by strategic value
  const eligibleClients = [...clients]
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
 * Process raw CSV data into client objects.
 *
 * Revenue years are read from the file's `YYYY Contracts` headers (D5): the
 * `revenue` object carries exactly those years, and the sorted list is
 * attached to every client as `revenueYears`.
 *
 * The import sheet's optional columns (docs/plans/people-and-second-chair.md,
 * section 3) are read by readSheetRow into `sheet` ({ values, people,
 * errors }); the judgment values present in the file also replace the
 * defaults below, so the scores in the response use them. `rowNumber` is the
 * row as a spreadsheet shows it, the header being row 1.
 * @param {Array} csvData - Raw CSV data from Papaparse
 * @returns {Array} Processed client objects
 */
function processCSVData(csvData) {
  if (!csvData || !Array.isArray(csvData)) {
    return [];
  }

  // The file's revenue columns: one `YYYY Contracts` header per year
  const headers = headerKeys(csvData);
  const revenueYears = extractRevenueYears(headers);
  const columnByYear = {};
  for (const header of headers) {
    const year = revenueYearOfHeader(header);
    if (year !== null && !(year in columnByYear)) columnByYear[year] = header;
  }
  const { columns } = findSheetColumns(headers);

  return csvData
    .map((row, index) => ({ row, rowNumber: rowNumberOf(index) }))
    .filter(({ row }) => row.CLIENT && row.CLIENT.trim()) // Filter out empty rows
    .map(({ row, rowNumber }) => {
      const clientName = decodeHTMLEntities(row.CLIENT.trim());
      
      // Revenue for exactly the years the file covers
      const revenue = {};
      for (const year of revenueYears) {
        revenue[year] = parseAmount(row[columnByYear[year]]);
      }
      
      // Generate UUID (simple version for demo)
      const id = 'client_' + Math.random().toString(36).substr(2, 9);

      // The sheet's people and judgment columns, where the file has them
      const sheet = readSheetRow(row, columns);
      const judged = sheet.values;
      
      return {
        id,
        name: clientName,
        revenue,
        revenueYears: [...revenueYears],
        rowNumber,
        // Default enhancement fields
        practiceArea: judged.practice_area || [],
        relationshipStrength: 5,
        conflictRisk: judged.conflict_risk || 'Medium',
        renewalProbability: 0.7,
        strategicFitScore: 5,
        notes: judged.notes || '',
        ...('stickiness' in judged ? { stickiness: judged.stickiness } : {}),
        ...('interaction_frequency' in judged ? { interaction_frequency: judged.interaction_frequency } : {}),
        ...('high_maintenance' in judged ? { high_maintenance: judged.high_maintenance } : {}),
        sheet,
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
    // Check for zero revenue across the years the file covered
    const revenue = client.revenue && typeof client.revenue === 'object' ? client.revenue : {};
    const importedYears = Object.keys(revenue);
    const totalRevenue = importedYears.reduce((sum, year) => sum + (parseFloat(revenue[year]) || 0), 0);

    if (importedYears.length > 0 && totalRevenue === 0) {
      warnings.push(`Client "${client.name}" has zero revenue across all imported years`);
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
  calculateStrategicValue,
  calculateStrategicScores,
  optimizePortfolio,
  processCSVData,
  validateClientData
};

