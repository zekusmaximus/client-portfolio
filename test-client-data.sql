-- Insert test client data for user ID 2 (testadmin)
INSERT INTO clients (
    user_id, 
    name, 
    status, 
    practice_area, 
    relationship_strength, 
    conflict_risk, 
    renewal_probability, 
    strategic_fit_score, 
    notes
) VALUES (
    2,
    'Acme Corporation',
    'Active',
    ARRAY['Technology', 'Healthcare'],
    8,
    'Low',
    0.85,
    7,
    'Key strategic client with strong growth potential'
);

-- Get the client ID for revenue insertion
DO $$ 
DECLARE 
    client_uuid UUID;
BEGIN
    SELECT id INTO client_uuid FROM clients WHERE user_id = 2 AND name = 'Acme Corporation';
    
    -- Insert revenue data
    INSERT INTO client_revenues (client_id, year, revenue_amount, contract_end_date) VALUES
    (client_uuid, 2023, 250000.00, '2023-12-31'),
    (client_uuid, 2024, 300000.00, '2024-12-31'),
    (client_uuid, 2025, 350000.00, '2025-12-31');
END $$;