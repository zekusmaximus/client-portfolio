const express = require('express');
const router = express.Router();
const db = require('./db.cjs');
const auth = require('./middleware/auth.cjs');
const { body, validationResult } = require('express-validator');
const { sanitizeRequestBody } = require('./middleware/validation.cjs');
const {
  processCSVData,
  validateClientData,
  calculateStrategicScores,
  optimizePortfolio
} = require('./clientAnalyzer.cjs');

// Apply authentication middleware to all routes
router.use(auth);
router.use(sanitizeRequestBody);

// Helper function to decode HTML entities
function decodeHTMLEntities(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Helper to calculate strategic value for a single client
function calculateStrategicValue(client) {
  // 1. Convert qualitative fields
  const intensityScore = client.relationshipIntensity ?? 5;           // 1-10
  const crisisNeedsMap = { Low: 1, Medium: 5, High: 9 };
  const crisisScore = 10 - (crisisNeedsMap[client.crisisManagementNeeds] ?? 5);

  // 2. Quantitative defaults
  const revenueScore            = client.revenueScore           ?? 0;
  const growthScore             = client.growthScore            ?? 0;
  const strategicFitScore       = client.strategicFitScore      ?? 5;
  const renewalProbabilityScore = (client.renewalProbability ?? 0.7) * 10;

  // 3. Conflict penalty
  const conflictPenalty = { High: 3, Medium: 1, Low: 0 }[client.conflictRisk] ?? 1;

  // 4. Weighted formula
  const value = (
    revenueScore            * 0.20 +
    intensityScore          * 0.30 +
    strategicFitScore       * 0.15 +
    renewalProbabilityScore * 0.15 +
    crisisScore             * 0.10 +
    growthScore             * 0.10
  ) - conflictPenalty;

  return Math.max(0, Math.min(12, value));
}

// Validation for CSV processing
const csvValidationRules = [
  body('csvData')
    .isArray({ min: 1 })
    .withMessage('CSV data must be a non-empty array')
    .custom((csvData) => {
      if (!Array.isArray(csvData)) return true;
      
      // Validate each row has required structure
      for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];
        if (!row || typeof row !== 'object') {
          throw new Error(`Row ${i + 1}: Must be an object`);
        }
        
        // Check for required fields (CLIENT is minimum requirement)
        if (!row.CLIENT || typeof row.CLIENT !== 'string' || !row.CLIENT.trim()) {
          throw new Error(`Row ${i + 1}: CLIENT is required and must be a non-empty string`);
        }
        
        // Validate CLIENT length and pattern
        if (row.CLIENT.trim().length > 255) {
          throw new Error(`Row ${i + 1}: CLIENT must not exceed 255 characters`);
        }
        
        // Decode HTML entities for validation
        const decodedClient = decodeHTMLEntities(row.CLIENT.trim());
        
        if (!/^[a-zA-Z0-9\s\-\.,&'()\/]+$/.test(decodedClient)) {
          throw new Error(`Row ${i + 1}: CLIENT contains invalid characters`);
        }
      }
      
      return true;
    })
];

// Handle validation errors for CSV
const handleCSVValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));
    
    return res.status(400).json({
      error: 'CSV validation failed',
      details: errorMessages
    });
  }
  
  next();
};

// POST /api/data/process-csv
router.post('/process-csv', csvValidationRules, handleCSVValidationErrors, async (req, res) => {
  const client = db.pool.connect();
  
  try {
    const { csvData } = req.body;
    
    if (!csvData || !Array.isArray(csvData)) {
      return res.status(400).json({ 
        error: 'Invalid CSV data. Expected array of objects.' 
      });
    }

    // Process the CSV data
    // First, decode HTML entities in the raw CSV data
    const decodedCsvData = csvData.map(row => {
      const decodedRow = {};
      for (const [key, value] of Object.entries(row)) {
        decodedRow[key] = typeof value === 'string' ? decodeHTMLEntities(value) : value;
      }
      return decodedRow;
    });
    
    const clients = processCSVData(decodedCsvData);
    
    // Validate the processed data
    const validation = validateClientData(clients);
    
    // Calculate strategic scores
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Save to database using upsert logic
    await (await client).query('BEGIN');
    
    const savedClients = [];
    let updatedCount = 0;
    let insertedCount = 0;
    
    for (const clientData of clientsWithScores) {
      // Check if client exists by name (case-insensitive)
      const { rows: existingClients } = await (await client).query(`
        SELECT id, name, practice_area, relationship_strength, conflict_risk,
               renewal_probability, strategic_fit_score, notes, primary_lobbyist,
               client_originator, lobbyist_team, interaction_frequency, relationship_intensity
        FROM clients 
        WHERE LOWER(name) = LOWER($1) AND user_id = $2
      `, [clientData.name || '', req.user.userId]);

      let currentClient;
      
      if (existingClients.length > 0) {
        // Client exists - UPDATE with CSV data, preserve manual enhancements
        const existingClient = existingClients[0];
        
        // Preserve manual enhancements (only if they were manually set and differ from defaults)
        const preservedPracticeArea = existingClient.practice_area && existingClient.practice_area.length > 0 
          ? existingClient.practice_area 
          : clientData.practiceArea || [];
        
        const preservedRelationshipStrength = existingClient.relationship_strength !== 5 
          ? existingClient.relationship_strength 
          : clientData.relationshipStrength || 5;
        
        const preservedConflictRisk = existingClient.conflict_risk !== 'Medium' 
          ? existingClient.conflict_risk 
          : clientData.conflictRisk || 'Medium';
        
        const preservedRenewalProbability = existingClient.renewal_probability !== 0.7 
          ? existingClient.renewal_probability 
          : clientData.renewalProbability || 0.7;
        
        const preservedStrategicFitScore = existingClient.strategic_fit_score !== 5 
          ? existingClient.strategic_fit_score 
          : clientData.strategicFitScore || 5;
        
        const preservedNotes = existingClient.notes && existingClient.notes.trim() !== '' 
          ? existingClient.notes 
          : clientData.notes || '';
        
        const preservedPrimaryLobbyist = existingClient.primary_lobbyist && existingClient.primary_lobbyist.trim() !== '' 
          ? existingClient.primary_lobbyist 
          : clientData.primaryLobbyist || '';
        
        const preservedClientOriginator = existingClient.client_originator && existingClient.client_originator.trim() !== '' 
          ? existingClient.client_originator 
          : clientData.clientOriginator || '';
        
        const preservedLobbyistTeam = existingClient.lobbyist_team && existingClient.lobbyist_team.length > 0 
          ? existingClient.lobbyist_team 
          : clientData.lobbyistTeam || [];
        
        const preservedInteractionFrequency = existingClient.interaction_frequency && existingClient.interaction_frequency.trim() !== '' 
          ? existingClient.interaction_frequency 
          : clientData.interactionFrequency || '';
        
        const preservedRelationshipIntensity = existingClient.relationship_intensity !== 5 
          ? existingClient.relationship_intensity 
          : clientData.relationshipIntensity || 5;

        // Update existing client with CSV data but preserve manual enhancements
        const { rows: [updatedClient] } = await (await client).query(`
          UPDATE clients SET 
            name = $1,
            status = $2,
            practice_area = $3,
            relationship_strength = $4,
            conflict_risk = $5,
            renewal_probability = $6,
            strategic_fit_score = $7,
            notes = $8,
            primary_lobbyist = $9,
            client_originator = $10,
            lobbyist_team = $11,
            interaction_frequency = $12,
            relationship_intensity = $13,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $14 AND user_id = $15
          RETURNING *
        `, [
          clientData.name || '',
          clientData.status || 'H',
          preservedPracticeArea,
          preservedRelationshipStrength,
          preservedConflictRisk,
          preservedRenewalProbability,
          preservedStrategicFitScore,
          preservedNotes,
          preservedPrimaryLobbyist,
          preservedClientOriginator,
          preservedLobbyistTeam,
          preservedInteractionFrequency,
          preservedRelationshipIntensity,
          existingClient.id,
          req.user.userId
        ]);

        currentClient = updatedClient;
        updatedCount++;
      } else {
        // Client doesn't exist - INSERT new client
        const { rows: [newClient] } = await (await client).query(`
          INSERT INTO clients (
            user_id, name, status, practice_area, relationship_strength, conflict_risk,
            renewal_probability, strategic_fit_score, notes, primary_lobbyist,
            client_originator, lobbyist_team, interaction_frequency, relationship_intensity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `, [
          req.user.userId,
          clientData.name || '',
          clientData.status || 'H',
          clientData.practiceArea || [],
          clientData.relationshipStrength || 5,
          clientData.conflictRisk || 'Medium',
          clientData.renewalProbability || 0.7,
          clientData.strategicFitScore || 5,
          clientData.notes || '',
          clientData.primaryLobbyist || '',
          clientData.clientOriginator || '',
          clientData.lobbyistTeam || [],
          clientData.interactionFrequency || '',
          clientData.relationshipIntensity || 5
        ]);

        currentClient = newClient;
        insertedCount++;
      }

      // Handle revenue updates - DELETE existing and INSERT new
      if (clientData.revenue) {
        // Delete existing revenue records for this client
        await (await client).query(`
          DELETE FROM client_revenues 
          WHERE client_id = $1
        `, [currentClient.id]);

        // Insert new revenue records from CSV
        for (const [year, amount] of Object.entries(clientData.revenue)) {
          if (amount && amount > 0) {
            await (await client).query(`
              INSERT INTO client_revenues (client_id, year, revenue_amount)
              VALUES ($1, $2, $3)
            `, [currentClient.id, parseInt(year), amount]);
          }
        }
      }
      
      savedClients.push(currentClient);
    }
    
    await (await client).query('COMMIT');
    
    res.json({
      success: true,
      clients: clientsWithScores,
      validation,
      summary: {
        totalClients: clientsWithScores.length,
        updatedClients: updatedCount,
        newClients: insertedCount,
        totalRevenue: clientsWithScores.reduce((sum, c) => sum + (c.averageRevenue || 0), 0),
        statusBreakdown: {
          'Active': clientsWithScores.filter(c => c.status === 'Active' || c.status === 'IF').length,
          'Prospect': clientsWithScores.filter(c => c.status === 'Prospect' || c.status === 'P').length,
          'Former': clientsWithScores.filter(c => c.status === 'Former' || c.status === 'D').length,
          'Inactive': clientsWithScores.filter(c => c.status === 'Inactive' || c.status === 'H').length
        }
      }
    });

  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('CSV processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process CSV data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});

// POST /api/data/update-client
router.post('/update-client', (req, res) => {
  try {
    const { clients, updatedClient } = req.body;
    
    if (!clients || !Array.isArray(clients) || !updatedClient) {
      return res.status(400).json({ 
        error: 'Invalid request. Expected clients array and updatedClient object.' 
      });
    }

    // Calculate new strategic value for the updated client
    updatedClient.strategicValue = calculateStrategicValue(updatedClient);

    // Update the client in the array (replace old record)
    const updatedClients = clients.map(client =>
      client.id === updatedClient.id ? { ...client, ...updatedClient } : client
    );

    // Return the full updated clients array
    res.json({
      success: true,
      clients: updatedClients
    });

  } catch (error) {
    console.error('Client update error:', error);
    res.status(500).json({ 
      error: 'Failed to update client data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/data/optimize-portfolio
router.post('/optimize-portfolio', (req, res) => {
  try {
    const { clients, maxCapacity = 2000 } = req.body;
    
    if (!clients || !Array.isArray(clients)) {
      return res.status(400).json({ 
        error: 'Invalid request. Expected clients array.' 
      });
    }

    // Ensure clients have strategic scores
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Optimize the portfolio
    const optimization = optimizePortfolio(clientsWithScores, maxCapacity);
    
    res.json({
      success: true,
      optimization,
      parameters: {
        maxCapacity,
        totalEligibleClients: clientsWithScores.filter(c => 
          (c.status === 'IF' || c.status === 'P') && (parseFloat(c.timeCommitment) || 0) > 0
        ).length
      }
    });

  } catch (error) {
    console.error('Portfolio optimization error:', error);
    res.status(500).json({ 
      error: 'Failed to optimize portfolio',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/data/analytics
router.post('/analytics', (req, res) => {
  try {
    const { clients } = req.body;
    
    if (!clients || !Array.isArray(clients)) {
      return res.status(400).json({ 
        error: 'Invalid request. Expected clients array.' 
      });
    }

    // Calculate analytics
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Practice area breakdown
    const practiceAreas = {};
    clientsWithScores.forEach(client => {
      if (client.practiceArea && Array.isArray(client.practiceArea)) {
        client.practiceArea.forEach(area => {
          if (!practiceAreas[area]) {
            practiceAreas[area] = { count: 0, revenue: 0 };
          }
          practiceAreas[area].count++;
          practiceAreas[area].revenue += client.averageRevenue || 0;
        });
      }
    });
    
    // Revenue by status - using new status labels that match client cards
    const revenueByStatus = {
      'Active': 0, 'Prospect': 0, 'Inactive': 0, 'Former': 0
    };
    clientsWithScores.forEach(client => {
      const clientStatus = client.status;
      
      // Map old status codes to new labels if needed
      const statusMapping = {
        'IF': 'Active',
        'P': 'Prospect', 
        'D': 'Former',
        'H': 'Inactive'
      };
      
      const mappedStatus = statusMapping[clientStatus] || clientStatus || 'Prospect';
      
      if (revenueByStatus.hasOwnProperty(mappedStatus)) {
        revenueByStatus[mappedStatus] += client.averageRevenue || 0; // averageRevenue already contains 2025 data only
      } else {
        revenueByStatus['Prospect'] += client.averageRevenue || 0; // Default fallback
      }
    });
    
    // Top clients by strategic value
    const topClients = clientsWithScores
      .sort((a, b) => (b.strategicValue || 0) - (a.strategicValue || 0))
      .slice(0, 10);
    
    res.json({
      success: true,
      analytics: {
        practiceAreas,
        revenueByStatus,
        topClients,
        totalRevenue: clientsWithScores.reduce((sum, c) => sum + (c.averageRevenue || 0), 0),
        averageStrategicValue: clientsWithScores.length > 0 ? 
          clientsWithScores.reduce((sum, c) => sum + (c.strategicValue || 0), 0) / clientsWithScores.length : 0
      }
    });

  } catch (error) {
    console.error('Analytics calculation error:', error);
    res.status(500).json({ 
      error: 'Failed to calculate analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/data/clients - Get all clients with aggregated revenue data
router.get('/clients', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        c.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'year', r.year,
              'revenue_amount', r.revenue_amount
            ) ORDER BY r.year
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS revenues
      FROM clients c
      LEFT JOIN client_revenues r ON r.client_id = c.id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [req.user.userId]);
    
    // Transform database fields to frontend-expected field names
    const transformedClients = rows.map(client => {
      // Build revenue object for 2023-2025
      const revenue = { '2023': 0, '2024': 0, '2025': 0 };
      if (Array.isArray(client.revenues)) {
        client.revenues.forEach((r) => {
          if (['2023', '2024', '2025'].includes(String(r.year))) {
            revenue[r.year] = parseFloat(r.revenue_amount) || 0;
          }
        });
      }

      return {
        ...client,
        revenue,
        // Transform database field names to frontend-expected names
        practiceArea: client.practice_area || [],
        relationshipStrength: client.relationship_strength || 5,
        conflictRisk: client.conflict_risk || 'Medium',
        renewalProbability: client.renewal_probability || 0.7,
        strategicFitScore: client.strategic_fit_score || 5,
        timeCommitment: client.time_commitment || 40,
      };
    });
    
    // Calculate strategic scores for all clients before returning
    const clientsWithScores = calculateStrategicScores(transformedClients);
    
    res.json({
      success: true,
      clients: clientsWithScores
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ 
      error: 'Failed to fetch clients',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/data/clients - Create new client with revenues
router.post('/clients', async (req, res) => {
  const client = db.pool.connect();
  
  try {
    await (await client).query('BEGIN');
    
    const {
      name,
      status,
      practice_area,
      relationship_strength,
      conflict_risk,
      renewal_probability,
      strategic_fit_score,
      notes,
      primary_lobbyist,
      client_originator,
      lobbyist_team,
      interaction_frequency,
      relationship_intensity,
      revenues = []
    } = req.body;

    // Insert client record
    const { rows: [newClient] } = await (await client).query(`
      INSERT INTO clients (
        user_id, name, status, practice_area, relationship_strength, conflict_risk,
        renewal_probability, strategic_fit_score, notes, primary_lobbyist,
        client_originator, lobbyist_team, interaction_frequency, relationship_intensity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      req.user.userId, name, status, practice_area, relationship_strength, conflict_risk,
      renewal_probability, strategic_fit_score, notes, primary_lobbyist,
      client_originator, lobbyist_team, interaction_frequency, relationship_intensity
    ]);

    // Insert revenue records
    for (const revenue of revenues) {
      await (await client).query(`
        INSERT INTO client_revenues (client_id, year, revenue_amount)
        VALUES ($1, $2, $3)
      `, [newClient.id, revenue.year, revenue.revenue_amount]);
    }

    await (await client).query('COMMIT');
    
    // Fetch the complete client with revenues
    const { rows } = await db.query(`
      SELECT 
        c.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'year', r.year,
              'revenue_amount', r.revenue_amount
            ) ORDER BY r.year
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS revenues
      FROM clients c
      LEFT JOIN client_revenues r ON r.client_id = c.id
      WHERE c.id = $1 AND c.user_id = $2
      GROUP BY c.id
    `, [newClient.id, req.user.userId]);

    // Transform database fields to frontend-expected field names
    const transformedClients = rows.map(client => {
      // Build revenue object for 2023-2025
      const revenue = { '2023': 0, '2024': 0, '2025': 0 };
      if (Array.isArray(client.revenues)) {
        client.revenues.forEach((r) => {
          if (['2023', '2024', '2025'].includes(String(r.year))) {
            revenue[r.year] = parseFloat(r.revenue_amount) || 0;
          }
        });
      }

      return {
        ...client,
        revenue,
        // Transform database field names to frontend-expected names
        practiceArea: client.practice_area || [],
        relationshipStrength: client.relationship_strength || 5,
        conflictRisk: client.conflict_risk || 'Medium',
        renewalProbability: client.renewal_probability || 0.7,
        strategicFitScore: client.strategic_fit_score || 5,
        timeCommitment: client.time_commitment || 40,
      };
    });

    // Calculate strategic scores for the new client
    const clientsWithScores = calculateStrategicScores(transformedClients);

    res.status(201).json({
      success: true,
      client: clientsWithScores[0]
    });
    
  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('Error creating client:', error);
    res.status(500).json({ 
      error: 'Failed to create client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});

// PUT /api/data/clients/:id - Update client with revenues
router.put('/clients/:id', async (req, res) => {
  const client = db.pool.connect();
  
  try {
    await (await client).query('BEGIN');
    
    const clientId = req.params.id;
    const {
      name,
      status,
      practice_area,
      relationship_strength,
      conflict_risk,
      renewal_probability,
      strategic_fit_score,
      notes,
      primary_lobbyist,
      client_originator,
      lobbyist_team,
      interaction_frequency,
      relationship_intensity,
      revenues = []
    } = req.body;

    // Update client record
    const { rows: [updatedClient] } = await (await client).query(`
      UPDATE clients SET 
        name = $1, status = $2, practice_area = $3, relationship_strength = $4,
        conflict_risk = $5, renewal_probability = $6, strategic_fit_score = $7,
        notes = $8, primary_lobbyist = $9, client_originator = $10,
        lobbyist_team = $11, interaction_frequency = $12, relationship_intensity = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14 AND user_id = $15
      RETURNING *
    `, [
      name, status, practice_area, relationship_strength, conflict_risk,
      renewal_probability, strategic_fit_score, notes, primary_lobbyist,
      client_originator, lobbyist_team, interaction_frequency, relationship_intensity,
      clientId, req.user.userId
    ]);

    if (!updatedClient) {
      await (await client).query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }

    // Delete existing revenues
    await (await client).query('DELETE FROM client_revenues WHERE client_id = $1', [clientId]);

    // Insert new revenues
    for (const revenue of revenues) {
      await (await client).query(`
        INSERT INTO client_revenues (client_id, year, revenue_amount)
        VALUES ($1, $2, $3)
      `, [clientId, revenue.year, revenue.revenue_amount]);
    }

    await (await client).query('COMMIT');
    
    // Fetch the complete updated client with revenues
    const { rows } = await db.query(`
      SELECT 
        c.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'year', r.year,
              'revenue_amount', r.revenue_amount
            ) ORDER BY r.year
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS revenues
      FROM clients c
      LEFT JOIN client_revenues r ON r.client_id = c.id
      WHERE c.id = $1 AND c.user_id = $2
      GROUP BY c.id
    `, [clientId, req.user.userId]);

    // Transform database fields to frontend-expected field names
    const transformedClients = rows.map(client => {
      // Build revenue object for 2023-2025
      const revenue = { '2023': 0, '2024': 0, '2025': 0 };
      if (Array.isArray(client.revenues)) {
        client.revenues.forEach((r) => {
          if (['2023', '2024', '2025'].includes(String(r.year))) {
            revenue[r.year] = parseFloat(r.revenue_amount) || 0;
          }
        });
      }

      return {
        ...client,
        revenue,
        // Transform database field names to frontend-expected names
        practiceArea: client.practice_area || [],
        relationshipStrength: client.relationship_strength || 5,
        conflictRisk: client.conflict_risk || 'Medium',
        renewalProbability: client.renewal_probability || 0.7,
        strategicFitScore: client.strategic_fit_score || 5,
        timeCommitment: client.time_commitment || 40,
      };
    });

    // Calculate strategic scores for the updated client
    const clientsWithScores = calculateStrategicScores(transformedClients);

    res.json({
      success: true,
      client: clientsWithScores[0]
    });
    
  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('Error updating client:', error);
    res.status(500).json({ 
      error: 'Failed to update client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});

// DELETE /api/data/clients/:id - Delete client and associated revenues
router.delete('/clients/:id', async (req, res) => {
  const client = db.pool.connect();
  
  try {
    await (await client).query('BEGIN');
    
    const clientId = req.params.id;

    // First delete associated revenues
    await (await client).query('DELETE FROM client_revenues WHERE client_id = $1', [clientId]);

    // Then delete the client (with user_id check for security)
    const { rowCount } = await (await client).query(
      'DELETE FROM clients WHERE id = $1 AND user_id = $2', 
      [clientId, req.user.userId]
    );

    if (rowCount === 0) {
      await (await client).query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }

    await (await client).query('COMMIT');
    
    res.status(204).end();
    
  } catch (error) {
    await (await client).query('ROLLBACK');
    console.error('Error deleting client:', error);
    res.status(500).json({ 
      error: 'Failed to delete client',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    (await client).release();
  }
});


module.exports = router;

