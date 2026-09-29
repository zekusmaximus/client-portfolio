// Saved Scenarios (docs/plans/tier-2.md, S12, WP8): the server's state checks
// (utils/scenarioState.cjs) and the page's state (src/utils/scenarioState.js):
// what is saved, what is dropped on open, a plan's AI fields and the
// partner's edits kept apart, and the two sides held equal. The routes are in
// tests/routes.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import server from '../utils/scenarioState.cjs';
import validation from '../middleware/validation.cjs';
import * as page from '../src/utils/scenarioState.js';
import { departureModel, withChoice } from '../src/utils/departure.js';
import { pinnedChoice, syncTransitions, approvalBlocker } from '../src/utils/transitionPlans.js';
import { revenueForYear } from '../src/utils/revenue.js';
import { PEOPLE, CLIENTS } from './fixtures/books.mjs';

const { trimStrings } = validation;
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const TODAY = '2026-09-29';
const AT = '2026-09-29T14:00:00.000Z';

// The route's answer for one client (routes/scenarios.cjs), as Stage 2 receives it
const aiResponse = (clientId, overrides = {}) => ({
  success: true,
  answerId: 41,
  saved: true,
  plan: {
    clientId,
    clientName: 'Client name the page must not save',
    strategy: '  Two meetings, then a letter.\n',
    recommendedLead: { person: { id: 2, name: 'Jeff', role: 'partner' }, none: false, text: 'Jeff', problem: null },
    recommendedSecondChair: { person: null, none: true, text: 'None', problem: null },
    timelineDays: 45,
    risks: 'The client may follow Kevin.',
    tasks: ['Call the client', 'Send the letter'],
    communicationTemplate: 'Dear client,',
    priority: 'high',
    status: 'planned',
    createdAt: AT,
    truncated: false,
    refused: false,
    ...overrides,
  },
  timestamp: AT,
});

// The store's scenario pieces, as the page's actions leave them: Kevin
// leaving the fixture book, every decision planned by the AI and approved,
// one plan edited (FIRST, the heaviest client), Stage 3 started (and that
// client's transition moved to at risk, from an earlier date), a task added
// and a communication logged
let FIRST;
function builtStore() {
  const departingIds = [4];
  let choices = {};
  const revenueOf = (c) => revenueForYear(c, 2026);
  let departure = departureModel({ people: PEOPLE, clients: CLIENTS, departingIds, revenueOf, choices });
  let plans = {};
  for (const d of departure.decisions) {
    plans[String(d.client.id)] = page.withAiPlan(plans[String(d.client.id)], aiResponse(d.client.id), AT);
  }
  const first = String(departure.decisions[0].client.id);
  FIRST = first;
  plans[first] = page.withEdits(plans[first], { strategy: 'One meeting, then a letter.', timelineDays: 30 }, AT);
  for (const d of departure.decisions) {
    if (approvalBlocker(d)) continue;
    choices = withChoice(choices, d.client.id, pinnedChoice(d));
    plans[String(d.client.id)] = { ...plans[String(d.client.id)], status: 'approved', updatedAt: AT };
  }
  departure = departureModel({ people: PEOPLE, clients: CLIENTS, departingIds, revenueOf, choices });
  const started = syncTransitions({ decisions: departure.decisions, plans: page.planViews(plans), transitions: [], tasks: [], today: TODAY });
  const moved = started.transitions.map((t) => (t.clientId === first ? { ...t, status: 'at-risk', startDate: '2026-09-01' } : t));
  const { transitions } = syncTransitions({ decisions: departure.decisions, plans: page.planViews(plans), transitions: moved, tasks: [], today: TODAY });
  const { tasks } = started;
  return {
    successionWorkflow: { currentStage: 'implementation', departingIds, choices },
    transitionPlans: plans,
    activeTransitions: transitions,
    heldTransitions: [],
    transitionTasks: [...tasks, { id: 'task-1', title: 'Brief the new lead ', description: '', assignee: 'Jeff', dueDate: '2026-10-15', priority: 'medium', clientId: first, status: 'pending', createdAt: AT }],
    communicationLog: [{ id: 'comm-1', type: 'call', subject: 'First call', content: 'They took it well.\n', date: TODAY, outcome: 'positive', clientId: first, timestamp: AT }],
  };
}

const openOn = (state, { people = PEOPLE, clients = CLIENTS } = {}) =>
  page.openState(state, { people, clients, reportingYear: 2026, today: TODAY });

test('the page\'s vocabularies, keys and bounds are the server\'s', () => {
  for (const key of [
    'KINDS', 'STAGES', 'PLAN_STATUSES', 'TRANSITION_STATUSES', 'PRIORITIES', 'STATE_KEYS', 'CHOICE_KEYS', 'PLAN_KEYS',
    'AI_FIELDS', 'EDIT_FIELDS', 'RECOMMENDATION_KEYS', 'PERSON_KEYS', 'EXECUTION_KEYS', 'TASK_KEYS', 'COMMUNICATION_KEYS', 'LIMITS',
  ]) {
    assert.deepEqual(page[key], server[key], key);
  }
  assert.deepEqual(Object.keys(page.emptyState()), server.STATE_KEYS);
  assert.deepEqual(Object.keys(page.emptyPlan()), server.PLAN_KEYS);
});

test('the statuses and stages the checks allow are the ones the page uses', () => {
  const keysOf = (file, name) => {
    const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(source(file))[1];
    return [...block.matchAll(/^\s+'?([\w-]+)'?:/gm)].map((m) => m[1]);
  };
  assert.deepEqual(keysOf('src/components/succession/ClientReviewInterface.jsx', 'TRANSITION_STATUS'), server.PLAN_STATUSES);
  assert.deepEqual(keysOf('src/components/succession/ClientReviewInterface.jsx', 'PRIORITY_LEVELS'), server.PRIORITIES);
  assert.deepEqual(keysOf('src/components/succession/TransitionPlanManager.jsx', 'TRANSITION_STATUS'), server.TRANSITION_STATUSES);
  assert.match(source('src/components/succession/SuccessionScenario.tsx'), new RegExp(`type Stage = ${server.STAGES.map((s) => `'${s}'`).join(' \\| ')};`));
  // The AI fields are the transition-plan parser's (utils/transitionPlan.cjs), less its status, date and the client's facts
  const parsed = source('utils/transitionPlan.cjs');
  for (const field of server.AI_FIELDS.filter((f) => !['truncated', 'refused'].includes(f))) assert.match(parsed, new RegExp(`\\b${field}[,:]`), field);
  assert.match(source('routes/scenarios.cjs'), /truncated: result\.truncated,\n\s+refused: result\.refused/);
});

test('checkState accepts a new scenario and a full one; checkScenario names the name, the version and the state\'s problems', () => {
  assert.deepEqual(server.checkState(page.emptyState()), []);
  const state = page.stateFromStore(builtStore());
  assert.deepEqual(server.checkState(state), []);
  assert.deepEqual(server.checkScenario({ name: 'Kevin retires', state }), []);
  assert.deepEqual(server.checkScenario({ name: 'Kevin retires', state, version: 3 }, { update: true }), []);
  assert.deepEqual(server.checkScenario({ name: '', state: [], version: '3' }, { update: true }), [
    { field: 'name', message: 'The scenario needs a name.' },
    { field: 'version', message: 'version must be the whole number the scenario was opened at.' },
    { field: 'state', message: 'The scenario\'s state must be a JSON object.' },
  ]);
  // A name is counted in characters, as VARCHAR(120) counts them
  assert.deepEqual(server.checkScenario({ name: '😀'.repeat(120), state }), []);
  assert.equal(server.checkScenario({ name: '😀'.repeat(121), state })[0].field, 'name');
  // However many problems, at most MAX_DETAILS are listed
  const bad = { ...state, departingIds: Array.from({ length: 40 }, () => 'x') };
  assert.equal(server.checkState(bad).length, server.MAX_DETAILS);
  // readScenarioId: positive integers in PostgreSQL's integer range only
  assert.deepEqual(['1', '2147483647', '2147483648', '0', '01', '-1', '1.0', 'abc', '', undefined].map(server.readScenarioId),
    [1, 2147483647, null, null, null, null, null, null, null, null]);
});

test('never what the engine derives: a load, a candidate or a client\'s facts in the state is refused by the server and dropped by the page', () => {
  const state = page.stateFromStore(builtStore());
  const id = FIRST;
  const derived = [
    { ...state, decisions: [] },
    { ...state, before: { rows: [] } },
    { ...state, plans: { ...state.plans, [id]: { ...state.plans[id], clientName: 'Acme' } } },
    { ...state, plans: { ...state.plans, [id]: { ...state.plans[id], ai: { ...state.plans[id].ai, successionRisk: 7 } } } },
    { ...state, choices: { [id]: { leadId: '2', candidates: [] } } },
    { ...state, execution: { [id]: { startDate: TODAY, status: 'in-progress', lead: 'Jeff' } } },
    { ...state, tasks: [{ id: 't', title: 'x', revenue: 5 }] },
  ];
  for (const bad of derived) {
    assert.notDeepEqual(server.checkState(bad), [], JSON.stringify(bad).slice(0, 80));
    assert.deepEqual(server.checkState(page.canonicalState(bad)), []);
  }
  // Built from a real store, the state holds ids and what partners entered, nothing else
  const text = JSON.stringify(state);
  // (the AI's own text may name people: it is what the AI answered)
  for (const fact of ['Client ', 'revenue', 'effort', 'candidates', 'successionRisk', 'clientName', '"lead":', '"secondChair":', '"clientName"']) {
    assert.ok(!text.includes(fact), fact);
  }
  assert.ok(Object.keys(state.plans).every((key) => /^\d+$/.test(key)));
});

test('the state the page builds: every id as text, every string trimmed, as trimRequestBody leaves it, and the checks pass', () => {
  const state = page.stateFromStore(builtStore());
  assert.deepEqual(trimStrings(state), state, 'the server stores what the page compares');
  assert.deepEqual(state.departingIds, ['4']);
  for (const choice of Object.values(state.choices)) {
    for (const value of Object.values(choice)) assert.ok(value === null || typeof value === 'string');
  }
  const first = FIRST;
  assert.equal(state.plans[first].ai.strategy, 'Two meetings, then a letter.');
  assert.deepEqual(state.plans[first].edits, { strategy: 'One meeting, then a letter.', timelineDays: 30 });
  assert.equal(state.plans[first].answerId, 41);
  assert.ok(!('clientName' in state.plans[first].ai) && !('createdAt' in state.plans[first].ai) && !('status' in state.plans[first].ai));
  assert.equal(state.tasks.at(-1).title, 'Brief the new lead');
  assert.equal(state.communications[0].content, 'They took it well.');
  assert.deepEqual(state.execution[first], { startDate: '2026-09-01', status: 'at-risk' });
  assert.deepEqual(page.canonicalState(state), state, 'canonical twice is canonical once');
});

test('a state as text: equal whatever order its keys arrived in (JSONB keeps its own), different when anything partners entered differs', () => {
  const state = page.stateFromStore(builtStore());
  const shuffled = JSON.parse(JSON.stringify(state, (key, value) => (
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value)));
  assert.equal(page.stateJson(shuffled), page.stateJson(state));
  const id = Object.keys(state.plans)[0];
  const edited = { ...state, plans: { ...state.plans, [id]: { ...state.plans[id], edits: { strategy: 'Another' } } } };
  assert.notEqual(page.stateJson(edited), page.stateJson(state));
  assert.notEqual(page.stateJson({ ...state, currentStage: 'impact' }), page.stateJson(state));
});

test('saved, then opened on the same book: the store holds the same scenario, nothing is dropped, no notice, and Stage 3 is rebuilt with its saved dates and statuses', () => {
  const store = builtStore();
  const state = page.stateFromStore(store);
  const opened = openOn(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(opened.notices, []);
  assert.equal(page.stateJson(page.stateFromStore(opened)), page.stateJson(state));
  assert.deepEqual(opened.heldTransitions, []);
  assert.deepEqual(opened.activeTransitions, store.activeTransitions, 'the transitions Stage 3 showed before the save');
  assert.deepEqual(opened.transitionTasks, trimStrings(store.transitionTasks));
  // Unsaved changes: none on open, and one edit makes one
  const after = { ...opened, savedStateJson: page.stateJson(state) };
  assert.equal(page.scenarioDirty(after), false);
  const id = Object.keys(opened.transitionPlans)[1];
  const changed = { ...after, transitionPlans: { ...opened.transitionPlans, [id]: page.withEdits(opened.transitionPlans[id], { risks: 'None' }, AT) } };
  assert.equal(page.scenarioDirty(changed), true);
});

test('opened on a changed book: a client deleted since the save loses its pick, plan, Stage 3 record and tasks, with a notice; the communication log is kept', () => {
  const store = builtStore();
  const state = page.stateFromStore(store);
  const first = FIRST;
  const clients = CLIENTS.filter((c) => String(c.id) !== first);
  const opened = openOn(state, { clients });
  assert.ok(!(first in opened.successionWorkflow.choices));
  assert.ok(!(first in opened.transitionPlans));
  assert.ok(opened.activeTransitions.every((t) => t.clientId !== first));
  assert.ok(opened.transitionTasks.every((t) => t.clientId !== first));
  assert.deepEqual(opened.communicationLog, state.communications);
  assert.deepEqual(opened.notices, [
    '1 client in this scenario is no longer in the book: its picks, plans, Stage 3 records and tasks were dropped; the communication log is kept as it was. Saving the scenario removes them.',
  ]);
  // Everything else as saved; so the opened scenario differs from the saved one ("Unsaved changes")
  const rest = Object.keys(state.plans).filter((id) => id !== first);
  for (const id of rest) assert.deepEqual(opened.transitionPlans[id], state.plans[id]);
  assert.notEqual(page.stateJson(page.stateFromStore(opened)), page.stateJson(state));
  assert.deepEqual(server.checkState(page.stateFromStore(opened)), []);
});

test('opened on a changed book: someone no longer on the People list is taken off the people leaving with a notice; someone leaving who is now inactive is kept and named', () => {
  const state = { ...page.emptyState(), departingIds: ['4', '99'] };
  const opened = openOn(state);
  assert.deepEqual(opened.successionWorkflow.departingIds, ['4']);
  assert.deepEqual(opened.notices, ['1 person marked as leaving is no longer on the People list and was taken off the people leaving.']);
  const inactive = openOn({ ...page.emptyState(), departingIds: ['10'] });
  assert.deepEqual(inactive.successionWorkflow.departingIds, ['10']);
  assert.deepEqual(inactive.notices, ['Marked as leaving and now inactive on the People list: Steve.']);
});

test('opened on a changed book: a pick the engine now refuses stays, and Stage 2 shows the engine\'s reason; a notice counts them', () => {
  const state = page.stateFromStore(builtStore());
  const first = FIRST;
  const lead = state.choices[first].leadId;
  assert.ok(lead, 'the approved client has a pinned lead');
  const people = PEOPLE.map((p) => (String(p.id) === lead ? { ...p, active: false } : p));
  const opened = openOn(state, { people });
  assert.deepEqual(opened.successionWorkflow.choices[first], state.choices[first], 'the pick is kept');
  const departure = departureModel({ people, clients: CLIENTS, departingIds: opened.successionWorkflow.departingIds, revenueOf: (c) => revenueForYear(c, 2026), choices: opened.successionWorkflow.choices });
  const decision = departure.decisions.find((d) => String(d.client.id) === first);
  const name = PEOPLE.find((p) => String(p.id) === lead).name;
  assert.equal(decision.lead.problem, `${name} is inactive.`);
  assert.ok(opened.notices.some((n) => /^\d+ picks? no longer holds? on the current book; Stage 2 shows why/.test(n)), opened.notices.join('\n'));
  // Its approved seats no longer apply, so its Stage 3 record is kept but not shown
  assert.ok(opened.heldTransitions.some((t) => t.clientId === first));
  assert.ok(opened.activeTransitions.every((t) => t.clientId !== first));
  assert.equal(page.stateJson(page.stateFromStore(opened)), page.stateJson(state), 'nothing entered was lost');
});

test('a scenario whose transition sheet has been imported: nobody leaving holds a seat, so nothing is shown in Stages 2 and 3, and every record is kept', () => {
  const state = page.stateFromStore(builtStore());
  const applied = CLIENTS.map((c) => (c.lead?.id === 4 ? { ...c, lead: PEOPLE[1] } : c.secondChair?.id === 4 ? { ...c, secondChair: null } : c));
  const opened = openOn(state, { clients: applied });
  assert.deepEqual(opened.activeTransitions, []);
  assert.equal(opened.heldTransitions.length, Object.keys(state.execution).length);
  assert.equal(page.stateJson(page.stateFromStore(opened)), page.stateJson(state));
  assert.match(opened.notices.at(-1), /^Stage 3's records for \d+ clients are kept but not shown/);
});

test('a plan keeps the AI\'s fields and the partner\'s edits apart: regenerating never loses an edit, an edit never loses the AI\'s text', () => {
  let plan = page.withAiPlan(undefined, aiResponse(1), AT);
  assert.deepEqual(plan.edits, {});
  assert.equal(plan.answerId, 41);
  assert.equal(plan.status, 'planned');
  plan = page.withEdits(plan, { strategy: 'Ours', risks: 'The client may follow Kevin.', timelineDays: 45 }, AT);
  assert.deepEqual(plan.edits, { strategy: 'Ours' }, 'an edit equal to the AI\'s value is no edit');
  assert.equal(plan.ai.strategy, 'Two meetings, then a letter.');
  assert.equal(page.planView(plan, 1).strategy, 'Ours');
  assert.deepEqual(page.planView(plan, 1).edited, ['strategy']);

  plan = { ...plan, status: 'approved' };
  plan = page.withAiPlan(plan, aiResponse(1, { strategy: 'A new plan.', timelineDays: 60 }), AT);
  assert.deepEqual(plan.edits, { strategy: 'Ours' }, 'regenerating kept the edit');
  assert.equal(plan.ai.strategy, 'A new plan.');
  assert.equal(plan.status, 'approved', 'an approved plan stays approved');
  assert.deepEqual([page.planView(plan, 1).strategy, page.planView(plan, 1).timelineDays], ['Ours', 60]);

  plan = page.withEdits(plan, { timelineDays: null }, AT);
  assert.equal(page.planView(plan, 1).timelineDays, null, 'a cleared timeline is an edit too');
  plan = page.withoutEdit(page.withoutEdit(plan, 'strategy', AT), 'timelineDays', AT);
  assert.deepEqual([page.planView(plan, 1).strategy, page.planView(plan, 1).timelineDays], ['A new plan.', 60]);

  // No AI plan yet: the partner's own text is the plan
  const own = page.withEdits(undefined, { strategy: 'Hand over at lunch.' }, AT);
  assert.deepEqual([own.ai, own.edits, page.planView(own, 2).strategy, own.status], [null, { strategy: 'Hand over at lunch.' }, 'Hand over at lunch.', 'pending']);
  // An API older than WP4 answers without answerId, and a failed save with null
  assert.equal(page.withAiPlan(undefined, { plan: aiResponse(1).plan }, AT).answerId, null);
  assert.equal(page.withAiPlan(undefined, { ...aiResponse(1), answerId: null, saved: false }, AT).answerId, null);
});

test('Stage 3 and the sheet read the plan with its edits: an edited timeline sets the end date; the tasks are the AI\'s', () => {
  const store = builtStore();
  const first = FIRST;
  const transition = store.activeTransitions.find((t) => t.clientId === first);
  assert.equal(transition.timelineDays, 30, 'the edited 30, not the AI\'s 45');
  assert.equal(store.transitionTasks.filter((t) => t.clientId === first && t.category === 'transition').length, 2);
});

// Seeded random stores on seeded random books: the state the page builds
// always passes the server's checks and survives a save and an open
test('on 300 seeded random books and scenarios: the page\'s state passes the server\'s checks, survives JSON and an open on the same book, and trims as the server does', () => {
  let seed = 20260929;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const pad = (text) => `${random() > 0.7 ? ' ' : ''}${text}${random() > 0.7 ? '\n' : ''}`;
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(random() * 16).toString(16));
  for (let run = 0; run < 300; run += 1) {
    const integerIds = random() > 0.5;
    const people = PEOPLE.map((p) => ({ ...p, active: p.name === 'Steve' ? false : random() > 0.05 }));
    const partners = people.filter((p) => p.role === 'partner');
    const clients = Array.from({ length: 3 + Math.floor(random() * 12) }, (_, n) => ({
      id: integerIds ? n + 1 : uuid(),
      name: `Client ${n}`,
      lead: random() > 0.1 ? pick(partners) : null,
      secondChair: random() > 0.4 ? pick(people) : null,
      effort: 1 + Math.floor(random() * 5),
      revenues: [{ year: 2026, revenue_amount: String(Math.round(random() * 100000)) }],
    })).map((c) => (c.secondChair && c.lead && c.secondChair.id === c.lead.id ? { ...c, secondChair: null } : c));
    const departingIds = people.filter(() => random() > 0.8).map((p) => (random() > 0.5 ? p.id : String(p.id)));
    let choices = {};
    for (const c of clients) {
      if (random() > 0.7) choices = withChoice(choices, c.id, { leadId: String(pick(people).id), ...(random() > 0.5 ? { secondChairId: random() > 0.5 ? pick(people).id : null } : {}) });
    }
    const departure = departureModel({ people, clients, departingIds, revenueOf: (c) => revenueForYear(c, 2026), choices });
    let plans = {};
    for (const d of departure.decisions) {
      const id = String(d.client.id);
      if (random() > 0.3) plans[id] = page.withAiPlan(plans[id], aiResponse(d.client.id, { strategy: pad('A plan'), timelineDays: random() > 0.9 ? 99999 : 30 }), AT);
      if (random() > 0.6) plans[id] = page.withEdits(plans[id], { strategy: pad('Ours'), timelineDays: Math.floor(random() * 90) }, AT);
      if (random() > 0.5) {
        plans[id] = { ...(plans[id] || page.emptyPlan()), status: 'approved', updatedAt: AT };
        choices = withChoice(choices, d.client.id, pinnedChoice(d));
      }
    }
    const after = departureModel({ people, clients, departingIds, revenueOf: (c) => revenueForYear(c, 2026), choices });
    const { transitions, tasks } = syncTransitions({ decisions: after.decisions, plans: page.planViews(plans), transitions: [], tasks: [], today: TODAY });
    const store = {
      successionWorkflow: { currentStage: pick(page.STAGES), departingIds, choices },
      transitionPlans: plans,
      activeTransitions: transitions.map((t) => ({ ...t, status: pick(page.TRANSITION_STATUSES) })),
      heldTransitions: [],
      transitionTasks: [...tasks, ...(random() > 0.5 ? [{ id: `task-${run}`, title: pad('Task'), description: pad(''), assignee: '', dueDate: '', priority: 'medium', clientId: '', status: 'pending', createdAt: AT }] : [])],
      communicationLog: random() > 0.5 ? [{ id: `comm-${run}`, type: 'email', subject: pad('Hi'), content: pad('Notes'), date: TODAY, outcome: 'neutral', clientId: String(pick(clients).id), timestamp: AT }] : [],
    };
    const state = page.stateFromStore(store);
    assert.deepEqual(server.checkState(state), [], `run ${run}`);
    assert.deepEqual(trimStrings(state), state, `run ${run}`);
    const stored = JSON.parse(JSON.stringify(state));
    const opened = page.openState(stored, { people, clients, reportingYear: 2026, today: TODAY });
    assert.equal(page.stateJson(page.stateFromStore(opened)), page.stateJson(state), `run ${run}: opened as saved`);
    assert.deepEqual(opened.notices.filter((n) => /no longer (in the book|on the People list)/.test(n)), [], `run ${run}`);
  }
});
