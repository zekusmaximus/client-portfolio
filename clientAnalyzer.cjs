/**
 * Client Portfolio Analysis Engine
 * CSV processing.
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
      // As the sheet spells it: cells arrive as sent, trimmed, and are
      // neither escaped nor decoded (docs/plans/tier-2.md, WP5)
      const clientName = row.CLIENT.trim();
      
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
        conflictRisk: judged.conflict_risk || 'Medium',
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
  processCSVData,
  validateClientData
};

