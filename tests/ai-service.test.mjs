// services/anthropic.cjs (docs/plans/tier-0.md, WP2 5.3): responses are read
// by content-block type, truncation and refusals are flagged, and SDK errors
// map to a status and a message a partner can act on. The service reads the
// API key at load time; without one, complete() must fail fast. Never import
// db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ai from '../services/anthropic.cjs';

// The service loads the SDK's CommonJS build. Load the same copy here so the
// instanceof checks in describeError see the same classes; the package's ESM
// entry is a separate build with its own class identities.
const require = createRequire(import.meta.url);
const { Anthropic } = require('@anthropic-ai/sdk');

const { AI_MODEL, isConfigured, complete, parseResponse, describeError } = ai;

// SDK 0.56.0 error constructors take (status, error, message, headers) and
// call headers.get(), so a real Headers instance is required; the plain `{}`
// suggested in the plan throws at construction time.
const headers = () => new Headers();

test('AI_MODEL defaults to claude-opus-5 unless AI_MODEL is set in the environment', () => {
  assert.equal(AI_MODEL, process.env.AI_MODEL || 'claude-opus-5');
});

test('parseResponse: [thinking, text] blocks return only the text', () => {
  const out = parseResponse({
    content: [
      { type: 'thinking', thinking: 'internal reasoning' },
      { type: 'text', text: '## EXECUTIVE SUMMARY\nAll good.' },
    ],
    stop_reason: 'end_turn',
    model: 'claude-opus-5',
    usage: { input_tokens: 120, output_tokens: 40 },
  });
  assert.equal(out.text, '## EXECUTIVE SUMMARY\nAll good.');
  assert.equal(out.truncated, false);
  assert.equal(out.refused, false);
  assert.equal(out.stopReason, 'end_turn');
  assert.equal(out.model, 'claude-opus-5');
  assert.deepEqual(out.usage, { input_tokens: 120, output_tokens: 40 });
});

test('parseResponse: several text blocks are joined and trimmed; non-text blocks are ignored', () => {
  const out = parseResponse({
    content: [
      { type: 'text', text: '  First part.' },
      { type: 'tool_use', id: 'x', name: 'noop', input: {} },
      { type: 'text', text: 'Second part.\n\n' },
    ],
    stop_reason: 'end_turn',
  });
  assert.equal(out.text, 'First part.\nSecond part.');
});

test("parseResponse: stop_reason 'max_tokens' sets truncated", () => {
  const out = parseResponse({ content: [{ type: 'text', text: 'cut off mid' }], stop_reason: 'max_tokens' });
  assert.equal(out.truncated, true);
  assert.equal(out.refused, false);
  assert.equal(out.text, 'cut off mid');
});

test("parseResponse: stop_reason 'refusal' sets refused", () => {
  const out = parseResponse({ content: [], stop_reason: 'refusal' });
  assert.equal(out.refused, true);
  assert.equal(out.truncated, false);
  assert.equal(out.text, '');
});

test('parseResponse: empty or missing content yields an empty string, never a throw', () => {
  assert.equal(parseResponse({ content: [] }).text, '');
  assert.equal(parseResponse({}).text, '');
  assert.equal(parseResponse(undefined).text, '');
  assert.equal(parseResponse({}).stopReason, null);
  assert.equal(parseResponse({}).usage, null);
});

test('describeError: AI_NOT_CONFIGURED maps to 503 with the "not configured" message', () => {
  const err = new Error('AI not configured');
  err.code = 'AI_NOT_CONFIGURED';
  assert.deepEqual(describeError(err), {
    status: 503,
    message: 'AI is not configured on the server (missing API key).',
  });
});

test('describeError: RateLimitError maps to 429', () => {
  const err = new Anthropic.RateLimitError(429, { error: { type: 'rate_limit_error' } }, 'rate limited', headers());
  assert.equal(describeError(err).status, 429);
  assert.match(describeError(err).message, /rate-limiting/);
});

test('describeError: AuthenticationError maps to 502 (bad server key)', () => {
  const err = new Anthropic.AuthenticationError(401, { error: { type: 'authentication_error' } }, 'invalid x-api-key', headers());
  assert.equal(describeError(err).status, 502);
  assert.match(describeError(err).message, /API key/);
});

test('describeError: connection errors and timeouts map to 504', () => {
  const conn = new Anthropic.APIConnectionError({ message: 'socket hang up' });
  const timeout = new Anthropic.APIConnectionTimeoutError({ message: 'timed out' });
  assert.equal(describeError(conn).status, 504);
  assert.equal(describeError(timeout).status, 504);
});

test('describeError: 5xx from the API (including 529 overloaded) maps to 503', () => {
  const internal = new Anthropic.InternalServerError(500, { error: { type: 'api_error' } }, 'internal', headers());
  const overloaded = Anthropic.APIError.generate(529, { error: { type: 'overloaded_error' } }, 'Overloaded', headers());
  assert.equal(describeError(internal).status, 503);
  assert.equal(describeError(overloaded).status, 503);
});

test('describeError: other API rejections map to 502 and name the status', () => {
  const bad = new Anthropic.BadRequestError(400, { error: { type: 'invalid_request_error' } }, 'bad request', headers());
  const missing = new Anthropic.NotFoundError(404, { error: { type: 'not_found_error' } }, 'model not found', headers());
  assert.deepEqual(describeError(bad), { status: 502, message: 'AI request rejected (400).' });
  assert.deepEqual(describeError(missing), { status: 502, message: 'AI request rejected (404).' });
});

test('describeError: anything else is a plain 500', () => {
  assert.deepEqual(describeError(new Error('boom')), { status: 500, message: 'AI request failed.' });
  assert.deepEqual(describeError(undefined), { status: 500, message: 'AI request failed.' });
});

test(
  'complete() without an API key rejects with AI_NOT_CONFIGURED before any request',
  { skip: isConfigured() ? 'an Anthropic key is set in this environment' : false },
  async () => {
    await assert.rejects(complete({ prompt: 'hello', label: 'test' }), (err) => err.code === 'AI_NOT_CONFIGURED');
  }
);
