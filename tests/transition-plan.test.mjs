// utils/transitionPlan.cjs (docs/plans/tier-0.md, WP2 5.3; people plan,
// Phase 5; docs/plans/tier-1.md, WP6): the request and roster checks; the
// per-client prompt on the book (the system blocks Ask sends, the client's
// facts and the roster's loads from the server's book, whatever the page
// sent), held to the page's own roster by a parity test; and the parser,
// which turns the model's markdown into the plan shape the succession
// workflow expects, resolving the recommended lead and second chair against
// the roster only.
// Pure module: never import db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import transitionPlan from '../utils/transitionPlan.cjs';
import askPrompts from '../utils/askPrompts.cjs';
import book from '../utils/book.cjs';
import { departureModel } from '../src/utils/departure.js';
import { computeReportingYear, revenueForYear } from '../src/utils/revenue.js';
import { rosterFor } from '../src/utils/transitionPlans.js';
import { PEOPLE as FIXTURE_PEOPLE, CLIENTS as FIXTURE_CLIENTS } from './fixtures/books.mjs';

const { buildBook } = book;
const {
  ROSTER_MAX,
  checkPlanRequest,
  checkRoster,
  departingNames,
  unescapeText,
  rosterNamesIn,
  resolveRecommendation,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
  bookClient,
  rosterFromBook,
} = transitionPlan;

const load = (count, revenue, effort) => ({ count, revenue, effort });
// The People list as the database has it
const PEOPLE = [
  { id: 2, name: 'Jeff', role: 'partner', active: true },
  { id: 3, name: 'Joe', role: 'partner', active: true },
  { id: 4, name: 'Kevin', role: 'partner', active: true },
  { id: 6, name: 'Paula', role: 'partner', active: true },
  { id: 7, name: 'Jay', role: 'emeritus', active: true },
  { id: 8, name: 'Anna', role: 'associate', active: true },
  { id: 9, name: 'Ben', role: 'associate', active: true },
  { id: 10, name: 'Steve', role: 'partner', active: false },
  { id: 11, name: "Mary O'Brien", role: 'associate', active: true },
  { id: 12, name: 'Mary', role: 'associate', active: true },
];
// The roster as the page sends it: the people staying, with their loads
const ROSTER_IN = [
  { name: 'Jeff', role: 'partner', lead: load(4, 235000, 8), second: load(0, 0, 0) },
  { name: 'Joe', role: 'partner', lead: load(4, 199000, 9), second: load(1, 120000, 1.5) },
  { name: 'Paula', role: 'partner', lead: load(3, 195000, 9.5), second: load(3, 250000, 1.6) },
  { name: 'Jay', role: 'emeritus', lead: load(0, 0, 0), second: load(2, 127000, 1.5) },
  { name: 'Ben', role: 'associate', lead: load(0, 0, 0), second: load(4, 205000, 1.6) },
  // escaped by the request sanitizer on the way in
  { name: 'Mary O&#x27;Brien', role: 'associate', lead: load(0, 0, 0), second: load(0, 0, 0) },
  { name: 'Mary', role: 'associate', lead: load(0, 0, 0), second: load(0, 0, 0) },
];
const DEPARTING = [{ name: 'Kevin', role: 'partner' }, { name: 'Anna', role: 'associate' }];
const { roster: ROSTER } = checkRoster(ROSTER_IN, PEOPLE, departingNames({ departing: DEPARTING }));

const client = {
  id: 'c1',
  name: 'Acme Health Alliance',
  averageRevenue: 120000,
  stickinessScore: 7.5,
  effort: 3,
  interaction_frequency: 'Weekly',
  high_maintenance: true,
  primary_lobbyist: 'Kevin',
  lead: { id: 4, name: 'Kevin', role: 'partner', active: true },
  secondChair: { id: 8, name: 'Anna', role: 'associate', active: true },
  practiceArea: ['Healthcare', 'Energy'],
  relationshipType: 'primary',
  successionRisk: 8,
  transitionComplexity: 6,
};

const stage1Data = {
  departing: DEPARTING,
  impactData: { totalRevenueAtRisk: 250000, estimatedRetentionRate: 0.82 },
  reportingYear: 2026,
};

const fixture = `## TRANSITION STRATEGY
Pair the successor with the current partner for two joint meetings before the handoff.

## RECOMMENDED LEAD
**Joe**
Joe already leads a Healthcare client and has room in his book.

## RECOMMENDED SECOND CHAIR
Ben
Ben seconds two Healthcare clients.

## TIMELINE
A 60 days transition with a mid-point review at day 30.

## KEY RISKS & MITIGATION
- Client loyalty to the departing partner: joint introduction call in week one.
- Legislative session timing: complete the handoff before the session opens.

## ACTION ITEMS
1. Schedule introduction call - Owner: Joe - Due: day 3
2. Transfer matter files - Owner: Paralegal - Due: day 7
3. Joint client meeting - Owner: Both partners - Due: day 14
4. Update the engagement letter - Owner: Joe - Due: day 21
5. Confirm billing contact - Owner: Finance - Due: day 30
6. Mid-point check-in - Owner: Joe - Due: day 30
7. Final handoff review - Owner: Managing partner - Due: day 60

## CLIENT COMMUNICATION TEMPLATE
Dear Acme team,

As discussed, Joe will lead your matters from next month.`;

// The book the server builds for the same People list (utils/book.cjs), from
// the clients as clientModel.listWithMetrics() returns them. Its figures
// differ from the page's on purpose (the request's `client` above and
// ROSTER_IN), so every figure in the prompt can be traced to one side.
const personOf = (id) => {
  const p = PEOPLE.find((x) => x.id === id);
  return p ? { ...p } : null;
};
const years = (amounts) => Object.entries(amounts).map(([year, amount]) => ({ year: Number(year), revenue_amount: `${amount}.00` }));
const stored = (id, name, leadId, secondId, extra = {}) => ({
  id,
  name,
  lead: personOf(leadId),
  secondChair: personOf(secondId),
  originator: null,
  originator_is_firm: false,
  practiceArea: [],
  revenues: [],
  stickiness: null,
  interaction_frequency: '',
  high_maintenance: false,
  conflict_risk: 'Medium',
  effort: 1,
  strategicValue: 0,
  ...extra,
});
const BOOK_CLIENTS = [
  stored('c1', 'Acme Health Alliance', 4, 8, {
    practiceArea: ['Healthcare', 'Insurance'], revenues: years({ 2025: 50000, 2026: 135000 }), stickiness: 2,
    interaction_frequency: 'Monthly', conflict_risk: 'High', effort: 2, strategicValue: 3.4,
  }),
  stored('c2', 'Capitol Energy Partners', 3, 6, {
    practiceArea: ['Energy'], revenues: years({ 2026: 80000 }), stickiness: 4, interaction_frequency: 'Monthly', effort: 2, strategicValue: 5.5,
  }),
  stored('c3', 'Harbor Schools', 3, 9, { practiceArea: ['Education'], revenues: years({ 2026: 40000 }), effort: 1, strategicValue: 2 }),
  stored('c4', 'Riverside Hospital', 6, 3, {
    practiceArea: ['Healthcare'], revenues: years({ 2026: 60000 }), stickiness: 5, interaction_frequency: 'Weekly',
    high_maintenance: true, effort: 4.5, strategicValue: 7.2,
  }),
  stored('c5', 'Old Mill Co', 2, 7, { practiceArea: ['Municipal'], revenues: years({ 2025: 30000 }), stickiness: 3, interaction_frequency: 'As-Needed', effort: 0.5, strategicValue: 3 }),
  // Production's integer id; a name the client form stored escaped
  stored(42, 'Smith &amp; O&#x27;Brien', 2, null, { revenues: years({ 2026: 25000 }), effort: 1, strategicValue: 1 }),
  // Nothing set: no lead, no revenue, not rated, no cadence, no conflict risk
  stored('c6', 'Bare Client', null, null, { conflict_risk: null }),
];
const NOW = new Date('2026-09-26T15:00:00Z');
const BOOK = buildBook({ people: PEOPLE, clients: BOOK_CLIENTS, now: NOW });
const at = { today: NOW };
const section = (prompt, from, to) => prompt.slice(prompt.indexOf(from), prompt.indexOf(to));

test('createTransitionPlanPrompt: the system blocks are Ask\'s for the same book, byte for byte; the persona is gone and nothing per request is in them', () => {
  const { system, prompt } = createTransitionPlanPrompt(client, stage1Data, ROSTER, BOOK, at);
  assert.deepEqual(system, askPrompts.systemBlocks(BOOK.text));
  assert.equal(JSON.stringify(system), JSON.stringify(askPrompts.systemBlocks(BOOK.text)));
  assert.equal(system[1].text, BOOK.text, 'the book the AI tab shows');
  assert.deepEqual(system.map((b) => Boolean(b.cache_control)), [false, true], 'the one cache marker, on the book');
  assert.equal(transitionPlan.TRANSITION_PLAN_SYSTEM, undefined, 'the old persona is gone');
  assert.doesNotMatch(JSON.stringify(system), /succession planning consultant|You are a senior/);
  assert.doesNotMatch(prompt, /You are a senior|succession planning consultant/);

  // Another client, another scenario, another day: the same blocks
  const other = createTransitionPlanPrompt({ id: 'c2', name: 'Capitol Energy Partners' },
    { departing: [{ name: 'Joe', role: 'partner' }] }, ROSTER, BOOK, { today: new Date('2027-01-04T12:00:00Z') });
  assert.equal(JSON.stringify(other.system), JSON.stringify(system));
  // The date, the scenario, the client and the roster are in the user turn only
  assert.match(prompt, /^Today is 2026-09-26\.\n/);
  assert.match(other.prompt, /^Today is 2027-01-04\.\n/);
  const blocks = JSON.stringify(system);
  for (const perRequest of ['2026-09-26', 'Today is', '## ROSTER', '## RECOMMENDED LEAD', 'are leaving the firm. Write', 'Acme Health Alliance: who', 'Succession Risk']) {
    assert.ok(!blocks.includes(perRequest), perRequest);
  }
  // The request says who is leaving and asks for the seats: rule 6's exception
  assert.match(prompt, /^Today is 2026-09-26\.\n\nKevin \(Partner\) and Anna \(Associate\) are leaving the firm\. Write the transition plan for one client they hold a seat on, Acme Health Alliance: who should take the seats they leave/m);
  assert.match(askPrompts.ASK_INSTRUCTIONS, /when a request says someone is leaving and asks who should take their seats, recommend people for those seats/);
  assert.match(askPrompts.ASK_INSTRUCTIONS, /or, when someone is leaving the firm, a request for one client's transition plan\./, 'the instructions name the request');
});

test('createTransitionPlanPrompt: the client\'s facts come from the book, not the request; the succession metrics from the request', () => {
  const { prompt } = createTransitionPlanPrompt(client, stage1Data, ROSTER, BOOK, at);
  const profile = section(prompt, '## THE CLIENT', '## ROSTER');
  assert.ok(profile.includes([
    '- **Name**: Acme Health Alliance',
    '- **Revenue 2026**: $135,000 (on file: 2025 $50,000; 2026 $135,000)',
    '- **Practice Areas**: Healthcare; Insurance',
    '- **Current Lead**: Kevin (leaving)',
    '- **Current Second Chair**: Anna (leaving)',
    '- **Stickiness**: 2 New / still shallow',
    '- **Cadence**: Monthly',
    '- **Handful**: no',
    '- **Conflict Risk**: High',
    '- **Effort**: 2',
    '- **Strategic Value**: 3.4',
  ].join('\n')), profile);
  // The request's figures for the same client (averageRevenue 120000,
  // stickinessScore 7.5, effort 3, Weekly, a handful, Energy) are not used
  assert.doesNotMatch(profile, /\$120,000|7\.5|Weekly|Energy|\*\*Handful\*\*: yes|\*\*Effort\*\*: 3/);
  assert.ok(profile.includes([
    '- **Relationship Type**: primary',
    '- **Succession Risk**: 8/10',
    '- **Transition Complexity**: 6/10',
  ].join('\n')), 'the page\'s succession analysis, which the server has no copy of');

  const scenario = section(prompt, '## THE SCENARIO', '## THE CLIENT');
  assert.match(scenario, /\*\*Departing\*\*: Kevin \(Partner\), Anna \(Associate\)/);
  assert.match(scenario, /\*\*Revenue at Risk\*\*: \$250,000/);
  assert.doesNotMatch(prompt, /[Rr]etention/, 'no retention estimate, even when a caller still sends one');
  assert.doesNotMatch(prompt, /undefined|NaN|average_revenue|relationshipStrength/);

  // A name the client form stored escaped reads as the book writes it; an integer id finds its client
  const escaped = createTransitionPlanPrompt({ id: 42, name: 'Smith &amp;amp; O&amp;#x27;Brien' }, stage1Data, ROSTER, BOOK, at).prompt;
  assert.ok(escaped.includes("- **Name**: Smith & O'Brien\n"), escaped);
  assert.ok(escaped.includes("the transition plan for one client they hold a seat on, Smith & O'Brien:"));

  // Every section the parser reads is asked for, as a heading of its own
  for (const heading of ['TRANSITION STRATEGY', 'RECOMMENDED LEAD', 'RECOMMENDED SECOND CHAIR', 'TIMELINE', 'KEY RISKS & MITIGATION', 'ACTION ITEMS', 'CLIENT COMMUNICATION TEMPLATE']) {
    assert.ok(prompt.includes(`\n## ${heading}\n`), `prompt asks for ${heading}`);
  }
  // Rule 4 (no invented owners, dates or contacts) holds in the plan's own rules
  assert.match(prompt, /give no calendar dates/);
  assert.match(prompt, /name no one at the client/);
});

test('createTransitionPlanPrompt: the roster\'s loads are the book\'s, even when the request\'s are inflated', () => {
  const inflate = (l) => ({ count: l.count + 90, revenue: l.revenue + 9000000, effort: l.effort + 900 });
  const inflated = checkRoster(ROSTER_IN.map((p) => ({ ...p, lead: inflate(p.lead), second: inflate(p.second) })), PEOPLE, departingNames(stage1Data));
  assert.deepEqual(inflated.errors, []);
  const { prompt } = createTransitionPlanPrompt(client, stage1Data, inflated.roster, BOOK, at);
  const plain = createTransitionPlanPrompt(client, stage1Data, ROSTER, BOOK, at).prompt;
  assert.equal(prompt, plain, 'the request\'s loads change nothing');

  const roster = section(prompt, '## ROSTER', 'Write the plan');
  assert.ok(roster.includes([
    '- Jeff (Partner): leads 2 clients ($25,000, effort 1.5); second chair on 0 clients ($0, effort 0)',
    '- Joe (Partner): leads 2 clients ($120,000, effort 3); second chair on 1 client ($60,000, effort 0.9)',
    '- Paula (Partner): leads 1 client ($60,000, effort 4.5); second chair on 1 client ($80,000, effort 0.4)',
    '- Jay (Emeritus): leads 0 clients ($0, effort 0); second chair on 1 client ($0, effort 0.1)',
    '- Ben (Associate): leads 0 clients ($0, effort 0); second chair on 1 client ($40,000, effort 0.2)',
    "- Mary O'Brien (Associate): leads 0 clients ($0, effort 0); second chair on 0 clients ($0, effort 0)",
    '- Mary (Associate): leads 0 clients ($0, effort 0); second chair on 0 clients ($0, effort 0)',
  ].join('\n')), roster);
  // Neither the page's figures nor the inflated ones
  assert.doesNotMatch(roster, /\$199,000|\$235,000|effort 9\b|9[0-9] clients|\$9,/);
  assert.equal((roster.match(/^- /gm) || []).length, 7, 'the roster checkRoster kept, nobody else');

  // rosterFromBook: each person's ids from checkRoster, loads from the book's rows
  const fromBook = rosterFromBook(inflated.roster, BOOK.model);
  const joe = BOOK.model.rows.find((r) => r.person.name === 'Joe');
  assert.deepEqual(fromBook.find((p) => p.name === 'Joe'), {
    id: 3, name: 'Joe', role: 'partner',
    lead: { count: joe.lead.count, revenue: joe.lead.revenue, effort: joe.lead.effort },
    second: { count: joe.second.count, revenue: joe.second.revenue, effort: joe.second.effort },
  });
  // Someone the book has no row for carries no seats (not the page's loads)
  assert.deepEqual(rosterFromBook([{ id: 99, name: 'New', role: 'associate', lead: inflate(joe.lead), second: inflate(joe.second) }], BOOK.model), [
    { id: 99, name: 'New', role: 'associate', lead: { count: 0, revenue: 0, effort: 0 }, second: { count: 0, revenue: 0, effort: 0 } },
  ]);
});

test('createTransitionPlanPrompt: the roster, with roles, and the rule to recommend only from it, in the two seats\' sections', () => {
  const { prompt } = createTransitionPlanPrompt(client, stage1Data, ROSTER, BOOK, at);
  assert.match(prompt, /\n## ROSTER\n/);
  assert.match(prompt, /Recommend people only from this roster, by name exactly as written here: nobody else can take a seat\./);
  assert.match(prompt, /their revenue in 2026 and their effort/);
  assert.ok(prompt.includes("- Mary O'Brien (Associate):"), 'the People list\'s own spelling, unescaped');
  // Nobody leaving is on it
  const roster = section(prompt, '## ROSTER', 'Write the plan');
  assert.doesNotMatch(roster, /Kevin|Anna|Steve/);
  // The fake Anthropic server finds the roster with this pattern (tests/helpers/fakeAnthropic.mjs)
  assert.deepEqual([...prompt.matchAll(/^- (.+?) \((Partner|Emeritus|Associate)\): leads /gm)].map((m) => m[1]),
    ['Jeff', 'Joe', 'Paula', 'Jay', 'Ben', "Mary O'Brien", 'Mary']);
  // The two seats, each in its own section, from the roster
  assert.match(prompt, /## RECOMMENDED LEAD\n\[On the first line, exactly one name from the roster whose role is Partner/);
  assert.match(prompt, /## RECOMMENDED SECOND CHAIR\n\[On the first line, exactly one name from the roster, other than the recommended lead, as written there, and nothing else, or None/);
});

test('createTransitionPlanPrompt: a client the book has nothing set for, and empty stage data, read as the book\'s defaults, never undefined', () => {
  const { prompt } = createTransitionPlanPrompt({ id: 'c6', name: 'Bare Client' }, {}, [], BOOK, at);
  const profile = section(prompt, '## THE CLIENT', '## ROSTER');
  for (const line of [
    '- **Revenue 2026**: $0 (on file: 2025 —; 2026 —)',
    '- **Practice Areas**: not set',
    '- **Current Lead**: none',
    '- **Current Second Chair**: none',
    '- **Stickiness**: not rated',
    '- **Cadence**: not set',
    '- **Conflict Risk**: not set',
    '- **Relationship Type**: not given',
    '- **Succession Risk**: not given',
    '- **Transition Complexity**: not given',
  ]) assert.ok(profile.includes(`${line}\n`), line);
  assert.match(prompt, /\*\*Departing\*\*: not given/);
  assert.match(prompt, /\*\*Revenue at Risk\*\*: not given/);
  assert.match(prompt, /- \(no roster given\)/);
  assert.doesNotMatch(prompt, /[Rr]etention/, 'no invented default either');
  assert.doesNotMatch(prompt, /undefined|NaN/);
  // An older caller's names
  assert.match(createTransitionPlanPrompt(client, { selectedPartners: ['Kevin (Partner)'] }, [], BOOK, at).prompt, /\*\*Departing\*\*: Kevin \(Partner\)/);
});

test('bookClient: the book\'s entry by the client id as text, integer or uuid; createTransitionPlanPrompt refuses a client not in the book', () => {
  assert.equal(bookClient(BOOK, 42).name, "Smith & O'Brien");
  assert.equal(bookClient(BOOK, '42').id, 42);
  assert.equal(bookClient(BOOK, 'c1').name, 'Acme Health Alliance');
  for (const id of [43, 'c9', '', null, undefined]) assert.equal(bookClient(BOOK, id), null, String(id));
  assert.equal(bookClient(buildBook({ people: PEOPLE, clients: [], now: NOW }), 'c1'), null, 'an empty book');
  assert.throws(() => createTransitionPlanPrompt({ id: 'c9', name: 'Gone' }, stage1Data, ROSTER, BOOK, at), /not in the book/);
});

test('checkRoster: active people on the People list, not leaving, once each, names and roles from the list', () => {
  assert.deepEqual(checkRoster(ROSTER_IN, PEOPLE, ['Kevin', 'Anna']).errors, []);
  assert.deepEqual(ROSTER.map((p) => [p.id, p.name, p.role]), [
    [2, 'Jeff', 'partner'], [3, 'Joe', 'partner'], [6, 'Paula', 'partner'], [7, 'Jay', 'emeritus'],
    [9, 'Ben', 'associate'], [11, "Mary O'Brien", 'associate'], [12, 'Mary', 'associate'],
  ]);
  assert.deepEqual(ROSTER[1].second, load(1, 120000, 1.5));
  // The list's role wins over the page's; case and spacing do not matter
  const relabelled = checkRoster([{ ...ROSTER_IN[3], name: '  JAY ', role: 'partner' }], PEOPLE, []);
  assert.deepEqual([relabelled.roster[0].name, relabelled.roster[0].role], ['Jay', 'emeritus']);

  const refused = (roster, departing = []) => checkRoster(roster, PEOPLE, departing);
  const entry = (name) => ({ name, role: 'partner', lead: load(0, 0, 0), second: load(0, 0, 0) });
  assert.deepEqual(refused([entry('Nobody'), entry('Zed')]).errors, ['Not on the People list: Nobody, Zed.']);
  assert.deepEqual(refused([entry('Steve')]).errors, ['Inactive on the People list: Steve.']);
  assert.deepEqual(refused([entry('Kevin')], ['Kevin']).errors, ['Leaving, so not on the roster: Kevin.']);
  assert.deepEqual(refused([entry('Joe'), entry('joe')]).errors, ['On the roster twice: Joe.']);
  assert.deepEqual(refused([entry('Joe'), entry('Nobody')]).roster, [], 'any problem refuses the whole roster');
  for (const bad of [
    { name: 'Joe', lead: load(1, 0, 0) },
    { name: 'Joe', lead: load(1.5, 0, 0), second: load(0, 0, 0) },
    { name: 'Joe', lead: load(1, -1, 0), second: load(0, 0, 0) },
    { name: 'Joe', lead: load(1, 0, NaN), second: load(0, 0, 0) },
    { name: 'Joe', lead: load(1, '5', 0), second: load(0, 0, 0) },
    { lead: load(1, 0, 0), second: load(0, 0, 0) },
    null,
  ]) {
    assert.match(refused([bad]).errors[0], /^Each roster entry needs a name/, JSON.stringify(bad));
  }
  const tooLong = `roster must list the 1 to ${ROSTER_MAX} people who are staying`;
  assert.deepEqual(refused([]).errors, [tooLong]);
  assert.deepEqual(refused(undefined).errors, [tooLong]);
  assert.deepEqual(refused({}).errors, [tooLong]);
  assert.deepEqual(refused(Array.from({ length: ROSTER_MAX + 1 }, () => entry('Joe'))).errors, [tooLong]);
});

test('unescapeText and departingNames undo the request sanitizer', () => {
  assert.equal(unescapeText('O&#x27;Brien &amp; &lt;Co&gt; &quot;x&quot; a&#x2F;b'), `O'Brien & <Co> "x" a/b`);
  assert.equal(unescapeText('&amp;lt;'), '&lt;', 'one level only');
  assert.deepEqual(departingNames({ departing: [{ name: 'Mary O&#x27;Brien' }, 'Kevin', { role: 'x' }] }), ["Mary O'Brien", 'Kevin']);
  assert.deepEqual(departingNames({}), []);
});

test('parseTransitionPlanResponse: extracts every section, and resolves the lead and second chair against the roster', () => {
  const plan = parseTransitionPlanResponse(fixture, client, ROSTER);
  assert.equal(plan.strategy, 'Pair the successor with the current partner for two joint meetings before the handoff.');
  assert.deepEqual(plan.recommendedLead.person, { id: 3, name: 'Joe', role: 'partner' });
  assert.match(plan.recommendedLead.text, /^\*\*Joe\*\*\nJoe already leads a Healthcare client/);
  assert.equal(plan.recommendedLead.problem, null);
  assert.deepEqual(plan.recommendedSecondChair.person, { id: 9, name: 'Ben', role: 'associate' });
  assert.equal(plan.recommendedSecondChair.none, false);
  assert.equal(plan.successorPartner, undefined, 'the free-text successor is gone');
  assert.equal(plan.timelineDays, 60);
  assert.match(plan.risks, /^- Client loyalty to the departing partner/);
  assert.equal(plan.tasks.length, 5, 'at most five tasks');
  assert.equal(plan.tasks[0], 'Schedule introduction call - Owner: Joe - Due: day 3');
  assert.equal(plan.tasks[4], 'Confirm billing contact - Owner: Finance - Due: day 30');
  assert.match(plan.communicationTemplate, /^Dear Acme team,/);
  assert.match(plan.communicationTemplate, /Joe will lead your matters from next month\.$/);
  assert.equal(plan.status, 'planned');
  assert.equal(plan.priority, 'critical', 'successionRisk 8 is critical');
  assert.ok(!Number.isNaN(Date.parse(plan.createdAt)));
});

test('a recommendation off the roster resolves to nobody and never fills a seat', () => {
  const answer = (lead, second) => `## RECOMMENDED LEAD\n${lead}\nBecause.\n\n## RECOMMENDED SECOND CHAIR\n${second}\nBecause.\n\n## TIMELINE\n30 days`;
  const parse = (lead, second) => parseTransitionPlanResponse(answer(lead, second), client, ROSTER);

  // Someone leaving, someone inactive, someone never on the list
  for (const name of ['Kevin', 'Steve', 'Jane Roe', 'the healthcare partner']) {
    const plan = parse(name, name);
    assert.equal(plan.recommendedLead.person, null, name);
    assert.equal(plan.recommendedLead.problem, 'The recommendation names nobody on the roster.');
    assert.equal(plan.recommendedSecondChair.person, null, name);
  }
  // A roster person who cannot lead
  assert.equal(parse('Jay', 'Ben').recommendedLead.problem, 'Jay is not a partner.');
  assert.equal(parse('Jay', 'Ben').recommendedLead.person, null);
  // The second chair cannot be the recommended lead
  const same = parse('Joe', 'Joe');
  assert.deepEqual([same.recommendedLead.person.name, same.recommendedSecondChair.person], ['Joe', null]);
  assert.equal(same.recommendedSecondChair.problem, 'Joe is the recommended lead.');
  // Two names on the first line: nobody
  assert.equal(parse('Joe or Paula', 'None').recommendedLead.problem, 'The recommendation names more than one person (Joe, Paula).');
  // None is an answer for the second chair, not for the lead
  const none = parse('Paula', '**None**');
  assert.deepEqual([none.recommendedSecondChair.none, none.recommendedSecondChair.person, none.recommendedSecondChair.problem], [true, null, null]);
  assert.equal(parse('None', 'None').recommendedLead.person, null);
  // Only the first line counts: a name in the reasoning does not
  assert.equal(parseTransitionPlanResponse('## RECOMMENDED LEAD\nTo be decided.\nJoe could do it.\n', client, ROSTER).recommendedLead.person, null);
  // No section, or no roster: nobody
  assert.equal(parseTransitionPlanResponse('## TIMELINE\n30 days', client, ROSTER).recommendedLead.problem, 'The answer had no recommendation for this seat.');
  assert.equal(parseTransitionPlanResponse(fixture, client).recommendedLead.person, null, 'without a roster nobody resolves');
});

test('rosterNamesIn and resolveRecommendation: whole names, regardless of case and markdown', () => {
  const names = (line) => rosterNamesIn(line, ROSTER).map((p) => p.name);
  assert.deepEqual(names('joe'), ['Joe']);
  assert.deepEqual(names('- **Joe** (Partner)'), ['Joe']);
  assert.deepEqual(names('Joey'), [], 'not part of a longer word');
  assert.deepEqual(names("Mary O'Brien"), ["Mary O'Brien"], 'a name inside a longer matched name does not count');
  assert.deepEqual(names('Mary, then Mary O\'Brien').sort(), ['Mary', "Mary O'Brien"]);
  assert.deepEqual(names('Recommended lead: Paula'), ['Paula']);
  assert.deepEqual(resolveRecommendation("Mary O'Brien", ROSTER, { seat: 'second' }).person, { id: 11, name: "Mary O'Brien", role: 'associate' });
  assert.deepEqual(resolveRecommendation('1. Jeff', ROSTER).person, { id: 2, name: 'Jeff', role: 'partner' });
});

test('parseTransitionPlanResponse: priority follows the client succession risk', () => {
  assert.equal(parseTransitionPlanResponse(fixture, { successionRisk: 6 }).priority, 'high');
  assert.equal(parseTransitionPlanResponse(fixture, { successionRisk: 5 }).priority, 'medium');
  assert.equal(parseTransitionPlanResponse(fixture, { successionRisk: 3 }).priority, 'low');
  assert.equal(parseTransitionPlanResponse(fixture).priority, 'medium');
});

test('parseTransitionPlanResponse: empty text returns the documented defaults, with no invented timeline', () => {
  const noRecommendation = { person: null, none: false, text: '', problem: 'The answer had no recommendation for this seat.' };
  const expected = {
    strategy: 'No strategy generated',
    recommendedLead: noRecommendation,
    recommendedSecondChair: noRecommendation,
    timelineDays: null,
    risks: 'No specific risks identified',
    tasks: [],
    communicationTemplate: 'No template generated',
    priority: 'medium',
    status: 'planned',
  };
  for (const text of ['', undefined, null]) {
    const { createdAt, ...plan } = parseTransitionPlanResponse(text, client, ROSTER);
    plan.priority = 'medium'; // the client fixture is critical; defaults are about the sections
    assert.deepEqual(plan, expected);
    assert.ok(createdAt);
  }
  // A number of days outside the TIMELINE section is not the timeline
  assert.equal(parseTransitionPlanResponse('## KEY RISKS & MITIGATION\nCall within 5 days.', client).timelineDays, null);
});

test('checkPlanRequest: a client id is a uuid string or, on production\'s older tables, an integer', () => {
  const ok = { client: { id: 42, name: 'Acme' }, stage1Data: {} };
  assert.equal(checkPlanRequest(ok), null, 'production\'s integer ids were refused with a 400 before Phase 5');
  assert.equal(checkPlanRequest({ ...ok, client: { id: '3f2b8c1e-0000-4000-8000-000000000000', name: 'Acme' } }), null);
  const refused = 'client.id (a string or a positive integer) and client.name (a string) are required';
  for (const client of [undefined, null, 'Acme', { name: 'Acme' }, { id: 0, name: 'Acme' }, { id: -1, name: 'Acme' },
    { id: 1.5, name: 'Acme' }, { id: '', name: 'Acme' }, { id: 1 }, { id: 1, name: '  ' }, { id: true, name: 'Acme' }]) {
    assert.equal(checkPlanRequest({ ...ok, client }), refused, JSON.stringify(client));
  }
  for (const stage1Data of [undefined, null, [], 'x']) {
    assert.equal(checkPlanRequest({ ...ok, stage1Data }), 'stage1Data (object) is required');
  }
  assert.equal(checkPlanRequest(undefined), refused);
});

// WP6's parity (docs/plans/tier-1.md, section 11): the loads the server puts
// on the roster (checkRoster, then rosterFromBook over utils/book.cjs) equal
// the page's rosterFor(departure) (src/utils/transitionPlans.js) on the fixture
// book of tests/load.test.mjs, for every one person leaving and for two at
// once. Counts exactly; revenue to 1e-9 of its size (the two sides sum in
// different orders); effort to 0.005 plus 1e-9, because rosterFor rounds it
// to the hundredth.
test('parity: the roster\'s loads from the server\'s book equal the page\'s rosterFor on the fixture book', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const year = computeReportingYear(FIXTURE_CLIENTS, now);
  const serverBook = buildBook({ people: FIXTURE_PEOPLE, clients: FIXTURE_CLIENTS, now });
  assert.equal(serverBook.reportingYear, year);
  const active = FIXTURE_PEOPLE.filter((p) => p.active);
  const scenarios = [...active.map((p) => [p.id]), [4, 8], [6, 7]];
  let compared = 0;
  for (const departingIds of scenarios) {
    const departure = departureModel({
      people: FIXTURE_PEOPLE, clients: FIXTURE_CLIENTS, departingIds, revenueOf: (c) => revenueForYear(c, year),
    });
    const pageRoster = rosterFor(departure);
    const checked = checkRoster(pageRoster, FIXTURE_PEOPLE, departingNames({ departing: departure.departing.map((p) => ({ name: p.name, role: p.role })) }));
    assert.deepEqual(checked.errors, [], `leaving ${departingIds}`);
    const serverRoster = rosterFromBook(checked.roster, serverBook.model);
    assert.deepEqual(serverRoster.map((p) => p.name), pageRoster.map((p) => p.name), `leaving ${departingIds}: the same people, in the same order`);
    serverRoster.forEach((s, i) => {
      const p = pageRoster[i];
      for (const seat of ['lead', 'second']) {
        const who = `leaving ${departingIds}, ${s.name}, ${seat}`;
        assert.equal(s[seat].count, p[seat].count, `${who}: count`);
        assert.ok(Math.abs(s[seat].revenue - p[seat].revenue) <= 1e-9 * Math.max(1, Math.abs(p[seat].revenue)), `${who}: revenue ${s[seat].revenue} vs ${p[seat].revenue}`);
        assert.ok(Math.abs(s[seat].effort - p[seat].effort) <= 0.005 + 1e-9, `${who}: effort ${s[seat].effort} vs ${p[seat].effort}`);
        compared += 1;
      }
    });
  }
  assert.ok(compared >= 100, `${compared} loads compared`);
});
