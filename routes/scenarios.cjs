const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { aiUserLimiter, aiGlobalLimiter } = require('../middleware/rateLimit.cjs');
const { trimRequestBody } = require('../middleware/validation.cjs');
const { AI_MODEL, complete, describeError } = require('../services/anthropic.cjs');
const { answerRow } = require('../utils/aiAnswers.cjs');
const { saveAnswer } = require('../models/aiAnswerModel.cjs');
const { loadBook } = require('../models/bookModel.cjs');
const db = require('../db.cjs');
const scenarioState = require('../utils/scenarioState.cjs');
const {
  checkPlanRequest,
  checkRoster,
  departingNames,
  bookClient,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
} = require('../utils/transitionPlan.cjs');

// Sign-in for every route. The AI budgets (D11, T16), shared with
// routes/ai.cjs, are on the transition-plan route alone: until Tier 2 WP8 they
// were mounted here for every route, and the saved scenarios' routes below
// call no model, so they must not spend the budget (docs/plans/tier-2.md,
// section 13). The budget itself is unchanged.
router.use(auth);
// Every string trimmed, as the request sanitizer trimmed it until WP5, and not
// escaped (docs/plans/tier-2.md, S8). A saved scenario's state is trimmed
// too, its text included (a plan's edited strategy, a communication's notes);
// the page trims it the same way before it compares or saves
// (src/utils/scenarioState.js), so what it holds is what is stored.
router.use(trimRequestBody);

/* -------------------------------------------------------------------------- */
/*                         PER-CLIENT TRANSITION PLAN                         */
/* -------------------------------------------------------------------------- */

// The output budget (T11): thinking and the plan together
const MAX_TOKENS = 16000;

// POST /api/scenarios/transition-plan
// Body: { client: <one affected client from Stage 1>,
//         stage1Data: { departing: [{ name, role }], impactData, reportingYear },
//         roster: [{ name, role, lead: { count, revenue, effort }, second: {...} }] }
// One request per client (docs/plans/tier-0.md, D9): the succession workflow
// runs these with concurrency 2 and shows progress, instead of one bulk request
// that would outlive any proxy timeout on a current model. The roster is the
// people staying (docs/plans/people-and-second-chair.md, Phase 5); every name
// is checked against the People list before anything goes to the model, and
// the plan's recommended lead and second chair are resolved against it.
//
// On the book (docs/plans/tier-1.md, WP6, T14): the route builds the book
// (models/bookModel.cjs, as Ask does) and answers 404 when the client is not
// in it. The prompt's system blocks are Ask's, byte for byte, so a plan reads
// the book from the same cache entry (T8); the client's facts come from its
// entry in the book and, after checkRoster, each roster person's loads from
// the book's rows (createTransitionPlanPrompt, rosterFromBook), whatever the
// page sent. Since Tier 2 WP7 (S11) so do the client's succession metrics
// (planMetrics, utils/succession.cjs: the figures its client response
// carries), and the plan's priority follows that risk; the metrics the page
// sends are ignored. Only the scenario (who is leaving, the revenue at risk)
// comes from the request. The response is unchanged, so the page needs no
// change and no feature name.
//
// The plan is saved (WP4, T12) as a 'transition-plan' answer with the
// client's id as text, its name unescaped (unescapeStored: the name the page
// sends is the stored one, which is escaped if the form saved it before WP5),
// the book's hash and its reporting year. The response keeps its shape (T14)
// and adds answerId and saved beside plan: a failed save returns the plan
// with saved: false and answerId null, never an error.
router.post('/transition-plan', aiUserLimiter, aiGlobalLimiter, async (req, res) => {
  const { client, stage1Data, roster } = req.body || {};
  const refusal = checkPlanRequest(req.body);
  if (refusal) {
    return res.status(400).json({ success: false, error: refusal });
  }

  const now = new Date();
  let book;
  try {
    book = await loadBook(now);
  } catch (error) {
    console.error('Error reading the book for a transition plan:', error);
    return res.status(500).json({ success: false, error: 'Failed to read the book.' });
  }
  if (!bookClient(book, client.id)) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  const checked = checkRoster(roster, book.people, departingNames(stage1Data));
  if (checked.errors.length > 0) {
    return res.status(400).json({ success: false, error: checked.errors.join(' '), errors: checked.errors });
  }

  try {
    const { system, prompt, metrics } = createTransitionPlanPrompt(client, stage1Data, checked.roster, book, { today: now });
    const started = Date.now();
    const result = await complete({
      system,
      prompt,
      maxTokens: MAX_TOKENS,
      userId: req.user.userId,
      label: 'transition-plan',
    });
    const { id: answerId, saved } = await saveAnswer(answerRow({
      kind: 'transition-plan',
      client,
      user: req.user,
      result,
      bookText: book.text,
      reportingYear: book.reportingYear,
      durationMs: Date.now() - started,
      model: AI_MODEL,
    }), { label: 'transition-plan', userId: req.user.userId });
    const parsed = parseTransitionPlanResponse(result.text, metrics, checked.roster);

    res.json({
      success: true,
      plan: {
        clientId: client.id,
        clientName: client.name,
        ...parsed,
        truncated: result.truncated,
        refused: result.refused,
      },
      answerId,
      saved,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // An API status error is already described by the ai_error log line. A
    // missing key writes no line (complete() refuses it before any call;
    // /api/health shows it) and needs no stack trace. Keep the stack trace for
    // unexpected failures only.
    const expected = error?.code === 'AI_NOT_CONFIGURED' || typeof error?.status === 'number';
    console.error(`Error generating transition plan for client ${client.id}:`, expected ? error.message : error);
    const { status, message } = describeError(error);
    res.status(status).json({ success: false, error: message });
  }
});

/* -------------------------------------------------------------------------- */
/*                              SAVED SCENARIOS                               */
/* -------------------------------------------------------------------------- */

// Saved Scenarios (docs/plans/tier-2.md, S12, WP8): named scenarios every
// partner can list, open, save and delete (P2: no roles). A scenario's state
// is what partners entered, checked by checkScenario (utils/scenarioState.cjs),
// never what the departure engine derives from the book. A save names the
// version it opened; a stale one answers 409 naming who saved last and when.
// None of these routes is behind the AI limiters (T16). A failed query is
// logged by its code and message only: PostgreSQL's `detail` for a refused
// row would print the whole state, partners' notes included.
const {
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
} = scenarioState;

const NOT_FOUND = { success: false, error: 'Scenario not found.' };
const validationFailed = (details) => ({ success: false, error: 'Validation failed', details });
const failed = (res, what, error) => {
  console.error(`Error ${what}:`, error?.code, error?.message);
  res.status(500).json({ success: false, error: `Failed ${what}.` });
};

// GET /api/scenarios - every saved scenario, newest save first:
// { success, scenarios: [{ id, name, kind, current_stage, version,
//   created_by_username, updated_by_username, created_at, updated_at,
//   leaving: [{ id, name }] }] }, a leaving person's name as the People list
// has it now (null for an id no longer on it)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(LIST_SCENARIOS_SQL);
    res.json({ success: true, scenarios: rows });
  } catch (error) {
    failed(res, 'listing the scenarios', error);
  }
});

// GET /api/scenarios/:id - one scenario with its state: { success, scenario }
router.get('/:id', async (req, res) => {
  const id = readScenarioId(req.params.id);
  if (id === null) return res.status(404).json(NOT_FOUND);
  try {
    const { rows: [scenario] } = await db.query(ONE_SCENARIO_SQL, [id]);
    if (!scenario) return res.status(404).json(NOT_FOUND);
    res.json({ success: true, scenario });
  } catch (error) {
    failed(res, 'reading the scenario', error);
  }
});

// POST /api/scenarios { name, state } - 201 { success, scenario } at version 1
router.post('/', async (req, res) => {
  const details = checkScenario(req.body);
  if (details.length > 0) return res.status(400).json(validationFailed(details));
  try {
    const { rows: [scenario] } = await db.query(INSERT_SCENARIO_SQL, insertScenarioParams(req.body.name, req.body.state, req.user));
    res.status(201).json({ success: true, scenario });
  } catch (error) {
    failed(res, 'saving the scenario', error);
  }
});

// PUT /api/scenarios/:id { name, state, version } - { success, scenario } at
// the next version. The order: the body's 400 (before the id is looked up),
// then 404, then 409 when another save came first (nothing written)
router.put('/:id', async (req, res) => {
  const details = checkScenario(req.body, { update: true });
  if (details.length > 0) return res.status(400).json(validationFailed(details));
  const id = readScenarioId(req.params.id);
  if (id === null) return res.status(404).json(NOT_FOUND);
  try {
    const { name, state, version } = req.body;
    const { rows: [scenario] } = await db.query(UPDATE_SCENARIO_SQL, updateScenarioParams(id, name, state, version, req.user));
    if (scenario) return res.json({ success: true, scenario });
    const { rows: [latest] } = await db.query(LATEST_SAVE_SQL, [id]);
    if (!latest) return res.status(404).json(NOT_FOUND);
    res.status(409).json(conflictBody(latest));
  } catch (error) {
    failed(res, 'saving the scenario', error);
  }
});

// DELETE /api/scenarios/:id - { success: true }; any partner (P2)
router.delete('/:id', async (req, res) => {
  const id = readScenarioId(req.params.id);
  if (id === null) return res.status(404).json(NOT_FOUND);
  try {
    const { rows: [deleted] } = await db.query(DELETE_SCENARIO_SQL, [id]);
    if (!deleted) return res.status(404).json(NOT_FOUND);
    res.json({ success: true });
  } catch (error) {
    failed(res, 'deleting the scenario', error);
  }
});

module.exports = router;
