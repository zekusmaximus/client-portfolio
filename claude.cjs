const express = require('express');
const router = express.Router();

const authenticateToken = require('./middleware/auth.cjs');
const clientModel = require('./models/clientModel.cjs');
const { generatePortfolioSummary } = require('./utils/strategic.cjs');

// Initialize Anthropic client
let anthropic = null;

try {
  const { Anthropic } = require('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ No API key found. Set ANTHROPIC_API_KEY, CLAUDE_API_KEY, or OPENAI_API_KEY');
    anthropic = null;
  } else {
    anthropic = new Anthropic({ apiKey });
    console.log('✅ Anthropic client initialized successfully');
  }
} catch (error) {
  console.error('❌ Failed to initialize Anthropic client:', error.message);
  anthropic = null;
}

// Validate client functionality
if (anthropic && anthropic.messages && anthropic.messages.create) {
  console.log('🎉 AI service ready');
} else {
  console.error('💥 AI service unavailable - check API key configuration');
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
      console.error('❌ Anthropic client not initialized in strategic-advice');
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration and server logs' : undefined
      });
    }
    
    if (!anthropic.messages || !anthropic.messages.create) {
      console.error('❌ Anthropic client missing required methods in strategic-advice');
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not available - Anthropic client malformed',
        details: process.env.NODE_ENV === 'development' ? 'Client initialization incomplete' : undefined
      });
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
      model: 'claude-sonnet-4-20250514',
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
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration and server logs' : undefined
      });
    }
    
    if (!anthropic.messages || !anthropic.messages.create) {
      console.error('❌ Anthropic client missing required methods');
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not available - Anthropic client malformed',
        details: process.env.NODE_ENV === 'development' ? 'Client initialization incomplete' : undefined
      });
    }
    
    console.log('✅ Anthropic client available and functional');

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
        model: 'claude-sonnet-4-20250514',
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
      console.error('❌ Anthropic client not initialized in client-recommendations');
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not available - Anthropic client not initialized',
        details: process.env.NODE_ENV === 'development' ? 'Check API key configuration and server logs' : undefined
      });
    }
    
    if (!anthropic.messages || !anthropic.messages.create) {
      console.error('❌ Anthropic client missing required methods in client-recommendations');
      return res.status(500).json({ 
        success: false, 
        error: 'AI service not available - Anthropic client malformed',
        details: process.env.NODE_ENV === 'development' ? 'Client initialization incomplete' : undefined
      });
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
      model: 'claude-sonnet-4-20250514',
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
  // Calculate key strategic metrics
  const revenueConcentration = portfolioSummary.topClients.slice(0, 5)
    .reduce((sum, client) => sum + client.revenue, 0) / portfolioSummary.totalRevenue;
  const averageClientValue = portfolioSummary.totalRevenue / portfolioSummary.totalClients;
  const strategicAlignment = portfolioSummary.topClients
    .filter(c => c.strategicValue >= 8).length / portfolioSummary.topClients.length;

  const basePrompt = `You are a senior strategic advisor with 20+ years of experience in government relations law firm management. You're preparing advice for the firm's executive committee, known for their analytical rigor and strategic thinking.

<firm_profile>
Portfolio Metrics:
- Scale: ${portfolioSummary.totalClients} clients, $${portfolioSummary.totalRevenue.toLocaleString()} revenue
- Average Client Value: $${averageClientValue.toLocaleString()}
- Strategic Alignment: ${(strategicAlignment * 100).toFixed(0)}% of top clients are strategic (8+ score)
- Revenue Concentration: Top 5 clients represent ${(revenueConcentration * 100).toFixed(0)}% of revenue
- Contract Health: ${((portfolioSummary.statusBreakdown.Active || 0) / portfolioSummary.totalClients * 100).toFixed(0)}% active contracts

Practice Area Distribution:
${Object.entries(portfolioSummary.practiceAreas)
  .sort(([,a], [,b]) => b - a)
  .map(([area, count]) => `- ${area}: ${count} clients (${(count / portfolioSummary.totalClients * 100).toFixed(0)}%)`)
  .join('\n')}

Risk Exposure:
${Object.entries(portfolioSummary.riskProfile)
  .map(([level, count]) => `- ${level} risk: ${count} clients (${(count / portfolioSummary.totalClients * 100).toFixed(0)}%)`)
  .join('\n')}

Strategic Client Profiles:
${portfolioSummary.topClients.slice(0, 8).map((c, i) => 
  `${i + 1}. ${c.name}
   Financial Profile: $${c.revenue.toLocaleString()} | ${c.timeCommitment || 'Unknown'} hours/month
   Strategic Profile: ${c.strategicValue}/10 value | ${c.relationshipStrength || 'Unknown'}/10 relationship
   Risk Profile: ${c.status} contract | ${c.renewalProbability ? `${(c.renewalProbability * 100).toFixed(0)}%` : 'Unknown'} renewal | ${c.conflictRisk || 'Unknown'} conflict risk
   Practice Areas: ${c.practiceArea ? c.practiceArea.join(', ') : 'Not specified'}`
).join('\n\n')}
</firm_profile>

${context ? `<additional_context>\n${context}\n</additional_context>` : ''}

<analytical_frameworks>
Apply these frameworks in your strategic thinking:
1. **Porter's Five Forces** (adapted for legal services): Client bargaining power, threat of boutique firms, competitive rivalry, threat of in-house counsel, supplier power (talent)
2. **Value Chain Analysis**: How each client contributes to firm capabilities and market position
3. **Blue Ocean Strategy**: Identifying uncontested market spaces in government relations
4. **Platform Strategy**: Leveraging client relationships for network effects
5. **Dynamic Capabilities**: Building sensing, seizing, and reconfiguring capabilities
</analytical_frameworks>`;

  if (query) {
    return `${basePrompt}

<specific_query>
${query}
</specific_query>

<response_requirements>
Structure your strategic advice as follows:

## STRATEGIC ASSESSMENT
[Direct answer to the query with key insights]

## ANALYTICAL DEEP DIVE
### Relevant Data Points
[Specific metrics and trends from the portfolio that inform your recommendation]

### Strategic Frameworks Applied
[How established business frameworks support your recommendations]

### Scenario Analysis
[Best case, expected case, and worst case outcomes]

## RECOMMENDED STRATEGY
### Core Strategic Thrust
[The main strategic direction with rationale]

### Implementation Roadmap
[Phased approach with milestones and success metrics]

### Resource Requirements
[People, systems, and investments needed]

### Risk Mitigation
[Key risks and mitigation strategies]

## EXPECTED OUTCOMES
- Financial Impact: [Quantified where possible]
- Strategic Position: [Market and competitive improvements]
- Organizational Capabilities: [New strengths developed]

## EXECUTIVE DECISION POINTS
[3-5 specific decisions the executive committee needs to make]

Ensure your advice is:
- Grounded in the specific portfolio data
- Supported by proven strategic frameworks
- Actionable with clear next steps
- Honest about tradeoffs and risks
</response_requirements>`;
  }

  return `${basePrompt}

<response_requirements>
Provide comprehensive strategic recommendations addressing these critical areas:

## 1. PORTFOLIO OPTIMIZATION STRATEGY
### Current State Diagnosis
[Data-driven assessment of portfolio efficiency and effectiveness]

### Optimization Opportunities
- **Client Mix Rebalancing**: [Specific recommendations based on strategic value vs. revenue analysis]
- **Practice Area Focus**: [Where to double down vs. divest based on market dynamics]
- **Resource Allocation**: [How to deploy partner time for maximum impact]

### Implementation Approach
[Specific steps, timeline, and success metrics]

## 2. RISK MANAGEMENT FRAMEWORK
### Portfolio Risk Assessment
[Quantified analysis of concentration, succession, and market risks]

### Mitigation Strategies
- **Concentration Risk**: [Specific diversification targets and strategies]
- **Succession Risk**: [Partner coverage and relationship transition plans]
- **Market Risk**: [Hedging strategies against regulatory or political changes]

### Early Warning System
[Metrics and triggers for proactive risk management]

## 3. REVENUE GROWTH STRATEGY
### Growth Vector Analysis
- **Organic Growth**: [Specific cross-selling and upselling opportunities with revenue estimates]
- **New Client Acquisition**: [Target profiles and acquisition strategies]
- **New Service Lines**: [Adjacent opportunities based on current capabilities]

### Revenue Model Innovation
[Opportunities for value-based pricing, retainers, success fees]

### Growth Enablers
[Required investments in people, technology, and marketing]

## 4. CLIENT RELATIONSHIP EXCELLENCE
### Relationship Audit Findings
[Current state of key relationships with improvement opportunities]

### Enhancement Strategies
- **Top 10 Client Plans**: [Customized strategies for each]
- **Client Experience Innovation**: [Differentiating service delivery approaches]
- **Relationship ROI Optimization**: [Balancing investment with returns]

## 5. PRACTICE AREA DEVELOPMENT
### Capability Assessment
[Current strengths and gaps in service offerings]

### Development Priorities
- **Core Strengthening**: [Investments in dominant practice areas]
- **Emerging Opportunities**: [New practice areas with market potential]
- **Synergy Creation**: [Cross-practice collaboration opportunities]

## 6. SUCCESSION PLANNING BLUEPRINT
### Succession Risk Map
[Visual representation of partner dependencies and transition timelines]

### Transition Strategies
- **Client Relationship Transfers**: [Structured handoff processes]
- **Knowledge Management**: [Capturing and transferring institutional knowledge]
- **Next Generation Development**: [Building bench strength]

### Succession Economics
[Financial implications and mitigation strategies]

## STRATEGIC SYNTHESIS
### Integrated Action Plan
[How all recommendations work together synergistically]

### Critical Path Items
[What must happen first for success]

### Success Metrics Dashboard
[KPIs to track strategic progress]

Remember: Frame all recommendations in terms of competitive advantage, financial impact, and implementation feasibility.
</response_requirements>`;
}

function createAnalysisPrompt(portfolioSummary) {
  return `You are a senior strategic consultant specializing in government relations law firms, with deep expertise in practice management, client portfolio optimization, and succession planning. Your analysis will be reviewed by managing partners and executive committees.

<context>
You are analyzing a government relations law firm's client portfolio with the following characteristics:
- Portfolio Scale: ${portfolioSummary.totalClients} clients, $${portfolioSummary.totalRevenue.toLocaleString()} total revenue
- Strategic Position: Average strategic value score of ${portfolioSummary.avgStrategicValue}/10
- Contract Mix: ${Object.entries(portfolioSummary.statusBreakdown).map(([status, count]) => `${status}: ${count}`).join(', ')}
- Practice Concentration: ${Object.entries(portfolioSummary.practiceAreas).sort(([,a], [,b]) => b - a).slice(0, 3).map(([area, count]) => `${area} (${count} clients)`).join(', ')}
- Risk Profile: ${Object.entries(portfolioSummary.riskProfile).map(([level, count]) => `${level}-risk: ${count}`).join(', ')}

Key Client Relationships:
${portfolioSummary.topClients.slice(0, 10).map((c, i) => 
  `${i + 1}. ${c.name}
   - Financial: $${c.revenue.toLocaleString()} revenue (${((c.revenue / portfolioSummary.totalRevenue) * 100).toFixed(1)}% of portfolio)
   - Strategic: ${c.strategicValue}/10 value score, ${c.status} contract
   - Risk: ${c.conflictRisk || 'Unknown'} conflict risk, ${c.renewalProbability ? `${(c.renewalProbability * 100).toFixed(0)}%` : 'Unknown'} renewal probability`
).join('\n\n')}
</context>

<thinking_framework>
Apply these analytical frameworks in your assessment:
1. Portfolio Concentration Analysis (revenue concentration risk using Herfindahl-Hirschman Index principles)
2. Client Lifecycle Value Assessment (CLV modeling for government relations context)
3. Strategic Client Segmentation (BCG Matrix adapted: Stars, Cash Cows, Question Marks, Dogs)
4. Practice Area Synergy Mapping (cross-selling potential and expertise leverage)
5. Succession Risk Framework (partner dependency and relationship transition planning)
</thinking_framework>

Provide a comprehensive strategic analysis structured as follows:

## EXECUTIVE SUMMARY
[2-3 sentences capturing the most critical insights and recommendations]

## PORTFOLIO DIAGNOSTIC

### Strategic Position Assessment
- **Market Position**: [Firm's competitive standing based on client quality and revenue metrics]
- **Portfolio Health Score**: [X/10 with justification based on diversity, growth, and risk factors]
- **Key Success Factors**: [Top 3 differentiators evident from the portfolio]

### Financial Architecture
- **Revenue Stability**: [Assessment of recurring vs. at-risk revenue]
- **Concentration Risk**: [Quantify using top 5 and top 10 client percentages]
- **Margin Implications**: [Inferred profitability insights from client mix]

## SWOT ANALYSIS WITH STRATEGIC IMPLICATIONS

### Strengths → Competitive Advantages
[Not just what's strong, but how to leverage these strengths for market dominance]

### Weaknesses → Improvement Imperatives  
[Specific vulnerabilities with quantified business impact]

### Opportunities → Growth Vectors
[Concrete expansion possibilities with revenue potential estimates]

### Threats → Risk Mitigation Priorities
[External and internal risks with probability and impact assessment]

## CLIENT PORTFOLIO SEGMENTATION

### Strategic Champions (High Value + High Revenue)
[List clients and their unique strategic importance]

### Revenue Engines (High Revenue + Lower Strategic Value)
[Optimization strategies for these cash generators]

### Strategic Investments (High Value + Lower Revenue)
[Development plans to unlock potential]

### Portfolio Candidates for Transition
[Clients to potentially sunset with succession planning]

## ACTIONABLE RECOMMENDATIONS

### Immediate Actions (Next 30 Days)
1. [Specific action with responsible party and success metric]
2. [Specific action with responsible party and success metric]
3. [Specific action with responsible party and success metric]

### Quick Wins (30-90 Days)
[3-5 high-impact, low-effort improvements with expected outcomes]

### Strategic Initiatives (3-12 Months)
[Major portfolio transformation projects with implementation roadmap]

### Long-Term Vision (1-3 Years)
[Portfolio evolution strategy aligned with market trends]

## CRITICAL SUCCESS METRICS
- Revenue Concentration: Target <X% from top 5 clients
- Strategic Value Average: Increase from ${portfolioSummary.avgStrategicValue} to X
- Practice Area Balance: Optimal mix recommendation
- Succession Readiness: X% of relationships with backup coverage

Remember: Your audience consists of seasoned managing partners. Be direct, quantitative where possible, and focus on actionable insights rather than generic observations.`;
}

function createClientRecommendationPrompt(client, portfolioContext) {
  // Calculate client-specific insights
  const revenuePerHour = client.timeCommitment ? 
    (client.averageRevenue || 0) / (client.timeCommitment * 12) : null;
  const riskScore = calculateRiskScore(client);
  const growthPotential = calculateGrowthPotential(client);
  
  return `You are a senior client relationship strategist for a premier government relations law firm. You're developing a comprehensive client strategy that will be reviewed by the managing partner and the client relationship partner.

<client_intelligence>
Client: ${client.name}
Industry: ${client.industry || 'Not specified'}
Relationship Duration: ${client.relationshipDuration || 'Not specified'}

FINANCIAL PROFILE
- Current Revenue: $${(client.averageRevenue || 0).toLocaleString()} annually
- Time Investment: ${client.timeCommitment || 'Not specified'} hours/month
- Revenue Efficiency: ${revenuePerHour ? `$${revenuePerHour.toFixed(0)}/hour` : 'Unable to calculate'}
- Payment History: ${client.paymentHistory || 'Not specified'}
- Budget Flexibility: ${client.budgetFlexibility || 'Not assessed'}

STRATEGIC PROFILE  
- Strategic Value Score: ${client.strategicValue || 'Not assessed'}/10
- Relationship Strength: ${client.relationshipStrength || 'Not assessed'}/10
- Decision Maker Access: ${client.decisionMakerAccess || 'Not specified'}
- Referral Potential: ${client.referralPotential || 'Not assessed'}
- Brand Value: ${client.brandValue || 'Not assessed'}

ENGAGEMENT PROFILE
- Contract Status: ${client.status}
- Practice Areas: ${client.practiceArea ? client.practiceArea.join(', ') : 'Not specified'}
- Service Utilization: ${client.serviceUtilization || 'Not tracked'}
- Satisfaction Score: ${client.satisfactionScore || 'Not measured'}
- Key Contacts: ${client.keyContacts || 'Not documented'}

RISK PROFILE
- Renewal Probability: ${client.renewalProbability ? `${(client.renewalProbability * 100).toFixed(0)}%` : 'Not assessed'}
- Conflict Risk: ${client.conflictRisk || 'Not assessed'}
- Competitive Threats: ${client.competitiveThreats || 'Not identified'}
- Political Exposure: ${client.politicalExposure || 'Not assessed'}
- Calculated Risk Score: ${riskScore}/10

GROWTH INDICATORS
- Historical Growth: ${client.historicalGrowth || 'Not tracked'}
- Unmet Needs: ${client.unmetNeeds || 'Not identified'}  
- Budget Headroom: ${client.budgetHeadroom || 'Unknown'}
- Calculated Growth Potential: ${growthPotential}/10
</client_intelligence>

${portfolioContext ? `<portfolio_context>\n${portfolioContext}\n</portfolio_context>` : ''}

<strategic_frameworks>
Apply these client management frameworks:
1. **Client Lifetime Value (CLV) Optimization**: Maximize long-term value extraction
2. **Key Account Management (KAM) Best Practices**: Systematic relationship development
3. **RACI Matrix**: Clarify roles in client service delivery
4. **Client Journey Mapping**: Identify enhancement touchpoints
5. **Net Promoter System**: Drive advocacy and referrals
</strategic_frameworks>

<response_structure>
Provide actionable recommendations in this format:

## EXECUTIVE SUMMARY
[2-3 sentences capturing the client's strategic importance and primary opportunity/risk]

## CLIENT STRATEGIC ASSESSMENT

### Current Position
- **Portfolio Role**: [Star, Cash Cow, Question Mark, or Dog with justification]
- **Value Creation**: [How this client contributes beyond revenue]
- **Relationship Maturity**: [Stage and trajectory]

### SWOT Analysis
[Client-specific strengths, weaknesses, opportunities, threats]

## RELATIONSHIP ENHANCEMENT STRATEGY

### Relationship Architecture
1. **Stakeholder Mapping**
   - Current Coverage: [Who we know and how well]
   - Coverage Gaps: [Who we need to know]
   - Influence Dynamics: [Power structure and decision making]

2. **Engagement Elevation Plan**
   - From: [Current relationship depth]
   - To: [Target relationship depth]
   - How: [Specific tactics and touchpoints]

3. **Trust Building Initiatives**
   [3-5 specific actions to deepen trust and partnership]

### Communication & Touch Point Strategy
- Frequency: [Optimal cadence for different stakeholders]
- Channels: [Preferred communication methods]
- Content: [Value-add topics and insights to share]

## REVENUE OPTIMIZATION PATHWAY

### Revenue Analysis
- Current State: $${(client.averageRevenue || 0).toLocaleString()} from [current services]
- Realistic Potential: $[amount] (${growthPotential > 7 ? 'High' : growthPotential > 4 ? 'Moderate' : 'Low'} growth potential)
- Stretch Goal: $[amount] with [specific conditions]

### Growth Strategies
1. **Service Expansion**
   - Immediate Opportunities: [Services they need but don't buy from us]
   - Development Opportunities: [Services to build for this client]
   - Cross-Practice Synergies: [How to leverage full firm capabilities]

2. **Value Proposition Enhancement**
   - Current Value Delivery: [What we provide today]
   - Enhanced Value Proposition: [What we could provide]
   - Investment Required: [What it takes to get there]

3. **Pricing Optimization**
   - Current Model: [Hourly, retainer, project, success-based]
   - Optimization Opportunity: [Better alignment of price to value]
   - Implementation Approach: [How to transition without friction]

### Revenue Protection
[Specific strategies to protect and ensure current revenue streams]

## RISK MITIGATION FRAMEWORK

### Risk Assessment
1. **Relationship Risks**
   - Single Point of Failure: [Over-dependence concerns]
   - Succession Vulnerabilities: [Partner transition risks]
   - Competitive Threats: [Specific firms/threats]

2. **Commercial Risks**
   - Payment Risk: [Assessment and mitigation]
   - Scope Creep: [Boundary management strategies]
   - Profitability Pressure: [Margin protection tactics]

3. **Strategic Risks**
   - Conflict Potential: [Current and future conflict scenarios]
   - Reputation Risk: [Association concerns and management]
   - Political Risk: [Changes that could impact relationship]

### Mitigation Action Plan
[Specific actions for each identified risk with owners and timelines]

## STRATEGIC POSITIONING RECOMMENDATIONS

### Portfolio Integration
- Synergies with Other Clients: [Cross-pollination opportunities]
- Practice Area Leverage: [How this client strengthens capabilities]
- Market Position Enhancement: [How this client elevates firm standing]

### Long-Term Vision
- 3-Year Relationship Goal: [Where we want to be]
- Investment Thesis: [Why continued investment makes sense]
- Success Metrics: [How we'll measure progress]

## IMPLEMENTATION ROADMAP

### 30-Day Quick Wins
1. [Specific action] - Owner: [Name] - Success Metric: [Measure]
2. [Specific action] - Owner: [Name] - Success Metric: [Measure]
3. [Specific action] - Owner: [Name] - Success Metric: [Measure]

### 90-Day Initiatives  
[3-5 medium-term improvements with clear accountability]

### 6-Month Transformations
[2-3 significant relationship enhancements]

### Annual Review Checkpoints
[Key milestones and evaluation criteria]

## SUCCESS METRICS & MONITORING

### Key Performance Indicators
- Financial: [Revenue, profitability, payment timing]
- Relationship: [NPS, satisfaction, engagement depth]
- Strategic: [Referrals, brand value, market intelligence]

### Review Cadence
- Weekly: [What to monitor]
- Monthly: [What to review]
- Quarterly: [What to assess strategically]

## DECISION REQUIREMENTS
[3-4 specific decisions needed from leadership to execute this strategy]

Remember: Be specific, actionable, and realistic. Every recommendation should have a clear owner, timeline, and success metric.
</response_structure>`;
}

// Helper functions
function calculateRiskScore(client) {
  let score = 5; // baseline
  if (client.renewalProbability && client.renewalProbability < 0.5) score += 2;
  if (client.conflictRisk === 'High') score += 2;
  if (client.status === 'At Risk') score += 1;
  if (!client.relationshipStrength || client.relationshipStrength < 5) score += 1;
  return Math.min(score, 10);
}

function calculateGrowthPotential(client) {
  let score = 5; // baseline
  if (client.strategicValue >= 8) score += 2;
  if (client.relationshipStrength >= 8) score += 1;
  if (client.budgetFlexibility === 'High') score += 1;
  if (client.satisfactionScore >= 8) score += 1;
  return Math.min(score, 10);
}



module.exports = router;
