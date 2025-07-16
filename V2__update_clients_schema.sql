-- Migration script to update clients table and create revenues table
-- This script removes old columns, adds new ones, and creates a separate revenues table

BEGIN;

-- Step 1: Remove columns from clients table
ALTER TABLE clients DROP COLUMN IF EXISTS timeCommitment;
ALTER TABLE clients DROP COLUMN IF EXISTS crisisManagement;

-- Step 2: Add new columns to clients table
ALTER TABLE clients ADD COLUMN client_originator VARCHAR(255);
ALTER TABLE clients ADD COLUMN lobbyist_team TEXT[];

-- Step 3: Remove revenue columns from clients table
ALTER TABLE clients DROP COLUMN IF EXISTS revenue_2023;
ALTER TABLE clients DROP COLUMN IF EXISTS revenue_2024;
ALTER TABLE clients DROP COLUMN IF EXISTS revenue_2025;
ALTER TABLE clients DROP COLUMN IF EXISTS average_revenue;

-- Step 4: Create new revenues table
CREATE TABLE revenues (
    id SERIAL PRIMARY KEY,
    client_id UUID NOT NULL,
    year INTEGER NOT NULL,
    revenue_amount NUMERIC(12, 2) NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Step 5: Add unique constraint on revenues table
ALTER TABLE revenues ADD CONSTRAINT unique_client_year UNIQUE (client_id, year);

COMMIT;