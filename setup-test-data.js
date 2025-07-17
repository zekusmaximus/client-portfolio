// Test script to verify frontend functionality with sample data
console.log('Setting up test data for frontend verification...');

// Sample client data with strategic values
const testClients = [
  {
    id: 'client-1',
    name: 'Altria Corporation',
    status: 'IF',
    practiceArea: ['Corporate', 'Regulatory'],
    relationship_strength: 8,
    conflict_risk: 'Low',
    renewal_probability: 0.85,
    strategic_fit_score: 7,
    notes: 'Long-standing client with strong relationship',
    primary_lobbyist: 'John Smith',
    strategicValue: 7.2, // This should now be calculated by backend
    revenues: [
      { year: 2023, revenue_amount: 82000 },
      { year: 2024, revenue_amount: 82000 },
      { year: 2025, revenue_amount: 82000 }
    ]
  },
  {
    id: 'client-2', 
    name: '50CAN',
    status: 'IF',
    practiceArea: ['Healthcare'],
    relationship_strength: 6,
    conflict_risk: 'Medium',
    renewal_probability: 0.7,
    strategic_fit_score: 6,
    notes: 'Healthcare advocacy organization',
    primary_lobbyist: 'Jane Doe',
    strategicValue: 5.1, // This should now be calculated by backend
    revenues: [
      { year: 2023, revenue_amount: 72000 },
      { year: 2024, revenue_amount: 72000 },
      { year: 2025, revenue_amount: 72000 }
    ]
  },
  {
    id: 'client-3',
    name: 'Advanced Behavioral Health',
    status: 'D',
    practiceArea: ['Healthcare'],
    relationship_strength: 4,
    conflict_risk: 'High',
    renewal_probability: 0.3,
    strategic_fit_score: 4,
    notes: 'Contract ended, renewal unlikely',
    primary_lobbyist: 'Bob Johnson',
    strategicValue: 2.8, // This should now be calculated by backend
    revenues: [
      { year: 2023, revenue_amount: 30000 },
      { year: 2024, revenue_amount: 30000 },
      { year: 2025, revenue_amount: 0 }
    ]
  }
];

// Store test data in localStorage to simulate what would come from the backend
const portfolioData = {
  state: {
    clients: testClients,
    optimizationParams: { maxCapacity: 2000 },
    currentView: 'client-details',
    isModalOpen: false,
    selectedClient: null
  },
  version: 0
};

localStorage.setItem('portfolio-storage', JSON.stringify(portfolioData));
console.log('✅ Test data loaded into localStorage');
console.log('🌐 Frontend should now display clients with strategic values');
console.log('📊 Navigate to "Client Details" tab to see the strategic value scores');
