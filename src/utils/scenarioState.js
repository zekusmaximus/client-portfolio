// Saved Scenarios (docs/plans/tier-2.md, S12, WP8), the page's side: the
// state a saved scenario holds, built from the store; the scenario opened on
// the current book; and a Stage 2 plan kept as the AI's fields and the
// partner's edits, apart. Pure.
//
// The state is what partners entered, never what the departure engine
// derives from the book (./departure.js recomputes that at every render, so
// a scenario stays valid as the book changes):
//
//   { kind: 'departure', currentStage, departingIds: [personId],
//     choices: { [clientId]: { leadId?, secondChairId? } },
//     plans: { [clientId]: { answerId, ai, edits, status, updatedAt } },
//     execution: { [clientId]: { startDate, status } },
//     tasks: [...], communications: [...] }
//
// Every id is text. Every string is trimmed, as trimRequestBody trims the
// body on /api/scenarios, so the state the page compares ("Unsaved
// changes") is the state the server stores. The server's copy of the shape
// and its checks is utils/scenarioState.cjs; tests/scenario-state.test.mjs
// holds the two equal and checks that every state built here passes the
// server's checks.
//
// A hire scenario (docs/plans/tier-2.md, section 14, WP9) holds its own keys:
//
//   { kind: 'hire',
//     associates: [{ id: 'h1', label, focus: [practiceArea], target, personId }],
//     picks: { [clientId]: { associateId, seenSecondChairId } },
//     relief: false }
//
// (utils/scenarioState.cjs has the shape in full). The store keeps it apart
// from the departure's state (hireScenario, with scenarioKind naming which is
// open), and ./hireScenario.js derives the proposals and every load from it.

import { departureModel } from './departure.js';
import { hireScenarioModel } from './hireScenario.js';
import { revenueForYear } from './revenue.js';
import { syncTransitions } from './transitionPlans.js';
import { PRACTICE_AREAS } from './validation.js';

export const KINDS = ['departure', 'hire'];
export const STAGES = ['impact', 'mitigation', 'implementation'];
export const PLAN_STATUSES = ['pending', 'planned', 'approved', 'rejected'];
export const TRANSITION_STATUSES = ['in-progress', 'at-risk', 'delayed', 'completed'];
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const STATE_KEYS = ['kind', 'currentStage', 'departingIds', 'choices', 'plans', 'execution', 'tasks', 'communications'];
export const CHOICE_KEYS = ['leadId', 'secondChairId'];
export const PLAN_KEYS = ['answerId', 'ai', 'edits', 'status', 'updatedAt'];
export const AI_FIELDS = [
  'strategy', 'recommendedLead', 'recommendedSecondChair', 'timelineDays', 'risks', 'tasks',
  'communicationTemplate', 'priority', 'truncated', 'refused',
];
export const EDIT_FIELDS = ['strategy', 'risks', 'timelineDays'];
export const RECOMMENDATION_KEYS = ['person', 'none', 'text', 'problem'];
export const PERSON_KEYS = ['id', 'name', 'role'];
export const EXECUTION_KEYS = ['startDate', 'status'];
export const TASK_KEYS = ['id', 'title', 'description', 'assignee', 'dueDate', 'priority', 'status', 'clientId', 'category', 'createdAt'];
export const COMMUNICATION_KEYS = ['id', 'type', 'subject', 'content', 'date', 'outcome', 'clientId', 'timestamp'];
export const HIRE_STATE_KEYS = ['kind', 'associates', 'picks', 'relief'];
export const ASSOCIATE_KEYS = ['id', 'label', 'focus', 'target', 'personId'];
export const TARGET_KINDS = ['count', 'average'];
export const PICK_KEYS = ['associateId', 'seenSecondChairId'];
export const HYPOTHETICAL_ID = /^h[1-9]\d{0,3}$/;
// The 21 practice areas a hire scenario's focus may name (utils/clientRules.cjs
// on the server): the focus is not client data, so a retired name is neither
// offered nor accepted, and openState drops one with a notice
// (docs/plans/tier-3.md, U43 (b))
export { PRACTICE_AREAS };
export const LIMITS = {
  name: 120,
  stateBytes: 1000000,
  departing: 50,
  clients: 500,
  tasks: 2000,
  communications: 2000,
  aiTasks: 100,
  text: 64000,
  short: 500,
  timelineDays: 36500,
  associates: 20,
  label: 120,
};

const PERSON_ID = /^[1-9]\d{0,9}$/;
const CLIENT_ID = /^(?:[1-9]\d{0,9}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INT_MAX = 2147483647;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const idText = (value) => (value === null || value === undefined ? '' : String(value).trim());
const personId = (value) => {
  const text = idText(value);
  return PERSON_ID.test(text) && Number(text) <= INT_MAX ? text : null;
};
const clientId = (value) => {
  const text = idText(value);
  return CLIENT_ID.test(text) && (!/^\d+$/.test(text) || Number(text) <= INT_MAX) ? text : null;
};
const isDate = (value) => typeof value === 'string' && DATE.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const text = (value) => (typeof value === 'string' ? value.trim() : null);
const days = (value) => (Number.isInteger(value) && value >= 1 && value <= LIMITS.timelineDays ? value : null);
const boolean = (value) => value === true;

/** A new scenario: nobody leaving, no picks, no plans, nothing in Stage 3. */
export const emptyState = () => ({
  kind: 'departure',
  currentStage: 'impact',
  departingIds: [],
  choices: {},
  plans: {},
  execution: {},
  tasks: [],
  communications: [],
});

/** A new hire scenario: no associates, no picks, the toggle off. */
export const emptyHireState = () => ({ kind: 'hire', associates: [], picks: {}, relief: false });

/** A new scenario of either kind. */
export const emptyStateOf = (kind) => (kind === 'hire' ? emptyHireState() : emptyState());

/* --------------------------------- plans --------------------------------- */

/** A client's plan before anyone has asked the AI or edited it. */
export const emptyPlan = () => ({ answerId: null, ai: null, edits: {}, status: 'pending', updatedAt: null });

const recommendation = (value) => {
  if (!isPlainObject(value)) return null;
  const out = {};
  if (value.person !== undefined) {
    out.person = isPlainObject(value.person)
      ? {
        id: Number.isInteger(value.person.id) ? value.person.id : idText(value.person.id),
        name: text(value.person.name) ?? '',
        role: text(value.person.role) ?? '',
      }
      : null;
  }
  if (value.none !== undefined) out.none = boolean(value.none);
  if (value.text !== undefined) out.text = text(value.text) ?? '';
  if (value.problem !== undefined) out.problem = text(value.problem);
  return out;
};

/** The AI's fields a plan keeps, from the transition-plan route's `plan` (or a saved `ai`). */
export function aiFields(plan) {
  if (!isPlainObject(plan)) return null;
  const ai = {};
  for (const key of ['strategy', 'risks', 'communicationTemplate']) {
    if (plan[key] !== undefined) ai[key] = text(plan[key]);
  }
  for (const key of ['recommendedLead', 'recommendedSecondChair']) {
    if (plan[key] !== undefined) ai[key] = recommendation(plan[key]);
  }
  if (plan.timelineDays !== undefined) ai.timelineDays = days(plan.timelineDays);
  if (plan.tasks !== undefined) {
    ai.tasks = (Array.isArray(plan.tasks) ? plan.tasks : []).filter((t) => typeof t === 'string').map((t) => t.trim()).slice(0, LIMITS.aiTasks);
  }
  if (plan.priority !== undefined) ai.priority = PRIORITIES.includes(plan.priority) ? plan.priority : null;
  for (const key of ['truncated', 'refused']) {
    if (plan[key] !== undefined) ai[key] = boolean(plan[key]);
  }
  return ai;
}

const editFields = (edits) => {
  const out = {};
  if (!isPlainObject(edits)) return out;
  for (const key of ['strategy', 'risks']) {
    if (typeof edits[key] === 'string') out[key] = edits[key].trim();
  }
  if (edits.timelineDays !== undefined) out.timelineDays = days(edits.timelineDays);
  return out;
};

const now = () => new Date().toISOString();

/**
 * The plan with the AI's answer in it: the route's `plan` as its AI fields,
 * its saved answer's id (`answerId`; null from an API that saves none, or
 * when the save failed), and the status planned unless already approved. The
 * partner's edits stay as they are: regenerating a plan never loses one.
 */
export function withAiPlan(plan, response, at = now()) {
  const current = plan || emptyPlan();
  return {
    ...emptyPlan(),
    ...current,
    answerId: Number.isInteger(response?.answerId) && response.answerId > 0 ? response.answerId : null,
    ai: aiFields(response?.plan),
    edits: { ...(current.edits || {}) },
    status: current.status === 'approved' ? 'approved' : 'planned',
    updatedAt: at,
  };
}

const sameValue = (a, b) => (a ?? null) === (b ?? null);

/**
 * The plan with the partner's edits: `changes` holds any of strategy, risks
 * and timelineDays (null for none). An edit equal to the AI's own value is
 * no edit, so the AI's next answer shows through; the AI's text is never
 * changed.
 */
export function withEdits(plan, changes, at = now()) {
  const current = plan || emptyPlan();
  const edits = { ...(current.edits || {}) };
  for (const key of EDIT_FIELDS) {
    if (changes?.[key] === undefined) continue;
    const value = key === 'timelineDays' ? days(changes[key]) : String(changes[key] ?? '').trim();
    if (sameValue(value, current.ai?.[key] ?? (key === 'timelineDays' ? null : ''))) delete edits[key];
    else edits[key] = value;
  }
  return { ...emptyPlan(), ...current, edits, updatedAt: at };
}

/** The plan without the partner's edit of `field`: the AI's text shows again. */
export function withoutEdit(plan, field, at = now()) {
  const current = plan || emptyPlan();
  const edits = { ...(current.edits || {}) };
  delete edits[field];
  return { ...emptyPlan(), ...current, edits, updatedAt: at };
}

/**
 * What Stage 2 and Stage 3 read for a plan: the AI's fields with the
 * partner's edits over them, plus the plan's own keys and `edited`, the
 * fields the partner changed.
 */
export function planView(plan, id) {
  const current = plan || emptyPlan();
  const edits = current.edits || {};
  return {
    ...(current.ai || {}),
    ...edits,
    clientId: id === undefined ? current.clientId : String(id),
    answerId: current.answerId ?? null,
    status: current.status || 'pending',
    updatedAt: current.updatedAt ?? null,
    ai: current.ai ?? null,
    edits,
    edited: EDIT_FIELDS.filter((key) => edits[key] !== undefined),
  };
}

/**
 * Whether the AI has written a strategy for this plan (a stored plan or its
 * planView): its own field, not the partner's text planView lays over it.
 * Stage 2's "AI Plans" count and its "No AI plan" filter read it; until Tier 3
 * WP4 (candidate (n)) they read the view's strategy, so a plan holding only a
 * partner's text counted as an AI plan.
 */
export const hasAiPlan = (plan) => Boolean(plan?.ai?.strategy);

/** planView for every plan in the store's transitionPlans. */
export function planViews(plans = {}) {
  return Object.fromEntries(Object.entries(plans || {}).map(([id, plan]) => [id, planView(plan, id)]));
}

/* ------------------------------ saved state ------------------------------ */

const record = (value, keys) => {
  const out = {};
  for (const key of keys) {
    if (key === 'clientId') {
      if (value.clientId !== undefined && value.clientId !== null) out.clientId = clientId(value.clientId) ?? '';
    } else if (typeof value[key] === 'string') {
      out[key] = value[key].trim();
    }
  }
  return out;
};

/**
 * A state in the shape the server stores: the known keys only, every id as
 * text, every string trimmed, anything malformed dropped (a plan's
 * out-of-range timeline as none). Used on what the page builds and on what it
 * opens, so both compare alike.
 */
export function canonicalState(state) {
  const input = isPlainObject(state) ? state : {};
  if (input.kind === 'hire') return canonicalHire(input);
  const out = emptyState();
  out.currentStage = STAGES.includes(input.currentStage) ? input.currentStage : 'impact';

  const seen = new Set();
  for (const id of Array.isArray(input.departingIds) ? input.departingIds : []) {
    const person = personId(id);
    if (person && !seen.has(person)) {
      seen.add(person);
      out.departingIds.push(person);
    }
  }

  for (const [key, choice] of Object.entries(isPlainObject(input.choices) ? input.choices : {})) {
    const id = clientId(key);
    if (!id || !isPlainObject(choice)) continue;
    const next = {};
    for (const seat of CHOICE_KEYS) {
      if (choice[seat] === undefined) continue;
      if (choice[seat] === null || choice[seat] === '') next[seat] = null;
      else if (personId(choice[seat])) next[seat] = personId(choice[seat]);
    }
    out.choices[id] = next;
  }

  for (const [key, plan] of Object.entries(isPlainObject(input.plans) ? input.plans : {})) {
    const id = clientId(key);
    if (!id || !isPlainObject(plan)) continue;
    out.plans[id] = {
      answerId: Number.isInteger(plan.answerId) && plan.answerId > 0 && plan.answerId <= INT_MAX ? plan.answerId : null,
      ai: aiFields(plan.ai),
      edits: editFields(plan.edits),
      status: PLAN_STATUSES.includes(plan.status) ? plan.status : 'pending',
      updatedAt: text(plan.updatedAt),
    };
  }

  for (const [key, entry] of Object.entries(isPlainObject(input.execution) ? input.execution : {})) {
    const id = clientId(key);
    if (!id || !isPlainObject(entry) || !isDate(entry.startDate) || !TRANSITION_STATUSES.includes(entry.status)) continue;
    out.execution[id] = { startDate: entry.startDate, status: entry.status };
  }

  out.tasks = (Array.isArray(input.tasks) ? input.tasks : [])
    .filter(isPlainObject)
    .map((task) => record(task, TASK_KEYS))
    .filter((task) => task.id);
  out.communications = (Array.isArray(input.communications) ? input.communications : [])
    .filter(isPlainObject)
    .map((entry) => record(entry, COMMUNICATION_KEYS))
    .filter((entry) => entry.id);
  return out;
}

// The label a hypothetical associate is saved with when a partner cleared it
const DEFAULT_LABEL = 'New associate';

// canonicalState for a hire scenario: associates with scenario-local ids
// (each once, at most LIMITS.associates), a label (the default when blank),
// the focus in the vocabulary's order, a target, a person linked once at
// most; picks naming one of them, or null; the toggle as a boolean
function canonicalHire(input) {
  const out = emptyHireState();
  const ids = new Set();
  const linked = new Set();
  for (const associate of Array.isArray(input.associates) ? input.associates : []) {
    if (out.associates.length >= LIMITS.associates) break;
    if (!isPlainObject(associate)) continue;
    const id = idText(associate.id);
    if (!HYPOTHETICAL_ID.test(id) || ids.has(id)) continue;
    ids.add(id);
    const label = (text(associate.label) || DEFAULT_LABEL).slice(0, LIMITS.label).trim() || DEFAULT_LABEL;
    const focus = Array.isArray(associate.focus) ? associate.focus.map(text) : [];
    const target = isPlainObject(associate.target) && associate.target.kind === 'average'
      ? { kind: 'average' }
      : { kind: 'count', count: Math.max(0, Math.min(LIMITS.clients, Math.round(Number(associate.target?.count)) || 0)) };
    let person = personId(associate.personId);
    if (person && linked.has(person)) person = null;
    if (person) linked.add(person);
    out.associates.push({ id, label, focus: PRACTICE_AREAS.filter((area) => focus.includes(area)), target, personId: person });
  }
  for (const [key, pick] of Object.entries(isPlainObject(input.picks) ? input.picks : {})) {
    const id = clientId(key);
    if (!id || !isPlainObject(pick)) continue;
    const associate = pick.associateId === null || pick.associateId === '' || pick.associateId === undefined ? null : idText(pick.associateId);
    if (associate !== null && !ids.has(associate)) continue;
    out.picks[id] = { associateId: associate, seenSecondChairId: personId(pick.seenSecondChairId) };
  }
  out.relief = boolean(input.relief);
  return out;
}

/**
 * The open scenario's state from the store: the workflow, Stage 2's plans,
 * and Stage 3's records (the transitions shown, and those kept but not shown
 * since the scenario was opened: `heldTransitions`), tasks and communications.
 */
export function stateFromStore(store = {}) {
  if (store.scenarioKind === 'hire') return canonicalState({ kind: 'hire', ...(store.hireScenario || {}) });
  const workflow = store.successionWorkflow || {};
  const execution = {};
  for (const t of [...(store.heldTransitions || []), ...(store.activeTransitions || [])]) {
    if (t && t.clientId !== undefined) execution[String(t.clientId)] = { startDate: t.startDate, status: t.status };
  }
  return canonicalState({
    kind: 'departure',
    currentStage: workflow.currentStage,
    departingIds: workflow.departingIds,
    choices: workflow.choices,
    plans: store.transitionPlans,
    execution,
    tasks: store.transitionTasks,
    communications: store.communicationLog,
  });
}

// JSON with every object's keys sorted, so two states compare as text
// whatever order their keys arrived in (JSONB stores its own order)
const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
};

/** A state as text, for "Unsaved changes": equal states give equal text. */
export const stateJson = (state) => JSON.stringify(sorted(canonicalState(state)));

/** Whether the store's scenario differs from what was last opened or saved. */
export const scenarioDirty = (store) => stateJson(stateFromStore(store)) !== store.savedStateJson;

/**
 * Whether the API can save the open scenario: saved-scenarios in /api/health
 * (WP8), and for a hire scenario hire-scenarios too (WP9): an API with only
 * the first refuses kind 'hire'. Without it the scenario works in the browser
 * only, and nothing asks about unsaved changes, as without saved-scenarios.
 * Never for "A new client" (Tier 3 WP6, U22 (a)): the sandbox is not a saved
 * kind (KINDS and the checks on both sides are untouched), so Save and Save
 * as are off for it and nothing asks about it on logout or leaving.
 */
export const scenarioSavable = (store) => store.scenarioFeature === true
  && store.scenarioKind !== 'client'
  && (store.scenarioKind !== 'hire' || store.hireFeature === true);

/** Unsaved changes that could be saved: what New, Open, logout and leaving the page ask about. */
export const unsavedChanges = (store) => scenarioSavable(store) && scenarioDirty(store);

/* -------------------------------- opening -------------------------------- */

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * A saved scenario opened on the current book: the store's scenario state,
 * and the notices to show. Everything the engine derives is derived again by
 * the page (departureModel); here:
 *
 * - someone no longer on the People list is taken off the people leaving,
 *   with a notice (people are only ever deactivated, P5, so this is rare);
 *   someone leaving who is now inactive is kept and named;
 * - a client no longer in the book: its pick, plan, Stage 3 record and tasks
 *   are dropped, with a notice; the communication log is kept as recorded.
 *   Its id will never return (a client is re-created with a new id), so they
 *   could never be shown again. Saving the scenario then removes them;
 * - a pick the engine now refuses stays, and Stage 2 shows why (a notice
 *   counts them);
 * - Stage 3's transitions are rebuilt from each client's saved start date and
 *   status (syncTransitions, as Stage 3 builds them); a client whose approved
 *   seats no longer apply keeps its record, not shown (`heldTransitions`),
 *   until the partner proceeds to Stage 3 again.
 *
 * `people` and `clients` are the store's (the People list, the API's
 * clients); `reportingYear` the book's; `today` 'YYYY-MM-DD'.
 */
export function openState(saved, { people = [], clients = [], reportingYear = null, today } = {}) {
  const state = canonicalState(saved);
  if (state.kind === 'hire') return openHire(state, { people, clients, reportingYear }, saved);
  const notices = [];

  const listed = new Map(people.map((p) => [String(p.id), p]));
  const missingPeople = state.departingIds.filter((id) => !listed.has(id));
  const departingIds = state.departingIds.filter((id) => listed.has(id));
  if (missingPeople.length > 0) {
    notices.push(`${missingPeople.length} ${plural(missingPeople.length, 'person', 'people')} marked as leaving ${plural(missingPeople.length, 'is', 'are')} no longer on the People list and ${plural(missingPeople.length, 'was', 'were')} taken off the people leaving.`);
  }
  const inactive = departingIds.map((id) => listed.get(id)).filter((p) => !p.active);
  if (inactive.length > 0) {
    notices.push(`Marked as leaving and now inactive on the People list: ${inactive.map((p) => p.name).join(', ')}.`);
  }

  const inBook = new Set(clients.map((c) => String(c.id)));
  const gone = new Set([
    ...Object.keys(state.choices),
    ...Object.keys(state.plans),
    ...Object.keys(state.execution),
    ...state.tasks.map((t) => t.clientId).filter(Boolean),
  ].filter((id) => !inBook.has(id)));
  const keep = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => !gone.has(id)));
  const choices = keep(state.choices);
  const plans = keep(state.plans);
  const execution = keep(state.execution);
  const tasks = state.tasks.filter((t) => !gone.has(t.clientId));
  if (gone.size > 0) {
    notices.push(`${gone.size} ${plural(gone.size, 'client', 'clients')} in this scenario ${plural(gone.size, 'is', 'are')} no longer in the book: ${plural(gone.size, 'its', 'their')} picks, plans, Stage 3 records and tasks were dropped; the communication log is kept as it was. Saving the scenario removes them.`);
  }

  const departure = departureModel({
    people,
    clients,
    departingIds,
    revenueOf: (client) => revenueForYear(client, reportingYear),
    choices,
  });
  const refused = departure.decisions.filter((d) => d.lead.problem || d.secondChair.problem).length;
  if (refused > 0) {
    notices.push(`${refused} ${plural(refused, 'pick no longer holds', 'picks no longer hold')} on the current book; Stage 2 shows why, and the proposal stands until someone picks again.`);
  }

  const records = Object.entries(execution).map(([id, entry]) => ({ clientId: id, ...entry }));
  const { transitions } = syncTransitions({
    decisions: departure.decisions,
    plans: planViews(plans),
    transitions: records,
    tasks: [],
    today,
  });
  const activeTransitions = transitions.filter((t) => execution[t.clientId] !== undefined);
  const shown = new Set(activeTransitions.map((t) => t.clientId));
  const heldTransitions = records.filter((r) => !shown.has(r.clientId));
  if (heldTransitions.length > 0) {
    const n = heldTransitions.length;
    notices.push(`Stage 3's ${plural(n, 'record', 'records')} for ${n} ${plural(n, 'client', 'clients')} ${plural(n, 'is', 'are')} kept but not shown: ${plural(n, 'its', 'their')} approved seats no longer apply on the current book. Proceeding to Stage 3 again sets Stage 3 from the plans approved then.`);
  }

  return {
    scenarioKind: 'departure',
    successionWorkflow: { currentStage: state.currentStage, departingIds, choices },
    transitionPlans: plans,
    activeTransitions,
    heldTransitions,
    transitionTasks: tasks,
    communicationLog: state.communications,
    notices,
  };
}

/**
 * A saved hire scenario opened on the current book (WP9): the store's
 * hireScenario and the notices. The proposals and the loads are derived again
 * (./hireScenario.js); here:
 *
 * - a client no longer in the book loses its pick, with a notice (its id never
 *   returns); saving the scenario removes it;
 * - an associate linked to someone no longer on the People list is unlinked,
 *   with a notice; one linked to someone who is no longer an active associate
 *   keeps the link, which the figures do not use, and is named;
 * - a pick whose seat has changed since it was made stays, and the page shows
 *   why and does not apply it (a notice counts them), as a refused pick stays
 *   in a departure;
 * - a practice area of focus no longer on the list (one of the four the list
 *   retired, docs/plans/tier-3.md, U43 (b)) is taken off, as canonicalState
 *   takes it off, and named in a notice, so the scenario saves again (the
 *   server refuses it).
 */
function openHire(state, { people, clients, reportingYear }, saved = {}) {
  const notices = [];
  const savedFocus = new Map();
  for (const a of Array.isArray(saved?.associates) ? saved.associates : []) {
    const id = isPlainObject(a) ? idText(a.id) : '';
    if (id && !savedFocus.has(id)) savedFocus.set(id, Array.isArray(a.focus) ? a.focus.map(text) : []);
  }
  for (const a of state.associates) {
    const dropped = [...new Set((savedFocus.get(a.id) || []).filter((area) => typeof area === 'string' && area !== '' && !PRACTICE_AREAS.includes(area)))];
    if (dropped.length > 0) {
      notices.push(`${a.label}'s ${plural(dropped.length, 'practice area', 'practice areas')} of focus ${dropped.map((area) => `"${area}"`).join(', ')} ${plural(dropped.length, 'is', 'are')} no longer on the list, so ${plural(dropped.length, 'it was', 'they were')} taken off.`);
    }
  }
  const listed = new Map(people.map((p) => [String(p.id), p]));
  const inBook = new Set(clients.map((c) => String(c.id)));
  const gone = Object.keys(state.picks).filter((id) => !inBook.has(id));
  const picks = Object.fromEntries(Object.entries(state.picks).filter(([id]) => inBook.has(id)));
  if (gone.length > 0) {
    notices.push(`${gone.length} ${plural(gone.length, 'client', 'clients')} picked or taken out in this scenario ${plural(gone.length, 'is', 'are')} no longer in the book, so ${plural(gone.length, 'its pick was', 'their picks were')} dropped. Saving the scenario removes ${plural(gone.length, 'it', 'them')}.`);
  }
  const associates = state.associates.map((a) => {
    if (a.personId === null) return a;
    const person = listed.get(a.personId);
    if (!person) {
      notices.push(`${a.label} was linked to someone no longer on the People list, so the link was removed.`);
      return { ...a, personId: null };
    }
    if (!person.active || person.role !== 'associate') {
      notices.push(`${a.label} is linked to ${person.name}, who is no longer an active associate; the figures treat ${a.label} as not hired yet.`);
    }
    return a;
  });
  const model = hireScenarioModel({
    people,
    clients,
    revenueOf: (client) => revenueForYear(client, reportingYear),
    associates,
    picks,
  });
  const stale = model.notApplied.filter((n) => n.stale).length;
  if (stale > 0) {
    notices.push(`${stale} ${plural(stale, 'pick\'s seat has', 'picks\' seats have')} changed since ${plural(stale, 'it was', 'they were')} made; each shows why and is not applied until someone picks it again.`);
  }
  return {
    scenarioKind: 'hire',
    hireScenario: { associates, picks, relief: state.relief },
    notices,
  };
}
