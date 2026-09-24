// utils/transitionPlan.cjs
//
// Pure helpers for POST /api/scenarios/transition-plan (docs/plans/tier-0.md,
// WP2 5.2C / D9): build the per-client prompt and parse the model's markdown
// into the plan shape the succession workflow expects. No I/O and no env, so
// tests/transition-plan.test.mjs can import this directly; the route file
// cannot be imported from tests because it loads utils/jwt.cjs via the auth
// middleware.

const TRANSITION_PLAN_SYSTEM =
  'You are a senior succession planning consultant specializing in government relations law firms.';

// `client` is one affected client as the frontend holds it: a scored client
// from GET /api/data/clients (averageRevenue, stickinessScore, effort,
// strategicValue) plus the succession metrics the store adds (successionRisk,
// transitionComplexity, relationshipType). `stage1Data` carries the impact
// analysis: selectedPartners (names) and impactData.
function createTransitionPlanPrompt(client, stage1Data = {}) {
  const revenue = Number(client.averageRevenue) || 0;
  const practiceAreas = Array.isArray(client.practiceArea)
    ? client.practiceArea.join(', ')
    : client.practiceArea || 'Not specified';
  const relationshipType = client.relationshipType || 'unknown';
  const successionRisk = client.successionRisk || 5;
  const transitionComplexity = client.transitionComplexity || 5;
  const stickiness = client.stickinessScore != null && client.stickinessScore !== ''
    ? `${client.stickinessScore}/10`
    : 'Not specified';
  const effort = client.effort != null && client.effort !== '' ? String(client.effort) : 'Not specified';
  const cadence = client.interaction_frequency || 'Not specified';
  const handful = client.high_maintenance === true || client.high_maintenance === 'true' ? 'Yes' : 'No';

  const departingPartners = Array.isArray(stage1Data.selectedPartners) && stage1Data.selectedPartners.length > 0
    ? stage1Data.selectedPartners.join(', ')
    : 'Not specified';
  const impact = stage1Data.impactData || {};
  const revenueAtRisk = Number(impact.totalRevenueAtRisk) || 0;
  const retentionRate = Number(impact.estimatedRetentionRate) || 0.8;

  const prompt = `Create a detailed transition plan for this specific client based on the Stage 1 impact analysis.

## CLIENT PROFILE
- **Name**: ${client.name}
- **Annual Revenue**: $${revenue.toLocaleString()}
- **Practice Areas**: ${practiceAreas}
- **Current Partner**: ${client.primary_lobbyist || 'Not assigned'}
- **Relationship Type**: ${relationshipType}
- **Succession Risk**: ${successionRisk}/10
- **Transition Complexity**: ${transitionComplexity}/10
- **Stickiness**: ${stickiness}
- **Effort**: ${effort} (relative work units)
- **Contact Cadence**: ${cadence}
- **High-maintenance ("handful")**: ${handful}

## STAGE 1 CONTEXT
- **Departing Partners**: ${departingPartners}
- **Total Revenue at Risk**: $${revenueAtRisk.toLocaleString()}
- **Expected Retention Rate**: ${(retentionRate * 100).toFixed(1)}%

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

  return { system: TRANSITION_PLAN_SYSTEM, prompt };
}

function parseTransitionPlanResponse(aiResponse, client = {}) {
  const text = typeof aiResponse === 'string' ? aiResponse : '';

  try {
    // Extract different sections from the AI response
    const sections = {
      strategy: extractSection(text, 'TRANSITION STRATEGY'),
      successorPartner: extractSection(text, 'RECOMMENDED SUCCESSOR'),
      timeline: extractTimelineFromResponse(text),
      risks: extractSection(text, 'KEY RISKS & MITIGATION'),
      tasks: extractTasksFromResponse(text),
      communicationTemplate: extractSection(text, 'CLIENT COMMUNICATION TEMPLATE')
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

module.exports = {
  TRANSITION_PLAN_SYSTEM,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
  extractSection,
  extractTimelineFromResponse,
  extractTasksFromResponse,
};
