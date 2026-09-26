// utils/aiCost.cjs (docs/plans/tier-1.md, section 5 and T13): the estimated
// cost of one call, summed over its attempts, each at its own model's list
// price; cache writes by lifetime and cache reads at their multipliers; the
// published refusal billing rule; and no guess for a model without a price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import cost from '../utils/aiCost.cjs';
import ai from '../services/anthropic.cjs';

const { PRICES, PRICES_READ_ON, BILLED_BEFORE_OUTPUT, normalizeUsage, callCost } = cost;

const attempt = (type, model, input, output, extra = {}) => ({
  type, model, input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, ...extra,
});

test('the price table: each model as read from the pricing page, cache prices at 1.25x, 2x and 0.1x of input', () => {
  assert.deepEqual({ ...PRICES['claude-opus-5'] }, { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 });
  assert.deepEqual({ ...PRICES['claude-opus-4-8'] }, { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 });
  assert.deepEqual({ ...PRICES['claude-sonnet-5'] }, { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 });
  assert.match(PRICES_READ_ON, /^\d{4}-\d{2}-\d{2}$/);
});

test('every model the service can send, and the fallback target, has a price', () => {
  const models = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', ...ai.FALLBACK_MODELS]);
  for (const model of models) assert.ok(PRICES[model], `${model} has a price`);
});

test('a plain call: input and output at the model price', () => {
  const out = callCost({ input_tokens: 1000, output_tokens: 500 }, 'claude-opus-5');
  assert.equal(out.usd, 0.0175); // 1,000 x $5 + 500 x $25, per million
  assert.deepEqual(out.attempts, [{ model: 'claude-opus-5', usd: 0.0175, billed: true }]);
  assert.deepEqual(out.unknownModels, []);
  assert.equal(out.pricesReadOn, PRICES_READ_ON);
  assert.equal(callCost({ input_tokens: 1000, output_tokens: 500 }, 'claude-sonnet-5').usd, 0.007);
});

test('cache writes: split by lifetime at 1.25x (5 minutes) and 2x (1 hour)', () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 100,
    cache_creation_input_tokens: 3000,
    cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
  };
  // 100 x 5 + 100 x 25 + 1,000 x 6.25 + 2,000 x 10
  assert.equal(callCost(usage, 'claude-opus-5').usd, 0.02925);
});

test('cache writes without the lifetime split count as 5-minute writes', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2000, cache_creation: null };
  assert.equal(callCost(usage, 'claude-opus-5').usd, 0.0125);
  assert.equal(normalizeUsage(usage, 'claude-opus-5').cacheWrite5mTokens, 2000);
});

test('cache reads at 0.1x of input', () => {
  const usage = { input_tokens: 50, output_tokens: 200, cache_read_input_tokens: 12000 };
  // 50 x 5 + 200 x 25 + 12,000 x 0.5
  assert.equal(callCost(usage, 'claude-opus-5').usd, 0.01125);
  assert.equal(callCost(usage, 'claude-sonnet-5').usd, 0.0045);
});

test('a fallback: each attempt priced at its own model, summed', () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    iterations: [attempt('message', 'claude-sonnet-5', 1000, 100), attempt('fallback_message', 'claude-opus-4-8', 1000, 100)],
  };
  // The declined attempt had output, so it is billed: 1,000 x 2 + 100 x 10; then 1,000 x 5 + 100 x 25.
  const out = callCost(usage, 'claude-opus-4-8', { declined: ['cyber'] });
  assert.deepEqual(out.attempts, [
    { model: 'claude-sonnet-5', usd: 0.003, billed: true },
    { model: 'claude-opus-4-8', usd: 0.0075, billed: true },
  ]);
  assert.equal(out.usd, 0.0105);
});

test('a refusal before any output is billed only in the categories Anthropic bills', () => {
  assert.deepEqual([...BILLED_BEFORE_OUTPUT].sort(), ['bio', 'frontier_llm', 'reasoning_extraction']);
  const usage = { input_tokens: 412, output_tokens: 0 };
  for (const category of ['bio', 'frontier_llm', 'reasoning_extraction']) {
    assert.equal(callCost(usage, 'claude-opus-5', { declined: [category] }).usd, 0.00206, category);
  }
  for (const category of ['cyber', 'general_harms', null]) {
    const out = callCost(usage, 'claude-opus-5', { declined: [category] });
    assert.equal(out.usd, 0, String(category));
    assert.equal(out.attempts[0].billed, false);
  }
});

test('a refusal after output had started is billed at normal rates', () => {
  const out = callCost({ input_tokens: 1850, output_tokens: 15 }, 'claude-sonnet-5', { declined: ['general_harms'] });
  assert.equal(out.usd, 0.00385);
});

test('a fallback after a decline before output: only the fallback attempt is billed', () => {
  const usage = {
    input_tokens: 412,
    output_tokens: 264,
    iterations: [attempt('message', 'claude-opus-5', 412, 0), attempt('fallback_message', 'claude-opus-4-8', 412, 264)],
  };
  const out = callCost(usage, 'claude-opus-4-8', { declined: ['cyber'] });
  assert.equal(out.usd, 0.00866);
  assert.equal(out.attempts[0].billed, false);
});

test('a model without a price gives a null cost and names it; never a guess', () => {
  const out = callCost({ input_tokens: 1000, output_tokens: 500 }, 'claude-future-9');
  assert.equal(out.usd, null);
  assert.deepEqual(out.unknownModels, ['claude-future-9']);
  assert.deepEqual(out.attempts, [{ model: 'claude-future-9', usd: null, billed: true }]);

  const mixed = callCost({
    iterations: [attempt('message', 'claude-opus-5', 1000, 10), attempt('fallback_message', 'claude-future-9', 1000, 10)],
  }, 'claude-future-9', { declined: ['cyber'] });
  assert.equal(mixed.usd, null, 'one unpriced billed attempt makes the total unknown');
});

test('an unpriced attempt that is not billed costs nothing and leaves the total known', () => {
  const out = callCost({
    iterations: [attempt('message', 'claude-future-9', 412, 0), attempt('fallback_message', 'claude-opus-4-8', 412, 264)],
  }, 'claude-opus-4-8', { declined: ['cyber'] });
  assert.equal(out.usd, 0.00866);
  assert.deepEqual(out.unknownModels, []);
});

test('normalizeUsage: totals over the attempts, each attempt with its model', () => {
  const usage = {
    input_tokens: 1862,
    output_tokens: 30,
    iterations: [
      attempt('message', 'claude-opus-5', 1850, 12, { cache_read_input_tokens: 100 }),
      attempt('fallback_message', 'claude-opus-4-8', 1862, 30, { cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40 } }),
    ],
  };
  const out = normalizeUsage(usage, 'claude-opus-4-8');
  assert.equal(out.inputTokens, 3712);
  assert.equal(out.outputTokens, 42);
  assert.equal(out.cacheReadTokens, 100);
  assert.equal(out.cacheWrite1hTokens, 40);
  assert.deepEqual(out.iterations.map((a) => [a.type, a.model]), [['message', 'claude-opus-5'], ['fallback_message', 'claude-opus-4-8']]);
});

test('normalizeUsage: no usage is all zeros, and missing counts are zero', () => {
  assert.deepEqual(normalizeUsage(null), {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, iterations: [],
  });
  assert.equal(normalizeUsage({ output_tokens: 5 }, 'claude-opus-5').inputTokens, 0);
  assert.equal(callCost(null, 'claude-opus-5').usd, 0);
});
