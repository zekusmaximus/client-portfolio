const { processCSVData, validateClientData, calculateStrategicScores } = require('./utils/clientAnalyzer');

// Sample CSV data (as would come from Papaparse)
const sampleCSVData = [
  {
    "CLIENT": "50CAN",
    "Contract Period": "1/1/25-12/31/25",
    "2023 Contracts": "$72000.00",
    "2024 Contracts": "$72000.00",
    "2025 Contracts": "$72000.00"
  },
  {
    "CLIENT": "CTLA",
    "Contract Period": "1/1/23-12/31/25",
    "2023 Contracts": "$120000.00",
    "2024 Contracts": "$120000.00",
    "2025 Contracts": "$120000.00"
  },
  {
    "CLIENT": "Pfizer",
    "Contract Period": "1/1/25-12/31/27",
    "2023 Contracts": "$150000.00",
    "2024 Contracts": "$150000.00",
    "2025 Contracts": "$150000.00"
  }
];

console.log('Testing Client Analyzer...\n');

// Test CSV processing
console.log('1. Processing CSV data...');
const clients = processCSVData(sampleCSVData);
console.log(`Processed ${clients.length} clients`);
console.log('Sample client:', JSON.stringify(clients[0], null, 2));

// Test validation
console.log('\n2. Validating data...');
const validation = validateClientData(clients);
console.log('Validation result:', validation);

// Test strategic scoring
console.log('\n3. Calculating strategic scores...');
const clientsWithScores = calculateStrategicScores(clients);
console.log('Clients with scores:');
clientsWithScores.forEach(client => {
  console.log(`${client.name}: Strategic Value = ${client.strategicValue}, Status = ${client.status}`);
});

console.log('\nTest completed successfully!');

