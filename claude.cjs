const express = require('express');
const router = express.Router();

const authenticateToken = require('./middleware/auth.cjs');
const clientModel = require('./models/clientModel.cjs');
const { generatePortfolioSummary } = require('./utils/strategic.cjs');

// Initialize Anthropic client
let anthropic;
try {
  const { Anthropic } = require('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ No API key found. Set ANTHROPIC_API_KEY, CLAUDE_API_KEY, or OPENAI_API_KEY');
  } else {
    anthropic = new Anthropic({ apiKey });
    console.log('✅ Anthropic client initialized successfully');
  }
} catch (error) {
  console.error('❌ Failed to initialize Anthropic client:', error);
}

// Apply JWT auth to all claude routes
router.use(authenticateToken);

/* -------------------------------------------------------------------------- */
/*                                  ROUTES                                    */
/* -------------------------------------------------------------------------- */

// Strategic advice
// Request body: { query?: string, context?: string }
router.post('/strategic-advice', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({ success: false, error: 'AI service not available' });
    }

    const { query, context } = req.body || {};
    const userId = req.user.userId;

    // Fetch portfolio with metrics
    const clients = await clientModel.listWithMetrics(userId);
    if (!clients.length) {
      return res.status(400).json({ success: false, error: 'No clients found for user' });
    }

    const portfolioSummary = generatePortfolioSummary(clients);
    const prompt = createStrategicPrompt(portfolioSummary, query, context);

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const advice = response.content[0].text;

    res.json({
      success: true,
      advice,
      portfolioSummary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating strategic advice:', error);
    res.status(500).json({ success: false, error: 'Failed to generate strategic advice' });
  }
});

// Portfolio analysis
// Request body: {}
router.post('/analyze-portfolio', async (req, res) => {
  try {
    console.log('🔍 Starting portfolio analysis request');
    
    // Check Anthropic client initialization
    if (!anthropic) {
      console.error('❌ Anthropic client not initialized');
      return res.status(500).json({ success: false, error: 'AI service not available - API key missing or invalid' });
    }
    console.log('✅ Anthropic client available');

    // Check authentication
    const userId = req.user.userId;
    console.log('📋 User ID from JWT:', userId);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID not found in token' });
    }

    // Fetch clients with detailed error handling
    console.log('🔍 Fetching clients for user:', userId);
    let clients;
    try {
      clients = await clientModel.listWithMetrics(userId);
      console.log('✅ Successfully fetched clients:', clients.length);
    } catch (dbError) {
      console.error('❌ Database error fetching clients:', dbError);
      return res.status(500).json({ 
        success: false, 
        error: 'Database connection failed',
        details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
    }

    if (!clients.length) {
      console.log('⚠️ No clients found for user:', userId);
      return res.status(400).json({ success: false, error: 'No clients found for user' });
    }

    // Generate portfolio summary
    console.log('📊 Generating portfolio summary');
    let portfolioSummary;
    try {
      portfolioSummary = generatePortfolioSummary(clients);
      console.log('✅ Portfolio summary generated:', {
        totalClients: portfolioSummary.totalClients,
        totalRevenue: portfolioSummary.totalRevenue
      });
    } catch (summaryError) {
      console.error('❌ Error generating portfolio summary:', summaryError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to generate portfolio summary',
        details: process.env.NODE_ENV === 'development' ? summaryError.message : undefined
      });
    }

    // Create analysis prompt
    console.log('📝 Creating analysis prompt');
    const analysisPrompt = createAnalysisPrompt(portfolioSummary);

    // Call Anthropic API
    console.log('🤖 Calling Anthropic API');
    let response;
    try {
      response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2500,
        temperature: 0.2,
        messages: [{ role: 'user', content: analysisPrompt }],
      });
      console.log('✅ Anthropic API call successful');
    } catch (apiError) {
      console.error('❌ Anthropic API error:', apiError);
      return res.status(500).json({ 
        success: false, 
        error: 'AI analysis failed',
        details: process.env.NODE_ENV === 'development' ? apiError.message : undefined
      });
    }

    const analysis = response.content[0].text;

    console.log('✅ Portfolio analysis completed successfully');
    res.json({
      success: true,
      analysis,
      portfolioSummary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Unexpected error in portfolio analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to analyze portfolio',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Client-specific recommendations
// Request body: { clientId: string|number, includePortfolio?: boolean }
router.post('/client-recommendations', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(500).json({ success: false, error: 'AI service not available' });
    }

    const { clientId, includePortfolio } = req.body || {};
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }

    const userId = req.user.userId;
    const client = await clientModel.getWithMetrics(clientId, userId);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    let portfolioContext;
    if (includePortfolio) {
      const clients = await clientModel.listWithMetrics(userId);
      portfolioContext = JSON.stringify(generatePortfolioSummary(clients));
    }

    const clientPrompt = createClientRecommendationPrompt(client, portfolioContext);

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      temperature: 0.3,
      messages: [{ role: 'user', content: clientPrompt }],
    });

    const recommendations = response.content[0].text;

    res.json({
      success: true,
      recommendations,
      client: client.name,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating client recommendations:', error);
    res.status(500).json({ success: false, error: 'Failed to generate client recommendations' });
  }
});

/* -------------------------------------------------------------------------- */
/*                              PROMPT BUILDERS                               */
/* -------------------------------------------------------------------------- */

function createStrategicPrompt(portfolioSummary, query, context) {
  const basePrompt = `You are a strategic advisor for a government relations law firm. Analyze the following client portfolio data and provide strategic recommendations.

Portfolio Summary:
- Total Clients: ${portfolioSummary.totalClients}
- Total Revenue: $${portfolioSummary.totalRevenue.toLocaleString()}
- Average Strategic Value: ${portfolioSummary.avgStrategicValue}
- Contract Status Breakdown: ${JSON.stringify(portfolioSummary.statusBreakdown)}
- Practice Areas: ${JSON.stringify(portfolioSummary.practiceAreas)}
- Risk Profile: ${JSON.stringify(portfolioSummary.riskProfile)}

Top 5 Clients by Strategic Value:
${portfolioSummary.topClients
  .map(
    (c, i) =>
      `${i + 1}. ${c.name} - Revenue: $${c.revenue.toLocaleString()}, Strategic Value: ${c.strategicValue}, Status: ${c.status}, Practice Areas: ${c.practiceArea.join(
        ', ',
      )}`,
  )
  .join('\n')}

${context ? `Additional Context: ${context}` : ''}`;

  if (query) {
    return `${basePrompt}

Specific Question: ${query}

Please provide detailed strategic advice addressing this question.`;
  }

  return `${basePrompt}

Please provide comprehensive strategic recommendations covering:
1. Portfolio optimization opportunities
2. Risk management strategies
3. Revenue growth potential
4. Client relationship enhancement
5. Practice area development
6. Succession planning considerations

Format your response with clear sections and actionable recommendations.`;
}

function createAnalysisPrompt(portfolioSummary) {
  return `As a strategic consultant for a government relations law firm, conduct a comprehensive analysis of this client portfolio:

Portfolio Data:
- Total Clients: ${portfolioSummary.totalClients}
- Total Revenue: $${portfolioSummary.totalRevenue.toLocaleString()}
- Average Strategic Value: ${portfolioSummary.avgStrategicValue}
- Contract Status: ${JSON.stringify(portfolioSummary.statusBreakdown)}
- Practice Areas: ${JSON.stringify(portfolioSummary.practiceAreas)}
- Risk Distribution: ${JSON.stringify(portfolioSummary.riskProfile)}

Top Clients:
${portfolioSummary.topClients
  .map(
    (c, i) =>
      `${i + 1}. ${c.name} - $${c.revenue.toLocaleString()} revenue, ${c.strategicValue} strategic value, ${c.status} status`,
  )
  .join('\n')}

Provide a detailed analysis including:

**STRENGTHS:**
- Key portfolio advantages
- High-performing client relationships
- Strong practice areas

**WEAKNESSES:**
- Portfolio vulnerabilities
- Underperforming segments
- Risk concentrations

**OPPORTUNITIES:**
- Growth potential areas
- Cross-selling possibilities
- New practice development

**THREATS:**
- Client retention risks
- Market challenges
- Competitive pressures

**STRATEGIC RECOMMENDATIONS:**
- Immediate action items (next 3 months)
- Medium-term strategies (6-12 months)
- Long-term vision (1-3 years)

Format with clear headers and bullet points for easy reading.`;
}

function createClientRecommendationPrompt(client, portfolioContext) {
  return `As a strategic advisor for a government relations law firm, provide specific recommendations for this client:

Client: ${client.name}
Revenue: $${(client.averageRevenue || 0).toLocaleString()}
Strategic Value: ${client.strategicValue || 'Not assessed'}
Contract Status: ${client.status}
Practice Areas: ${client.practiceArea ? client.practiceArea.join(', ') : 'Not specified'}
Time Commitment: ${client.timeCommitment || 'Not specified'} hours/month
Renewal Probability: ${
    client.renewalProbability ? Math.round(client.renewalProbability * 100) + '%' : 'Not assessed'
  }
Conflict Risk: ${client.conflictRisk || 'Not assessed'}
Relationship Strength: ${client.relationshipStrength || 'Not assessed'}/10
Notes: ${client.notes || 'None'}

${portfolioContext ? `Portfolio Context: ${portfolioContext}` : ''}

Provide specific recommendations for:

1. **Relationship Enhancement:**
   - Strategies to strengthen the client relationship
   - Communication and engagement improvements

2. **Revenue Optimization:**
   - Opportunities to increase revenue from this client
   - Value-added services to offer

3. **Risk Management:**
   - Strategies to mitigate identified risks
   - Conflict prevention measures

4. **Strategic Development:**
   - Ways to increase strategic value
   - Long-term partnership opportunities

5. **Operational Efficiency:**
   - Time management improvements
   - Service delivery optimization

Keep recommendations specific, actionable, and tailored to this client's profile.`;
}

module.exports = router;
