const express = require('express');
const router = express.Router();
const {
  processCSVData,
  validateClientData,
  calculateStrategicScores,
  optimizePortfolio
} = require('./clientAnalyzer.cjs');

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

// POST /api/data/process-csv
router.post('/process-csv', (req, res) => {
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
    console.error('CSV processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process CSV data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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


module.exports = router;

