// services/anthropic.cjs
//
// The one place this app talks to Anthropic (docs/plans/tier-1.md T1, from
// Tier 0's WP2 and D7). Every AI route calls complete(); nothing else may
// construct an Anthropic client or call the Messages API, and
// tests/ai-grep.test.mjs fails if anything does.
//
// The request carries model, max_tokens, system and one user turn, streamed
// (client.beta.messages.stream, then finalMessage()); plus, only on the models
// in FALLBACK_MODELS, the server-side refusal fallback (T10); plus, only when
// AI_EFFORT is set, output_config.effort (T11). Nothing else: no sampling
// parameters, no thinking configuration (the current model thinks by default,
// and max_tokens caps the thinking and the answer together), no tools, no
// prefill.
//
// createService() builds one service. The module exports the default
// instance, built from the environment when the server starts, so require()
// works as it always has; tests build their own with a fake fetch
// (tests/ai-service.test.mjs), and local end-to-end runs point
// ANTHROPIC_BASE_URL at tests/helpers/fakeAnthropic.mjs. In production the
// address is always https://api.anthropic.com, whatever ANTHROPIC_BASE_URL
// says (T17), so a stray variable on Render cannot send the key elsewhere.
//
// Timeout: TIMEOUT_MS bounds the wait for an answer to start, not the whole
// answer. The SDK arms its timer around fetch() only, and a streamed answer's
// body is read after fetch() resolves. Checked on SDK 0.128.0 and Node 22.22.2
// with Node's own fetch against a local server, timeout 500 ms: an answer
// whose headers came at once and whose events took 1.8 s completed on the
// first attempt; a server that held its headers for 2 s failed with
// APIConnectionTimeoutError after three attempts (the first and maxRetries' 2).
// tests/ai-service.test.mjs keeps the first case.

const { Anthropic } = require('@anthropic-ai/sdk');
const { callCost, normalizeUsage, PRICES_READ_ON } = require('../utils/aiCost.cjs');

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16000; // thinking tokens count against this on current models
const TIMEOUT_MS = 180_000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com';

// The effort levels output_config.effort accepts; unset means the API's
// default (high on claude-opus-5).
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Models that get the server-side refusal fallback (T10). The claude-api
// skill documents "default" routing for claude-opus-5, not for
// claude-sonnet-5, so other models run without it and a refusal shows as one.
const FALLBACK_MODELS = ['claude-opus-5'];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// AI_EFFORT, read once. Unset or blank means none; anything else must be one
// of EFFORT_LEVELS, or the server stops at start with this message, as an
// invalid DATABASE_SSL stops it (db.cjs).
function readEffort(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const effort = String(value).trim().toLowerCase();
  if (!EFFORT_LEVELS.includes(effort)) {
    throw new Error(`AI_EFFORT must be low, medium, high, xhigh or max (got ${JSON.stringify(value)})`);
  }
  return effort;
}

function notConfiguredError() {
  const err = new Error('AI not configured');
  err.code = 'AI_NOT_CONFIGURED';
  return err;
}

// Pure: turn a Messages API message into what the routes need. Text is
// collected by block type: current models return `thinking` blocks before the
// answer, and a served fallback adds a `fallback` block where one model
// handed over to the next. The text after that block continues the text
// before it, so the two are joined with nothing between them; other text
// blocks are joined with a line break. A refusal nothing rescued returns empty
// text, whatever was streamed before it (T10), and its category.
//
// servedBy is the model that produced the message; fellBack says a fallback
// attempt ran (a fallback_message entry in usage.iterations, which also marks
// a turn sticky routing sent straight to the fallback model).
// declinedCategories lists each declined attempt's category in order, for
// callCost. tokens are the normalised counts; usage stays the raw object the
// routes return.
function parseResponse(res) {
  const content = Array.isArray(res?.content) ? res.content : [];
  const stopReason = res?.stop_reason ?? null;
  const refused = stopReason === 'refusal';
  const usage = res?.usage ?? null;
  const model = res?.model ?? null;

  let text = '';
  let hasText = false;
  let handedOver = false;
  const declinedCategories = [];
  for (const block of content) {
    if (block?.type === 'fallback') {
      handedOver = true;
      declinedCategories.push(block.trigger?.category ?? null);
      continue;
    }
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    if (hasText && !handedOver) text += '\n';
    text += block.text;
    hasText = true;
    handedOver = false;
  }

  const refusalCategory = refused ? (res?.stop_details?.category ?? null) : null;
  if (refused) declinedCategories.push(refusalCategory);
  const iterations = Array.isArray(usage?.iterations) ? usage.iterations : [];

  return {
    text: refused ? '' : text.trim(),
    truncated: stopReason === 'max_tokens',
    refused,
    refusalCategory,
    stopReason,
    model,
    servedBy: model,
    fellBack: iterations.some((entry) => entry?.type === 'fallback_message'),
    declinedCategories,
    tokens: normalizeUsage(usage, model),
    usage,
  };
}

const RATE_LIMITED = { status: 429, message: 'The AI service is rate-limiting us. Try again in a minute.' };
const UNAVAILABLE = { status: 503, message: 'The AI service is temporarily unavailable.' };

// Map SDK errors to an HTTP status and a message a partner can act on. An
// `error` event in the middle of a stream arrives as an APIError with no
// status and the error's `type` (checked on 0.128.0: overloaded_error), so
// those are mapped by type.
function describeError(err) {
  if (err?.code === 'AI_NOT_CONFIGURED') {
    return { status: 503, message: 'AI is not configured on the server (missing API key).' };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 502, message: "The AI service rejected the server's API key." };
  }
  if (err instanceof Anthropic.RateLimitError) return RATE_LIMITED;
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 504, message: 'Could not reach the AI service. Try again.' };
  }
  if (err instanceof Anthropic.APIError && typeof err.status !== 'number') {
    const type = err.type ?? err.error?.error?.type ?? null;
    if (type === 'rate_limit_error') return RATE_LIMITED;
    if (type === 'overloaded_error' || type === 'api_error') return UNAVAILABLE;
    if (type) return { status: 502, message: `AI request rejected (${type}).` };
    return { status: 500, message: 'AI request failed.' };
  }
  if (err instanceof Anthropic.APIError && err.status >= 500) return UNAVAILABLE;
  if (err instanceof Anthropic.APIError) {
    return { status: 502, message: `AI request rejected (${err.status}).` };
  }
  return { status: 500, message: 'AI request failed.' };
}

/**
 * One AI service. `apiKey` absent means not configured: complete() then fails
 * at once with AI_NOT_CONFIGURED and sends nothing. `effort` is AI_EFFORT's
 * raw value (validated here). `fetch` and `baseURL` are for tests and local
 * runs; `baseURL` undefined lets the SDK read ANTHROPIC_BASE_URL, and in
 * production both are overridden by Anthropic's own address. `timeout` is for
 * the timeout test only.
 */
function createService({ apiKey, model = DEFAULT_MODEL, effort: effortSetting, fetch, baseURL, timeout = TIMEOUT_MS } = {}) {
  const effort = readEffort(effortSetting);
  const fallbacks = FALLBACK_MODELS.includes(model);

  let clientBaseURL = baseURL;
  if (process.env.NODE_ENV === 'production') {
    if (baseURL || process.env.ANTHROPIC_BASE_URL) {
      console.warn(JSON.stringify({
        event: 'anthropic_base_url_ignored',
        message: `ANTHROPIC_BASE_URL is ignored in production; AI calls go to ${ANTHROPIC_API_URL}.`,
      }));
    }
    clientBaseURL = ANTHROPIC_API_URL;
  }

  // authToken: null sends only the API key, whatever ANTHROPIC_AUTH_TOKEN says.
  const client = apiKey
    ? new Anthropic({ apiKey, authToken: null, baseURL: clientBaseURL, fetch, timeout, maxRetries: 2 })
    : null;

  function isConfigured() {
    return client !== null;
  }

  // One Messages API call. `system` is optional: a string, or text blocks
  // ({ type: 'text', text, cache_control? }) passed through unchanged.
  // `prompt` becomes the single user turn. `onText`, when given, receives
  // each piece of the answer's text as it streams; an error it throws is
  // logged once and never stops the call (T15). Writes one structured log line
  // per call, success or failure, so cost is visible in the server log.
  async function complete({ system, prompt, maxTokens = DEFAULT_MAX_TOKENS, userId, label, onText } = {}) {
    if (!client) throw notConfiguredError();

    const started = Date.now();
    try {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
        ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
        ...(effort ? { output_config: { effort } } : {}),
      });

      if (typeof onText === 'function') {
        let failed = false;
        stream.on('text', (delta) => {
          if (failed) return;
          try {
            onText(delta);
          } catch (err) {
            failed = true;
            console.error(JSON.stringify({ event: 'ai_on_text_error', label, userId, message: err?.message }));
          }
        });
      }

      const message = await stream.finalMessage();
      const out = parseResponse(message);
      const cost = callCost(out.usage, out.servedBy, { declined: out.declinedCategories });
      if (cost.unknownModels.length > 0) {
        console.warn(JSON.stringify({ event: 'ai_cost_unknown_model', label, models: cost.unknownModels, pricesReadOn: PRICES_READ_ON }));
      }

      console.log(JSON.stringify({
        event: 'ai_call',
        label,
        userId,
        model,
        servedBy: out.servedBy,
        fellBack: out.fellBack,
        stop: out.stopReason,
        refusalCategory: out.refusalCategory,
        inputTokens: out.tokens.inputTokens,
        outputTokens: out.tokens.outputTokens,
        cacheReadTokens: out.tokens.cacheReadTokens,
        cacheWriteTokens: out.tokens.cacheWrite5mTokens + out.tokens.cacheWrite1hTokens,
        costUsd: cost.usd,
        ms: Date.now() - started,
      }));
      return { ...out, costUsd: cost.usd, pricesReadOn: PRICES_READ_ON };
    } catch (err) {
      console.error(JSON.stringify({
        event: 'ai_error',
        label,
        userId,
        model,
        status: err?.status ?? null,
        type: err?.type ?? null,
        message: err?.message,
        ms: Date.now() - started,
      }));
      throw err;
    }
  }

  return { AI_MODEL: model, isConfigured, complete };
}

const service = createService({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
  model: process.env.AI_MODEL || DEFAULT_MODEL,
  effort: process.env.AI_EFFORT,
});

module.exports = {
  AI_MODEL: service.AI_MODEL,
  isConfigured: service.isConfigured,
  complete: service.complete,
  createService,
  parseResponse,
  describeError,
  readEffort,
  EFFORT_LEVELS,
  FALLBACK_MODELS,
};
