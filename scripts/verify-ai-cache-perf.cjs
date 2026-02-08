const { performance } = require('perf_hooks');
const assert = require('assert');

// Mock environment variables before importing anything
process.env.DATABASE_URL = 'postgres://mock:mock@localhost:5432/mock_db';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mock-secret';

console.log('Running benchmark...');

try {
  const router = require('../routes/scenarios.cjs');

  if (typeof router._getSuccessionScenarioAnalysis !== 'function') {
    console.error('Error: _getSuccessionScenarioAnalysis not exported from routes/scenarios.cjs');
    process.exit(1);
  }

  if (typeof router._setAnthropicClient !== 'function') {
    console.error('Error: _setAnthropicClient not exported from routes/scenarios.cjs');
    process.exit(1);
  }

  // Mock Anthropic client
  const mockAnthropic = {
    messages: {
      create: async () => {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms is enough
        return {
          content: [{ text: 'Mock AI Response' }]
        };
      }
    }
  };

  // Inject mock client
  router._setAnthropicClient(mockAnthropic);

  const mathResults = {
    departingLobbyists: ['Alice', 'Bob'],
    totalClientsAtRisk: 5,
    totalRevenueAtRisk: 50000,
    riskPercentage: 10,
    riskByLevel: {
      high: { count: 1, revenue: 10000 },
      medium: { count: 2, revenue: 20000 },
      low: { count: 2, revenue: 20000 }
    }
  };

  const portfolioSummary = {
    totalClients: 50,
    totalRevenue: 500000,
    avgStrategicValue: 7.5
  };

  const scenarioData = { type: 'succession' };

  (async () => {
    console.log('Starting benchmark...');

    // 1. First call (Cold)
    const start1 = performance.now();
    const result1 = await router._getSuccessionScenarioAnalysis(mathResults, portfolioSummary, scenarioData);
    const end1 = performance.now();
    console.log(`First call time: ${(end1 - start1).toFixed(2)}ms`);

    // 2. Second call (Cached)
    const start2 = performance.now();
    const result2 = await router._getSuccessionScenarioAnalysis(mathResults, portfolioSummary, scenarioData);
    const end2 = performance.now();
    console.log(`Second call time: ${(end2 - start2).toFixed(2)}ms`);

    if (end2 - start2 >= 100) {
      console.error('❌ Expected cache hit, but got slow response');
    } else {
      console.log('✅ CACHE HIT verified');
    }

    // 3. Third call with DIFFERENT input (Should miss)
    const mathResults2 = { ...mathResults, totalClientsAtRisk: 6 }; // Changed input
    const start3 = performance.now();
    const result3 = await router._getSuccessionScenarioAnalysis(mathResults2, portfolioSummary, scenarioData);
    const end3 = performance.now();
    console.log(`Third call (different input) time: ${(end3 - start3).toFixed(2)}ms`);

    if (end3 - start3 < 400) {
      console.error('❌ Expected cache miss, but got fast response');
    } else {
      console.log('✅ CACHE MISS verified for new input');
    }

  })();

} catch (error) {
  console.error('Benchmark failed:', error);
}
