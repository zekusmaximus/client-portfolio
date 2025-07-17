// Test script to verify strategic value calculation
const { calculateStrategicScores } = require('./clientAnalyzer.cjs');

// Sample client data similar to what would come from the database
const sampleClients = [
  {
    id: 'test-1',
    name: 'High Value Client',
    relationship_strength: 9,
    conflict_risk: 'Low',
    renewal_probability: 0.9,
    strategic_fit_score: 8,
    revenues: [
      { year: 2023, revenue_amount: 100000 },
      { year: 2024, revenue_amount: 120000 },
      { year: 2025, revenue_amount: 150000 }
    ]
  },
  {
    id: 'test-2', 
    name: 'Medium Value Client',
    relationship_strength: 6,
    conflict_risk: 'Medium',
    renewal_probability: 0.7,
    strategic_fit_score: 6,
    revenues: [
      { year: 2023, revenue_amount: 50000 },
      { year: 2024, revenue_amount: 55000 },
      { year: 2025, revenue_amount: 60000 }
    ]
  },
  {
    id: 'test-3',
    name: 'Low Value Client', 
    relationship_strength: 3,
    conflict_risk: 'High',
    renewal_probability: 0.4,
    strategic_fit_score: 3,
    revenues: [
      { year: 2023, revenue_amount: 20000 },
      { year: 2024, revenue_amount: 18000 },
      { year: 2025, revenue_amount: 15000 }
    ]
  }
];

console.log('Testing Strategic Value Calculation...\n');

const clientsWithScores = calculateStrategicScores(sampleClients);

clientsWithScores.forEach(client => {
  console.log(`Client: ${client.name}`);
  console.log(`  Strategic Value: ${client.strategicValue}`);
  console.log(`  Average Revenue: $${client.averageRevenue.toLocaleString()}`);
  console.log(`  Relationship Strength: ${client.relationship_strength}`);
  console.log(`  Conflict Risk: ${client.conflict_risk}`);
  console.log('  ---');
});

console.log('\n✅ Strategic value calculation test completed!');
