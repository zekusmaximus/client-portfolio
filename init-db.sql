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

-- Create clients table. user_id is the account that created the row; no current
-- code writes it or scopes by it (the book is shared since 2025-07-23). Removing
-- an account clears it and never removes the client.
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER CONSTRAINT clients_user_id_fkey REFERENCES users(id) ON DELETE SET NULL,
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
    stickiness SMALLINT,
    high_maintenance BOOLEAN DEFAULT false,
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

-- Stickiness + effort inputs (idempotent; also migrates pre-existing databases).
-- ADD COLUMN IF NOT EXISTS is a no-op when the columns already exist above.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stickiness SMALLINT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS high_maintenance BOOLEAN DEFAULT false;

-- One-time backfill: seed stickiness (1-5) from legacy relationship_intensity (1-10).
-- Only fills rows not yet set, so re-running never clobbers a partner's chosen value.
UPDATE clients
SET stickiness = GREATEST(1, LEAST(5, ROUND(relationship_intensity / 2.0)))::smallint
WHERE stickiness IS NULL AND relationship_intensity IS NOT NULL;

-- clients.user_id: ON DELETE CASCADE becomes ON DELETE SET NULL, so deleting a
-- user can never delete clients or, through them, revenue rows. Databases
-- created before this change have the cascade; the CREATE TABLE above no longer
-- does. The guard reads the catalog, so after the first start this is a no-op
-- that takes no lock. It matches the foreign key by column, not by name, so a
-- cascading key under any name is replaced by clients_user_id_fkey. The whole
-- file runs as one transaction (one multi-statement query from server.cjs):
-- a failure here leaves the constraint as it was.
DO $$
DECLARE
  fk name;
BEGIN
  FOR fk IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND con.conkey = ARRAY[att.attnum]
     WHERE con.contype = 'f'
       AND con.conrelid = 'clients'::regclass
       AND con.confrelid = 'users'::regclass
       AND att.attname = 'user_id'
       AND con.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE clients DROP CONSTRAINT %I', fk);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND con.conkey = ARRAY[att.attnum]
     WHERE con.contype = 'f'
       AND con.conrelid = 'clients'::regclass
       AND con.confrelid = 'users'::regclass
       AND att.attname = 'user_id'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- People in the book (docs/plans/people-and-second-chair.md, P1-P5). A role
-- describes a person's place in the book, not an app permission. People are
-- never deleted, only deactivated.
CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('partner', 'emeritus', 'associate')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS people_name_lower_key ON people (lower(name));

-- Seed the roster only into an empty table, so a rename or a role change made
-- in the app survives every restart.
INSERT INTO people (name, role)
SELECT v.name, v.role
  FROM (VALUES
    ('Brendan', 'partner'), ('Jeff', 'partner'), ('Joe', 'partner'),
    ('Kevin', 'partner'), ('Mike', 'partner'), ('Paula', 'partner'),
    ('Jay', 'emeritus')
  ) AS v(name, role)
 WHERE NOT EXISTS (SELECT 1 FROM people);

-- Each client: one lead (an active partner, enforced by the API), at most one
-- second chair (anyone else), and an originator whose credit can pass to the
-- firm. The legacy text columns (primary_lobbyist, lobbyist_team,
-- client_originator) stay and are still written, for older code after a
-- rollback. When a column already exists ADD COLUMN IF NOT EXISTS skips the
-- whole clause, foreign key included.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES people(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS second_chair_id INTEGER REFERENCES people(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS originator_id INTEGER REFERENCES people(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS originator_is_firm BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'clients'::regclass AND conname = 'clients_second_chair_not_lead'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_second_chair_not_lead
      CHECK (second_chair_id IS NULL OR second_chair_id <> lead_id);
  END IF;
END $$;

-- No default users are created for security reasons
-- Use the create-admin.cjs script to create your first administrator account