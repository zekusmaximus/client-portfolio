-- Database initialization script for Client Portfolio Dashboard
-- This script creates all necessary tables for the application

-- Create users table first (referenced by clients)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Prospect',
    practice_area TEXT[],
    relationship_strength INTEGER DEFAULT 5,
    conflict_risk VARCHAR(50) DEFAULT 'Medium',
    renewal_probability DECIMAL(3,2) DEFAULT 0.7,
    strategic_fit_score INTEGER DEFAULT 5,
    notes TEXT,
    primary_lobbyist VARCHAR(255),
    client_originator VARCHAR(255),
    lobbyist_team TEXT[],
    interaction_frequency VARCHAR(100),
    relationship_intensity INTEGER DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create client_revenues table
CREATE TABLE IF NOT EXISTS client_revenues (
    id SERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    revenue_amount NUMERIC(12, 2) NOT NULL,
    contract_end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, year)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_client_revenues_client_id ON client_revenues(client_id);
CREATE INDEX IF NOT EXISTS idx_client_revenues_year ON client_revenues(year);

-- No default users are created for security reasons
-- Use the create-admin.cjs script to create your first administrator account