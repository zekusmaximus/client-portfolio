// Test script to verify practice area transformation fix
console.log('Testing practice area field transformation...');

// Simulate raw database client data (with practice_area field)
const rawDatabaseClients = [
  {
    id: 'test-1',
    name: 'Test Client 1',
    practice_area: ['Healthcare', 'Corporate'],
    relationship_strength: 8,
    conflict_risk: 'Low',
    renewal_probability: 0.85,
    strategic_fit_score: 7,
    revenues: [
      { year: 2023, revenue_amount: 50000 },
      { year: 2024, revenue_amount: 55000 },
      { year: 2025, revenue_amount: 60000 }
    ]
  },
  {
    id: 'test-2',
    name: 'Test Client 2',
    practice_area: ['Municipal'],
    relationship_strength: 6,
    conflict_risk: 'Medium',
    renewal_probability: 0.7,
    strategic_fit_score: 5,
    revenues: [
      { year: 2023, revenue_amount: 30000 },
      { year: 2024, revenue_amount: 32000 },
      { year: 2025, revenue_amount: 35000 }
    ]
  },
  {
    id: 'test-3',
    name: 'Test Client 3',
    practice_area: null, // Client with no practice area
    relationship_strength: 4,
    conflict_risk: 'High',
    renewal_probability: 0.5,
    strategic_fit_score: 3,
    revenues: [
      { year: 2023, revenue_amount: 20000 },
      { year: 2024, revenue_amount: 18000 },
      { year: 2025, revenue_amount: 15000 }
    ]
  }
];

// Apply the transformation logic from data.cjs
const transformedClients = rawDatabaseClients.map(client => {
  // Build revenue object for 2023-2025
  const revenue = { '2023': 0, '2024': 0, '2025': 0 };
  if (Array.isArray(client.revenues)) {
    client.revenues.forEach((r) => {
      if (['2023', '2024', '2025'].includes(String(r.year))) {
        revenue[r.year] = parseFloat(r.revenue_amount) || 0;
      }
    });
  }

  return {
    ...client,
    revenue,
    // Transform database field names to frontend-expected names
    practiceArea: client.practice_area || [],
    relationshipStrength: client.relationship_strength || 5,
    conflictRisk: client.conflict_risk || 'Medium',
    renewalProbability: client.renewal_probability || 0.7,
    strategicFitScore: client.strategic_fit_score || 5,
    timeCommitment: client.time_commitment || 40,
  };
});

// Simulate the practice area aggregation logic from DashboardView.jsx
const practiceAreas = {};
transformedClients.forEach(client => {
  const clientRevenue = Object.values(client.revenue).reduce((sum, rev) => sum + rev, 0) / 3; // Simple average

  if (client.practiceArea && Array.isArray(client.practiceArea) && client.practiceArea.length > 0) {
    client.practiceArea.forEach(area => {
      if (!practiceAreas[area]) {
        practiceAreas[area] = { count: 0, revenue: 0 };
      }
      practiceAreas[area].count++;
      practiceAreas[area].revenue += clientRevenue;
    });
  } else {
    // Handle clients without practice area or with empty array
    if (!practiceAreas['Not Specified']) {
      practiceAreas['Not Specified'] = { count: 0, revenue: 0 };
    }
    practiceAreas['Not Specified'].count++;
    practiceAreas['Not Specified'].revenue += clientRevenue;
  }
});

console.log('\n=== TRANSFORMATION TEST RESULTS ===');
console.log('\n1. Raw database clients (before transformation):');
rawDatabaseClients.forEach(client => {
  console.log(`  - ${client.name}: practice_area = ${JSON.stringify(client.practice_area)}`);
});

console.log('\n2. Transformed clients (after transformation):');
transformedClients.forEach(client => {
  console.log(`  - ${client.name}: practiceArea = ${JSON.stringify(client.practiceArea)}`);
});

console.log('\n3. Practice area aggregation results:');
Object.entries(practiceAreas).forEach(([area, data]) => {
  const percentage = ((data.revenue / Object.values(practiceAreas).reduce((sum, p) => sum + p.revenue, 0)) * 100).toFixed(1);
  console.log(`  - ${area}: ${data.count} clients, $${Math.round(data.revenue)} revenue (${percentage}%)`);
});

console.log('\n✅ Test completed - the transformation should now correctly categorize clients by practice area!');
console.log('🎯 Expected result: Healthcare, Corporate, Municipal areas should show up, plus "Not Specified" for client 3');
