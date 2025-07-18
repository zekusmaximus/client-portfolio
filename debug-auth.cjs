require('dotenv').config();
const { Pool } = require('pg');
const { sign, verify } = require('./utils/jwt.cjs');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function debugAuth() {
  try {
    console.log('🔍 Debugging Authentication and Database Issues...\n');
    
    // Test database connection
    console.log('1. Testing database connection...');
    const testResult = await db.query('SELECT NOW()');
    console.log('   ✅ Database connection successful:', testResult.rows[0].now);
    
    // Check tables exist
    console.log('\n2. Checking database tables...');
    const tablesResult = await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'');
    console.log('   Tables found:', tablesResult.rows.map(r => r.table_name));
    
    // Check users table
    console.log('\n3. Checking users table...');
    const usersResult = await db.query('SELECT id, username, created_at FROM users ORDER BY created_at DESC LIMIT 5');
    console.log('   Users found:', usersResult.rows.length);
    usersResult.rows.forEach(user => {
      console.log(`   - ID: ${user.id}, Username: ${user.username}, Created: ${user.created_at}`);
    });
    
    // Check clients table
    console.log('\n4. Checking clients table...');
    const clientsResult = await db.query('SELECT id, user_id, name, created_at FROM clients ORDER BY created_at DESC LIMIT 10');
    console.log('   Clients found:', clientsResult.rows.length);
    clientsResult.rows.forEach(client => {
      console.log(`   - ID: ${client.id}, User ID: ${client.user_id}, Name: ${client.name}, Created: ${client.created_at}`);
    });
    
    // Test JWT token structure
    console.log('\n5. Testing JWT token structure...');
    if (usersResult.rows.length > 0) {
      const testUser = usersResult.rows[0];
      const token = sign({ userId: testUser.id, username: testUser.username });
      console.log('   Token created for user:', testUser.username);
      
      const decoded = verify(token);
      console.log('   Decoded token:', decoded);
      console.log('   Available fields:', Object.keys(decoded));
      
      // Test both access patterns
      console.log('   req.user.id would be:', decoded.id);
      console.log('   req.user.userId would be:', decoded.userId);
    }
    
    await db.end();
    
  } catch (error) {
    console.error('❌ Error during debugging:', error.message);
    if (error.code) {
      console.error('   Error code:', error.code);
    }
  }
}

debugAuth();
