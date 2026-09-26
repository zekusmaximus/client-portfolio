// utils/transitionPlan.cjs
//
// Pure helpers for POST /api/scenarios/transition-plan (docs/plans/tier-0.md,
// WP2 5.2C / D9): check the request and its roster, build the per-client
// prompt and parse the model's markdown into the plan shape the succession
// workflow expects. No I/O and no env, so tests/transition-plan.test.mjs can
// import this directly; the route file cannot be imported from tests because
// it loads utils/jwt.cjs via the auth middleware.
//
// The roster (docs/plans/people-and-second-chair.md, Phase 5): the page sends
// the people who are staying with their lead and second-chair loads, as its
// partnershipModel computes them; checkRoster keeps it to active people on the
// People list, with the list's names and roles. The prompt asks for a lead and
// a second chair by name from that roster, each in its own section, and the
// parser resolves each name against the same roster: a name that is not on it
// resolves to nobody, so the model can never put someone in a seat.

// sanitizeRequestBody HTML-escapes every string in the request with
// validator.escape, so a name with an apostrophe (O'Brien, which the People
// list allows) arrives as O&#x27;Brien. unescapeText (utils/escaping.cjs)
// undoes exactly that set.
const { unescapeText } = require('./escaping.cjs');

const TRANSITION_PLAN_SYSTEM =
  'You are a senior succession planning consultant specializing in government relations law firms.';

// The most people a roster may hold; the firm has about a dozen
const ROSTER_MAX = 50;
const ROLE_NAMES = { partner: 'Partner', emeritus: 'Emeritus', associate: 'Associate' };

const nameKey = (name) => (typeof name === 'string' ? unescapeText(name).trim().replace(/\s+/g, ' ').toLowerCase() : '');
const isLoad = (load) =>
  !!load && typeof load === 'object' &&
  Number.isInteger(load.count) && load.count >= 0 &&
  ['revenue', 'effort'].every((k) => typeof load[k] === 'number' && Number.isFinite(load[k]) && load[k] >= 0);

/** The names of the people leaving, from stage1Data.departing ([{ name, role }] or names). */
function departingNames(stage1Data = {}) {
  const list = Array.isArray(stage1Data?.departing) ? stage1Data.departing : [];
  return list
    .map((d) => (typeof d === 'string' ? d : d?.name))
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => unescapeText(n).trim());
}

/**
 * Check the page's roster against the People list (rows { id, name, role,
 * active }): 1 to ROSTER_MAX entries, each an active person on the list who is
 * not leaving, named once, with lead and second-chair loads ({ count,
 * revenue, effort }, non-negative numbers). The names and roles come from the
 * People list, whatever the page sent.
 * @returns {{ roster: Array<{ id, name, role, lead, second }>, errors: string[] }}
 */
function checkRoster(roster, people = [], departing = []) {
  if (!Array.isArray(roster) || roster.length === 0 || roster.length > ROSTER_MAX) {
    return { roster: [], errors: [`roster must list the 1 to ${ROSTER_MAX} people who are staying`] };
  }
  const byName = new Map(people.map((p) => [nameKey(p.name), p]));
  const leaving = new Set(departing.map(nameKey));
  const unknown = [];
  const inactive = [];
  const leavingOnRoster = [];
  const twice = [];
  const seen = new Set();
  let malformed = false;
  const checked = [];

  for (const entry of roster) {
    const key = nameKey(entry?.name);
    if (!key || !isLoad(entry?.lead) || !isLoad(entry?.second)) {
      malformed = true;
      continue;
    }
    const person = byName.get(key);
    const shown = unescapeText(entry.name).trim();
    if (!person) unknown.push(shown);
    else if (!person.active) inactive.push(person.name);
    else if (leaving.has(key)) leavingOnRoster.push(person.name);
    else if (seen.has(key)) twice.push(person.name);
    else {
      seen.add(key);
      const load = (l) => ({ count: l.count, revenue: l.revenue, effort: l.effort });
      checked.push({ id: person.id, name: person.name, role: person.role, lead: load(entry.lead), second: load(entry.second) });
    }
  }

  const errors = [];
  if (malformed) errors.push('Each roster entry needs a name, and lead and second-chair loads with a whole count and non-negative revenue and effort.');
  if (unknown.length) errors.push(`Not on the People list: ${unknown.join(', ')}.`);
  if (inactive.length) errors.push(`Inactive on the People list: ${inactive.join(', ')}.`);
  if (leavingOnRoster.length) errors.push(`Leaving, so not on the roster: ${leavingOnRoster.join(', ')}.`);
  if (twice.length) errors.push(`On the roster twice: ${twice.join(', ')}.`);
  return { roster: errors.length ? [] : checked, errors };
}

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const effortText = (n) => String(Math.round((Number(n) || 0) * 10) / 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One roster line for the prompt: "- Joe (Partner): leads 4 clients ($199,000, effort 9); second chair on 1 client ($120,000, effort 1.5)". */
function rosterLine(p) {
  return `- ${p.name} (${ROLE_NAMES[p.role] || p.role}): leads ${plural(p.lead.count, 'client')} (${money(p.lead.revenue)}, effort ${effortText(p.lead.effort)}); ` +
    `second chair on ${plural(p.second.count, 'client')} (${money(p.second.revenue)}, effort ${effortText(p.second.effort)})`;
}

// `client` is one affected client as the frontend holds it: a scored client
// from GET /api/data/clients (averageRevenue, stickinessScore, effort,
// strategicValue, the nested lead and secondChair) plus the succession
// metrics the store adds (successionRisk, transitionComplexity,
// relationshipType). `stage1Data` carries the impact analysis: departing
// ([{ name, role }]; older callers sent selectedPartners, names), impactData
// ({ totalRevenueAtRisk }) and reportingYear. `roster` is checkRoster's.
// The retention estimate Stage 1 used to send, built on the retired
// relationshipStrength, is gone (people plan, Phase 5), and the prompt no
// longer states one.
function createTransitionPlanPrompt(client, stage1Data = {}, roster = []) {
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

  const departingList = Array.isArray(stage1Data.departing) && stage1Data.departing.length > 0
    ? stage1Data.departing.map((d) => (typeof d === 'string' ? d : `${d?.name} (${ROLE_NAMES[d?.role] || d?.role || 'role not given'})`))
    : Array.isArray(stage1Data.selectedPartners) ? stage1Data.selectedPartners : [];
  const departingPartners = departingList.length > 0 ? departingList.join(', ') : 'Not specified';
  const leaving = new Set(departingNames(stage1Data).map(nameKey));
  const seat = (name) => (name ? `${name}${leaving.has(nameKey(name)) ? ' (leaving)' : ''}` : 'None');
  const leadName = client.lead?.name || client.primary_lobbyist || '';
  const secondName = client.secondChair?.name || '';
  const year = Number.isInteger(Number(stage1Data.reportingYear)) && Number(stage1Data.reportingYear) > 0
    ? ` in ${Number(stage1Data.reportingYear)}` : '';
  const impact = stage1Data.impactData || {};
  const revenueAtRisk = Number(impact.totalRevenueAtRisk) || 0;

  const prompt = `Create a detailed transition plan for this specific client based on the Stage 1 impact analysis.

## CLIENT PROFILE
- **Name**: ${client.name}
- **Annual Revenue**: $${revenue.toLocaleString()}
- **Practice Areas**: ${practiceAreas}
- **Current Lead**: ${leadName ? seat(leadName) : 'Not assigned'}
- **Current Second Chair**: ${seat(secondName)}
- **Relationship Type**: ${relationshipType}
- **Succession Risk**: ${successionRisk}/10
- **Transition Complexity**: ${transitionComplexity}/10
- **Stickiness**: ${stickiness}
- **Effort**: ${effort} (relative work units)
- **Contact Cadence**: ${cadence}
- **High-maintenance ("handful")**: ${handful}

## STAGE 1 CONTEXT
- **Departing**: ${departingPartners}
- **Total Revenue at Risk**: $${revenueAtRisk.toLocaleString()}

## ROSTER
The people who are staying, with the clients each leads now and the clients each is second chair on now, their revenue${year} and their effort. Recommend people only from this roster, by name exactly as written here: nobody else can take a seat.
${roster.length > 0 ? roster.map(rosterLine).join('\n') : '- (no roster given)'}

Please create a comprehensive transition plan with the following structure:

## TRANSITION STRATEGY
[Specific approach tailored to this client's risk profile and relationship type]

## RECOMMENDED LEAD
[On the first line, exactly one name from the roster whose role is Partner, as written there, and nothing else; then one or two sentences on why, from practice area, load and the client's needs. If the current lead is staying, name them.]

## RECOMMENDED SECOND CHAIR
[On the first line, exactly one name from the roster, other than the recommended lead, as written there, and nothing else, or None; then one or two sentences on why. If the current second chair is staying and is not the recommended lead, name them unless there is a reason to change.]

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

// A client id as GET /api/data/clients sends it: an integer on production's
// older tables, a uuid string on the tables init-db.sql creates (CLAUDE.md,
// File Structure). The route required a string until Phase 5, so on
// production every plan request answered 400.
const isClientId = (id) => (typeof id === 'string' && id.trim() !== '') || (Number.isInteger(id) && id > 0);

/**
 * Check a POST /transition-plan body; returns the 400 message, or null when
 * the request can go to the model.
 */
function checkPlanRequest(body) {
  const { client, stage1Data } = body || {};
  if (!client || typeof client !== 'object' || !isClientId(client.id) || typeof client.name !== 'string' || !client.name.trim()) {
    return 'client.id (a string or a positive integer) and client.name (a string) are required';
  }
  if (!stage1Data || typeof stage1Data !== 'object' || Array.isArray(stage1Data)) {
    return 'stage1Data (object) is required';
  }
  return null;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The roster people a line names, as whole words regardless of case; a name
 * inside a longer name that also matched ("Ann" in "Mary Ann") does not count.
 */
function rosterNamesIn(line, roster = []) {
  const plain = String(line || '').replace(/[*_`#>[\]]/g, ' ');
  const hits = [];
  for (const person of roster) {
    const re = new RegExp(`(^|[^A-Za-z])(${escapeRegExp(person.name)})(?![A-Za-z])`, 'gi');
    for (const m of plain.matchAll(re)) {
      const start = m.index + m[1].length;
      hits.push({ person, start, end: start + m[2].length });
    }
  }
  const outer = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
  return [...new Map(outer.map((h) => [h.person.id, h.person])).values()];
}

/**
 * One RECOMMENDED section resolved against the roster: the person its first
 * line names, or nobody with the reason. A name that is not on the roster
 * resolves to nobody. `seat` is 'lead' (a partner) or 'second'; `leadId` is
 * the recommended lead, whom the second chair cannot be.
 * @returns {{ person: { id, name, role } | null, none: boolean, text: string, problem: string | null }}
 */
function resolveRecommendation(section, roster = [], { seat = 'lead', leadId = null } = {}) {
  const text = typeof section === 'string' ? section.trim() : '';
  const result = { person: null, none: false, text, problem: null };
  if (!text) {
    result.problem = 'The answer had no recommendation for this seat.';
    return result;
  }
  const first = text.split('\n').map((l) => l.trim()).find(Boolean);
  const bare = first.replace(/[*_`#>[\]]/g, ' ').replace(/^[\s\-•\d.)]+/, '').trim();
  if (seat === 'second' && /^none\b/i.test(bare)) {
    result.none = true;
    return result;
  }
  const named = rosterNamesIn(first, roster);
  if (named.length === 0) {
    result.problem = 'The recommendation names nobody on the roster.';
  } else if (named.length > 1) {
    result.problem = `The recommendation names more than one person (${named.map((p) => p.name).join(', ')}).`;
  } else if (seat === 'lead' && named[0].role !== 'partner') {
    result.problem = `${named[0].name} is not a partner.`;
  } else if (seat === 'second' && leadId !== null && named[0].id === leadId) {
    result.problem = `${named[0].name} is the recommended lead.`;
  } else {
    const { id, name, role } = named[0];
    result.person = { id, name, role };
  }
  return result;
}

function parseTransitionPlanResponse(aiResponse, client = {}, roster = []) {
  const text = typeof aiResponse === 'string' ? aiResponse : '';

  try {
    const recommendedLead = resolveRecommendation(extractSection(text, 'RECOMMENDED LEAD'), roster, { seat: 'lead' });
    const recommendedSecondChair = resolveRecommendation(extractSection(text, 'RECOMMENDED SECOND CHAIR'), roster, {
      seat: 'second',
      leadId: recommendedLead.person ? recommendedLead.person.id : null,
    });

    // Extract different sections from the AI response
    const sections = {
      strategy: extractSection(text, 'TRANSITION STRATEGY'),
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
      recommendedLead,
      recommendedSecondChair,
      timelineDays: sections.timeline,
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
      recommendedLead: { person: null, none: false, text: '', problem: 'The answer could not be read.' },
      recommendedSecondChair: { person: null, none: false, text: '', problem: 'The answer could not be read.' },
      timelineDays: null,
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

// The number of days the TIMELINE section names, or null: no default is
// invented (people plan, Phase 5; Stage 3 shows only what the plan holds)
function extractTimelineFromResponse(text) {
  // Look for timeline section and extract number of days
  const timelineSection = extractSection(text, 'TIMELINE');
  if (timelineSection) {
    const dayMatch = timelineSection.match(/(\d+)\s*days?/i);
    if (dayMatch) {
      return parseInt(dayMatch[1]);
    }
  }

  return null;
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
  ROSTER_MAX,
  checkPlanRequest,
  checkRoster,
  departingNames,
  unescapeText,
  rosterNamesIn,
  resolveRecommendation,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
  extractSection,
  extractTimelineFromResponse,
  extractTasksFromResponse,
};
