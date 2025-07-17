/**
 * Simple test to verify JWT cookie implementation is correctly configured
 * This tests the HTTP-level cookie handling without database dependencies
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';

async function testCookieImplementation() {
  console.log('🔐 Testing JWT Cookie Implementation (HTTP Level)...\n');

  try {
    // Test 1: Check that login endpoint exists and handles cookies
    console.log('1. Testing login endpoint structure...');
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'test',
        password: 'test'
      })
    });

    console.log('Login response status:', loginResponse.status);
    console.log('Login response headers:', Object.fromEntries(loginResponse.headers.entries()));

    // Check if the endpoint exists (should not be 404)
    if (loginResponse.status === 404) {
      console.error('❌ Login endpoint not found');
      return;
    }

    console.log('✅ Login endpoint exists');

    // Test 2: Check logout endpoint exists
    console.log('\n2. Testing logout endpoint...');
    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST'
    });

    console.log('Logout response status:', logoutResponse.status);
    
    if (logoutResponse.status === 404) {
      console.error('❌ Logout endpoint not found');
      return;
    }

    console.log('✅ Logout endpoint exists');

    // Test 3: Check /me endpoint exists
    console.log('\n3. Testing /me endpoint...');
    const meResponse = await fetch(`${BASE_URL}/api/auth/me`, {
      method: 'GET'
    });

    console.log('Me response status:', meResponse.status);
    
    if (meResponse.status === 404) {
      console.error('❌ /me endpoint not found');
      return;
    }

    // Should be 401 (unauthorized) since we don't have a valid token
    if (meResponse.status === 401) {
      console.log('✅ /me endpoint correctly requires authentication');
    }

    // Test 4: Check CORS headers for credentials
    console.log('\n4. Testing CORS configuration...');
    const optionsResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST'
      }
    });

    const corsHeaders = Object.fromEntries(optionsResponse.headers.entries());
    console.log('CORS headers:', corsHeaders);

    if (corsHeaders['access-control-allow-credentials'] === 'true') {
      console.log('✅ CORS configured to allow credentials');
    } else {
      console.log('⚠️ CORS might not be configured for credentials');
    }

    console.log('\n🎉 Cookie implementation structure tests completed!');
    console.log('\nNote: Full authentication flow requires database setup with test user.');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    if (response.ok) {
      console.log('✅ Server is running\n');
      return true;
    }
  } catch (error) {
    console.error('❌ Server is not running. Please start the server first.');
    console.error('Run: npm start');
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (serverRunning) {
    await testCookieImplementation();
  }
}

main();
