#!/usr/bin/env node

/**
 * Secure Admin User Creation Script
 * 
 * This script creates a new administrator user with a securely hashed password.
 * It should be used to create the initial admin account after database setup.
 * 
 * Usage: node create-admin.cjs <username> <password>
 * 
 * Security Features:
 * - Hashes with utils/hash.cjs (bcrypt, BCRYPT_SALT_ROUNDS, default 12)
 * - Validates password strength requirements (utils/passwordPolicy.cjs)
 * - Prevents duplicate username creation
 * - Connects through db.cjs (DATABASE_URL, DATABASE_SSL)
 */

require('dotenv').config();
const { hash } = require('./utils/hash.cjs');
const { validatePassword, validateUsername } = require('./utils/passwordPolicy.cjs');

/**
 * Creates a new admin user in the database
 * @param {string} username - The admin username
 * @param {string} password - The admin password (plain text)
 */
async function createAdminUser(username, password) {
    let db;
    
    try {
        // Validate inputs
        const usernameValidation = validateUsername(username);
        if (!usernameValidation.isValid) {
            console.error('❌ Username validation failed:');
            usernameValidation.errors.forEach(error => console.error(`   - ${error}`));
            process.exit(1);
        }
        
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            console.error('❌ Password validation failed:');
            passwordValidation.errors.forEach(error => console.error(`   - ${error}`));
            process.exit(1);
        }
        
        // Check for DATABASE_URL
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            console.error('❌ DATABASE_URL environment variable not set');
            console.error('   Please ensure your .env file contains a valid DATABASE_URL');
            process.exit(1);
        }
        
        // Loaded here, not at the top: db.cjs reads DATABASE_URL when it is
        // first required, after main() may have overridden it.
        db = require('./db.cjs');
        
        console.log('🔗 Connecting to database...');
        
        // Check if username already exists
        const existingUserQuery = 'SELECT id FROM users WHERE username = $1';
        const existingUserResult = await db.query(existingUserQuery, [username]);
        
        if (existingUserResult.rows.length > 0) {
            console.error(`❌ Username '${username}' already exists`);
            console.error('   Please choose a different username');
            process.exit(1);
        }
        
        console.log('🔐 Hashing password...');
        
        // Hash the password
        const passwordHash = await hash(password);
        
        console.log('👤 Creating admin user...');
        
        // Insert the new admin user
        const insertUserQuery = `
            INSERT INTO users (username, password_hash, created_at, updated_at) 
            VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id, username, created_at
        `;
        
        const result = await db.query(insertUserQuery, [username, passwordHash]);
        const newUser = result.rows[0];
        
        console.log('✅ Admin user created successfully!');
        console.log(`   User ID: ${newUser.id}`);
        console.log(`   Username: ${newUser.username}`);
        console.log(`   Created: ${newUser.created_at}`);
        console.log('');
        console.log('🔒 Security Reminder:');
        console.log('   - Your password has been securely hashed and stored');
        console.log('   - Please store your credentials in a secure location');
        console.log('   - Consider enabling additional security measures for production');
        
    } catch (error) {
        console.error('❌ Failed to create admin user:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('   Database connection refused. Please ensure:');
            console.error('   - Database server is running');
            console.error('   - DATABASE_URL is correct');
            console.error('   - Network connectivity is available');
        } else if (error.code === '28P01') {
            console.error('   Authentication failed. Please check your database credentials.');
        } else if (error.code === '3D000') {
            console.error('   Database does not exist. Please create the database first.');
        }
        
        process.exit(1);
    } finally {
        if (db) {
            await db.pool.end();
        }
    }
}

/**
 * Main function
 */
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length < 2 || args.length > 4) {
        console.error('❌ Invalid usage');
        console.error('');
        console.error('Usage: node create-admin.cjs <username> <password> [db_user] [db_password]');
        console.error('');
        console.error('Examples:');
        console.error('  node create-admin.cjs myAdmin MySecurePassword123!');
        console.error('  node create-admin.cjs myAdmin MySecurePassword123! postgres myDbPassword');
        console.error('');
        console.error('Password Requirements:');
        console.error('  - At least 8 characters long');
        console.error('  - At least one uppercase letter');
        console.error('  - At least one lowercase letter');
        console.error('  - At least one number');
        console.error('  - At least one special character');
        console.error('');
        console.error('Username Requirements:');
        console.error('  - 3-50 characters long');
        console.error('  - Only letters, numbers, underscores, and hyphens');
        console.error('');
        console.error('Database Connection:');
        console.error('  - If db_user and db_password are not provided, uses DATABASE_URL from .env');
        console.error('  - If provided, overrides the DATABASE_URL with custom credentials');
        process.exit(1);
    }
    
    const [username, password, dbUser, dbPassword] = args;
    
    // If database credentials are provided, temporarily override the DATABASE_URL
    if (dbUser && dbPassword) {
        process.env.DATABASE_URL = `postgresql://${dbUser}:${dbPassword}@localhost:5432/client_portfolio`;
        console.log(`🔗 Using database credentials: ${dbUser}@localhost:5432/client_portfolio`);
    }
    
    console.log('🛡️  Client Portfolio Dashboard - Admin User Creation');
    console.log('================================================');
    console.log('');
    
    await createAdminUser(username, password);
}

// Run the script
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = { createAdminUser };
