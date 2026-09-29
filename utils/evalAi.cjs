// utils/evalAi.cjs
//
// Model and effort from real answers (docs/plans/tier-2.md, S16, WP11): the
// pure half of scripts/eval-ai.cjs. The script asks 10 to 20 of the firm's
// saved questions, chosen by Jeff by id, again on today's book under each
// configuration S16 names, through services/anthropic.cjs, and writes the
// saved answer and each configuration's answer side by side. It saves
// nothing; this module never touches the database, the environment or the
// network.
//
// What is here: the command line (parseArgs), the configurations
// (configurations), the estimate printed before anything is spent
// (estimateRun, readConfirm), the rule for where the side-by-side may be
// written (outputPathProblem), the candidate list (candidateLine), the
// side-by-side itself (renderSideBySide), the transition-plan check
// (planCheck) and the SQL the script runs, all read-only.

const path = require('node:path');
const { PRICES } = require('./aiCost.cjs');
const { ASK_MAX_TOKENS, FIRM_TIME_ZONE, askTurn } = require('./askPrompts.cjs');
const { resolveRecommendation, extractSection } = require('./transitionPlan.cjs');

// S16: an evaluation set of 10 to 20 questions. The script takes 1 to 20 (a
// smaller set is useful for a first look); 20 is also its cap on calls per
// configuration, since the app's rate limiters do not apply to a script.
const IDS_MAX = 20;
const IDS_SUGGESTED_MIN = 10;

// The effort levels the API takes (services/anthropic.cjs, EFFORT_LEVELS).
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// S16's configurations, in the order they run: AI_MODEL's default model at
// the API's default effort (what production sends while AI_EFFORT is unset,
// high on claude-opus-5) and at medium. claude-opus-5-5 only when Jeff asks
// (--opus-5-5 <effort>), always with its effort set: its default is medium,
// claude-opus-5's high (the claude-api skill), so S16 has a 5.5 switch set
// AI_EFFORT explicitly.
const BASE_CONFIGURATIONS = Object.freeze([
  Object.freeze({ key: 'opus-5-default', model: 'claude-opus-5', effort: null }),
  Object.freeze({ key: 'opus-5-medium', model: 'claude-opus-5', effort: 'medium' }),
]);
const OPUS_5_5 = 'claude-opus-5-5';

// The output side of the estimate: each saved answer's output tokens
// (thinking included) times 0.5 at the low end and 2 at the high end, never
// above max_tokens. Output varies with effort and model; the claude-api skill
// says claude-opus-5-5 thinks more per turn than claude-opus-5 at a given
// level and less at medium than claude-opus-5 at high, without figures, so
// one band for every configuration.
const OUTPUT_LOW = 0.5;
const OUTPUT_HIGH = 2;
// A saved answer with no output (declined before it wrote anything) says
// nothing about how long an answer runs: it counts as the longest chosen
// answer, or this many tokens when every chosen answer is empty.
const OUTPUT_UNKNOWN = 4000;

// The system blocks' tokens when no answer on today's book measured them:
// their characters at two a token. Production measured 2.35 on 2026-09-27
// (9,811 tokens for the instructions and the 84-client book; Tier 1 WP3's
// row), so this overstates, as an estimate before spending should.
const CHARS_PER_TOKEN = 2;

// Inside the repository the side-by-side may be written only here, which
// .gitignore lists: it holds the firm's questions, answers and client names,
// and the repository is public.
const OUTPUT_DIR = 'eval-ai-output';

// The ai_call log line's label for the script's calls.
const LABEL = 'eval';

const USAGE = [
  'Usage: node scripts/eval-ai.cjs                          list the saved Asks to choose from (read-only)',
  '       node scripts/eval-ai.cjs --plans                  count saved transition plans whose recommendations the parser cannot resolve (read-only)',
  '       node scripts/eval-ai.cjs --ids 12,15,...          print the estimate; sends nothing',
  '       node scripts/eval-ai.cjs --ids 12,15,... --confirm <dollars>',
  '                                                         run it; <dollars> is the figure the estimate printed',
  '  --ids: 1 to 20 saved Asks by id, from the list (10 to 20 make the evaluation set)',
  '  --opus-5-5 <effort>[,<effort>]: also run claude-opus-5-5 at each effort (low, medium, high, xhigh, max); off unless given',
  `  --out <path>: where to write the side-by-side (default ${OUTPUT_DIR}/eval-ai-<time>.md); inside the repository only under ${OUTPUT_DIR}/`,
  '  --stdout: print the side-by-side instead of writing a file (Render\'s Shell has no download)',
];

const isWholeId = (text) => /^[1-9]\d{0,9}$/.test(text) && Number(text) <= 2147483647;

/**
 * The command line: { mode, ids, opus55, out, stdout, confirm } or { error }.
 * `mode` is 'list' (no arguments), 'plans', 'estimate' (--ids without
 * --confirm) or 'run'. `confirm` is the figure as given (text); readConfirm
 * reads it.
 */
function parseArgs(argv = []) {
  const out = { mode: 'list', ids: [], opus55: [], out: null, stdout: false, confirm: null };
  const fail = (error) => ({ error });
  const seen = new Set();
  let plans = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takesValue = ['--ids', '--opus-5-5', '--out', '--confirm'].includes(arg);
    if (!['--plans', '--stdout'].includes(arg) && !takesValue) return fail(`Unknown argument: ${arg}`);
    if (seen.has(arg)) return fail(`${arg} is given twice.`);
    seen.add(arg);
    if (arg === '--plans') { plans = true; continue; }
    if (arg === '--stdout') { out.stdout = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return fail(`${arg} needs a value.`);
    i += 1;
    if (arg === '--ids') {
      const parts = value.split(',').map((part) => part.trim());
      if (parts.some((part) => !isWholeId(part))) return fail('--ids takes answer ids separated by commas, such as 12,15,18.');
      const ids = parts.map(Number);
      if (new Set(ids).size !== ids.length) return fail('--ids names an answer twice.');
      if (ids.length > IDS_MAX) return fail(`--ids takes at most ${IDS_MAX} answers.`);
      out.ids = ids;
    } else if (arg === '--opus-5-5') {
      const efforts = value.split(',').map((part) => part.trim().toLowerCase());
      if (efforts.some((effort) => !EFFORT_LEVELS.includes(effort))) return fail(`--opus-5-5 takes efforts from ${EFFORT_LEVELS.join(', ')}.`);
      if (new Set(efforts).size !== efforts.length) return fail('--opus-5-5 names an effort twice.');
      out.opus55 = efforts;
    } else if (arg === '--out') {
      out.out = value;
    } else {
      out.confirm = value;
    }
  }
  if (plans) {
    if (seen.size > 1) return fail('--plans takes no other argument.');
    return { ...out, mode: 'plans' };
  }
  if (seen.size === 0) return out;
  if (out.ids.length === 0) return fail('--ids is required to estimate or run.');
  if (out.stdout && out.out !== null) return fail('Give --out or --stdout, not both.');
  if (out.confirm !== null && readConfirm(out.confirm) === null) return fail('--confirm takes the dollar figure the estimate printed, such as 2.51.');
  return { ...out, mode: out.confirm === null ? 'estimate' : 'run' };
}

/** A dollar figure as the estimate prints it ('2.51', '$2.51'), in cents, or null. */
function readConfirm(value) {
  const match = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || '0').padEnd(2, '0'));
}

const effortText = (effort) => (effort ? `effort ${effort}` : "the API's default effort");

/**
 * The configurations to run, in order: S16's two on claude-opus-5, then
 * claude-opus-5-5 at each effort Jeff names. Each is { key, model, effort,
 * title }, `effort` null for the API's default.
 */
function configurations({ opus55 = [] } = {}) {
  return [
    ...BASE_CONFIGURATIONS,
    ...opus55.map((effort) => ({ key: `opus-5-5-${effort}`, model: OPUS_5_5, effort })),
  ].map((config) => ({
    ...config,
    title: `${config.model}, ${config.effort === null && config.model === 'claude-opus-5' ? "the API's default effort (high)" : effortText(config.effort)}`,
  }));
}

const round6 = (usd) => Math.round(usd * 1e6) / 1e6;
const tokenCount = (n) => {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
};

/**
 * The system blocks' tokens for the estimate: measured, when an answer given
 * on today's book (a first question, a brief or a transition plan, which send
 * the same two blocks) read or wrote them in the cache; otherwise their
 * characters at CHARS_PER_TOKEN. Returns { tokens, measuredBy, basis }.
 */
function prefixEstimate({ measured = null, systemChars = 0 } = {}) {
  const tokens = tokenCount(measured?.tokens);
  if (tokens > 0) {
    return { tokens, measuredBy: measured.id ?? null, basis: `measured by answer #${measured.id} on today's book` };
  }
  return {
    tokens: Math.ceil(systemChars / CHARS_PER_TOKEN),
    measuredBy: null,
    basis: `estimated from the system blocks' ${systemChars.toLocaleString('en-US')} characters at ${CHARS_PER_TOKEN} a token (no saved answer on today's book measured them)`,
  };
}

/**
 * One question's user turn in tokens: its saved uncached input when it was a
 * first question that read or wrote the cache (the input the cache did not
 * cover is exactly the turn), otherwise the turn's characters at
 * CHARS_PER_TOKEN.
 */
function turnTokens(answer, now = new Date()) {
  const cached = tokenCount(answer.cache_read_tokens) + tokenCount(answer.cache_write_tokens);
  if (answer.parent_id === null && cached > 0 && tokenCount(answer.input_tokens) > 0) return tokenCount(answer.input_tokens);
  return Math.ceil(askTurn(answer.question ?? '', now).length / CHARS_PER_TOKEN);
}

/**
 * The estimate, before anything is sent. `answers` are the chosen saved Asks
 * (their token columns as stored), `configs` from configurations(), `prefix`
 * from prefixEstimate. Each configuration writes the prefix to the cache on
 * its first call and reads it on the rest (the calls run one at a time, all
 * of one configuration before the next, well inside the cache's five
 * minutes), sends each turn uncached, and writes 0.5x to 2x each saved
 * answer's output. The ceiling writes the prefix on every call and runs every
 * answer to max_tokens. Returns { configs: [{ key, title, model, calls, low,
 * high, ceiling }], low, high, ceiling, figure, unpriced }: dollars, `figure`
 * the high end rounded up to the cent as text (what --confirm must carry),
 * `unpriced` the models without a price (then nothing can be estimated).
 */
function estimateRun({ answers = [], configs = [], prefix, now = new Date() }) {
  const unpriced = [...new Set(configs.map((c) => c.model).filter((model) => !PRICES[model]))];
  const outputs = answers.map((a) => (a.refused === true ? 0 : tokenCount(a.output_tokens)));
  const longest = Math.max(0, ...outputs);
  const turns = answers.map((a) => turnTokens(a, now));
  const cap = ASK_MAX_TOKENS;
  const P = tokenCount(prefix?.tokens);
  const rows = configs.map((config) => {
    const pr = PRICES[config.model];
    if (!pr) return { key: config.key, title: config.title, model: config.model, calls: answers.length, low: null, high: null, ceiling: null };
    const n = answers.length;
    const turnUsd = turns.reduce((sum, t) => sum + t * pr.input, 0);
    const inputUsd = n === 0 ? 0 : P * pr.cacheWrite5m + (n - 1) * P * pr.cacheRead + turnUsd;
    const outputAt = (factor) => outputs.reduce((sum, o) => {
      const base = o > 0 ? o : (longest > 0 ? longest : OUTPUT_UNKNOWN);
      return sum + Math.min(cap, Math.ceil(base * factor)) * pr.output;
    }, 0);
    return {
      key: config.key,
      title: config.title,
      model: config.model,
      calls: n,
      low: round6((inputUsd + outputAt(OUTPUT_LOW)) / 1e6),
      high: round6((inputUsd + outputAt(OUTPUT_HIGH)) / 1e6),
      ceiling: round6((n * P * pr.cacheWrite5m + turnUsd + n * cap * pr.output) / 1e6),
    };
  });
  if (unpriced.length > 0) return { configs: rows, low: null, high: null, ceiling: null, figure: null, unpriced };
  const sum = (key) => round6(rows.reduce((total, row) => total + row[key], 0));
  const high = sum('high');
  const cents = Math.ceil(Math.round(high * 1e6) / 1e4);
  return { configs: rows, low: sum('low'), high, ceiling: sum('ceiling'), figure: centsText(cents), unpriced };
}

/** Cents as the estimate prints dollars: 251 -> '2.51'. */
function centsText(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Dollars for a person: '$2.51' from a dollar, '$0.0431' below one (an answer costs cents). */
function formatUsd(usd) {
  if (usd === null || usd === undefined || !Number.isFinite(Number(usd))) return 'no price';
  const value = Number(usd);
  return value >= 1 || value === 0 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

/** The saved answer's cost as stored (NUMERIC as text) for a person. */
function storedUsd(cost) {
  if (cost === null || cost === undefined) return 'no price';
  const value = Number(cost);
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : 'no price';
}

const n = (value) => tokenCount(value).toLocaleString('en-US');

// The firm's wall clock: 2026-10-12 14:03
const firmClock = new Intl.DateTimeFormat('en-US', {
  timeZone: FIRM_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
function firmStamp(when) {
  const p = Object.fromEntries(firmClock.formatToParts(new Date(when)).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** A default file name for the side-by-side at `now`, in the output directory. */
function defaultOutputPath(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return path.join(OUTPUT_DIR, `eval-ai-${stamp}.md`);
}

/**
 * Why the side-by-side may not be written to `target` (an absolute path,
 * with its directory's symbolic links resolved by the caller), or null.
 * `repoRoot` is the repository's root, resolved the same way. Inside the
 * repository only OUTPUT_DIR is allowed (.gitignore lists it); outside it,
 * anywhere.
 */
function outputPathProblem({ repoRoot, target }) {
  const rel = path.relative(repoRoot, target);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside) return null;
  const [first, ...rest] = rel.split(path.sep);
  if (first === OUTPUT_DIR && rest.length > 0) return null;
  return `Refused: ${target} is inside the repository, which is public. The side-by-side holds the firm's questions, answers and client names: write it under ${OUTPUT_DIR}/ (ignored by git), outside the repository, or print it with --stdout.`;
}

/** Where the calls go: Anthropic's API in production, else ANTHROPIC_BASE_URL when set (services/anthropic.cjs, T17). */
function callTarget(env = {}) {
  if (env.NODE_ENV === 'production' || !env.ANTHROPIC_BASE_URL) return 'https://api.anthropic.com';
  return env.ANTHROPIC_BASE_URL;
}

const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * One saved Ask in the candidate list: id, date, who asked, the question's
 * start, the saved answer's tokens and cost, and marks (a follow-up, hidden,
 * declined, cut off, given on an earlier book).
 */
function candidateLine(row, todaySha) {
  const marks = [
    row.parent_id !== null ? `follow-up of #${row.parent_id}, asked alone` : null,
    row.hidden_at ? `hidden${row.hidden_by_username ? ` by ${row.hidden_by_username}` : ''}` : null,
    row.refused ? 'declined' : null,
    row.truncated ? 'cut off' : null,
    row.book_sha256 && row.book_sha256 !== todaySha ? 'earlier book' : null,
  ].filter(Boolean);
  return [
    `#${row.id}`,
    firmStamp(row.created_at).slice(0, 10),
    row.asked_by_username || 'a former account',
    `in ${n(row.input_tokens)}, cache read ${n(row.cache_read_tokens)}, cache write ${n(row.cache_write_tokens)}, out ${n(row.output_tokens)}`,
    storedUsd(row.cost_usd),
    ...(marks.length ? [`[${marks.join('; ')}]`] : []),
    oneLine(row.question, 80),
  ].join('  ');
}

/** The book an answer was given on, against today's: the side-by-side's label. */
function bookLabel(sha, todaySha) {
  if (!sha) return 'the book it was given on is not recorded';
  return sha === todaySha ? "given on today's book" : 'given on an earlier book';
}

// An answer's text as the AI tab shows it (src/AIAdvisor.jsx): a decline's
// notice with its category instead of text, and the cut-off notice after
// what was written.
function shownAnswer({ text, refused, refusalCategory, truncated }) {
  if (refused) return `_The AI declined to answer this request.${refusalCategory ? ` (Category: ${refusalCategory}.)` : ''}_`;
  const body = String(text ?? '').trim() || '_(no text)_';
  return truncated ? `${body}\n\n_The response was cut off; ask a narrower question._` : body;
}

const quote = (text) => String(text ?? '').split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');

function resultLine(r) {
  const t = r.tokens || {};
  const served = r.fellBack ? `served by ${r.servedBy} after a decline (a fallback)` : `served by ${r.servedBy}`;
  return `${served}; tokens in ${n(t.inputTokens)}, cache read ${n(t.cacheReadTokens)}, cache write ${n(tokenCount(t.cacheWrite5mTokens) + tokenCount(t.cacheWrite1hTokens))}, out ${n(t.outputTokens)}; ${formatUsd(r.costUsd)}; ${(r.ms / 1000).toFixed(1)} s`;
}

/**
 * Totals per configuration from the results: answers, declined, cut off,
 * fell back, errors, output tokens, cost (null when any answer had no price)
 * and the mean time in seconds.
 */
function configTotals(config, results) {
  const mine = results.filter((r) => r.configKey === config.key);
  const done = mine.filter((r) => !r.error);
  const costs = done.map((r) => r.costUsd);
  const known = costs.every((c) => typeof c === 'number' && Number.isFinite(c));
  return {
    calls: mine.length,
    answered: done.filter((r) => !r.refused).length,
    declined: done.filter((r) => r.refused).length,
    cutOff: done.filter((r) => r.truncated).length,
    fellBack: done.filter((r) => r.fellBack).length,
    errors: mine.length - done.length,
    outputTokens: done.reduce((sum, r) => sum + tokenCount(r.tokens?.outputTokens), 0),
    costUsd: known ? round6(costs.reduce((sum, c) => sum + c, 0)) : null,
    meanSeconds: done.length ? done.reduce((sum, r) => sum + r.ms, 0) / done.length / 1000 : null,
  };
}

/**
 * The side-by-side, as Markdown. `book` is { clientCount, reportingYear, sha
 * }; `questions` the chosen saved Asks in order; `results` one entry per call
 * made: { configKey, answerId, text, truncated, refused, refusalCategory,
 * servedBy, fellBack, tokens, costUsd, ms } or { configKey, answerId, error,
 * ms }. `status` says whether the run finished, and why not.
 */
function renderSideBySide({ startedAt, book, prefix, configs, questions, results, status, approved }) {
  const lines = [];
  const push = (...more) => lines.push(...more);
  const planned = configs.length * questions.length;
  push(
    '# AI evaluation: side by side',
    '',
    '> This file holds the firm\'s questions, answers and client names. Do not commit it, email it or leave it on a shared disk; delete it when you are done.',
    '',
    `Run from ${firmStamp(startedAt)} (America/New_York) on today's book: ${book.clientCount} clients, reporting year ${book.reportingYear}, book SHA-256 ${String(book.sha).slice(0, 12)}. Every configuration answered on this book, with the same system blocks as the Ask route; each question was sent as a new question with today's date, and nothing was saved.`,
    `System blocks: ${n(prefix.tokens)} tokens, ${prefix.basis}.`,
    `${status} (${results.length} of ${planned} calls; approved up to $${approved}).`,
    '',
    '| Configuration | Answers | Declined | Cut off | Fell back | Errors | Output tokens | Estimated cost | Mean time |',
    '|---|---|---|---|---|---|---|---|---|',
  );
  for (const config of configs) {
    const t = configTotals(config, results);
    push(`| ${config.title} | ${t.answered} | ${t.declined} | ${t.cutOff} | ${t.fellBack} | ${t.errors} | ${t.outputTokens.toLocaleString('en-US')} | ${formatUsd(t.costUsd)} | ${t.meanSeconds === null ? '—' : `${t.meanSeconds.toFixed(1)} s`} |`);
  }
  const savedCost = questions.reduce((sum, q) => sum + (Number(q.cost_usd) || 0), 0);
  push(
    '',
    `The saved answers, for reference: ${questions.length} answers, ${questions.reduce((sum, q) => sum + tokenCount(q.output_tokens), 0).toLocaleString('en-US')} output tokens, $${savedCost.toFixed(4)} as saved (on the books they were given on, with the effort production had then).`,
    'Costs are estimates from list prices (utils/aiCost.cjs); the Anthropic Console is the bill. This run is not in the AI tab\'s month total.',
  );
  questions.forEach((q, index) => {
    push(
      '',
      '---',
      '',
      `## ${index + 1}. Question #${q.id}`,
      '',
      `Asked by ${q.asked_by_username || 'a former account'} on ${firmStamp(q.created_at)}${q.parent_id !== null ? `, a follow-up of #${q.parent_id} (asked here alone, without its thread)` : ''}${q.hidden_at ? '; hidden in the AI tab' : ''}.`,
      '',
      quote(q.question),
      '',
      `### Saved answer (${bookLabel(q.book_sha256, book.sha)})`,
      '',
      `${q.model || 'model not recorded'}, served by ${q.served_by || 'not recorded'}${q.fell_back ? ' after a decline (a fallback)' : ''}; tokens in ${n(q.input_tokens)}, cache read ${n(q.cache_read_tokens)}, cache write ${n(q.cache_write_tokens)}, out ${n(q.output_tokens)}; ${storedUsd(q.cost_usd)}; ${q.duration_ms === null || q.duration_ms === undefined ? 'time not recorded' : `${(Number(q.duration_ms) / 1000).toFixed(1)} s`}`,
      '',
      shownAnswer({ text: q.answer, refused: q.refused, refusalCategory: q.refusal_category, truncated: q.truncated }),
    );
    for (const config of configs) {
      const r = results.find((result) => result.configKey === config.key && result.answerId === q.id);
      push('', `### ${config.title}`, '');
      if (!r) push('_Not run._');
      else if (r.error) push(`_Error: ${r.error}_`);
      else push(resultLine(r), '', shownAnswer(r));
    }
  });
  push('');
  return lines.join('\n');
}

// Which seat problem resolveRecommendation (utils/transitionPlan.cjs)
// reported, by its message.
function seatOutcome(resolved) {
  if (resolved.person) return 'resolved';
  if (resolved.none) return 'none';
  const problem = resolved.problem || '';
  if (/no recommendation/.test(problem)) return 'missing';
  if (/names nobody/.test(problem)) return 'nobody';
  if (/more than one/.test(problem)) return 'several';
  if (/is not a partner/.test(problem)) return 'notPartner';
  if (/is the recommended lead/.test(problem)) return 'isLead';
  return 'other';
}

// Outcomes that no roster could resolve: a missing section, or a name on
// nobody's People list (a roster was always drawn from the People list, and
// people are never deleted).
const NEVER_RESOLVED = new Set(['missing', 'nobody']);

/**
 * The transition-plan check S16 names (read-only): each saved plan's
 * RECOMMENDED LEAD and RECOMMENDED SECOND CHAIR resolved as the parser
 * resolves them (resolveRecommendation), against everyone on today's People
 * list, active or not. The plan does not store the roster it was given (the
 * people staying, as active then), so today's whole list stands in for it:
 * a wider roster, on which a seat naming nobody named nobody on the plan's
 * roster too (unless the person was renamed since), so the count of plans
 * with such a seat is a lower bound; a seat naming several people, or a lead
 * who is not a partner today, may have resolved on the plan's roster, which
 * left the people leaving out. Returns { total, declined, cutOff, lead,
 * second, neverResolved, maybe, rows }.
 */
function planCheck(plans = [], people = []) {
  const roster = people.map((p) => ({ id: p.id, name: p.name, role: p.role }));
  const lead = {};
  const second = {};
  const rows = [];
  let declined = 0;
  let cutOff = 0;
  for (const plan of plans) {
    if (plan.refused) declined += 1;
    if (plan.truncated) cutOff += 1;
    const text = plan.refused ? '' : String(plan.answer ?? '');
    const leadResolved = resolveRecommendation(extractSection(text, 'RECOMMENDED LEAD'), roster, { seat: 'lead' });
    const secondResolved = resolveRecommendation(extractSection(text, 'RECOMMENDED SECOND CHAIR'), roster, {
      seat: 'second',
      leadId: leadResolved.person ? leadResolved.person.id : null,
    });
    const outcomes = { lead: seatOutcome(leadResolved), second: seatOutcome(secondResolved) };
    lead[outcomes.lead] = (lead[outcomes.lead] || 0) + 1;
    second[outcomes.second] = (second[outcomes.second] || 0) + 1;
    rows.push({ plan, outcomes, lead: leadResolved, second: secondResolved });
  }
  const unresolved = (row) => !['resolved', 'none'].includes(row.outcomes.lead) || !['resolved', 'none'].includes(row.outcomes.second);
  const never = (row) => NEVER_RESOLVED.has(row.outcomes.lead) || NEVER_RESOLVED.has(row.outcomes.second);
  return {
    total: plans.length,
    declined,
    cutOff,
    lead,
    second,
    neverResolved: rows.filter(never).length,
    maybe: rows.filter((row) => unresolved(row) && !never(row)).length,
    rows,
  };
}

const OUTCOME_TEXT = {
  resolved: 'resolved to one person',
  none: '"None" (no second chair)',
  missing: 'no recommendation (declined, cut off or no section)',
  nobody: 'names nobody on the People list',
  several: 'names more than one person',
  notPartner: 'a lead who is not a partner today',
  isLead: 'the second chair is the recommended lead',
  other: 'another problem',
};

/** planCheck's result as the lines --plans prints. */
function planLines(check, people = []) {
  const counts = (tally) => Object.keys(OUTCOME_TEXT).filter((k) => tally[k]).map((k) => `${OUTCOME_TEXT[k]} ${tally[k]}`).join('; ') || 'none';
  const lines = [
    `Saved transition plans: ${check.total} (declined ${check.declined}, cut off ${check.cutOff}).`,
    `Resolved as the parser resolves them (resolveRecommendation), against everyone on today's People list (${people.length} people, active or not), since a saved plan does not store the roster it was given.`,
    `Recommended lead: ${counts(check.lead)}.`,
    `Recommended second chair: ${counts(check.second)}.`,
    `Plans with a seat no roster could resolve (no recommendation, or a name on nobody's People list): ${check.neverResolved}. A lower bound: the plan's roster was narrower than today's list (unless someone was renamed since).`,
    `Plans with a seat that did not resolve on today's list but may have on the plan's roster (several names, a lead not a partner today, the lead named again): ${check.maybe}.`,
  ];
  const listed = check.rows.filter((row) => !['resolved', 'none'].includes(row.outcomes.lead) || !['resolved', 'none'].includes(row.outcomes.second));
  if (listed.length) lines.push('', 'Plans not resolved on today\'s list:');
  for (const row of listed) {
    for (const seat of ['lead', 'second']) {
      if (['resolved', 'none'].includes(row.outcomes[seat])) continue;
      const first = String(row[seat].text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
      lines.push(`  #${row.plan.id}  ${firmStamp(row.plan.created_at).slice(0, 10)}  ${row.plan.client_name || 'client not recorded'}  ${seat === 'lead' ? 'lead' : 'second chair'}: ${OUTCOME_TEXT[row.outcomes[seat]]}${first ? `  "${oneLine(first, 100)}"` : ''}`);
    }
  }
  lines.push('', 'Nothing was changed. A proposal for structured output (the roster as an enum) is for Jeff to approve, and only if these plans show recommendations the parser could not resolve (S16).');
  return lines;
}

const bookLine = (book, prefix) => `Today's book: ${book.clientCount} clients, reporting year ${book.reportingYear}. System blocks: ${n(prefix.tokens)} tokens, ${prefix.basis}.`;

/** What the list prints: today's book, then every saved Ask, newest first, and how to go on. */
function listLines({ book, prefix, rows, todaySha }) {
  if (rows.length === 0) return [bookLine(book, prefix), 'No saved Asks yet. Nothing was sent.'];
  return [
    bookLine(book, prefix),
    `Saved Asks, newest first: ${rows.length} (id, date, who asked, the saved answer's tokens and cost, marks, the question's start). Hidden answers are included and marked.`,
    ...rows.map((row) => candidateLine(row, todaySha)),
    '',
    `Choose ${IDS_SUGGESTED_MIN} to ${IDS_MAX} by id, then see the estimate: node scripts/eval-ai.cjs --ids 12,15,18 (nothing is sent without --confirm).`,
    'Nothing was sent.',
  ];
}

/** The command that spends what the estimate printed. */
function confirmCommand({ ids, opus55 = [], out = null, stdout = false, figure }) {
  return [
    'node scripts/eval-ai.cjs',
    `--ids ${ids.join(',')}`,
    ...(opus55.length ? [`--opus-5-5 ${opus55.join(',')}`] : []),
    ...(out !== null ? [`--out ${JSON.stringify(out)}`] : []),
    ...(stdout ? ['--stdout'] : []),
    `--confirm ${figure}`,
  ].join(' ');
}

/**
 * What the estimate prints: the book, the questions, each configuration's
 * range, the total and the ceiling, where the calls go and where the
 * side-by-side goes, and the command that spends it. `target` is the file's
 * path (null with --stdout); `keySet` whether ANTHROPIC_API_KEY is set.
 */
function estimateLines({ book, prefix, answers, configs, estimate, target, keySet, callsTo, args }) {
  const calls = configs.length * answers.length;
  const lines = [
    'Evaluation estimate. Nothing has been sent.',
    bookLine(book, prefix),
    `Questions (${answers.length}), asked as new questions on today's book with today's date, as the Ask route asks them:`,
    ...answers.map((a) => `  #${a.id}  ${firmStamp(a.created_at).slice(0, 10)}  ${a.asked_by_username || 'a former account'}  saved: out ${n(a.output_tokens)}, ${storedUsd(a.cost_usd)}${a.refused ? ' (declined)' : ''}${a.parent_id !== null ? ` (a follow-up of #${a.parent_id}, asked alone)` : ''}  ${oneLine(a.question, 70)}`),
  ];
  if (answers.length < IDS_SUGGESTED_MIN) lines.push(`  (S16's evaluation set is ${IDS_SUGGESTED_MIN} to ${IDS_MAX} questions; ${answers.length} will do for a first look.)`);
  lines.push('Configurations, in the order they run (one call at a time, every question under one before the next):');
  estimate.configs.forEach((row, i) => {
    const config = configs[i];
    const note = config.model === OPUS_5_5 ? ' Runs without the server-side refusal fallback, which only FALLBACK_MODELS\' claude-opus-5 gets until Jeff chooses: a decline shows as one.' : '';
    lines.push(`  ${i + 1}. ${row.title}: ${row.calls} call${row.calls === 1 ? '' : 's'}, ${row.low === null ? 'no price' : `${formatUsd(row.low)} to ${formatUsd(row.high)}`}.${note}`);
  });
  if (estimate.unpriced.length) {
    lines.push(`Refused: no price in utils/aiCost.cjs for ${estimate.unpriced.join(', ')}, so nothing can be estimated. Nothing was sent.`);
    return lines;
  }
  lines.push(
    `Estimate: ${formatUsd(estimate.low)} to ${formatUsd(estimate.high)} for ${calls} call${calls === 1 ? '' : 's'}. Output from ${OUTPUT_LOW}x to ${OUTPUT_HIGH}x each saved answer's output tokens (thinking included), which vary with effort and model; the system blocks written to the cache once per configuration and read on its other calls. List prices from utils/aiCost.cjs; the Anthropic Console is the bill.`,
    `At most ${formatUsd(estimate.ceiling)} if every answer ran to its ${ASK_MAX_TOKENS.toLocaleString('en-US')}-token limit and no call read the cache (a server-side fallback, when one runs, adds its own attempt).`,
    `The run stops before a call once the calls so far have cost $${estimate.figure} (the last call can take it past, by at most one answer).`,
    'The script writes nothing to the database: its cost shows in the Anthropic Console, not in the AI tab\'s month total. The app\'s AI rate limits (30 an hour per partner, 300 a day for the firm) do not apply to it; it takes at most 20 questions.',
    `Calls go to ${callsTo}.${keySet ? '' : ' ANTHROPIC_API_KEY is not set: the run will refuse until it is.'}`,
    target === null ? 'The side-by-side will be printed to standard output (--stdout).' : `The side-by-side will be written to ${target}. It holds the firm's questions, answers and client names: delete it when you are done.`,
    `Nothing was sent. To spend up to $${estimate.figure}, run:`,
    `  ${confirmCommand({ ...args, figure: estimate.figure })}`,
  );
  return lines;
}

// --- SQL (read-only; untyped placeholders, as utils/aiAnswers.cjs) ----------

// Every saved Ask, newest first, hidden ones included (the list marks them).
const CANDIDATES_SQL = `
  SELECT id, question, parent_id, asked_by_username, created_at, refused, truncated,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
         book_sha256, hidden_at, hidden_by_username
    FROM ai_answers
   WHERE kind = 'ask'
   ORDER BY created_at DESC, id DESC`;

// The chosen answers, whole (the stored turn aside: the script asks the
// question as saved, with today's date, never the saved turn).
const CHOSEN_SQL = `
  SELECT id, kind, question, answer, parent_id, asked_by_username, created_at,
         model, served_by, fell_back, truncated, refused, refusal_category,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
         book_sha256, duration_ms, hidden_at
    FROM ai_answers
   WHERE id = ANY($1)`;

// The system blocks' size on today's book, from the newest answer given on
// it that read or wrote them in the cache: a first question, a brief or a
// transition plan (a follow-up's cache also holds its thread).
const TODAY_PREFIX_SQL = `
  SELECT id, cache_read_tokens + cache_write_tokens AS tokens
    FROM ai_answers
   WHERE book_sha256 = $1 AND parent_id IS NULL AND cache_read_tokens + cache_write_tokens > 0
   ORDER BY created_at DESC, id DESC
   LIMIT 1`;

const PLANS_SQL = `
  SELECT id, client_name, created_at, answer, refused, truncated
    FROM ai_answers
   WHERE kind = 'transition-plan'
   ORDER BY created_at, id`;

const PEOPLE_SQL = 'SELECT id, name, role, active FROM people ORDER BY id';

/**
 * The chosen answers in the order given, or the problem: an id with no saved
 * answer, or one that is not an Ask.
 */
function orderChosen(ids, rows) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { error: `No saved answer ${missing.map((id) => `#${id}`).join(', ')}. Run without arguments to list the saved Asks.` };
  const other = ids.filter((id) => byId.get(id).kind !== 'ask');
  if (other.length) return { error: `Not an Ask: ${other.map((id) => `#${id} (${byId.get(id).kind})`).join(', ')}. The evaluation asks saved questions only.` };
  return { answers: ids.map((id) => byId.get(id)) };
}

module.exports = {
  IDS_MAX,
  IDS_SUGGESTED_MIN,
  EFFORT_LEVELS,
  BASE_CONFIGURATIONS,
  OUTPUT_LOW,
  OUTPUT_HIGH,
  OUTPUT_UNKNOWN,
  CHARS_PER_TOKEN,
  OUTPUT_DIR,
  LABEL,
  USAGE,
  OPUS_5_5,
  parseArgs,
  readConfirm,
  configurations,
  prefixEstimate,
  turnTokens,
  estimateRun,
  centsText,
  formatUsd,
  firmStamp,
  defaultOutputPath,
  outputPathProblem,
  callTarget,
  candidateLine,
  bookLabel,
  shownAnswer,
  configTotals,
  renderSideBySide,
  seatOutcome,
  planCheck,
  planLines,
  listLines,
  confirmCommand,
  estimateLines,
  orderChosen,
  CANDIDATES_SQL,
  CHOSEN_SQL,
  TODAY_PREFIX_SQL,
  PLANS_SQL,
  PEOPLE_SQL,
};
