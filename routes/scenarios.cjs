const express = require('express');
const router = express.Router();
const db = require('../db.cjs');
const auth = require('../middleware/auth.cjs');
const { aiUserLimiter, aiGlobalLimiter } = require('../middleware/rateLimit.cjs');
const { handleValidationErrors, sanitizeRequestBody } = require('../middleware/validation.cjs');
const { AI_MODEL, complete, describeError } = require('../services/anthropic.cjs');
const { answerRow } = require('../utils/aiAnswers.cjs');
const { saveAnswer } = require('../models/aiAnswerModel.cjs');
const {
  checkPlanRequest,
  checkRoster,
  departingNames,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
} = require('../utils/transitionPlan.cjs');

// Apply middleware: auth first, then the AI budgets (D11) shared with routes/ai.cjs
router.use(auth);
router.use(aiUserLimiter);
router.use(aiGlobalLimiter);
router.use(sanitizeRequestBody);

/* -------------------------------------------------------------------------- */
/*                         PER-CLIENT TRANSITION PLAN                         */
/* -------------------------------------------------------------------------- */

// POST /api/scenarios/transition-plan
// Body: { client: <one affected client from Stage 1>,
//         stage1Data: { departing: [{ name, role }], impactData, reportingYear },
//         roster: [{ name, role, lead: { count, revenue, effort }, second: {...} }] }
// One request per client (docs/plans/tier-0.md, D9): the succession workflow
// runs these with concurrency 2 and shows progress, instead of one bulk request
// that would outlive any proxy timeout on a current model. The roster is the
// people staying, with the loads the page's partnershipModel computes
// (docs/plans/people-and-second-chair.md, Phase 5); every name is checked
// against the People list before anything goes to the model, and the plan's
// recommended lead and second chair are resolved against it.
//
// The plan is saved (docs/plans/tier-1.md, WP4, T12) as a 'transition-plan'
// answer with the client's id as text and its name with the request
// sanitizer's escaping undone. The response keeps its shape (T14) and adds
// answerId and saved beside plan: a failed save returns the plan with
// saved: false and answerId null, never an error.
router.post('/transition-plan', handleValidationErrors, async (req, res) => {
  const { client, stage1Data, roster } = req.body || {};
  const refusal = checkPlanRequest(req.body);
  if (refusal) {
    return res.status(400).json({ success: false, error: refusal });
  }

  let checked;
  try {
    const { rows: people } = await db.query('SELECT id, name, role, active FROM people');
    checked = checkRoster(roster, people, departingNames(stage1Data));
  } catch (error) {
    console.error('Error reading the People list for a transition plan:', error);
    return res.status(500).json({ success: false, error: 'Failed to read the People list.' });
  }
  if (checked.errors.length > 0) {
    return res.status(400).json({ success: false, error: checked.errors.join(' '), errors: checked.errors });
  }

  try {
    const { system, prompt } = createTransitionPlanPrompt(client, stage1Data, checked.roster);
    const started = Date.now();
    const result = await complete({
      system,
      prompt,
      maxTokens: 8000,
      userId: req.user.userId,
      label: 'transition-plan',
    });
    const { id: answerId, saved } = await saveAnswer(answerRow({
      kind: 'transition-plan',
      client,
      user: req.user,
      result,
      reportingYear: stage1Data.reportingYear,
      durationMs: Date.now() - started,
      model: AI_MODEL,
    }), { label: 'transition-plan', userId: req.user.userId });
    const parsed = parseTransitionPlanResponse(result.text, client, checked.roster);

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
    // A missing key or an API status error is already described by the ai_error
    // log line; keep the stack trace for unexpected failures only.
    const expected = error?.code === 'AI_NOT_CONFIGURED' || typeof error?.status === 'number';
    console.error(`Error generating transition plan for client ${client.id}:`, expected ? error.message : error);
    const { status, message } = describeError(error);
    res.status(status).json({ success: false, error: message });
  }
});

module.exports = router;
