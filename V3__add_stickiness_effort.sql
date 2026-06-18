-- V3: Stickiness + effort inputs (Product Brief step 1)
--
-- Adds the two new client inputs that drive the consolidated score and the
-- partner effort model:
--   stickiness        SMALLINT  -- 1-5 roommate<->cold-call scale (flight risk)
--   high_maintenance  BOOLEAN   -- "handful" flag; bumps effort above cadence
--
-- Idempotent. Also applied automatically on server boot via init-db.sql; this
-- standalone file exists for manual / out-of-band migration of existing databases.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS stickiness SMALLINT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS high_maintenance BOOLEAN DEFAULT false;

-- Seed stickiness (1-5) from legacy relationship_intensity (1-10). Only fills
-- rows not yet set, so re-running never overwrites a partner's chosen value.
UPDATE clients
SET stickiness = GREATEST(1, LEAST(5, ROUND(relationship_intensity / 2.0)))::smallint
WHERE stickiness IS NULL AND relationship_intensity IS NOT NULL;
