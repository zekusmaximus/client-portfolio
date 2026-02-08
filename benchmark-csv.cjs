const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fetch = require('node-fetch');

// Configuration
const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;
const CSV_SIZE = 500; // Number of records to process

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function runBenchmark() {
  console.log('🚀 Starting Benchmark...');

  // 1. Setup Database & User
  const client = await pool.connect();
  let userId;
  try {
    // Create a temporary user for testing
    const userRes = await client.query(`
      INSERT INTO users (username, password_hash)
      VALUES ('benchmark_user_' || extract(epoch from now()), 'hash')
      RETURNING id, username
    `);
    userId = userRes.rows[0].id;
    const username = userRes.rows[0].username;
    console.log(`👤 Created benchmark user: ${username} (ID: ${userId})`);

    // Generate JWT token
    const token = jwt.sign(
      { id: userId, username: username },
      process.env.JWT_SECRET || 'change_me', // Fallback to default if not set
      { expiresIn: '1h' }
    );

    // 2. Generate Mock CSV Data
    console.log(`📝 Generating ${CSV_SIZE} client records...`);
    const csvData = [];
    for (let i = 0; i < CSV_SIZE; i++) {
      csvData.push({
        CLIENT: `Client ${i} - ${Date.now()}`,
        'Contract Period': '1/1/25-12/31/25',
        '2023 Contracts': '$10,000',
        '2024 Contracts': '$20,000',
        '2025 Contracts': '$30,000',
        'Practice Area': 'Government Relations',
        'Relationship Strength': '5',
        'Conflict Risk': 'Low',
        'Renewal Probability': '0.9',
        'Strategic Fit Score': '8',
        'Notes': 'Benchmark test client',
        'Primary Lobbyist': 'Jane Doe',
        'Client Originator': 'John Smith',
        'Lobbyist Team': 'Team A',
        'Interaction Frequency': 'Weekly',
        'Relationship Intensity': '7'
      });
    }

    // 3. Start Server (if not running, but for benchmark we assume we run against running server or start one)
    // To keep it simple, we assume the user runs `npm start` in another terminal, or we spawn it.
    // However, I will try to hit the server directly if it's running.
    // Checking if port is open...
    let serverRunning = false;
    try {
      await fetch(`${BASE_URL}/api/health`);
      serverRunning = true;
    } catch (e) {
      console.log('⚠️  Server not detected on port ' + PORT + '. Starting it locally...');
    }

    let serverProcess;
    if (!serverRunning) {
      // We can't easily require server.cjs because it starts listening immediately and we might have port conflicts if we are not careful or if we want to shut it down cleanly.
      // But for this environment, let's assume we can just require it.
      // However, require cache might be an issue if we run this multiple times.
      // Better to spawn a child process.
      const { spawn } = require('child_process');
      serverProcess = spawn('node', ['server.cjs'], {
        stdio: 'inherit',
        env: { ...process.env, PORT: PORT }
      });

      // Wait for server to be ready
      console.log('⏳ Waiting for server to start...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    }

    // 4. Run Benchmark
    console.log('⏱️  Sending request to process CSV...');
    const startTime = process.hrtime();

    const response = await fetch(`${BASE_URL}/api/data/process-csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // Use Bearer token
        // Also cookie if needed, but auth middleware checks header too
      },
      body: JSON.stringify({ csvData })
    });

    const endTime = process.hrtime(startTime);
    const durationInSeconds = endTime[0] + endTime[1] / 1e9;

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Request successful!');
      console.log(`📊 Processed ${result.summary.totalClients} clients.`);
      console.log(`⏱️  Time taken: ${durationInSeconds.toFixed(4)} seconds`);
      console.log(`⚡ Rate: ${(CSV_SIZE / durationInSeconds).toFixed(2)} clients/sec`);
    } else {
      console.error('❌ Request failed:', response.status, response.statusText);
      const text = await response.text();
      console.error('Response:', text);
    }

    // 5. Cleanup
    if (serverProcess) {
      serverProcess.kill();
    }

    // Clean up DB data (optional, but good for repeatability)
    // await client.query('DELETE FROM clients WHERE user_id = $1', [userId]);
    // await client.query('DELETE FROM users WHERE id = $1', [userId]);

  } catch (error) {
    console.error('❌ Benchmark failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runBenchmark();
