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
        
        // Check for required fields (name is minimum requirement)
        if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
          throw new Error(`Row ${i + 1}: Name is required and must be a non-empty string`);
        }
        
        // Validate name length and pattern
        if (row.name.trim().length > 255) {
          throw new Error(`Row ${i + 1}: Name must not exceed 255 characters`);
        }
        
        if (!/^[a-zA-Z0-9\s\-\.,&'()]+$/.test(row.name.trim())) {
          throw new Error(`Row ${i + 1}: Name contains invalid characters`);
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
    const clients = processCSVData(csvData);
    
    // Validate the processed data
    const validation = validateClientData(clients);
    
    // Calculate strategic scores
    const clientsWithScores = calculateStrategicScores(clients);
    
    // Save to database
    await (await client).query('BEGIN');
    
    const savedClients = [];
    
    for (const clientData of clientsWithScores) {
      // Insert client record
      const { rows: [newClient] } = await (await client).query(`
        INSERT INTO clients (
          name, status, practice_area, relationship_strength, conflict_risk,
          renewal_probability, strategic_fit_score, notes, primary_lobbyist,
          client_originator, lobbyist_team, interaction_frequency, relationship_intensity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [
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

      // Insert revenue records
      if (clientData.revenue) {
        for (const [year, amount] of Object.entries(clientData.revenue)) {
          if (amount && amount > 0) {
            await (await client).query(`
              INSERT INTO client_revenues (client_id, year, revenue_amount)
              VALUES ($1, $2, $3)
            `, [newClient.id, parseInt(year), amount]);
          }
        }
      }
      
      savedClients.push(newClient);
    }
    
    await (await client).query('COMMIT');
    
    res.json({
      success: true,
      clients: clientsWithScores,
      validation,
      summary: {
        totalClients: clientsWithScores.length,
        totalRevenue: clientsWithScores.reduce((sum, c) => sum + (c.averageRevenue || 0), 0),
        statusBreakdown: {
          'IF': clientsWithScores.filter(c => c.status === 'IF').length,
          'P': clientsWithScores.filter(c => c.status === 'P').length,
          'D': clientsWithScores.filter(c => c.status === 'D').length,
          'H': clientsWithScores.filter(c => c.status === 'H').length
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
    
    // Revenue by status
    const revenueByStatus = {
      'IF': 0, 'P': 0, 'D': 0, 'H': 0
    };
    clientsWithScores.forEach(client => {
      revenueByStatus[client.status] += client.averageRevenue || 0;
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

