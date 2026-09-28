const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { aiUserLimiter, aiGlobalLimiter } = require('../middleware/rateLimit.cjs');
const { trimRequestBody } = require('../middleware/validation.cjs');
const { AI_MODEL, complete, describeError } = require('../services/anthropic.cjs');
const { answerRow } = require('../utils/aiAnswers.cjs');
const { saveAnswer } = require('../models/aiAnswerModel.cjs');
const { loadBook } = require('../models/bookModel.cjs');
const {
  checkPlanRequest,
  checkRoster,
  departingNames,
  bookClient,
  createTransitionPlanPrompt,
  parseTransitionPlanResponse,
} = require('../utils/transitionPlan.cjs');

// Apply middleware: auth first, then the AI budgets (D11) shared with routes/ai.cjs
router.use(auth);
router.use(aiUserLimiter);
router.use(aiGlobalLimiter);
// Every string trimmed, as the request sanitizer trimmed it until WP5, and not
// escaped (docs/plans/tier-2.md, S8)
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
// page sent. Only the page's succession metrics (successionRisk,
// transitionComplexity, relationshipType) and the scenario (who is leaving,
// the revenue at risk) come from the request. The response is unchanged, so
// the page needs no change and no feature name.
//
// The plan is saved (WP4, T12) as a 'transition-plan' answer with the
// client's id as text, its name unescaped (unescapeStored: the name the page
// sends is the stored one, which is escaped if the form saved it before WP5),
// the book's hash and its reporting year. The response keeps its shape (T14)
// and adds answerId and saved beside plan: a failed save returns the plan
// with saved: false and answerId null, never an error.
router.post('/transition-plan', async (req, res) => {
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
    const { system, prompt } = createTransitionPlanPrompt(client, stage1Data, checked.roster, book, { today: now });
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

module.exports = router;
