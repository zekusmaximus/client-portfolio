// services/anthropic.cjs (docs/plans/tier-1.md, WP1): the real SDK, driven
// through createService({ apiKey: 'test', fetch }) by recorded streams in
// tests/fixtures/anthropic/, so every answer here is parsed by the SDK exactly
// as it parses Anthropic's. Each test checks the request the SDK sent as well
// as what the service returned. No test uses a real key or reaches the
// network: fakeFetch answers in process, and the timeout test uses a server on
// 127.0.0.1. Never import db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ai from '../services/anthropic.cjs';
import { fakeFetch, startFakeAnthropic, streamedText } from './helpers/fakeAnthropic.mjs';

// The service loads the SDK's CommonJS build. Load the same copy here so the
// instanceof checks in describeError see the same classes; the package's ESM
// entry is a separate build with its own class identities.
const require = createRequire(import.meta.url);
const { Anthropic } = require('@anthropic-ai/sdk');

const { AI_MODEL, isConfigured, complete, createService, parseResponse, describeError, readEffort } = ai;
const repo = fileURLToPath(new URL('..', import.meta.url));

// The SDK's error constructors take (status, error, message, headers, type)
// and read headers?.get(), so headers must be a Headers instance (or absent).
const headers = () => new Headers();

// Runs fn with console.log/warn/error captured; returns the JSON lines.
async function captureLogs(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...args) => {
    try { lines.push(JSON.parse(args[0])); } catch { lines.push({ text: args.join(' ') }); }
  };
  console.log = grab;
  console.warn = grab;
  console.error = grab;
  try {
    const result = await fn();
    return { result, lines };
  } catch (error) {
    return { error, lines };
  } finally {
    Object.assign(console, saved);
  }
}

// A service for `model` answering from `queue`, and its recorded requests.
function serviceWith(queue, options = {}) {
  const fake = fakeFetch(queue);
  const service = createService({ apiKey: 'test', fetch: fake.fetch, ...options });
  return { service, requests: fake.requests };
}

async function withEnv(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const SYSTEM_BLOCKS = [
  { type: 'text', text: 'You answer questions about the book.' },
  { type: 'text', text: 'THE BOOK\n...', cache_control: { type: 'ephemeral' } },
];

// ------------------------------------------------------------- the module ---

test('AI_MODEL defaults to claude-opus-5 unless AI_MODEL is set in the environment', () => {
  assert.equal(AI_MODEL, process.env.AI_MODEL || 'claude-opus-5');
});

test('the module exports the default instance and the factory', () => {
  assert.equal(typeof isConfigured, 'function');
  assert.equal(typeof complete, 'function');
  assert.equal(typeof createService, 'function');
  assert.equal(typeof parseResponse, 'function');
  assert.equal(typeof describeError, 'function');
});

// ---------------------------------------------------------------- answers ---

test('a thinking block then text: the text only, with tokens, cost and the ai_call line', async () => {
  const { service, requests } = serviceWith(['text-with-thinking.sse']);
  const { result, lines } = await captureLogs(() => service.complete({ system: 'Persona.', prompt: 'Who carries the most?', userId: 7, label: 'test' }));

  assert.equal(result.text, '## EXECUTIVE SUMMARY\nMike leads six clients and carries the heaviest book.');
  assert.equal(result.truncated, false);
  assert.equal(result.refused, false);
  assert.equal(result.refusalCategory, null);
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.model, 'claude-opus-5');
  assert.equal(result.servedBy, 'claude-opus-5');
  assert.equal(result.fellBack, false);
  assert.equal(result.usage.input_tokens, 1850, 'the raw usage is kept for the routes');
  assert.deepEqual(
    { ...result.tokens, iterations: undefined },
    { inputTokens: 1850, outputTokens: 420, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, iterations: undefined },
  );
  assert.equal(result.costUsd, 0.01975); // 1,850 x $5 + 420 x $25, per million
  assert.equal(result.pricesReadOn, '2026-09-26');

  const call = lines.find((line) => line.event === 'ai_call');
  assert.deepEqual(
    { ...call, ms: undefined },
    {
      event: 'ai_call', label: 'test', userId: 7, model: 'claude-opus-5', servedBy: 'claude-opus-5', fellBack: false,
      stop: 'end_turn', refusalCategory: null, inputTokens: 1850, outputTokens: 420, cacheReadTokens: 0,
      cacheWriteTokens: 0, costUsd: 0.01975, ms: undefined,
    },
  );
  assert.equal(typeof call.ms, 'number');
  assert.equal(lines.filter((line) => line.event === 'ai_call').length, 1);

  const [request] = requests;
  assert.equal(request.method, 'POST');
  assert.equal(new URL(request.url).pathname, '/v1/messages');
  assert.equal(request.headers['x-api-key'], 'test');
  assert.equal(request.headers.authorization, undefined, 'only the API key is sent');
  assert.equal(request.body.system, 'Persona.');
  assert.deepEqual(request.body.messages, [{ role: 'user', content: 'Who carries the most?' }]);
});

test("stop_reason 'max_tokens' sets truncated and keeps the text", async () => {
  const { service } = serviceWith(['max-tokens.sse']);
  const { result } = await captureLogs(() => service.complete({ prompt: 'x' }));
  assert.equal(result.truncated, true);
  assert.equal(result.refused, false);
  assert.equal(result.text, 'The heaviest lead book belongs to');
});

test('a refusal before any output: refused, empty text and the category; not billed for cyber', async () => {
  const { service } = serviceWith(['refusal-before-output.sse']);
  const { result, lines } = await captureLogs(() => service.complete({ prompt: 'x', label: 'test' }));
  assert.equal(result.refused, true);
  assert.equal(result.text, '');
  assert.equal(result.refusalCategory, 'cyber');
  assert.equal(result.truncated, false);
  assert.equal(result.costUsd, 0);
  const call = lines.find((line) => line.event === 'ai_call');
  assert.equal(call.stop, 'refusal');
  assert.equal(call.refusalCategory, 'cyber');
});

test('a refusal mid-stream without a fallback: the streamed text is discarded', async () => {
  const { service, requests } = serviceWith(['refusal-mid-stream.sse'], { model: 'claude-sonnet-5' });
  const deltas = [];
  const { result } = await captureLogs(() => service.complete({ prompt: 'x', onText: (d) => deltas.push(d) }));
  assert.deepEqual(deltas, ['Here is the first part ', 'of an answer that'], 'the partial did stream');
  assert.equal(result.refused, true);
  assert.equal(result.text, '');
  assert.equal(result.refusalCategory, 'general_harms');
  assert.equal(result.costUsd, 0.00385, 'a refusal after output bills at normal rates (1,850 x $2 + 15 x $10)');
  assert.equal(requests[0].body.fallbacks, undefined);
});

test('a fallback mid-stream: one continuous text, served by the fallback model, fellBack', async () => {
  const { service } = serviceWith(['fallback-mid-stream.sse']);
  const deltas = [];
  const { result, lines } = await captureLogs(() => service.complete({ prompt: 'x', onText: (d) => deltas.push(d) }));
  assert.equal(result.text, 'Mike leads six clients and carries the heaviest lead book.');
  assert.equal(result.refused, false);
  assert.equal(result.servedBy, 'claude-opus-4-8');
  assert.equal(result.fellBack, true);
  assert.deepEqual(deltas, ['Mike leads six clients ', 'and ', 'carries the heaviest ', 'lead book.']);
  assert.equal(result.tokens.inputTokens, 1850 + 1862, 'summed over both attempts');
  assert.deepEqual(result.tokens.iterations.map((a) => a.model), ['claude-opus-5', 'claude-opus-4-8']);
  // Each attempt at its own model's price; the declined one had output, so it is billed.
  assert.equal(result.costUsd, 0.01961);
  const call = lines.find((line) => line.event === 'ai_call');
  assert.equal(call.model, 'claude-opus-5', 'the model requested');
  assert.equal(call.servedBy, 'claude-opus-4-8');
  assert.equal(call.fellBack, true);
});

test('a fallback before any output: the fallback answer, and the declined attempt is not billed', async () => {
  const { service } = serviceWith(['fallback-before-output.sse']);
  const { result } = await captureLogs(() => service.complete({ prompt: 'x' }));
  assert.equal(result.text, 'Paula is the natural home for a healthcare client.');
  assert.equal(result.servedBy, 'claude-opus-4-8');
  assert.equal(result.fellBack, true);
  assert.equal(result.costUsd, 0.00866); // 412 x $5 + 264 x $25 on claude-opus-4-8 only
});

test('every model in the fallback chain declined: refused, empty text, the category, fellBack', async () => {
  const { service } = serviceWith(['fallback-refused.sse']);
  const { result } = await captureLogs(() => service.complete({ prompt: 'x' }));
  assert.equal(result.refused, true);
  assert.equal(result.text, '');
  assert.equal(result.refusalCategory, 'cyber');
  assert.equal(result.fellBack, true);
  assert.equal(result.costUsd, 0);
});

test('cache writes: counted by lifetime, priced at 1.25x, and in the ai_call line', async () => {
  const { service } = serviceWith(['cache-write.sse']);
  const { result, lines } = await captureLogs(() => service.complete({ system: SYSTEM_BLOCKS, prompt: 'x' }));
  assert.equal(result.tokens.cacheWrite5mTokens, 12000);
  assert.equal(result.tokens.cacheWrite1hTokens, 0);
  assert.equal(result.costUsd, 0.0978); // 60 x $5 + 900 x $25 + 12,000 x $6.25
  const call = lines.find((line) => line.event === 'ai_call');
  assert.equal(call.cacheWriteTokens, 12000);
  assert.equal(call.cacheReadTokens, 0);
});

test('a model without a price: costUsd null and an ai_cost_unknown_model line', async () => {
  const sse = streamedText('An answer.', { model: 'claude-future-9' }).join('');
  const { service } = serviceWith([{ sse }], { model: 'claude-future-9' });
  const { result, lines } = await captureLogs(() => service.complete({ prompt: 'x', label: 'test' }));
  assert.equal(result.costUsd, null);
  assert.deepEqual(lines.find((line) => line.event === 'ai_cost_unknown_model')?.models, ['claude-future-9']);
  assert.equal(lines.find((line) => line.event === 'ai_call').costUsd, null);
});

test('onText receives every text delta in order, and never a thinking delta', async () => {
  const { service } = serviceWith(['text-with-thinking.sse']);
  const deltas = [];
  await captureLogs(() => service.complete({ prompt: 'x', onText: (d) => deltas.push(d) }));
  assert.deepEqual(deltas, ['## EXECUTIVE SUMMARY\n', 'Mike leads six clients ', 'and carries the heaviest book.']);
});

test('an onText that throws is logged once and the answer still completes (T15)', async () => {
  const { service } = serviceWith(['text-with-thinking.sse']);
  let calls = 0;
  const { result, lines } = await captureLogs(() => service.complete({
    prompt: 'x',
    label: 'test',
    onText: () => { calls += 1; throw new Error('the page went away'); },
  }));
  assert.equal(result.text, '## EXECUTIVE SUMMARY\nMike leads six clients and carries the heaviest book.');
  assert.equal(calls, 1);
  assert.equal(lines.filter((line) => line.event === 'ai_on_text_error').length, 1);
});

// ---------------------------------------------------------------- request ---

test('the request on claude-opus-5: streamed, system blocks unchanged, the fallback beta and "default", nothing else', async () => {
  const { service, requests } = serviceWith(['text-with-thinking.sse'], { model: 'claude-opus-5' });
  await captureLogs(() => service.complete({ system: SYSTEM_BLOCKS, prompt: 'Is Mike overloaded?', maxTokens: 32000 }));
  const [{ body, headers: sent }] = requests;
  assert.deepEqual(body, {
    model: 'claude-opus-5',
    max_tokens: 32000,
    system: SYSTEM_BLOCKS,
    messages: [{ role: 'user', content: 'Is Mike overloaded?' }],
    fallbacks: 'default',
    stream: true,
  });
  assert.equal(sent['anthropic-beta'], 'server-side-fallback-2026-07-01');
  for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tools', 'tool_choice', 'output_config', 'betas']) {
    assert.equal(key in body, false, `${key} is not sent`);
  }
});

test('the request on claude-sonnet-5: no fallback and no beta header', async () => {
  const { service, requests } = serviceWith(['text-with-thinking.sse'], { model: 'claude-sonnet-5' });
  await captureLogs(() => service.complete({ prompt: 'x' }));
  const [{ body, headers: sent }] = requests;
  assert.deepEqual(body, { model: 'claude-sonnet-5', max_tokens: 16000, messages: [{ role: 'user', content: 'x' }], stream: true });
  assert.equal(sent['anthropic-beta'], undefined);
});

test('output_config.effort is sent only when an effort is set', async () => {
  const withEffort = serviceWith(['text-with-thinking.sse'], { effort: 'medium' });
  await captureLogs(() => withEffort.service.complete({ prompt: 'x' }));
  assert.deepEqual(withEffort.requests[0].body.output_config, { effort: 'medium' });

  const without = serviceWith(['text-with-thinking.sse'], { effort: '' });
  await captureLogs(() => without.service.complete({ prompt: 'x' }));
  assert.equal('output_config' in without.requests[0].body, false);
});

test('AI_EFFORT: blank is none, case and spaces are forgiven, anything else is refused naming the five values', () => {
  assert.equal(readEffort(undefined), null);
  assert.equal(readEffort(''), null);
  assert.equal(readEffort('  '), null);
  assert.equal(readEffort(' XHigh '), 'xhigh');
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(readEffort(level), level);
  assert.throws(() => readEffort('turbo'), /AI_EFFORT must be low, medium, high, xhigh or max \(got "turbo"\)/);
  assert.throws(() => createService({ apiKey: 'test', effort: 'extreme' }), /AI_EFFORT must be/);
});

test('an invalid AI_EFFORT stops server.cjs at start with the message', async () => {
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: repo,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      DATABASE_SSL: 'false',
      JWT_SECRET: 'a'.repeat(64),
      AI_EFFORT: 'turbo',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve('still running'); }, 15000);
    child.once('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
  });
  assert.notEqual(code, 0, output);
  assert.notEqual(code, 'still running', output);
  assert.match(output, /AI_EFFORT must be low, medium, high, xhigh or max \(got "turbo"\)/);
  assert.doesNotMatch(output, /Server running on port/);
});

// ---------------------------------------------------------------- address ---

test('outside production, ANTHROPIC_BASE_URL is honoured (the fake server for local runs)', async () => {
  await withEnv({ NODE_ENV: 'development', ANTHROPIC_BASE_URL: 'http://127.0.0.1:5099' }, async () => {
    const { service, requests } = serviceWith(['text-with-thinking.sse']);
    await captureLogs(() => service.complete({ prompt: 'x' }));
    assert.equal(new URL(requests[0].url).origin, 'http://127.0.0.1:5099');
  });
});

test('in production, the address is Anthropic\'s whatever ANTHROPIC_BASE_URL or baseURL say, with a warning', async () => {
  await withEnv({ NODE_ENV: 'production', ANTHROPIC_BASE_URL: 'http://127.0.0.1:5099' }, async () => {
    const fromEnv = fakeFetch(['text-with-thinking.sse']);
    const built = await captureLogs(() => createService({ apiKey: 'test', fetch: fromEnv.fetch }));
    assert.ok(built.lines.some((line) => line.event === 'anthropic_base_url_ignored'));
    await captureLogs(() => built.result.complete({ prompt: 'x' }));
    assert.equal(new URL(fromEnv.requests[0].url).origin, 'https://api.anthropic.com');

    const fromOption = fakeFetch(['text-with-thinking.sse']);
    const { result: service } = await captureLogs(() => createService({ apiKey: 'test', fetch: fromOption.fetch, baseURL: 'http://127.0.0.1:5099' }));
    await captureLogs(() => service.complete({ prompt: 'x' }));
    assert.equal(new URL(fromOption.requests[0].url).origin, 'https://api.anthropic.com');
  });
});

// ----------------------------------------------------------------- errors ---

test('HTTP errors through the SDK: 429 gives 429 after the retries, 401 gives 502 at once', async () => {
  const limited = serviceWith(['http-429-rate-limit.json', 'http-429-rate-limit.json', 'http-429-rate-limit.json']);
  const rate = await captureLogs(() => limited.service.complete({ prompt: 'x' }));
  assert.ok(rate.error instanceof Anthropic.RateLimitError);
  assert.deepEqual(describeError(rate.error), { status: 429, message: 'The AI service is rate-limiting us. Try again in a minute.' });
  assert.equal(limited.requests.length, 3, 'the first attempt and two retries');

  const badKey = serviceWith(['http-401-authentication.json']);
  const auth = await captureLogs(() => badKey.service.complete({ prompt: 'x', label: 'test' }));
  assert.deepEqual(describeError(auth.error), { status: 502, message: "The AI service rejected the server's API key." });
  assert.equal(badKey.requests.length, 1, 'a 401 is not retried');
  const logged = auth.lines.find((line) => line.event === 'ai_error');
  assert.equal(logged.status, 401);
  assert.equal(logged.type, 'authentication_error');
});

test('HTTP errors through the SDK: 500 and 529 give 503, 400 gives 502 naming the status', async () => {
  for (const fixture of ['http-500-api-error.json', 'http-529-overloaded.json']) {
    const { service } = serviceWith([fixture, fixture, fixture]);
    const { error } = await captureLogs(() => service.complete({ prompt: 'x' }));
    assert.deepEqual(describeError(error), { status: 503, message: 'The AI service is temporarily unavailable.' }, fixture);
  }
  const { service } = serviceWith(['http-400-invalid-request.json']);
  const { error } = await captureLogs(() => service.complete({ prompt: 'x' }));
  assert.deepEqual(describeError(error), { status: 502, message: 'AI request rejected (400).' });
});

test('an overloaded_error in the middle of the stream gives 503, not "rejected (undefined)"', async () => {
  const { service, requests } = serviceWith(['overloaded-mid-stream.sse']);
  const { error, lines } = await captureLogs(() => service.complete({ prompt: 'x', label: 'test' }));
  assert.ok(error instanceof Anthropic.APIError);
  assert.equal(error.status, undefined);
  assert.equal(error.type, 'overloaded_error');
  assert.deepEqual(describeError(error), { status: 503, message: 'The AI service is temporarily unavailable.' });
  assert.equal(requests.length, 1, 'a stream that has started is not retried');
  assert.equal(lines.find((line) => line.event === 'ai_error').type, 'overloaded_error');
});

test('a network failure gives 504 after the retries', async () => {
  const { service, requests } = serviceWith([{ networkError: true }, { networkError: true }, { networkError: true }]);
  const { error } = await captureLogs(() => service.complete({ prompt: 'x' }));
  assert.ok(error instanceof Anthropic.APIConnectionError);
  assert.deepEqual(describeError(error), { status: 504, message: 'Could not reach the AI service. Try again.' });
  assert.equal(requests.length, 3);
});

test('without a key: AI_NOT_CONFIGURED, and nothing is sent', async () => {
  const fake = fakeFetch(['text-with-thinking.sse']);
  const service = createService({ apiKey: undefined, fetch: fake.fetch });
  assert.equal(service.isConfigured(), false);
  await assert.rejects(service.complete({ prompt: 'hello', label: 'test' }), (err) => err.code === 'AI_NOT_CONFIGURED');
  assert.equal(fake.requests.length, 0);
});

test(
  'the default instance without an API key rejects with AI_NOT_CONFIGURED before any request',
  { skip: isConfigured() ? 'an Anthropic key is set in this environment' : false },
  async () => {
    await assert.rejects(complete({ prompt: 'hello', label: 'test' }), (err) => err.code === 'AI_NOT_CONFIGURED');
  },
);

// ---------------------------------------------------------------- timeout ---

test("the timeout bounds the wait for the answer to start, not the answer (Node's own fetch)", async () => {
  const fake = await startFakeAnthropic();
  try {
    fake.enqueue({ fixture: 'text-with-thinking.sse', pauseAfter: 2, pauseMs: 700 });
    const service = createService({ apiKey: 'test', baseURL: fake.url, timeout: 250 });
    const { result, error } = await captureLogs(() => service.complete({ prompt: 'x' }));
    assert.equal(error, undefined, String(error));
    assert.equal(result.text, '## EXECUTIVE SUMMARY\nMike leads six clients and carries the heaviest book.');
    assert.equal(fake.requests.length, 1, 'no retry');
  } finally {
    await fake.close();
  }
});

// ------------------------------------------------- parseResponse (pure) ---

test('parseResponse: several text blocks are joined with a line break and trimmed; other blocks are ignored', () => {
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

test('parseResponse: text either side of a fallback block is one continuous text', () => {
  const out = parseResponse({
    content: [
      { type: 'text', text: 'Mike leads six clients and ' },
      { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal', category: 'cyber' } },
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'carries the heaviest book.' },
    ],
    model: 'claude-opus-4-8',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: 'message', model: 'claude-opus-5' }, { type: 'fallback_message', model: 'claude-opus-4-8' }] },
  });
  assert.equal(out.text, 'Mike leads six clients and carries the heaviest book.');
  assert.deepEqual(out.declinedCategories, ['cyber']);
  assert.equal(out.fellBack, true);
});

test('parseResponse: empty or missing content yields an empty string, never a throw', () => {
  assert.equal(parseResponse({ content: [] }).text, '');
  assert.equal(parseResponse({}).text, '');
  assert.equal(parseResponse(undefined).text, '');
  assert.equal(parseResponse({}).stopReason, null);
  assert.equal(parseResponse({}).usage, null);
  assert.equal(parseResponse({}).fellBack, false);
  assert.equal(parseResponse({}).tokens.inputTokens, 0);
});

// -------------------------------------------------- describeError (pure) ---

test('describeError: AI_NOT_CONFIGURED maps to 503 with the "not configured" message', () => {
  const err = new Error('AI not configured');
  err.code = 'AI_NOT_CONFIGURED';
  assert.deepEqual(describeError(err), { status: 503, message: 'AI is not configured on the server (missing API key).' });
});

test('describeError: connection errors and timeouts map to 504', () => {
  assert.equal(describeError(new Anthropic.APIConnectionError({ message: 'socket hang up' })).status, 504);
  assert.equal(describeError(new Anthropic.APIConnectionTimeoutError({ message: 'timed out' })).status, 504);
});

test('describeError: an APIError without a status is mapped by its type', () => {
  const streamError = (type) => new Anthropic.APIError(undefined, { type: 'error', error: { type, message: type } }, undefined, headers(), type);
  assert.deepEqual(describeError(streamError('overloaded_error')), { status: 503, message: 'The AI service is temporarily unavailable.' });
  assert.deepEqual(describeError(streamError('api_error')), { status: 503, message: 'The AI service is temporarily unavailable.' });
  assert.deepEqual(describeError(streamError('rate_limit_error')), { status: 429, message: 'The AI service is rate-limiting us. Try again in a minute.' });
  assert.deepEqual(describeError(streamError('invalid_request_error')), { status: 502, message: 'AI request rejected (invalid_request_error).' });
  // The type read from the body when the error carries none of its own.
  const untyped = new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error' } }, undefined, headers());
  assert.equal(describeError(untyped).status, 503);
  assert.deepEqual(describeError(new Anthropic.APIUserAbortError()), { status: 500, message: 'AI request failed.' });
});

test('describeError: anything else is a plain 500', () => {
  assert.deepEqual(describeError(new Error('boom')), { status: 500, message: 'AI request failed.' });
  assert.deepEqual(describeError(undefined), { status: 500, message: 'AI request failed.' });
});
