// utils/aiCost.cjs
//
// What one AI call cost, estimated from list prices (docs/plans/tier-1.md,
// section 5 and T13). Pure: no environment and no logging; services/
// anthropic.cjs logs the result and an ai_cost_unknown_model line. It is an
// estimate; the Anthropic Console is the bill.
//
// Prices are dollars per million tokens, read on PRICES_READ_ON from
// https://platform.claude.com/docs/en/about-claude/pricing. On every model
// listed, a cache write costs 1.25x the input price (5-minute lifetime) or 2x
// (1-hour) and a cache read 0.1x. A model missing here gets no cost (null),
// never a guess: add it when AI_MODEL or a fallback target changes.
//
// A call's cost is the sum over its attempts: usage.iterations when the API
// reports them (a declined attempt and the fallback attempt are separate
// entries, each naming its model), otherwise the top-level usage at the
// message's model. Each attempt is priced at its own model's prices.
//
// Refusals (https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback,
// "How refusals are billed", read on PRICES_READ_ON): a refusal before any
// output is billed only in the categories in BILLED_BEFORE_OUTPUT; in any
// other category, or with a null one, it is free. A refusal after output has
// started is billed at normal rates. "Before any output" is read as the
// attempt reporting 0 output tokens.
//
// Not modelled: data residency (inference_geo, 1.1x), batch and fast-mode
// prices, none of which this app uses; and fallback credit, which the API
// applies itself on a server-side fallback: each attempt's counts are priced
// as reported, so a fallback over a cached prefix may be overstated.

const PRICES_READ_ON = '2026-09-26';

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const CACHE_READ = 0.1;

const modelPrices = (input, output) => Object.freeze({
  input,
  output,
  cacheWrite5m: input * CACHE_WRITE_5M,
  cacheWrite1h: input * CACHE_WRITE_1H,
  cacheRead: input * CACHE_READ,
});

const PRICES = Object.freeze({
  'claude-opus-5': modelPrices(5, 25), // AI_MODEL's default (D7)
  'claude-opus-4-8': modelPrices(5, 25), // where the default fallback sends cyber-category declines
  'claude-sonnet-5': modelPrices(2, 10), // D7's cheaper alternative
});

// Refusal categories billed when the refusal comes before any output (as of
// September 2026; Anthropic says the list may change).
const BILLED_BEFORE_OUTPUT = new Set(['bio', 'frontier_llm', 'reasoning_extraction']);

const count = (n) => {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const round = (usd) => Math.round(usd * 1e6) / 1e6;

// One attempt's tokens by kind. cache_creation splits the writes by lifetime;
// without it, every write is taken as the default 5-minute one.
function attemptTokens(u) {
  const writes = count(u?.cache_creation_input_tokens);
  const write5m = count(u?.cache_creation?.ephemeral_5m_input_tokens);
  const write1h = count(u?.cache_creation?.ephemeral_1h_input_tokens);
  const split = write5m + write1h > 0;
  return {
    inputTokens: count(u?.input_tokens),
    outputTokens: count(u?.output_tokens),
    cacheReadTokens: count(u?.cache_read_input_tokens),
    cacheWrite5mTokens: split ? write5m : writes,
    cacheWrite1hTokens: split ? write1h : 0,
  };
}

const SAMPLING_TYPES = new Set(['message', 'fallback_message']);

/**
 * A Messages API `usage` object as counts: the totals over the call's attempts
 * and each attempt with its model (`iterations`). `model` names the attempt
 * when the usage has no iterations (the message's model) or an entry names
 * none.
 */
function normalizeUsage(usage, model = null) {
  const entries = Array.isArray(usage?.iterations) && usage.iterations.length > 0 ? usage.iterations : null;
  let iterations = [];
  if (entries) {
    iterations = entries.map((entry) => ({ type: entry?.type ?? 'message', model: entry?.model || model || null, ...attemptTokens(entry) }));
  } else if (usage) {
    iterations = [{ type: 'message', model: model || null, ...attemptTokens(usage) }];
  }
  const sum = (key) => iterations.reduce((total, attempt) => total + attempt[key], 0);
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWrite5mTokens: sum('cacheWrite5mTokens'),
    cacheWrite1hTokens: sum('cacheWrite1hTokens'),
    iterations,
  };
}

function attemptUsd(tokens, prices) {
  return (
    tokens.inputTokens * prices.input +
    tokens.outputTokens * prices.output +
    tokens.cacheWrite5mTokens * prices.cacheWrite5m +
    tokens.cacheWrite1hTokens * prices.cacheWrite1h +
    tokens.cacheReadTokens * prices.cacheRead
  ) / 1e6;
}

/**
 * The estimated cost of one call.
 *
 * `usage` is the message's usage, `model` the message's model. `declined`
 * lists the refusal category (or null) of each attempt that declined, in the
 * order the attempts ran: the category of each `fallback` block's trigger,
 * then stop_details.category when the call ended in a refusal (parseResponse
 * in services/anthropic.cjs builds it). The first declined.length sampling
 * attempts are the declined ones.
 *
 * Returns { usd, attempts: [{ model, usd, billed }], unknownModels,
 * pricesReadOn }. usd is null when a billed attempt ran on a model without a
 * price; an attempt that is not billed costs 0 whatever its model.
 */
function callCost(usage, model, { declined = [] } = {}) {
  const { iterations } = normalizeUsage(usage, model);
  const unknownModels = [];
  let total = 0;
  let known = true;
  let sampling = 0;

  const attempts = iterations.map((attempt) => {
    const index = SAMPLING_TYPES.has(attempt.type) ? sampling++ : -1;
    const isDeclined = index >= 0 && index < declined.length;
    const billed = !(isDeclined && attempt.outputTokens === 0 && !BILLED_BEFORE_OUTPUT.has(declined[index]));
    if (!billed) return { model: attempt.model, usd: 0, billed };

    const prices = PRICES[attempt.model];
    if (!prices) {
      known = false;
      if (!unknownModels.includes(attempt.model)) unknownModels.push(attempt.model);
      return { model: attempt.model, usd: null, billed };
    }
    const usd = attemptUsd(attempt, prices);
    total += usd;
    return { model: attempt.model, usd: round(usd), billed };
  });

  return { usd: known ? round(total) : null, attempts, unknownModels, pricesReadOn: PRICES_READ_ON };
}

module.exports = {
  PRICES,
  PRICES_READ_ON,
  BILLED_BEFORE_OUTPUT,
  normalizeUsage,
  callCost,
};
