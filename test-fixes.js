/**
 * Test script to verify revenue calculation and contract period parsing fixes
 */

const {
  deriveContractStatus,
  calculateStrategicScores,
  validateClientData,
  processCSVData
} = require('./clientAnalyzer.cjs');

console.log('=== Testing Contract Period Parsing ===');

// Test expired contract
const expiredStatus = deriveContractStatus('Expired 9/20/21');
console.log('Expired 9/20/21 → Status:', expiredStatus, '(Expected: D)');

// Test expires contract (expired date)
const expiredExpiresStatus = deriveContractStatus('expires 2/1/23');
console.log('expires 2/1/23 → Status:', expiredExpiresStatus, '(Expected: D)');

// Test expires contract (future date)
const futureExpiresStatus = deriveContractStatus('expires 2/1/26');
console.log('expires 2/1/26 → Status:', futureExpiresStatus, '(Expected: IF)');

// Test normal contract period
const normalStatus = deriveContractStatus('1/1/25-12/31/25');
console.log('1/1/25-12/31/25 → Status:', normalStatus, '(Expected: IF)');

console.log('\n=== Testing Revenue Calculation ===');

// Test CSV format clients
const testClients = [
  {
    id: 'test1',
    name: 'Test Client 1',
    revenue: {
      '2023': 50000,
      '2024': 60000,
      '2025': 70000
    },
    contractPeriod: '1/1/25-12/31/25'
  },
  {
    id: 'test2',
    name: 'Test Client 2',
    revenue: {
      '2023': 100000,
      '2024': 110000,
      '2025': 120000
    },
    contractPeriod: 'Expired 9/20/21'
  }
];

const scoredClients = calculateStrategicScores(testClients);
console.log('Client 1 - 2025 Revenue: $70,000, Calculated averageRevenue:', scoredClients[0].averageRevenue);
console.log('Client 2 - 2025 Revenue: $120,000, Calculated averageRevenue:', scoredClients[1].averageRevenue);

// Calculate total revenue
const totalRevenue = scoredClients.reduce((sum, client) => sum + client.averageRevenue, 0);
console.log('Total Revenue from test clients:', totalRevenue, '(Expected: 190000)');

console.log('\n=== Testing Validation ===');

// Test validation with new contract formats
const validationTestClients = [
  {
    name: 'Curaleaf',
    contractPeriod: 'Expired 9/20/21',
    revenue: { '2023': 60000, '2024': 60000, '2025': 60000 }
  },
  {
    name: 'FuelCell Energy',
    contractPeriod: 'expires 2/1/23',
    revenue: { '2023': 60000, '2024': 60000, '2025': 60000 }
  },
  {
    name: 'Invalid Client',
    contractPeriod: 'Invalid Format',
    revenue: { '2023': 60000, '2024': 60000, '2025': 60000 }
  }
];

const validation = validateClientData(validationTestClients);
console.log('Validation Results:');
console.log('- Valid:', validation.isValid);
console.log('- Issues:', validation.issues);
console.log('- Warnings:', validation.warnings);

console.log('\n=== Testing with Sample CSV Data ===');

// Test with sample CSV row format
const sampleCSVData = [
  {
    CLIENT: 'Curaleaf',
    'Contract Period': 'Expired 9/20/21',
    '2023 Contracts': '$60,000.0',
    '2024 Contracts': '$60,000.0',
    '2025 Contracts': '$60,000.0'
  },
  {
    CLIENT: 'FuelCell Energy',
    'Contract Period': 'expires 2/1/23',
    '2023 Contracts': '$60,000.0',
    '2024 Contracts': '$60,000.0',
    '2025 Contracts': '$60,000.0'
  }
];

const processedCSVClients = processCSVData(sampleCSVData);
console.log('Processed CSV Clients:');
processedCSVClients.forEach(client => {
  console.log(`- ${client.name}: Status=${client.status}, 2025 Revenue=${client.revenue['2025']}`);
});

const csvValidation = validateClientData(processedCSVClients);
console.log('CSV Validation Results:');
console.log('- Valid:', csvValidation.isValid);
console.log('- Issues:', csvValidation.issues);
console.log('- Warnings:', csvValidation.warnings);

console.log('\n=== Test Complete ===');
