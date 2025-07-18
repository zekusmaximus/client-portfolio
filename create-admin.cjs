#!/usr/bin/env node

/**
 * Secure Admin User Creation Script
 * 
 * This script creates a new administrator user with a securely hashed password.
 * It should be used to create the initial admin account after database setup.
 * 
 * Usage: node create-admin.js <username> <password>
 * 
 * Security Features:
 * - Uses bcrypt with 12 salt rounds for password hashing
 * - Validates password strength requirements
 * - Prevents duplicate username creation
 * - Secure database connection handling
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

// Configuration
const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Validates password strength
 * @param {string} password - The password to validate
 * @returns {object} - Validation result with isValid boolean and errors array
 */
function validatePassword(password) {
    const errors = [];
    
    if (password.length < MIN_PASSWORD_LENGTH) {
        errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }
    
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validates username
 * @param {string} username - The username to validate
 * @returns {object} - Validation result with isValid boolean and errors array
 */
function validateUsername(username) {
    const errors = [];
    
    if (!username || username.trim().length === 0) {
        errors.push('Username is required');
    }
    
    if (username.length < 3) {
        errors.push('Username must be at least 3 characters long');
    }
    
    if (username.length > 50) {
        errors.push('Username must be no more than 50 characters long');
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        errors.push('Username can only contain letters, numbers, underscores, and hyphens');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Creates a new admin user in the database
 * @param {string} username - The admin username
 * @param {string} password - The admin password (plain text)
 */
async function createAdminUser(username, password) {
    let pool;
    
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
        
        // Create database connection
        pool = new Pool({
            connectionString,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        });
        
        console.log('🔗 Connecting to database...');
        
        // Check if username already exists
        const existingUserQuery = 'SELECT id FROM users WHERE username = $1';
        const existingUserResult = await pool.query(existingUserQuery, [username]);
        
        if (existingUserResult.rows.length > 0) {
            console.error(`❌ Username '${username}' already exists`);
            console.error('   Please choose a different username');
            process.exit(1);
        }
        
        console.log('🔐 Hashing password...');
        
        // Hash the password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        console.log('👤 Creating admin user...');
        
        // Insert the new admin user
        const insertUserQuery = `
            INSERT INTO users (username, password_hash, created_at, updated_at) 
            VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id, username, created_at
        `;
        
        const result = await pool.query(insertUserQuery, [username, passwordHash]);
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
        if (pool) {
            await pool.end();
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

module.exports = { createAdminUser, validatePassword, validateUsername };
