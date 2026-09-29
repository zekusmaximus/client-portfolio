// Saved Scenarios (docs/plans/tier-2.md, S12, WP8): the state a saved
// scenario holds, the checks POST and PUT /api/scenarios apply to it, and the
// SQL routes/scenarios.cjs runs. Pure.
//
// The state is what partners entered in Scenarios, never what the departure
// engine derives from the book (src/utils/departure.js recomputes that from
// the book at every render, so a scenario stays valid as the book changes):
//
//   { kind: 'departure',
//     currentStage: 'impact' | 'mitigation' | 'implementation',
//     departingIds: [personId],                       // the people leaving
//     choices: { [clientId]: { leadId?, secondChairId? } },   // approval's pins included
//     plans: { [clientId]: { answerId, ai, edits, status, updatedAt } },
//     execution: { [clientId]: { startDate, status } },       // Stage 3
//     tasks: [...], communications: [...] }                    // Stage 3
//
// A plan keeps the AI's fields (`ai`, as the transition-plan route answered
// them, with the saved answer's id) apart from the partner's edits (`edits`),
// so regenerating a plan never loses an edit and an edit never loses the AI's
// text. Every id is text: a person's id is the People list's integer, a
// client's is an integer on production's older tables and a uuid on
// init-db.sql's (CLAUDE.md, File Structure). No loads, no candidates and no
// client facts beyond ids: every key is checked, and one this file does not
// name is refused, so a state carrying a client's name or a load cannot be
// saved.
//
// The page's copy is src/utils/scenarioState.js, which builds this state from
// the store and opens it on the current book; the server never requires the
// page's src/ (T3), and tests/scenario-state.test.mjs holds the two equal.
//
// WP9 (section 14, S18 and S19) adds kind 'hire': one or more hypothetical
// associates, the partner's second-chair picks for them, and S19's toggle:
//
//   { kind: 'hire',
//     associates: [{ id: 'h1', label, focus: [practiceArea], target, personId }],
//     picks: { [clientId]: { associateId, seenSecondChairId } },
//     relief: false }
//
// An associate's id is scenario-local ('h1', 'h2', ...), which PERSON_ID
// refuses wherever a real person is required, so a hypothetical id never
// passes for a People list id. `target` is { kind: 'count', count } or
// { kind: 'average' } (the active associates' average second-chair load);
// `personId` the person on the People list it was linked to after the hire,
// or null. A pick's `associateId` is one of this state's associates, or null
// (the partner took the client out of the proposals); `seenSecondChairId` the
// second chair as the scenario saw it when the pick was made (a person's id,
// or null for an empty seat), which the page sends with an accepted pick. The
// proposals and every load are derived by the page (src/utils/hireScenario.js)
// and never saved. Each kind holds only its own keys.

const { firmTime } = require('./clientChanges.cjs');
const { PRACTICE_AREAS } = require('./clientRules.cjs');

const KINDS = ['departure', 'hire'];
const STAGES = ['impact', 'mitigation', 'implementation'];
// Stage 2's plan statuses (ClientReviewInterface.jsx) and Stage 3's
// transition statuses (TransitionPlanManager.jsx); the page reads both
const PLAN_STATUSES = ['pending', 'planned', 'approved', 'rejected'];
const TRANSITION_STATUSES = ['in-progress', 'at-risk', 'delayed', 'completed'];
// The plan's priority, from the server's succession risk (utils/transitionPlan.cjs)
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

const STATE_KEYS = ['kind', 'currentStage', 'departingIds', 'choices', 'plans', 'execution', 'tasks', 'communications'];
const CHOICE_KEYS = ['leadId', 'secondChairId'];
const PLAN_KEYS = ['answerId', 'ai', 'edits', 'status', 'updatedAt'];
// What the transition-plan route answers that a plan keeps (docs/plans/tier-2.md, section 13)
const AI_FIELDS = [
  'strategy', 'recommendedLead', 'recommendedSecondChair', 'timelineDays', 'risks', 'tasks',
  'communicationTemplate', 'priority', 'truncated', 'refused',
];
// What a partner can edit in Stage 2
const EDIT_FIELDS = ['strategy', 'risks', 'timelineDays'];
const RECOMMENDATION_KEYS = ['person', 'none', 'text', 'problem'];
const PERSON_KEYS = ['id', 'name', 'role'];
const EXECUTION_KEYS = ['startDate', 'status'];
// Stage 3's tasks and communications, as TransitionPlanManager.jsx and
// syncTransitions (src/utils/transitionPlans.js) make them: text only
const TASK_KEYS = ['id', 'title', 'description', 'assignee', 'dueDate', 'priority', 'status', 'clientId', 'category', 'createdAt'];
const COMMUNICATION_KEYS = ['id', 'type', 'subject', 'content', 'date', 'outcome', 'clientId', 'timestamp'];
// Of those, the ones a record must carry
const TASK_REQUIRED = ['id'];
const COMMUNICATION_REQUIRED = ['id'];
// A hire scenario (WP9)
const HIRE_STATE_KEYS = ['kind', 'associates', 'picks', 'relief'];
const ASSOCIATE_KEYS = ['id', 'label', 'focus', 'target', 'personId'];
const TARGET_KINDS = ['count', 'average'];
const PICK_KEYS = ['associateId', 'seenSecondChairId'];

// The bounds. The name is scenarios.name's VARCHAR(120), in characters as
// PostgreSQL counts them. The state is bounded by its size as JSON (the
// request body may be 5 MB: server.cjs), and each list by a count well above
// any book the firm holds (84 clients in September 2026).
const LIMITS = {
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
// Only this many details are listed, however many problems a state has
const MAX_DETAILS = 20;

const PERSON_ID = /^[1-9]\d{0,9}$/;
const CLIENT_ID = /^(?:[1-9]\d{0,9}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INT_MAX = 2147483647;
// A hypothetical associate's scenario-local id: never a People list id
const HYPOTHETICAL_ID = /^h[1-9]\d{0,3}$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = (value, max = INT_MAX) => Number.isInteger(value) && value >= 1 && value <= max;
const isPersonId = (value) => typeof value === 'string' && PERSON_ID.test(value) && Number(value) <= INT_MAX;
const isClientId = (value) => typeof value === 'string' && CLIENT_ID.test(value) && (!/^\d+$/.test(value) || Number(value) <= INT_MAX);
const isDate = (value) => typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const characters = (text) => Array.from(text).length;

/**
 * The problems with a scenario's state, as [{ field, message }], empty when
 * it can be saved. `field` names the place: `state`, `state.plans.<id>.ai`.
 */
function checkState(state) {
  const details = [];
  const problem = (field, message) => {
    if (details.length < MAX_DETAILS) details.push({ field, message });
  };
  if (!isPlainObject(state)) {
    problem('state', 'The scenario\'s state must be a JSON object.');
    return details;
  }
  const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  if (bytes > LIMITS.stateBytes) {
    problem('state', `The scenario is ${bytes.toLocaleString('en-US')} bytes; it can be at most ${LIMITS.stateBytes.toLocaleString('en-US')}.`);
    return details;
  }

  const onlyKeys = (field, object, keys) => {
    for (const key of Object.keys(object)) {
      if (!keys.includes(key)) problem(`${field}.${key}`, `${field} cannot hold "${key}"; it holds only ${keys.join(', ')}.`);
    }
  };
  const text = (field, value, { max = LIMITS.text, nullable = false } = {}) => {
    if (value === null && nullable) return;
    if (typeof value !== 'string') problem(field, `${field} must be text${nullable ? ' or null' : ''}.`);
    else if (value.length > max) problem(field, `${field} is ${value.length} characters; it can be at most ${max}.`);
  };
  const oneOf = (field, value, list) => {
    if (!list.includes(value)) problem(field, `${field} must be one of ${list.join(', ')}.`);
  };
  const clientMap = (field, value, checkEntry) => {
    if (!isPlainObject(value)) {
      problem(field, `${field} must be an object keyed by client id.`);
      return;
    }
    const entries = Object.entries(value);
    if (entries.length > LIMITS.clients) {
      problem(field, `${field} holds ${entries.length} clients; it can hold at most ${LIMITS.clients}.`);
      return;
    }
    for (const [clientId, entry] of entries) {
      if (!isClientId(clientId)) problem(`${field}.${clientId}`, `"${clientId}" is not a client id.`);
      else if (!isPlainObject(entry)) problem(`${field}.${clientId}`, `${field}.${clientId} must be an object.`);
      else checkEntry(`${field}.${clientId}`, entry);
    }
  };
  const recordList = (field, value, { keys, required, max }) => {
    if (!Array.isArray(value)) {
      problem(field, `${field} must be a list.`);
      return;
    }
    if (value.length > max) {
      problem(field, `${field} holds ${value.length} entries; it can hold at most ${max}.`);
      return;
    }
    value.forEach((record, index) => {
      const at = `${field}.${index}`;
      if (!isPlainObject(record)) {
        problem(at, `${at} must be an object.`);
        return;
      }
      onlyKeys(at, record, keys);
      for (const key of required) {
        if (typeof record[key] !== 'string' || record[key] === '') problem(`${at}.${key}`, `${at}.${key} is required.`);
      }
      for (const key of keys) {
        if (record[key] === undefined) continue;
        if (key === 'clientId') {
          if (record.clientId !== '' && !isClientId(record.clientId)) problem(`${at}.clientId`, `${at}.clientId must be a client id or empty.`);
        } else {
          text(`${at}.${key}`, record[key]);
        }
      }
    });
  };
  const recommendation = (field, value) => {
    if (value === null) return;
    if (!isPlainObject(value)) {
      problem(field, `${field} must be an object or null.`);
      return;
    }
    onlyKeys(field, value, RECOMMENDATION_KEYS);
    if (value.person !== undefined && value.person !== null) {
      if (!isPlainObject(value.person)) problem(`${field}.person`, `${field}.person must be an object or null.`);
      else {
        onlyKeys(`${field}.person`, value.person, PERSON_KEYS);
        const { id } = value.person;
        if (!(isPositiveInteger(id) || isPersonId(id))) problem(`${field}.person.id`, `${field}.person.id must be a person's id.`);
        text(`${field}.person.name`, value.person.name, { max: LIMITS.short });
        text(`${field}.person.role`, value.person.role, { max: LIMITS.short });
      }
    }
    if (value.none !== undefined && typeof value.none !== 'boolean') problem(`${field}.none`, `${field}.none must be true or false.`);
    if (value.text !== undefined) text(`${field}.text`, value.text);
    if (value.problem !== undefined) text(`${field}.problem`, value.problem, { nullable: true });
  };
  const timelineDays = (field, value) => {
    if (value !== null && !isPositiveInteger(value, LIMITS.timelineDays)) {
      problem(field, `${field} must be a whole number of days from 1 to ${LIMITS.timelineDays}, or null.`);
    }
  };

  // A hire scenario holds only its own keys; any other kind is checked as a
  // departure, so a kind the server does not know is the one detail
  if (state.kind === 'hire') {
    onlyKeys('state', state, HIRE_STATE_KEYS);
    checkHire(state, { problem, onlyKeys, text, oneOf, clientMap });
    return details;
  }
  onlyKeys('state', state, STATE_KEYS);
  oneOf('state.kind', state.kind, KINDS);
  oneOf('state.currentStage', state.currentStage, STAGES);

  if (!Array.isArray(state.departingIds)) problem('state.departingIds', 'state.departingIds must be a list of people\'s ids.');
  else if (state.departingIds.length > LIMITS.departing) {
    problem('state.departingIds', `state.departingIds holds ${state.departingIds.length} people; it can hold at most ${LIMITS.departing}.`);
  } else {
    state.departingIds.forEach((id, index) => {
      if (!isPersonId(id)) problem(`state.departingIds.${index}`, `state.departingIds.${index} must be a person's id as text.`);
    });
    if (new Set(state.departingIds).size !== state.departingIds.length) problem('state.departingIds', 'state.departingIds names someone twice.');
  }

  clientMap('state.choices', state.choices, (field, choice) => {
    onlyKeys(field, choice, CHOICE_KEYS);
    for (const key of CHOICE_KEYS) {
      if (choice[key] !== undefined && choice[key] !== null && !isPersonId(choice[key])) {
        problem(`${field}.${key}`, `${field}.${key} must be a person's id as text, or null.`);
      }
    }
  });

  clientMap('state.plans', state.plans, (field, plan) => {
    onlyKeys(field, plan, PLAN_KEYS);
    for (const key of PLAN_KEYS) {
      if (plan[key] === undefined) problem(`${field}.${key}`, `${field}.${key} is required.`);
    }
    if (plan.answerId !== undefined && plan.answerId !== null && !isPositiveInteger(plan.answerId)) {
      problem(`${field}.answerId`, `${field}.answerId must be a saved answer's id, or null.`);
    }
    if (plan.status !== undefined) oneOf(`${field}.status`, plan.status, PLAN_STATUSES);
    if (plan.updatedAt !== undefined) text(`${field}.updatedAt`, plan.updatedAt, { max: LIMITS.short, nullable: true });
    if (plan.ai !== undefined && plan.ai !== null) {
      const at = `${field}.ai`;
      if (!isPlainObject(plan.ai)) problem(at, `${at} must be an object or null.`);
      else {
        const { ai } = plan;
        onlyKeys(at, ai, AI_FIELDS);
        for (const key of ['strategy', 'risks', 'communicationTemplate']) {
          if (ai[key] !== undefined) text(`${at}.${key}`, ai[key], { nullable: true });
        }
        for (const key of ['recommendedLead', 'recommendedSecondChair']) {
          if (ai[key] !== undefined) recommendation(`${at}.${key}`, ai[key]);
        }
        if (ai.timelineDays !== undefined) timelineDays(`${at}.timelineDays`, ai.timelineDays);
        if (ai.tasks !== undefined) {
          if (!Array.isArray(ai.tasks) || ai.tasks.length > LIMITS.aiTasks) {
            problem(`${at}.tasks`, `${at}.tasks must be a list of at most ${LIMITS.aiTasks} action items.`);
          } else ai.tasks.forEach((task, index) => text(`${at}.tasks.${index}`, task));
        }
        if (ai.priority !== undefined && ai.priority !== null) oneOf(`${at}.priority`, ai.priority, PRIORITIES);
        for (const key of ['truncated', 'refused']) {
          if (ai[key] !== undefined && typeof ai[key] !== 'boolean') problem(`${at}.${key}`, `${at}.${key} must be true or false.`);
        }
      }
    }
    if (plan.edits !== undefined) {
      const at = `${field}.edits`;
      if (!isPlainObject(plan.edits)) problem(at, `${at} must be an object.`);
      else {
        onlyKeys(at, plan.edits, EDIT_FIELDS);
        for (const key of ['strategy', 'risks']) {
          if (plan.edits[key] !== undefined) text(`${at}.${key}`, plan.edits[key]);
        }
        if (plan.edits.timelineDays !== undefined) timelineDays(`${at}.timelineDays`, plan.edits.timelineDays);
      }
    }
  });

  clientMap('state.execution', state.execution, (field, record) => {
    onlyKeys(field, record, EXECUTION_KEYS);
    if (!isDate(record.startDate)) problem(`${field}.startDate`, `${field}.startDate must be a date, YYYY-MM-DD.`);
    oneOf(`${field}.status`, record.status, TRANSITION_STATUSES);
  });

  recordList('state.tasks', state.tasks, { keys: TASK_KEYS, required: TASK_REQUIRED, max: LIMITS.tasks });
  recordList('state.communications', state.communications, { keys: COMMUNICATION_KEYS, required: COMMUNICATION_REQUIRED, max: LIMITS.communications });
  return details;
}

// A hire scenario's associates, picks and toggle (checkState's helpers passed in)
function checkHire(state, { problem, onlyKeys, text, oneOf, clientMap }) {
  const ids = new Set();
  const linked = new Set();
  if (!Array.isArray(state.associates)) problem('state.associates', 'state.associates must be a list of hypothetical associates.');
  else if (state.associates.length > LIMITS.associates) {
    problem('state.associates', `state.associates holds ${state.associates.length} associates; it can hold at most ${LIMITS.associates}.`);
  } else {
    state.associates.forEach((associate, index) => {
      const at = `state.associates.${index}`;
      if (!isPlainObject(associate)) {
        problem(at, `${at} must be an object.`);
        return;
      }
      onlyKeys(at, associate, ASSOCIATE_KEYS);
      if (typeof associate.id !== 'string' || !HYPOTHETICAL_ID.test(associate.id)) {
        problem(`${at}.id`, `${at}.id must be a scenario-local id: h1, h2 and so on.`);
      } else if (ids.has(associate.id)) problem(`${at}.id`, `${at}.id repeats ${associate.id}.`);
      else ids.add(associate.id);
      if (typeof associate.label !== 'string' || associate.label === '') problem(`${at}.label`, `${at}.label is required.`);
      else text(`${at}.label`, associate.label, { max: LIMITS.label });
      if (!Array.isArray(associate.focus)) problem(`${at}.focus`, `${at}.focus must be a list of practice areas.`);
      else {
        associate.focus.forEach((area, n) => oneOf(`${at}.focus.${n}`, area, PRACTICE_AREAS));
        if (new Set(associate.focus).size !== associate.focus.length) problem(`${at}.focus`, `${at}.focus names a practice area twice.`);
      }
      const { target } = associate;
      if (!isPlainObject(target)) problem(`${at}.target`, `${at}.target must be { kind: 'count', count } or { kind: 'average' }.`);
      else {
        oneOf(`${at}.target.kind`, target.kind, TARGET_KINDS);
        onlyKeys(`${at}.target`, target, target.kind === 'count' ? ['kind', 'count'] : ['kind']);
        if (target.kind === 'count' && !(Number.isInteger(target.count) && target.count >= 0 && target.count <= LIMITS.clients)) {
          problem(`${at}.target.count`, `${at}.target.count must be a whole number of clients from 0 to ${LIMITS.clients}.`);
        }
      }
      if (associate.personId === undefined) problem(`${at}.personId`, `${at}.personId is required: a person's id as text, or null.`);
      else if (associate.personId !== null) {
        if (!isPersonId(associate.personId)) problem(`${at}.personId`, `${at}.personId must be a person's id as text, or null.`);
        else if (linked.has(associate.personId)) problem(`${at}.personId`, `${at}.personId links someone already linked to another associate.`);
        else linked.add(associate.personId);
      }
    });
  }

  clientMap('state.picks', state.picks, (field, pick) => {
    onlyKeys(field, pick, PICK_KEYS);
    if (pick.associateId === undefined) problem(`${field}.associateId`, `${field}.associateId is required.`);
    else if (pick.associateId !== null && !ids.has(pick.associateId)) {
      problem(`${field}.associateId`, `${field}.associateId must be the id of one of this scenario's associates, or null.`);
    }
    if (pick.seenSecondChairId === undefined) problem(`${field}.seenSecondChairId`, `${field}.seenSecondChairId is required.`);
    else if (pick.seenSecondChairId !== null && !isPersonId(pick.seenSecondChairId)) {
      problem(`${field}.seenSecondChairId`, `${field}.seenSecondChairId must be a person's id as text, or null.`);
    }
  });

  if (typeof state.relief !== 'boolean') problem('state.relief', 'state.relief must be true or false.');
}

/**
 * The problems with a POST or PUT body, { name, state } (and `version` on a
 * PUT), as [{ field, message }]: the name, then the version, then the state.
 * The body is as trimRequestBody passes it on (every string trimmed).
 */
function checkScenario(body, { update = false } = {}) {
  if (!isPlainObject(body)) {
    return [{ field: 'body', message: `The request body must be a JSON object: { name, state${update ? ', version' : ''} }.` }];
  }
  const details = [];
  if (typeof body.name !== 'string' || body.name === '') {
    details.push({ field: 'name', message: 'The scenario needs a name.' });
  } else if (characters(body.name) > LIMITS.name) {
    details.push({ field: 'name', message: `The name is ${characters(body.name)} characters; it can be at most ${LIMITS.name}.` });
  }
  if (update && !isPositiveInteger(body.version)) {
    details.push({ field: 'version', message: 'version must be the whole number the scenario was opened at.' });
  }
  return [...details, ...checkState(body.state)].slice(0, MAX_DETAILS);
}

/** A scenario id from the URL: a positive integer in PostgreSQL's `integer` range, or null. */
function readScenarioId(param) {
  const text = String(param ?? '');
  if (!/^[1-9]\d{0,9}$/.test(text)) return null;
  const id = Number(text);
  return id <= INT_MAX ? id : null;
}

// The columns every answer carries; the account ids stay in the table
const SCENARIO_COLUMNS = 'id, name, state, version, created_by_username, updated_by_username, created_at, updated_at';

// The list: newest save first, with the people leaving by id and their name
// on the People list now (null for an id no longer on it), in the state's order
// A hire scenario (WP9) has no people leaving and no stage; its associates
// are listed instead, each with the name of the person linked to it now (null
// for none, or for an id no longer on the People list), in the state's order
const LIST_SCENARIOS_SQL = `
  SELECT s.id, s.name, s.state->>'kind' AS kind, s.state->>'currentStage' AS current_stage, s.version,
         s.created_by_username, s.updated_by_username, s.created_at, s.updated_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', p.name) ORDER BY d.n)
             FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(s.state->'departingIds') = 'array' THEN s.state->'departingIds' ELSE '[]'::jsonb END
                  ) WITH ORDINALITY AS d(id, n)
             LEFT JOIN people p ON p.id::text = d.id
         ), '[]'::jsonb) AS leaving,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('id', a.value->>'id', 'label', a.value->>'label', 'person', p.name) ORDER BY a.n)
             FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(s.state->'associates') = 'array' THEN s.state->'associates' ELSE '[]'::jsonb END
                  ) WITH ORDINALITY AS a(value, n)
             LEFT JOIN people p ON p.id::text = a.value->>'personId'
         ), '[]'::jsonb) AS associates
    FROM scenarios s
   ORDER BY s.updated_at DESC, s.id DESC`;

const ONE_SCENARIO_SQL = `SELECT ${SCENARIO_COLUMNS} FROM scenarios WHERE id = $1`;

// $3 is the account's id, the key only while the account exists (a session
// outlives a deleted account: the JWT is not checked against users), and $4
// the username, copied
const INSERT_SCENARIO_SQL = `
  INSERT INTO scenarios (name, state, created_by, created_by_username, updated_by, updated_by_username)
  VALUES ($1, $2::jsonb, (SELECT id FROM users WHERE id = $3), $4::text, (SELECT id FROM users WHERE id = $3), $4::text)
  RETURNING ${SCENARIO_COLUMNS}`;

// The version is checked and incremented in the one statement: of two saves
// that read the same version, the second waits for the first's row lock,
// then finds the version moved on and updates nothing
const UPDATE_SCENARIO_SQL = `
  UPDATE scenarios
     SET name = $2, state = $3::jsonb, version = version + 1,
         updated_by = (SELECT id FROM users WHERE id = $5), updated_by_username = $6::text, updated_at = now()
   WHERE id = $1 AND version = $4
  RETURNING ${SCENARIO_COLUMNS}`;

// Who saved a scenario last, for a stale save's 409
const LATEST_SAVE_SQL = 'SELECT version, updated_by_username, updated_at FROM scenarios WHERE id = $1';

const DELETE_SCENARIO_SQL = 'DELETE FROM scenarios WHERE id = $1 RETURNING id';

const accountId = (user) => (Number.isInteger(user?.userId) ? user.userId : null);
const username = (user) => (typeof user?.username === 'string' ? user.username : null);

/** INSERT_SCENARIO_SQL's values; `user` is the JWT payload ({ userId, username }). */
const insertScenarioParams = (name, state, user) => [name, JSON.stringify(state), accountId(user), username(user)];

/** UPDATE_SCENARIO_SQL's values. */
const updateScenarioParams = (id, name, state, version, user) =>
  [id, name, JSON.stringify(state), version, accountId(user), username(user)];

/**
 * A stale save's 409: { success: false, error, latest_save }, naming who
 * saved last and when (America/New_York, as a client's 409 does).
 */
function conflictBody(latest) {
  const save = { version: latest.version, updated_by_username: latest.updated_by_username ?? null, updated_at: latest.updated_at };
  return {
    success: false,
    error: `This scenario was saved after you opened it, by ${save.updated_by_username || 'a former account'} on ${firmTime(save.updated_at)}. Nothing was saved.`,
    latest_save: save,
  };
}

module.exports = {
  KINDS,
  STAGES,
  PLAN_STATUSES,
  TRANSITION_STATUSES,
  PRIORITIES,
  STATE_KEYS,
  CHOICE_KEYS,
  PLAN_KEYS,
  AI_FIELDS,
  EDIT_FIELDS,
  RECOMMENDATION_KEYS,
  PERSON_KEYS,
  EXECUTION_KEYS,
  TASK_KEYS,
  COMMUNICATION_KEYS,
  HIRE_STATE_KEYS,
  ASSOCIATE_KEYS,
  TARGET_KINDS,
  PICK_KEYS,
  HYPOTHETICAL_ID,
  LIMITS,
  MAX_DETAILS,
  checkState,
  checkScenario,
  readScenarioId,
  LIST_SCENARIOS_SQL,
  ONE_SCENARIO_SQL,
  INSERT_SCENARIO_SQL,
  UPDATE_SCENARIO_SQL,
  LATEST_SAVE_SQL,
  DELETE_SCENARIO_SQL,
  insertScenarioParams,
  updateScenarioParams,
  conflictBody,
};
