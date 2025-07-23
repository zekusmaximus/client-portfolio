const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { handleValidationErrors, sanitizeRequestBody } = require('../middleware/validation.cjs');
const clientModel = require('../models/clientModel.cjs');
const { generatePortfolioSummary } = require('../utils/strategic.cjs');

// Initialize Anthropic client (reuse pattern from claude.cjs)
let anthropic = null;

try {
  const { Anthropic } = require('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ No API key found for scenarios. Set ANTHROPIC_API_KEY, CLAUDE_API_KEY, or OPENAI_API_KEY');
    anthropic = null;
  } else {
    anthropic = new Anthropic({ apiKey });
    console.log('✅ Anthropic client initialized for scenarios');
  }
} catch (error) {
  console.error('❌ Failed to initialize Anthropic client for scenarios:', error.message);
  anthropic = null;
}

// Apply middleware
router.use(auth);
router.use(sanitizeRequestBody);

/* -------------------------------------------------------------------------- */
/*                            SUCCESSION PLANNING                            */
/* -------------------------------------------------------------------------- */

// POST /api/scenarios/succession
router.post('/succession', handleValidationErrors, async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({
        success: false,
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration' : undefined
      });
    }

    const { scenarioData, portfolioId } = req.body;
    const userId = req.user.userId;

    if (!scenarioData) {
      return res.status(400).json({ success: false, error: 'scenarioData is required' });
    }

    // Fetch portfolio data from database
    const clients = await clientModel.listWithMetrics(userId);
    if (!clients.length) {
      return res.status(400).json({ success: false, error: 'No clients found for user' });
    }

    // Calculate mathematical results
    const mathResults = calculateSuccessionMath(clients, scenarioData);

    // Create portfolio summary for AI analysis
    const portfolioSummary = generatePortfolioSummary(clients);

    // Get AI insights
    const aiAnalysis = await getSuccessionScenarioAnalysis(mathResults, portfolioSummary, scenarioData);

    res.json({
      success: true,
      mathResults,
      aiInsights: aiAnalysis,
      portfolioSummary,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in succession scenario analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze succession scenario',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/scenarios/bulk-transition-plans
router.post('/bulk-transition-plans', handleValidationErrors, async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({
        success: false,
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration' : undefined
      });
    }

    const { clients, stage1Data } = req.body;

    if (!clients || !Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ success: false, error: 'clients array is required' });
    }

    if (!stage1Data) {
      return res.status(400).json({ success: false, error: 'stage1Data is required' });
    }

    // Generate individual transition plans for each client
    const plans = await Promise.all(clients.map(async (client) => {
      try {
        // Create client-specific prompt
        const prompt = createBulkTransitionPlanPrompt(client, stage1Data);
        
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        });

        const aiResponse = message.content[0].text;
        
        // Parse AI response into structured plan
        const parsedPlan = parseTransitionPlanResponse(aiResponse, client);
        
        return {
          clientId: client.id,
          clientName: client.name,
          ...parsedPlan
        };
      } catch (error) {
        console.error(`Error generating plan for client ${client.id}:`, error);
        return {
          clientId: client.id,
          clientName: client.name,
          error: 'Failed to generate plan',
          status: 'error'
        };
      }
    }));

    res.json({
      success: true,
      plans,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in bulk transition plans generation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate bulk transition plans',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* -------------------------------------------------------------------------- */
/*                           CAPACITY OPTIMIZATION                           */
/* -------------------------------------------------------------------------- */

// POST /api/scenarios/capacity
router.post('/capacity', handleValidationErrors, async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({
        success: false,
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration' : undefined
      });
    }

    const { scenarioData, portfolioId } = req.body;
    const userId = req.user.userId;

    if (!scenarioData) {
      return res.status(400).json({ success: false, error: 'scenarioData is required' });
    }

    // Fetch portfolio data from database
    const clients = await clientModel.listWithMetrics(userId);
    if (!clients.length) {
      return res.status(400).json({ success: false, error: 'No clients found for user' });
    }

    // Calculate mathematical results
    const mathResults = calculateCapacityMath(clients, scenarioData);

    // Create portfolio summary for AI analysis
    const portfolioSummary = generatePortfolioSummary(clients);

    // Get AI insights
    const aiAnalysis = await getCapacityOptimizationAnalysis(mathResults, portfolioSummary, scenarioData);

    res.json({
      success: true,
      mathResults,
      aiInsights: aiAnalysis,
      portfolioSummary,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in capacity optimization scenario:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze capacity optimization scenario',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* -------------------------------------------------------------------------- */
/*                             GROWTH MODELING                               */
/* -------------------------------------------------------------------------- */

// POST /api/scenarios/growth
router.post('/growth', handleValidationErrors, async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({
        success: false,
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration' : undefined
      });
    }

    const { scenarioData, portfolioId } = req.body;
    const userId = req.user.userId;

    if (!scenarioData) {
      return res.status(400).json({ success: false, error: 'scenarioData is required' });
    }

    // Fetch portfolio data from database
    const clients = await clientModel.listWithMetrics(userId);
    if (!clients.length) {
      return res.status(400).json({ success: false, error: 'No clients found for user' });
    }

    // Calculate mathematical results
    const mathResults = calculateGrowthMath(clients, scenarioData);

    // Create portfolio summary for AI analysis
    const portfolioSummary = generatePortfolioSummary(clients);

    // Get AI insights
    const aiAnalysis = await getGrowthModelingAnalysis(mathResults, portfolioSummary, scenarioData);

    res.json({
      success: true,
      mathResults,
      aiInsights: aiAnalysis,
      portfolioSummary,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in growth modeling scenario:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze growth modeling scenario',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* -------------------------------------------------------------------------- */
/*                              MATH CALCULATIONS                            */
/* -------------------------------------------------------------------------- */

function calculateSuccessionMath(clients, scenarioData) {
  const { departingLobbyists = [] } = scenarioData;
  
  // Calculate clients at risk due to departing lobbyists
  const clientsAtRisk = clients.filter(client => 
    departingLobbyists.includes(client.primary_lobbyist) ||
    (client.lobbyist_team && client.lobbyist_team.some(lobbyist => departingLobbyists.includes(lobbyist)))
  );

  const revenueAtRisk = clientsAtRisk.reduce((sum, client) => sum + (client.average_revenue || 0), 0);
  const totalRevenue = clients.reduce((sum, client) => sum + (client.average_revenue || 0), 0);
  const riskPercentage = totalRevenue > 0 ? (revenueAtRisk / totalRevenue) * 100 : 0;

  // Calculate transition scenarios
  const highRiskClients = clientsAtRisk.filter(c => (c.relationship_strength || 0) < 5);
  const mediumRiskClients = clientsAtRisk.filter(c => (c.relationship_strength || 0) >= 5 && (c.relationship_strength || 0) < 8);
  const lowRiskClients = clientsAtRisk.filter(c => (c.relationship_strength || 0) >= 8);

  return {
    totalClientsAtRisk: clientsAtRisk.length,
    totalRevenueAtRisk: revenueAtRisk,
    riskPercentage: riskPercentage,
    departingLobbyists,
    riskByLevel: {
      high: { count: highRiskClients.length, revenue: highRiskClients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) },
      medium: { count: mediumRiskClients.length, revenue: mediumRiskClients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) },
      low: { count: lowRiskClients.length, revenue: lowRiskClients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) }
    },
    affectedClients: clientsAtRisk.map(c => ({
      id: c.id,
      name: c.name,
      revenue: c.average_revenue || 0,
      primaryLobbyist: c.primary_lobbyist,
      relationshipStrength: c.relationship_strength || 0,
      strategicValue: c.strategic_value || 0
    }))
  };
}

function calculateCapacityMath(clients, scenarioData) {
  const { currentCapacity = 100, targetUtilization = 85, newHires = 0 } = scenarioData;
  
  // Calculate current utilization
  const totalHours = clients.reduce((sum, client) => sum + (client.time_commitment || 0), 0);
  const currentUtilization = currentCapacity > 0 ? (totalHours / currentCapacity) * 100 : 0;
  
  // Calculate capacity with new hires (assuming 40 hours per month per hire)
  const additionalCapacity = newHires * 40;
  const newTotalCapacity = currentCapacity + additionalCapacity;
  const newUtilization = newTotalCapacity > 0 ? (totalHours / newTotalCapacity) * 100 : 0;
  
  // Calculate potential revenue impact
  const avgRevenuePerHour = totalHours > 0 ? 
    clients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) / totalHours : 0;
  
  const additionalRevenueCapacity = additionalCapacity * avgRevenuePerHour * (targetUtilization / 100);

  return {
    currentCapacity,
    currentUtilization: currentUtilization,
    totalHours,
    newHires,
    additionalCapacity,
    newTotalCapacity,
    newUtilization,
    targetUtilization,
    avgRevenuePerHour,
    additionalRevenueCapacity,
    capacityGap: Math.max(0, (totalHours / (targetUtilization / 100)) - currentCapacity),
    utilizationImprovement: newUtilization - currentUtilization
  };
}

function calculateGrowthMath(clients, scenarioData) {
  const { targetRevenue = 0, timeHorizon = 12, growthStrategy = 'organic' } = scenarioData;
  
  const currentRevenue = clients.reduce((sum, client) => sum + (client.average_revenue || 0), 0);
  const requiredGrowth = targetRevenue - currentRevenue;
  const growthPercentage = currentRevenue > 0 ? (requiredGrowth / currentRevenue) * 100 : 0;
  const monthlyGrowthRate = timeHorizon > 0 ? growthPercentage / timeHorizon : 0;

  // Analyze growth potential by client segment
  const highValueClients = clients.filter(c => (c.strategic_value || 0) >= 8);
  const mediumValueClients = clients.filter(c => (c.strategic_value || 0) >= 5 && (c.strategic_value || 0) < 8);
  const lowValueClients = clients.filter(c => (c.strategic_value || 0) < 5);

  // Calculate expansion potential (assuming 20% expansion possibility for high-value clients)
  const expansionPotential = {
    highValue: highValueClients.reduce((sum, c) => sum + (c.average_revenue || 0) * 0.2, 0),
    mediumValue: mediumValueClients.reduce((sum, c) => sum + (c.average_revenue || 0) * 0.1, 0),
    lowValue: lowValueClients.reduce((sum, c) => sum + (c.average_revenue || 0) * 0.05, 0)
  };

  const totalExpansionPotential = Object.values(expansionPotential).reduce((sum, val) => sum + val, 0);

  return {
    currentRevenue,
    targetRevenue,
    requiredGrowth,
    growthPercentage,
    monthlyGrowthRate,
    timeHorizon,
    growthStrategy,
    expansionPotential,
    totalExpansionPotential,
    gapAfterExpansion: Math.max(0, requiredGrowth - totalExpansionPotential),
    clientSegments: {
      highValue: { count: highValueClients.length, revenue: highValueClients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) },
      mediumValue: { count: mediumValueClients.length, revenue: mediumValueClients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) },
      lowValue: { count: lowValueClients.length, revenue: lowValueClients.reduce((sum, c) => sum + (c.average_revenue || 0), 0) }
    }
  };
}

/* -------------------------------------------------------------------------- */
/*                               AI ANALYSIS                                 */
/* -------------------------------------------------------------------------- */

async function getSuccessionScenarioAnalysis(mathResults, portfolioSummary, scenarioData) {
  const prompt = `You are a senior succession planning consultant for government relations law firms. Analyze this succession scenario and provide strategic recommendations.

<scenario_context>
Departing Lobbyists: ${mathResults.departingLobbyists.join(', ')}
Clients at Risk: ${mathResults.totalClientsAtRisk} clients
Revenue at Risk: $${mathResults.totalRevenueAtRisk.toLocaleString()} (${mathResults.riskPercentage.toFixed(1)}% of portfolio)

Risk Distribution:
- High Risk: ${mathResults.riskByLevel.high.count} clients, $${mathResults.riskByLevel.high.revenue.toLocaleString()}
- Medium Risk: ${mathResults.riskByLevel.medium.count} clients, $${mathResults.riskByLevel.medium.revenue.toLocaleString()}
- Low Risk: ${mathResults.riskByLevel.low.count} clients, $${mathResults.riskByLevel.low.revenue.toLocaleString()}

Portfolio Context:
- Total Clients: ${portfolioSummary.totalClients}
- Total Revenue: $${portfolioSummary.totalRevenue.toLocaleString()}
- Average Strategic Value: ${portfolioSummary.avgStrategicValue.toFixed(1)}/10
</scenario_context>

Provide a structured succession planning analysis:

## RISK ASSESSMENT
[Evaluate the severity and implications of this succession scenario]

## RETENTION STRATEGY
[Specific strategies for each risk level - high, medium, low]

## TRANSITION PLANNING
[Step-by-step process for smooth client transitions]

## MITIGATION TACTICS
[Immediate actions to minimize revenue loss]

## LONG-TERM SUCCESSION FRAMEWORK
[Recommendations to prevent future succession crises]

Focus on actionable recommendations with specific timelines and success metrics.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

async function getCapacityOptimizationAnalysis(mathResults, portfolioSummary, scenarioData) {
  const prompt = `You are a capacity optimization consultant for law firms. Analyze this capacity scenario and provide optimization recommendations.

<capacity_analysis>
Current Capacity: ${mathResults.currentCapacity} hours/month
Current Utilization: ${mathResults.currentUtilization.toFixed(1)}%
Total Client Hours: ${mathResults.totalHours} hours/month
Target Utilization: ${mathResults.targetUtilization}%

Proposed Changes:
- New Hires: ${mathResults.newHires}
- Additional Capacity: ${mathResults.additionalCapacity} hours/month
- New Total Capacity: ${mathResults.newTotalCapacity} hours/month
- Projected Utilization: ${mathResults.newUtilization.toFixed(1)}%

Financial Impact:
- Average Revenue per Hour: $${mathResults.avgRevenuePerHour.toFixed(0)}
- Additional Revenue Capacity: $${mathResults.additionalRevenueCapacity.toLocaleString()}
- Capacity Gap: ${mathResults.capacityGap.toFixed(0)} hours/month

Portfolio Context:
- Total Clients: ${portfolioSummary.totalClients}
- Total Revenue: $${portfolioSummary.totalRevenue.toLocaleString()}
</capacity_analysis>

Provide a comprehensive capacity optimization analysis:

## CAPACITY DIAGNOSTIC
[Assessment of current capacity efficiency and constraints]

## OPTIMIZATION OPPORTUNITIES
[Specific areas where capacity can be better utilized]

## STAFFING RECOMMENDATIONS
[Hiring strategy, role definitions, and timeline]

## PROCESS IMPROVEMENTS
[Workflow optimizations to increase effective capacity]

## FINANCIAL PROJECTIONS
[ROI analysis and revenue impact projections]

## IMPLEMENTATION ROADMAP
[Step-by-step plan with milestones and success metrics]

Focus on data-driven recommendations with clear ROI justification.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

async function getGrowthModelingAnalysis(mathResults, portfolioSummary, scenarioData) {
  const prompt = `You are a growth strategy consultant for government relations law firms. Analyze this growth scenario and provide strategic recommendations.

<growth_scenario>
Current Revenue: $${mathResults.currentRevenue.toLocaleString()}
Target Revenue: $${mathResults.targetRevenue.toLocaleString()}
Required Growth: $${mathResults.requiredGrowth.toLocaleString()} (${mathResults.growthPercentage.toFixed(1)}%)
Time Horizon: ${mathResults.timeHorizon} months
Monthly Growth Rate: ${mathResults.monthlyGrowthRate.toFixed(2)}%

Client Expansion Potential:
- High-Value Clients: $${mathResults.expansionPotential.highValue.toLocaleString()}
- Medium-Value Clients: $${mathResults.expansionPotential.mediumValue.toLocaleString()}
- Low-Value Clients: $${mathResults.expansionPotential.lowValue.toLocaleString()}
- Total Expansion Potential: $${mathResults.totalExpansionPotential.toLocaleString()}
- Gap After Expansion: $${mathResults.gapAfterExpansion.toLocaleString()}

Client Segmentation:
- High Value: ${mathResults.clientSegments.highValue.count} clients, $${mathResults.clientSegments.highValue.revenue.toLocaleString()}
- Medium Value: ${mathResults.clientSegments.mediumValue.count} clients, $${mathResults.clientSegments.mediumValue.revenue.toLocaleString()}
- Low Value: ${mathResults.clientSegments.lowValue.count} clients, $${mathResults.clientSegments.lowValue.revenue.toLocaleString()}

Portfolio Context:
- Total Clients: ${portfolioSummary.totalClients}
- Practice Areas: ${Object.entries(portfolioSummary.practiceAreas).map(([area, count]) => `${area} (${count})`).join(', ')}
</growth_scenario>

Provide a comprehensive growth strategy analysis:

## GROWTH FEASIBILITY ASSESSMENT
[Evaluate whether the target is realistic and achievable]

## EXPANSION STRATEGY
[Detailed plan for expanding existing client relationships]

## NEW CLIENT ACQUISITION
[Strategy for acquiring new clients to fill the growth gap]

## PRACTICE AREA DEVELOPMENT
[Opportunities to expand service offerings]

## COMPETITIVE POSITIONING
[How to differentiate in the market for growth]

## IMPLEMENTATION ROADMAP
[Quarterly milestones and specific action items]

## RISK MITIGATION
[Potential obstacles and mitigation strategies]

Focus on specific, actionable strategies with timeline and resource requirements.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

/* -------------------------------------------------------------------------- */
/*                       BULK TRANSITION PLAN HELPERS                       */
/* -------------------------------------------------------------------------- */

function createBulkTransitionPlanPrompt(client, stage1Data) {
  const revenue = client.average_revenue || 0;
  const practiceAreas = Array.isArray(client.practiceArea) ? client.practiceArea.join(', ') : client.practiceArea || 'Not specified';
  const relationshipType = client.relationshipType || 'unknown';
  const successionRisk = client.successionRisk || 5;
  const transitionComplexity = client.transitionComplexity || 5;
  
  return `You are a senior succession planning consultant specializing in government relations law firms. Create a detailed transition plan for this specific client based on the Stage 1 impact analysis.

## CLIENT PROFILE
- **Name**: ${client.name}
- **Annual Revenue**: $${revenue.toLocaleString()}
- **Practice Areas**: ${practiceAreas}
- **Current Partner**: ${client.primary_lobbyist || 'Not assigned'}
- **Relationship Type**: ${relationshipType}
- **Succession Risk**: ${successionRisk}/10
- **Transition Complexity**: ${transitionComplexity}/10
- **Relationship Strength**: ${client.relationshipStrength || 'Not specified'}/10

## STAGE 1 CONTEXT
- **Departing Partners**: ${stage1Data.selectedPartners?.join(', ') || 'Not specified'}
- **Total Revenue at Risk**: $${stage1Data.impactData?.totalRevenueAtRisk?.toLocaleString() || '0'}
- **Expected Retention Rate**: ${((stage1Data.impactData?.estimatedRetentionRate || 0.8) * 100).toFixed(1)}%

Please create a comprehensive transition plan with the following structure:

## TRANSITION STRATEGY
[Specific approach tailored to this client's risk profile and relationship type]

## RECOMMENDED SUCCESSOR
[Suggest ideal successor partner based on practice area and client needs]

## TIMELINE
[Recommend timeline in days - be specific (e.g., 30, 60, 90 days)]

## KEY RISKS & MITIGATION
[Identify 2-3 specific risks and mitigation strategies]

## ACTION ITEMS
[3-5 specific, actionable tasks with clear owners and deadlines]

## CLIENT COMMUNICATION TEMPLATE
[Draft email template for initial client communication about transition]

Focus on practical, implementable recommendations. Consider the client's revenue impact, relationship dynamics, and succession risk level in your recommendations.`;
}

function parseTransitionPlanResponse(aiResponse, client) {
  try {
    // Extract different sections from the AI response
    const sections = {
      strategy: extractSection(aiResponse, 'TRANSITION STRATEGY'),
      successorPartner: extractSection(aiResponse, 'RECOMMENDED SUCCESSOR'),
      timeline: extractTimelineFromResponse(aiResponse),
      risks: extractSection(aiResponse, 'KEY RISKS & MITIGATION'),
      tasks: extractTasksFromResponse(aiResponse),
      communicationTemplate: extractSection(aiResponse, 'CLIENT COMMUNICATION TEMPLATE')
    };

    // Determine priority based on succession risk
    let priority = 'medium';
    if (client.successionRisk >= 8) priority = 'critical';
    else if (client.successionRisk >= 6) priority = 'high';
    else if (client.successionRisk <= 3) priority = 'low';

    return {
      strategy: sections.strategy || 'No strategy generated',
      successorPartner: sections.successorPartner || 'To be determined',
      timelineDays: sections.timeline || 30,
      risks: sections.risks || 'No specific risks identified',
      tasks: sections.tasks || [],
      communicationTemplate: sections.communicationTemplate || 'No template generated',
      priority,
      status: 'planned',
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error parsing transition plan response:', error);
    return {
      strategy: 'Error generating strategy',
      successorPartner: 'To be determined',
      timelineDays: 30,
      risks: 'Unable to assess risks',
      tasks: [],
      communicationTemplate: 'Template generation failed',
      priority: 'medium',
      status: 'error',
      error: error.message
    };
  }
}

function extractSection(text, sectionHeader) {
  const regex = new RegExp(`## ${sectionHeader}([\\s\\S]*?)(?=##|$)`, 'i');
  const match = text.match(regex);
  if (match && match[1]) {
    return match[1].trim().replace(/^\[|\]$/g, ''); // Remove brackets if present
  }
  return null;
}

function extractTimelineFromResponse(text) {
  // Look for timeline section and extract number of days
  const timelineSection = extractSection(text, 'TIMELINE');
  if (timelineSection) {
    const dayMatch = timelineSection.match(/(\d+)\s*days?/i);
    if (dayMatch) {
      return parseInt(dayMatch[1]);
    }
  }
  
  // Fallback: look for any mention of days in the text
  const globalMatch = text.match(/(\d+)\s*days?/i);
  if (globalMatch) {
    return parseInt(globalMatch[1]);
  }
  
  return 30; // Default fallback
}

function extractTasksFromResponse(text) {
  const actionSection = extractSection(text, 'ACTION ITEMS');
  if (!actionSection) return [];
  
  // Split by lines and look for bullet points or numbered items
  const lines = actionSection.split('\n');
  const tasks = [];
  
  for (const line of lines) {
    const cleanLine = line.trim();
    // Match various bullet point formats: -, *, 1., [1], etc.
    if (/^[-*•]\s+/.test(cleanLine) || /^\d+\.\s+/.test(cleanLine) || /^\[\d+\]\s+/.test(cleanLine)) {
      const task = cleanLine.replace(/^[-*•]\s+|^\d+\.\s+|^\[\d+\]\s+/, '').trim();
      if (task.length > 0) {
        tasks.push(task);
      }
    }
  }
  
  return tasks.slice(0, 5); // Limit to 5 tasks
}

module.exports = router;