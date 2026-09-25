// utils/transitionPlan.cjs (docs/plans/tier-0.md, WP2 5.3; people plan,
// Phase 5): the request and roster checks, the per-client prompt reads the
// fields the frontend actually sends and lists the roster, and the parser turns
// the model's markdown into the plan shape the succession workflow expects,
// resolving the recommended lead and second chair against the roster only.
// Pure module: never import db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import transitionPlan from '../utils/transitionPlan.cjs';

const {
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

test('createTransitionPlanPrompt: persona is the system prompt, the task is the user prompt', () => {
  const { system, prompt } = createTransitionPlanPrompt(client, stage1Data, ROSTER);
  assert.equal(system, TRANSITION_PLAN_SYSTEM);
  assert.match(system, /^You are a senior succession planning consultant/);
  assert.doesNotMatch(prompt, /You are a senior/);
  assert.match(prompt, /^Create a detailed transition plan/);
});

test('createTransitionPlanPrompt: reads the fields the frontend sends (averageRevenue, stickinessScore, effort, cadence, handful)', () => {
  const { prompt } = createTransitionPlanPrompt(client, stage1Data, ROSTER);
  assert.match(prompt, /\*\*Name\*\*: Acme Health Alliance/);
  assert.match(prompt, /\*\*Annual Revenue\*\*: \$120,000/);
  assert.match(prompt, /\*\*Practice Areas\*\*: Healthcare, Energy/);
  assert.match(prompt, /\*\*Current Lead\*\*: Kevin \(leaving\)/);
  assert.match(prompt, /\*\*Current Second Chair\*\*: Anna \(leaving\)/);
  assert.match(prompt, /\*\*Relationship Type\*\*: primary/);
  assert.match(prompt, /\*\*Succession Risk\*\*: 8\/10/);
  assert.match(prompt, /\*\*Transition Complexity\*\*: 6\/10/);
  assert.match(prompt, /\*\*Stickiness\*\*: 7\.5\/10/);
  assert.match(prompt, /\*\*Effort\*\*: 3 /);
  assert.match(prompt, /\*\*Contact Cadence\*\*: Weekly/);
  assert.match(prompt, /\("handful"\)\*\*: Yes/);
  assert.match(prompt, /\*\*Departing\*\*: Kevin \(Partner\), Anna \(Associate\)/);
  assert.match(prompt, /\*\*Total Revenue at Risk\*\*: \$250,000/);
  // The retention estimate was built on the retired relationshipStrength; the
  // prompt states none, even when a caller still sends one
  assert.doesNotMatch(prompt, /[Rr]etention/);
  // the retired reads are gone
  assert.doesNotMatch(prompt, /average_revenue|relationshipStrength|Relationship Strength|Current Partner|SUCCESSOR/);
  assert.doesNotMatch(prompt, /undefined|NaN/);
  // the sections the parser looks for are requested
  for (const heading of ['TRANSITION STRATEGY', 'RECOMMENDED LEAD', 'RECOMMENDED SECOND CHAIR', 'TIMELINE', 'KEY RISKS & MITIGATION', 'ACTION ITEMS', 'CLIENT COMMUNICATION TEMPLATE']) {
    assert.ok(prompt.includes(`## ${heading}\n`), `prompt asks for ${heading}`);
  }
});

test('createTransitionPlanPrompt: the roster, with roles and loads, and the rule to recommend only from it', () => {
  const { prompt } = createTransitionPlanPrompt(client, stage1Data, ROSTER);
  assert.match(prompt, /## ROSTER\n/);
  assert.match(prompt, /Recommend people only from this roster, by name exactly as written here: nobody else can take a seat\./);
  assert.match(prompt, /their revenue in 2026 and their effort/);
  assert.ok(prompt.includes('- Joe (Partner): leads 4 clients ($199,000, effort 9); second chair on 1 client ($120,000, effort 1.5)'));
  assert.ok(prompt.includes('- Jay (Emeritus): leads 0 clients ($0, effort 0); second chair on 2 clients ($127,000, effort 1.5)'));
  assert.ok(prompt.includes("- Mary O'Brien (Associate):"), 'the People list\'s own spelling, unescaped');
  // Nobody leaving is on it
  const roster = prompt.slice(prompt.indexOf('## ROSTER'), prompt.indexOf('Please create'));
  assert.doesNotMatch(roster, /Kevin|Anna|Steve/);
  // The two seats, each in its own section, from the roster
  assert.match(prompt, /## RECOMMENDED LEAD\n\[On the first line, exactly one name from the roster whose role is Partner/);
  assert.match(prompt, /## RECOMMENDED SECOND CHAIR\n\[On the first line, exactly one name from the roster, other than the recommended lead, as written there, and nothing else, or None/);
});

test('createTransitionPlanPrompt: a bare client and empty stage data fall back to "Not specified", never undefined', () => {
  const { prompt } = createTransitionPlanPrompt({ id: 'c2', name: 'Beta LLC' }, {});
  assert.match(prompt, /\*\*Annual Revenue\*\*: \$0/);
  assert.match(prompt, /\*\*Stickiness\*\*: Not specified/);
  assert.match(prompt, /\*\*Effort\*\*: Not specified/);
  assert.match(prompt, /\*\*Contact Cadence\*\*: Not specified/);
  assert.match(prompt, /\("handful"\)\*\*: No/);
  assert.match(prompt, /\*\*Current Lead\*\*: Not assigned/);
  assert.match(prompt, /\*\*Current Second Chair\*\*: None/);
  assert.match(prompt, /\*\*Departing\*\*: Not specified/);
  assert.match(prompt, /- \(no roster given\)/);
  assert.doesNotMatch(prompt, /[Rr]etention/, 'no invented default either');
  assert.doesNotMatch(prompt, /undefined|NaN/);
  // An older caller's names
  assert.match(createTransitionPlanPrompt(client, { selectedPartners: ['Kevin (Partner)'] }).prompt, /\*\*Departing\*\*: Kevin \(Partner\)/);
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
