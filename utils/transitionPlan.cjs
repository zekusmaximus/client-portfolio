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
//
// On the book (docs/plans/tier-1.md, WP6, T14): the plan is written with the
// whole book in view. Its system blocks are Ask's and the brief's
// (systemBlocks in utils/askPrompts.cjs: the instructions, then the book with
// the one cache marker), byte for byte, so a plan and a question on the same
// book share one cache entry (T8); the date, the scenario, the client and the
// roster go in the user turn. The client's facts come from its entry in the
// server's book (utils/book.cjs) and the roster's loads from the book's rows,
// whatever figures the page sent; only the page's succession metrics
// (successionRisk, transitionComplexity, relationshipType) come from the
// request, since the server has no copy of src/utils/successionUtils.js.

// Until WP5 the route's request sanitizer HTML-escaped every string in the
// request with validator.escape, so a name with an apostrophe (O'Brien, which
// the People list allows) arrived as O&#x27;Brien; unescapeText
// (utils/escaping.cjs) undoes exactly that set. Names now arrive as the page
// holds them, plain for people, and one level of decoding leaves plain text
// as it is; WP5's second PR removes these calls.
const { unescapeText } = require('./escaping.cjs');
const { systemBlocks, firmDate } = require('./askPrompts.cjs');
const {
  formatMoney,
  formatEffort,
  formatClientEffort,
  stickinessText,
  cadenceText,
  conflictText,
} = require('./book.cjs');

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One roster line for the prompt: "- Joe (Partner): leads 4 clients ($199,000,
 * effort 9); second chair on 1 client ($120,000, effort 1.5)". The figures are
 * formatted as the book formats them (formatMoney, formatEffort), so a line
 * shows what the book's People tables show for the same person. The fake
 * Anthropic server finds the roster by this shape (tests/helpers/fakeAnthropic.mjs).
 */
function rosterLine(p) {
  return `- ${p.name} (${ROLE_NAMES[p.role] || p.role}): leads ${plural(p.lead.count, 'client')} (${formatMoney(p.lead.revenue)}, effort ${formatEffort(p.lead.effort)}); ` +
    `second chair on ${plural(p.second.count, 'client')} (${formatMoney(p.second.revenue)}, effort ${formatEffort(p.second.effort)})`;
}

/**
 * The book's entry for a client (buildBook's model.clients), found by the id
 * as text: an integer on production's older tables, a uuid on the tables
 * init-db.sql creates (CLAUDE.md, File Structure). null when the book has no
 * such client.
 */
function bookClient(book, id) {
  if (id === null || id === undefined || id === '') return null;
  const wanted = String(id);
  return (book?.model?.clients || []).find((c) => String(c.id) === wanted) || null;
}

/**
 * The roster with each person's lead and second-chair loads ({ count,
 * revenue, effort }) taken from the book's rows (utils/book.cjs, the port of
 * the page's partnershipModel), whatever loads the request carried (T14).
 * `roster` is checkRoster's, whose ids come from the People list the book was
 * built from; someone the book has no row for holds no seat in it.
 */
function rosterFromBook(roster = [], model = {}) {
  const rows = new Map((model.rows || []).map((r) => [String(r.person.id), r]));
  const load = (l) => ({ count: l?.count || 0, revenue: l?.revenue || 0, effort: l?.effort || 0 });
  return roster.map((p) => {
    const row = rows.get(String(p.id));
    return { id: p.id, name: p.name, role: p.role, lead: load(row?.lead), second: load(row?.second) };
  });
}

// "Kevin", "Kevin and Anna", "Kevin, Anna and Jay"
const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// A succession metric the page computed (src/utils/successionUtils.js), out of 10
const metric = (value) => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? `${n}/10` : 'not given';
};

/**
 * One client's transition plan on the book (T14).
 *
 * `client` is the affected client as the page holds it; only its id (to find
 * it in the book) and the succession metrics the store adds (successionRisk,
 * transitionComplexity, relationshipType) are read. `stage1Data` carries who
 * is leaving (departing: [{ name, role }]; older callers sent
 * selectedPartners, names) and impactData.totalRevenueAtRisk, the page's
 * figure. `roster` is checkRoster's: its loads are replaced with the book's
 * (rosterFromBook). `book` is buildBook's result; `today` is taken in the
 * firm's zone. The retention estimate Stage 1 used to send, built on the
 * retired relationshipStrength, is gone (people plan, Phase 5), and the
 * prompt states none.
 *
 * @returns {{ system: Array, prompt: string }} system is systemBlocks(book.text), byte for byte
 */
function createTransitionPlanPrompt(client, stage1Data = {}, roster = [], book, { today = new Date() } = {}) {
  const entry = bookClient(book, client?.id);
  if (!entry) throw new Error(`Client ${client?.id} is not in the book.`);
  const data = stage1Data || {};
  const year = book.reportingYear;
  const years = book.model.years || [];

  const departing = Array.isArray(data.departing) && data.departing.length > 0
    ? data.departing
      .map((d) => (typeof d === 'string' ? unescapeText(d).trim() : `${unescapeText(String(d?.name ?? '')).trim()} (${ROLE_NAMES[d?.role] || d?.role || 'role not given'})`))
    : Array.isArray(data.selectedPartners) ? data.selectedPartners.map((n) => unescapeText(String(n)).trim()) : [];
  const leaving = new Set(departingNames(data).map(nameKey));
  const seat = (p) => (p ? `${p.name}${leaving.has(nameKey(p.name)) ? ' (leaving)' : ''}${p.active ? '' : ' (inactive)'}` : 'none');
  const atRisk = Number(data.impactData?.totalRevenueAtRisk);
  const revenueAtRisk = data.impactData?.totalRevenueAtRisk !== undefined && data.impactData?.totalRevenueAtRisk !== null && Number.isFinite(atRisk)
    ? `${formatMoney(atRisk)} (the page's figure: the ${year} revenue of the clients the people leaving lead or second-chair)`
    : 'not given';
  const onFile = years.length
    ? ` (on file: ${years.map((y) => `${y} ${entry.revenueByYear[y] === null ? '—' : formatMoney(entry.revenueByYear[y])}`).join('; ')})`
    : '';
  const opening = departing.length > 0
    ? `${andList(departing)} ${departing.length === 1 ? 'is' : 'are'} leaving the firm. Write the transition plan for one client they hold a seat on, ${entry.name}: who should take the seats they leave, with reasons, and how to hand the relationship over.`
    : `Write the transition plan for one client, ${entry.name}, in a departure scenario that does not say who is leaving: who should hold its seats, with reasons, and how to hand the relationship over.`;
  const staying = rosterFromBook(roster, book.model);

  const prompt = `Today is ${firmDate(today)}.

${opening}

## THE SCENARIO
- **Departing**: ${departing.length > 0 ? departing.join(', ') : 'not given'}
- **Revenue at Risk**: ${revenueAtRisk}

## THE CLIENT
As the book lists it (its row in the Clients table):
- **Name**: ${entry.name}
- **Revenue ${year}**: ${formatMoney(entry.revenue)}${onFile}
- **Practice Areas**: ${entry.practiceAreas.length ? entry.practiceAreas.join('; ') : 'not set'}
- **Current Lead**: ${seat(entry.lead)}
- **Current Second Chair**: ${seat(entry.secondChair)}
- **Stickiness**: ${stickinessText(entry.stickiness)}
- **Cadence**: ${cadenceText(entry.cadence)}
- **Handful**: ${entry.handful ? 'yes' : 'no'}
- **Conflict Risk**: ${conflictText(entry.conflictRisk)}
- **Effort**: ${formatClientEffort(entry.effort)}
- **Strategic Value**: ${entry.strategicValue.toFixed(1)}

From the page's succession analysis, which the book does not hold:
- **Relationship Type**: ${client.relationshipType ? unescapeText(String(client.relationshipType)) : 'not given'}
- **Succession Risk**: ${metric(client.successionRisk)}
- **Transition Complexity**: ${metric(client.transitionComplexity)}

## ROSTER
The people who are staying, with the clients each leads now and the clients each is second chair on now, their revenue in ${year} and their effort, as the book's People tables give them. Recommend people only from this roster, by name exactly as written here: nobody else can take a seat.
${staying.length > 0 ? staying.map(rosterLine).join('\n') : '- (no roster given)'}

Write the plan under these seven headings, in this order, each as a level-2 heading exactly as written:

## TRANSITION STRATEGY
[How to hand this client over, from what the book records about it (its stickiness, cadence, conflict risk and who holds its seats now) and the succession analysis above.]

## RECOMMENDED LEAD
[On the first line, exactly one name from the roster whose role is Partner, as written there, and nothing else; then one or two sentences on why, from the practice areas they hold, their load against the partners' average and the client's needs. If the current lead is staying, name them.]

## RECOMMENDED SECOND CHAIR
[On the first line, exactly one name from the roster, other than the recommended lead, as written there, and nothing else, or None; then one or two sentences on why. If the current second chair is staying and is not the recommended lead, name them unless there is a reason to change.]

## TIMELINE
[The number of days you recommend for the handover, such as 30, 60 or 90 days, and why, in a sentence.]

## KEY RISKS & MITIGATION
[Two or three risks to this relationship during the handover, each with how to reduce it.]

## ACTION ITEMS
[Three to five tasks as a numbered list, one to a line, each naming who does it (the recommended lead or second chair, or someone leaving) and the day of the handover it falls on.]

## CLIENT COMMUNICATION TEMPLATE
[A short draft email to the client introducing the change. The book holds no contacts, so address it to the client by its name and name no one at the client.]

The timeline and the days in the action items are your recommendation, counted from the start of the handover: give no calendar dates. Keep the plan to about 600 words, the email included.`;

  return { system: systemBlocks(book.text), prompt };
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
  ROSTER_MAX,
  checkPlanRequest,
  checkRoster,
  departingNames,
  unescapeText,
  rosterNamesIn,
  resolveRecommendation,
  rosterLine,
  bookClient,
  rosterFromBook,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
  extractSection,
  extractTimelineFromResponse,
  extractTasksFromResponse,
};
