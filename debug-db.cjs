const db = require('./db.cjs');

async function debugDatabase() {
  try {
    console.log('🔍 Checking database connection...');
    await db.query('SELECT 1');
    console.log('✅ Database connected successfully');

    console.log('\n📊 Checking clients table...');
    const clientCount = await db.query('SELECT COUNT(*) FROM clients');
    console.log(`Total clients in database: ${clientCount.rows[0].count}`);

    if (parseInt(clientCount.rows[0].count) > 0) {
      console.log('\n📋 Sample clients:');
      const sampleClients = await db.query('SELECT id, name, status, user_id, created_at FROM clients LIMIT 5');
      console.table(sampleClients.rows);

      console.log('\n🔍 Checking user_id distribution:');
      const userIdStats = await db.query('SELECT user_id, COUNT(*) as client_count FROM clients GROUP BY user_id ORDER BY user_id');
      console.table(userIdStats.rows);
    } else {
      console.log('⚠️  No clients found in database');
    }

    console.log('\n👥 Checking users table...');
    const userCount = await db.query('SELECT COUNT(*) FROM users');
    console.log(`Total users in database: ${userCount.rows[0].count}`);

    if (parseInt(userCount.rows[0].count) > 0) {
      const users = await db.query('SELECT id, username, created_at FROM users');
      console.table(users.rows);
    } else {
      console.log('⚠️  No users found in database');
    }

    console.log('\n💰 Checking client_revenues table...');
    const revenueCount = await db.query('SELECT COUNT(*) FROM client_revenues');
    console.log(`Total revenue records: ${revenueCount.rows[0].count}`);

    if (parseInt(revenueCount.rows[0].count) > 0) {
      const sampleRevenues = await db.query('SELECT client_id, year, revenue_amount FROM client_revenues LIMIT 5');
      console.table(sampleRevenues.rows);
    }

    console.log('\n🔗 Testing client query with revenues (like the API does):');
    const clientsWithRevenues = await db.query(`
      SELECT c.*, jsonb_agg(
           jsonb_build_object(
             'id', r.id,
             'year', r.year,
             'revenue_amount', r.revenue_amount,
             'contract_end_date', r.contract_end_date
           ) ORDER BY r.year
         ) AS revenues
       FROM clients c
       LEFT JOIN client_revenues r ON r.client_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT 3
    `);
    
    console.log(`Clients with revenues query returned: ${clientsWithRevenues.rows.length} rows`);
    if (clientsWithRevenues.rows.length > 0) {
      console.log('Sample client with revenues:');
      console.log(JSON.stringify(clientsWithRevenues.rows[0], null, 2));
    }

  } catch (error) {
    console.error('❌ Database error:', error);
  } finally {
    process.exit(0);
  }
}

debugDatabase();