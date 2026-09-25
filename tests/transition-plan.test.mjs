// utils/transitionPlan.cjs (docs/plans/tier-0.md, WP2 5.3): the per-client
// prompt reads the fields the frontend actually sends, and the parser turns the
// model's markdown into the plan shape the succession workflow expects. Pure
// module: never import db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import transitionPlan from '../utils/transitionPlan.cjs';

const { TRANSITION_PLAN_SYSTEM, checkPlanRequest, createTransitionPlanPrompt, parseTransitionPlanResponse } = transitionPlan;

const client = {
  id: 'c1',
  name: 'Acme Health Alliance',
  averageRevenue: 120000,
  stickinessScore: 7.5,
  effort: 3,
  interaction_frequency: 'Weekly',
  high_maintenance: true,
  primary_lobbyist: 'John Doe',
  practiceArea: ['Healthcare', 'Energy'],
  relationshipType: 'primary',
  successionRisk: 8,
  transitionComplexity: 6,
};

const stage1Data = {
  selectedPartners: ['John Doe', 'Jane Roe'],
  impactData: { totalRevenueAtRisk: 250000, estimatedRetentionRate: 0.82 },
};

const fixture = `## TRANSITION STRATEGY
Pair the successor with the current partner for two joint meetings before the handoff.

## RECOMMENDED SUCCESSOR
Jane Roe, who already covers the healthcare docket.

## TIMELINE
A 60 days transition with a mid-point review at day 30.

## KEY RISKS & MITIGATION
- Client loyalty to the departing partner: joint introduction call in week one.
- Legislative session timing: complete the handoff before the session opens.

## ACTION ITEMS
1. Schedule introduction call - Owner: Jane Roe - Due: day 3
2. Transfer matter files - Owner: Paralegal - Due: day 7
3. Joint client meeting - Owner: Both partners - Due: day 14
4. Update the engagement letter - Owner: Jane Roe - Due: day 21
5. Confirm billing contact - Owner: Finance - Due: day 30
6. Mid-point check-in - Owner: Jane Roe - Due: day 30
7. Final handoff review - Owner: Managing partner - Due: day 60

## CLIENT COMMUNICATION TEMPLATE
Dear Acme team,

As discussed, Jane Roe will lead your matters from next month.`;

test('createTransitionPlanPrompt: persona is the system prompt, the task is the user prompt', () => {
  const { system, prompt } = createTransitionPlanPrompt(client, stage1Data);
  assert.equal(system, TRANSITION_PLAN_SYSTEM);
  assert.match(system, /^You are a senior succession planning consultant/);
  assert.doesNotMatch(prompt, /You are a senior/);
  assert.match(prompt, /^Create a detailed transition plan/);
});

test('createTransitionPlanPrompt: reads the fields the frontend sends (averageRevenue, stickinessScore, effort, cadence, handful)', () => {
  const { prompt } = createTransitionPlanPrompt(client, stage1Data);
  assert.match(prompt, /\*\*Name\*\*: Acme Health Alliance/);
  assert.match(prompt, /\*\*Annual Revenue\*\*: \$120,000/);
  assert.match(prompt, /\*\*Practice Areas\*\*: Healthcare, Energy/);
  assert.match(prompt, /\*\*Current Partner\*\*: John Doe/);
  assert.match(prompt, /\*\*Relationship Type\*\*: primary/);
  assert.match(prompt, /\*\*Succession Risk\*\*: 8\/10/);
  assert.match(prompt, /\*\*Transition Complexity\*\*: 6\/10/);
  assert.match(prompt, /\*\*Stickiness\*\*: 7\.5\/10/);
  assert.match(prompt, /\*\*Effort\*\*: 3 /);
  assert.match(prompt, /\*\*Contact Cadence\*\*: Weekly/);
  assert.match(prompt, /\("handful"\)\*\*: Yes/);
  assert.match(prompt, /\*\*Departing\*\*: John Doe, Jane Roe/);
  assert.match(prompt, /\*\*Total Revenue at Risk\*\*: \$250,000/);
  // The retention estimate was built on the retired relationshipStrength; the
  // prompt states none, even when a caller still sends one
  assert.doesNotMatch(prompt, /[Rr]etention/);
  // the retired reads are gone
  assert.doesNotMatch(prompt, /average_revenue|relationshipStrength|Relationship Strength/);
  assert.doesNotMatch(prompt, /undefined|NaN/);
  // the six headings the parser looks for are requested
  for (const heading of ['TRANSITION STRATEGY', 'RECOMMENDED SUCCESSOR', 'TIMELINE', 'KEY RISKS & MITIGATION', 'ACTION ITEMS', 'CLIENT COMMUNICATION TEMPLATE']) {
    assert.ok(prompt.includes(`## ${heading}`), `prompt asks for ${heading}`);
  }
});

test('createTransitionPlanPrompt: a bare client and empty stage data fall back to "Not specified", never undefined', () => {
  const { prompt } = createTransitionPlanPrompt({ id: 'c2', name: 'Beta LLC' }, {});
  assert.match(prompt, /\*\*Annual Revenue\*\*: \$0/);
  assert.match(prompt, /\*\*Stickiness\*\*: Not specified/);
  assert.match(prompt, /\*\*Effort\*\*: Not specified/);
  assert.match(prompt, /\*\*Contact Cadence\*\*: Not specified/);
  assert.match(prompt, /\("handful"\)\*\*: No/);
  assert.match(prompt, /\*\*Current Partner\*\*: Not assigned/);
  assert.match(prompt, /\*\*Departing\*\*: Not specified/);
  assert.doesNotMatch(prompt, /[Rr]etention/, 'no invented default either');
  assert.doesNotMatch(prompt, /undefined|NaN/);
});

test('parseTransitionPlanResponse: extracts all six sections from a full answer', () => {
  const plan = parseTransitionPlanResponse(fixture, client);
  assert.equal(plan.strategy, 'Pair the successor with the current partner for two joint meetings before the handoff.');
  assert.equal(plan.successorPartner, 'Jane Roe, who already covers the healthcare docket.');
  assert.equal(plan.timelineDays, 60);
  assert.match(plan.risks, /^- Client loyalty to the departing partner/);
  assert.equal(plan.tasks.length, 5, 'at most five tasks');
  assert.equal(plan.tasks[0], 'Schedule introduction call - Owner: Jane Roe - Due: day 3');
  assert.equal(plan.tasks[4], 'Confirm billing contact - Owner: Finance - Due: day 30');
  assert.match(plan.communicationTemplate, /^Dear Acme team,/);
  assert.match(plan.communicationTemplate, /Jane Roe will lead your matters from next month\.$/);
  assert.equal(plan.status, 'planned');
  assert.equal(plan.priority, 'critical', 'successionRisk 8 is critical');
  assert.ok(!Number.isNaN(Date.parse(plan.createdAt)));
});

test('parseTransitionPlanResponse: priority follows the client succession risk', () => {
  assert.equal(parseTransitionPlanResponse(fixture, { successionRisk: 6 }).priority, 'high');
  assert.equal(parseTransitionPlanResponse(fixture, { successionRisk: 5 }).priority, 'medium');
  assert.equal(parseTransitionPlanResponse(fixture, { successionRisk: 3 }).priority, 'low');
  assert.equal(parseTransitionPlanResponse(fixture).priority, 'medium');
});

test('parseTransitionPlanResponse: empty text returns the documented defaults', () => {
  const expected = {
    strategy: 'No strategy generated',
    successorPartner: 'To be determined',
    timelineDays: 30,
    risks: 'No specific risks identified',
    tasks: [],
    communicationTemplate: 'No template generated',
    priority: 'medium',
    status: 'planned',
  };
  for (const text of ['', undefined, null]) {
    const { createdAt, ...plan } = parseTransitionPlanResponse(text, client);
    plan.priority = 'medium'; // the client fixture is critical; defaults are about the sections
    assert.deepEqual(plan, expected);
    assert.ok(createdAt);
  }
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
