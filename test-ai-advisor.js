#!/usr/bin/env node

/**
 * Test script for AI Advisor functionality
 * Tests the complete workflow: authentication -> database -> AI analysis
 */

const jwt = require('jsonwebtoken');

async function testAIAdvisor() {
  const baseUrl = 'http://localhost:5000';
  
  console.log('🧪 Testing AI Advisor functionality...\n');

  // Step 1: Health check
  console.log('1. Testing health endpoint...');
  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = await healthResponse.json();
    console.log('✅ Health check:', health);
    
    if (health.services.database !== 'connected') {
      console.error('❌ Database not connected');
      return;
    }
    
    if (health.services.anthropic !== 'configured') {
      console.error('❌ Anthropic API not configured');
      return;
    }
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return;
  }

  // Step 2: Create a test JWT token (requires user ID)
  console.log('\n2. Creating test JWT token...');
  const testUserId = 1; // Assuming admin user with ID 1 exists
  const token = jwt.sign(
    { userId: testUserId }, 
    process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development-only',
    { expiresIn: '1h' }
  );
  console.log('✅ Test token created for user ID:', testUserId);

  // Step 3: Test AI Advisor endpoint
  console.log('\n3. Testing AI Advisor analyze-portfolio endpoint...');
  try {
    const response = await fetch(`${baseUrl}/api/claude/analyze-portfolio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ AI Advisor request successful!');
      console.log('📊 Portfolio Summary:', {
        totalClients: result.portfolioSummary?.totalClients,
        totalRevenue: result.portfolioSummary?.totalRevenue
      });
      console.log('📝 Analysis preview:', result.analysis?.substring(0, 200) + '...');
    } else {
      console.error('❌ AI Advisor request failed:', response.status, result);
    }
  } catch (error) {
    console.error('❌ AI Advisor test failed:', error.message);
  }
}

// Import fetch for Node.js compatibility
import('node-fetch').then(({ default: fetch }) => {
  global.fetch = fetch;
  testAIAdvisor();
}).catch(() => {
  // Fallback for environments where node-fetch is not available
  console.log('⚠️  node-fetch not available, skipping test');
  console.log('💡 To run this test, install node-fetch or test manually via curl');
});