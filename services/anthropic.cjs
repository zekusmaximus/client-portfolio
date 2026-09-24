// services/anthropic.cjs
//
// The one place this app talks to Anthropic (docs/plans/tier-0.md, WP2 / D7).
// Every AI route calls complete(); nothing else may construct an Anthropic
// client or call messages.create. Only `model`, `max_tokens`, `system` and
// `messages` are sent: no sampling or thinking parameters, so the request shape
// is accepted by every current model on the pinned SDK (0.56.0).
// Streaming, prompt caching, refusal fallbacks and the SDK upgrade are Tier 1.

const { Anthropic } = require('@anthropic-ai/sdk');

const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16000; // thinking tokens count against this on current models
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const client = apiKey ? new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 }) : null;

function isConfigured() {
  return client !== null;
}

// Pure: turn a Messages API response into what the routes need. Current models
// can return `thinking` blocks before the answer, so the text is collected by
// block type rather than read from content[0]. Unit-tested in
// tests/ai-service.test.mjs.
function parseResponse(res) {
  const text = (res?.content || [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return {
    text,
    truncated: res?.stop_reason === 'max_tokens',
    refused: res?.stop_reason === 'refusal',
    stopReason: res?.stop_reason ?? null,
    model: res?.model ?? null,
    usage: res?.usage ?? null,
  };
}

function notConfiguredError() {
  const err = new Error('AI not configured');
  err.code = 'AI_NOT_CONFIGURED';
  return err;
}

// One Messages API call. `system` is optional; `prompt` becomes the single user
// turn. Writes one structured log line per call (success or failure) so cost
// is visible in the server log: model, token counts, duration, user id.
async function complete({ system, prompt, maxTokens = DEFAULT_MAX_TOKENS, userId, label } = {}) {
  if (!client) throw notConfiguredError();

  const started = Date.now();
  try {
    const res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    const out = parseResponse(res);
    console.log(JSON.stringify({
      event: 'ai_call',
      label,
      userId,
      model: out.model,
      stop: out.stopReason,
      inputTokens: out.usage?.input_tokens,
      outputTokens: out.usage?.output_tokens,
      ms: Date.now() - started,
    }));
    return out;
  } catch (err) {
    console.error(JSON.stringify({
      event: 'ai_error',
      label,
      userId,
      model: AI_MODEL,
      status: err?.status ?? null,
      message: err?.message,
      ms: Date.now() - started,
    }));
    throw err;
  }
}

// Map SDK errors to an HTTP status and a message a partner can act on.
function describeError(err) {
  if (err?.code === 'AI_NOT_CONFIGURED') {
    return { status: 503, message: 'AI is not configured on the server (missing API key).' };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 502, message: "The AI service rejected the server's API key." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'The AI service is rate-limiting us. Try again in a minute.' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 504, message: 'Could not reach the AI service. Try again.' };
  }
  if (err instanceof Anthropic.APIError && err.status >= 500) {
    return { status: 503, message: 'The AI service is temporarily unavailable.' };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, message: `AI request rejected (${err.status}).` };
  }
  return { status: 500, message: 'AI request failed.' };
}

module.exports = { AI_MODEL, isConfigured, complete, parseResponse, describeError };
