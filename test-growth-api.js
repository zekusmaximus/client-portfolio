/**
 * Test script to verify growth scenario API endpoint
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:5000';

async function testGrowthScenario() {
  console.log('=== Testing Growth Scenario API ===');

  try {
    const requestData = {
      scenarioData: {
        targetRevenue: 750000,
        timeHorizon: 12,
        growthStrategy: 'organic'
      },
      portfolioId: 'test'
    };

    console.log('Sending request:', JSON.stringify(requestData, null, 2));

    const response = await fetch(`${BASE_URL}/api/scenarios/growth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add a test cookie for authentication if needed
        'Cookie': 'token=test-token'
      },
      body: JSON.stringify(requestData)
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    const responseBody = await response.text();
    console.log('Response body:', responseBody);

    if (response.ok) {
      const data = JSON.parse(responseBody);
      console.log('✅ Success! Growth scenario API working correctly');
      console.log('Math results keys:', Object.keys(data.mathResults || {}));
      console.log('AI insights available:', !!data.aiInsights);
    } else {
      console.log('❌ API request failed');
      console.log('Status:', response.status);
      console.log('Body:', responseBody);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error.stack);
  }
}

// Also test with the old format to see if backend handles it
async function testOldFormat() {
  console.log('\n=== Testing Old Request Format (should fail) ===');

  try {
    const requestData = {
      clientIds: ['test1', 'test2'],
      currentRevenue: 500000,
      targetRevenue: 750000
    };

    console.log('Sending old format request:', JSON.stringify(requestData, null, 2));

    const response = await fetch(`${BASE_URL}/api/scenarios/growth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'token=test-token'
      },
      body: JSON.stringify(requestData)
    });

    const responseBody = await response.text();
    console.log('Response status:', response.status);
    console.log('Response body:', responseBody);

    if (response.status === 400 && responseBody.includes('scenarioData is required')) {
      console.log('✅ Expected: Old format correctly rejected');
    } else {
      console.log('❌ Unexpected response to old format');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

if (require.main === module) {
  (async () => {
    await testGrowthScenario();
    await testOldFormat();
    console.log('\n=== Test Complete ===');
  })();
}
