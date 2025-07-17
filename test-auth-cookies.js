/**
 * Test script to verify JWT cookie authentication is working correctly
 * Run with: node test-auth-cookies.js
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';

async function testAuthFlow() {
  console.log('🔐 Testing JWT Cookie Authentication...\n');

  try {
    // Test 1: Login with valid credentials
    console.log('1. Testing login...');
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'password123'
      })
    });

    const loginData = await loginResponse.json();
    
    if (!loginResponse.ok) {
      console.error('❌ Login failed:', loginData);
      return;
    }

    console.log('✅ Login successful:', loginData);

    // Extract cookies from response
    const cookies = loginResponse.headers.get('set-cookie');
    console.log('🍪 Cookies received:', cookies);

    if (!cookies || !cookies.includes('authToken=')) {
      console.error('❌ No authToken cookie found in response');
      return;
    }

    // Test 2: Access protected route with cookie
    console.log('\n2. Testing protected route access...');
    const meResponse = await fetch(`${BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Cookie': cookies
      }
    });

    const meData = await meResponse.json();
    
    if (!meResponse.ok) {
      console.error('❌ Protected route access failed:', meData);
      return;
    }

    console.log('✅ Protected route access successful:', meData);

    // Test 3: Logout
    console.log('\n3. Testing logout...');
    const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Cookie': cookies
      }
    });

    const logoutData = await logoutResponse.json();
    
    if (!logoutResponse.ok) {
      console.error('❌ Logout failed:', logoutData);
      return;
    }

    console.log('✅ Logout successful:', logoutData);

    // Test 4: Try accessing protected route after logout
    console.log('\n4. Testing protected route access after logout...');
    const afterLogoutResponse = await fetch(`${BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Cookie': logoutResponse.headers.get('set-cookie') || cookies
      }
    });

    if (afterLogoutResponse.ok) {
      console.error('❌ Protected route should not be accessible after logout');
      return;
    }

    console.log('✅ Protected route correctly blocked after logout');

    console.log('\n🎉 All authentication tests passed!');

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
    await testAuthFlow();
  }
}

main();
