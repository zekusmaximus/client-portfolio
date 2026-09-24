const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { aiUserLimiter, aiGlobalLimiter } = require('../middleware/rateLimit.cjs');
const { handleValidationErrors, sanitizeRequestBody } = require('../middleware/validation.cjs');
const { complete, describeError } = require('../services/anthropic.cjs');
const { createTransitionPlanPrompt, parseTransitionPlanResponse } = require('../utils/transitionPlan.cjs');

// Apply middleware: auth first, then the AI budgets (D11) shared with claude.cjs
router.use(auth);
router.use(aiUserLimiter);
router.use(aiGlobalLimiter);
router.use(sanitizeRequestBody);

/* -------------------------------------------------------------------------- */
/*                         PER-CLIENT TRANSITION PLAN                         */
/* -------------------------------------------------------------------------- */

// POST /api/scenarios/transition-plan
// Body: { client: <one affected client from Stage 1>, stage1Data: { selectedPartners, impactData } }
// One request per client (docs/plans/tier-0.md, D9): the succession workflow
// runs these with concurrency 2 and shows progress, instead of one bulk request
// that would outlive any proxy timeout on a current model.
router.post('/transition-plan', handleValidationErrors, async (req, res) => {
  const { client, stage1Data } = req.body || {};

  if (!client || typeof client.id !== 'string' || typeof client.name !== 'string') {
    return res.status(400).json({ success: false, error: 'client.id and client.name (strings) are required' });
  }
  if (!stage1Data || typeof stage1Data !== 'object' || Array.isArray(stage1Data)) {
    return res.status(400).json({ success: false, error: 'stage1Data (object) is required' });
  }

  try {
    const { system, prompt } = createTransitionPlanPrompt(client, stage1Data);
    const result = await complete({
      system,
      prompt,
      maxTokens: 8000,
      userId: req.user.userId,
      label: 'transition-plan',
    });
    const parsed = parseTransitionPlanResponse(result.text, client);

    res.json({
      success: true,
      plan: {
        clientId: client.id,
        clientName: client.name,
        ...parsed,
        truncated: result.truncated,
        refused: result.refused,
      },
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
