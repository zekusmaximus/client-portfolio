// Model and effort from real answers (docs/plans/tier-2.md, S16, WP11):
// utils/evalAi.cjs, the pure half of scripts/eval-ai.cjs (the command line,
// the configurations, the estimate, where the side-by-side may go, the
// candidate list, the side-by-side, and the transition-plan check), then the
// script itself as a child process on a throwaway database, against the fake
// Anthropic server: the list, the estimate sending nothing, the refusals,
// confirmed runs of two and three configurations, --stdout, the spend cap,
// declines, cut-offs, fallbacks and errors as the AI tab shows them, the
// transition-plan check, and the database byte for byte unchanged
// throughout.
//
// The database tests need SCHEMA_TEST_SERVER_URL, as tests/schema.test.mjs's
// (CI's schema job runs this file too); without it they are skipped.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import evalAi from '../utils/evalAi.cjs';
import aiCost from '../utils/aiCost.cjs';
import askPrompts from '../utils/askPrompts.cjs';
import ai from '../services/anthropic.cjs';
import { startFakeAnthropic } from './helpers/fakeAnthropic.mjs';
import { repo, serverUrl, urlFor } from './helpers/server.mjs';

const {
  IDS_MAX,
  EFFORT_LEVELS,
  BASE_CONFIGURATIONS,
  OUTPUT_DIR,
  OUTPUT_UNKNOWN,
  parseArgs,
  readConfirm,
  configurations,
  prefixEstimate,
  turnTokens,
  estimateRun,
  formatUsd,
  defaultOutputPath,
  outputPathProblem,
  callTarget,
  candidateLine,
  bookLabel,
  shownAnswer,
  renderSideBySide,
  planCheck,
  planLines,
  listLines,
  confirmCommand,
  estimateLines,
  orderChosen,
} = evalAi;

const execFileAsync = promisify(execFile);
const NOW = new Date('2026-10-12T18:00:00Z');

// --- The command line ------------------------------------------------------

test('parseArgs: no arguments list, --plans checks the plans, --ids estimates, --confirm runs', () => {
  assert.deepEqual(parseArgs([]), { mode: 'list', ids: [], opus55: [], out: null, stdout: false, confirm: null });
  assert.equal(parseArgs(['--plans']).mode, 'plans');
  assert.deepEqual(parseArgs(['--ids', '12, 15,18']), { mode: 'estimate', ids: [12, 15, 18], opus55: [], out: null, stdout: false, confirm: null });
  const run = parseArgs(['--ids', '3', '--opus-5-5', 'medium,HIGH', '--out', '/tmp/x.md', '--confirm', '$2.51']);
  assert.deepEqual(run, { mode: 'run', ids: [3], opus55: ['medium', 'high'], out: '/tmp/x.md', stdout: false, confirm: '$2.51' });
  assert.equal(parseArgs(['--ids', '3', '--stdout']).stdout, true);
});

test('parseArgs: every malformed command line is an error before anything connects', () => {
  const errors = {
    '--bogus': ['--bogus'],
    'twice': ['--ids', '1', '--ids', '2'],
    'no value': ['--ids'],
    'a flag as value': ['--ids', '--stdout'],
    'not an id': ['--ids', '1,x'],
    'zero': ['--ids', '0'],
    'too big for an integer': ['--ids', '2147483648'],
    'duplicate': ['--ids', '4,4'],
    'too many': ['--ids', Array.from({ length: IDS_MAX + 1 }, (_, i) => i + 1).join(',')],
    'no ids': ['--stdout'],
    'confirm without ids': ['--confirm', '1.00'],
    'plans with more': ['--plans', '--ids', '1'],
    'out and stdout': ['--ids', '1', '--out', 'a.md', '--stdout'],
    'bad figure': ['--ids', '1', '--confirm', 'lots'],
    'three decimals': ['--ids', '1', '--confirm', '1.234'],
    'bad effort': ['--ids', '1', '--opus-5-5', 'turbo'],
    'effort twice': ['--ids', '1', '--opus-5-5', 'medium,medium'],
  };
  for (const [what, argv] of Object.entries(errors)) {
    assert.equal(typeof parseArgs(argv).error, 'string', what);
  }
  assert.equal(parseArgs(['--ids', Array.from({ length: IDS_MAX }, (_, i) => i + 1).join(',')]).error, undefined, '20 ids');
});

test('readConfirm: the estimate\'s dollar figure in cents, with or without $', () => {
  assert.equal(readConfirm('2.51'), 251);
  assert.equal(readConfirm('$2.51'), 251);
  assert.equal(readConfirm('2.5'), 250);
  assert.equal(readConfirm('2'), 200);
  assert.equal(readConfirm('0.07'), 7);
  for (const bad of ['', 'x', '-1', '1.234', '1,000', null, undefined]) assert.equal(readConfirm(bad), null, String(bad));
});

// --- The configurations -----------------------------------------------------

test('configurations: S16\'s two on claude-opus-5 (the API\'s default effort, then medium), claude-opus-5-5 only when asked, its effort always set', () => {
  assert.deepEqual(configurations().map(({ key, model, effort }) => ({ key, model, effort })), [
    { key: 'opus-5-default', model: 'claude-opus-5', effort: null },
    { key: 'opus-5-medium', model: 'claude-opus-5', effort: 'medium' },
  ]);
  assert.equal(configurations()[0].title, "claude-opus-5, the API's default effort (high)");
  assert.equal(configurations()[1].title, 'claude-opus-5, effort medium');
  const withNew = configurations({ opus55: ['medium', 'high'] });
  assert.deepEqual(withNew.slice(2).map(({ key, model, effort, title }) => ({ key, model, effort, title })), [
    { key: 'opus-5-5-medium', model: 'claude-opus-5-5', effort: 'medium', title: 'claude-opus-5-5, effort medium' },
    { key: 'opus-5-5-high', model: 'claude-opus-5-5', effort: 'high', title: 'claude-opus-5-5, effort high' },
  ]);
  assert.deepEqual(BASE_CONFIGURATIONS.map((c) => c.model), ['claude-opus-5', 'claude-opus-5'], "D7's model, AI_MODEL's default");
});

test('the effort levels are the service\'s, and every configuration\'s model has a price', () => {
  assert.deepEqual(EFFORT_LEVELS, ai.EFFORT_LEVELS);
  for (const config of configurations({ opus55: EFFORT_LEVELS })) assert.ok(aiCost.PRICES[config.model], config.model);
  // The service accepts each configuration's effort
  for (const config of configurations({ opus55: EFFORT_LEVELS })) assert.equal(ai.readEffort(config.effort ?? undefined), config.effort);
});

// --- The estimate -----------------------------------------------------------

test('prefixEstimate: measured on today\'s book when an answer read or wrote it, else the characters at two a token', () => {
  assert.deepEqual(prefixEstimate({ measured: { id: 7, tokens: 9811 }, systemChars: 23080 }), {
    tokens: 9811, measuredBy: 7, basis: "measured by answer #7 on today's book",
  });
  const estimated = prefixEstimate({ measured: undefined, systemChars: 23081 });
  assert.equal(estimated.tokens, 11541);
  assert.equal(estimated.measuredBy, null);
  assert.match(estimated.basis, /23,081 characters at 2 a token/);
  assert.equal(prefixEstimate({ measured: { id: 3, tokens: 0 }, systemChars: 10 }).tokens, 5);
});

test('turnTokens: a first question\'s saved uncached input when it used the cache, else the turn\'s characters at two a token', () => {
  const first = { parent_id: null, question: 'Who carries the most?', input_tokens: 57, cache_read_tokens: 9811, cache_write_tokens: 0 };
  assert.equal(turnTokens(first, NOW), 57);
  const turnChars = askPrompts.askTurn('Who carries the most?', NOW).length;
  assert.equal(turnTokens({ ...first, parent_id: 4 }, NOW), Math.ceil(turnChars / 2), 'a follow-up\'s input is not its turn alone');
  assert.equal(turnTokens({ ...first, cache_read_tokens: 0 }, NOW), Math.ceil(turnChars / 2), 'no cache counts');
});

// Two saved Asks: the first wrote the 10,000-token prefix, the second read it.
const SAVED = [
  { id: 1, parent_id: null, question: 'a', input_tokens: 50, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 10000, refused: false },
  { id: 2, parent_id: null, question: 'b', input_tokens: 60, output_tokens: 2000, cache_read_tokens: 10000, cache_write_tokens: 0, refused: false },
];
const PREFIX = { tokens: 10000, measuredBy: 1, basis: 'measured' };

test('estimateRun: the prefix written once and read after, each turn uncached, output 0.5x to 2x the saved, per configuration and in all', () => {
  const est = estimateRun({ answers: SAVED, configs: configurations(), prefix: PREFIX, now: NOW });
  // Per claude-opus-5 configuration, in millionths of a dollar:
  //   input  10,000 x 6.25 + 10,000 x 0.5 + (50 + 60) x 5 = 68,050
  //   output low (500 + 1,000) x 25 = 37,500; high (2,000 + 4,000) x 25 = 150,000
  //   ceiling 2 x 10,000 x 6.25 + 550 + 2 x 32,000 x 25 = 1,725,550
  for (const row of est.configs) {
    assert.equal(row.calls, 2);
    assert.equal(row.low, 0.10555);
    assert.equal(row.high, 0.21805);
    assert.equal(row.ceiling, 1.72555);
  }
  assert.equal(est.low, 0.2111);
  assert.equal(est.high, 0.4361);
  assert.equal(est.ceiling, 3.4511);
  assert.equal(est.figure, '0.44', 'the high end rounded up to the cent');
  assert.deepEqual(est.unpriced, []);
});

test('estimateRun: claude-opus-5-5 at its own prices, its cache reads at 0.05x', () => {
  const est = estimateRun({ answers: SAVED, configs: configurations({ opus55: ['medium'] }), prefix: PREFIX, now: NOW });
  const row = est.configs[2];
  // input 10,000 x 5 + 10,000 x 0.2 + 110 x 4 = 52,440; output 1,500 x 20 and 6,000 x 20
  assert.equal(row.low, 0.08244);
  assert.equal(row.high, 0.17244);
  assert.equal(row.ceiling, 1.38044);
  assert.equal(est.high, 0.60854);
  assert.equal(est.figure, '0.61');
});

test('estimateRun: a declined saved answer counts as the longest chosen; all empty count as 4,000 tokens; never above max_tokens', () => {
  const declined = [{ ...SAVED[0] }, { ...SAVED[1], refused: true, output_tokens: 0 }];
  const one = [configurations()[0]];
  const a = estimateRun({ answers: declined, configs: one, prefix: PREFIX, now: NOW });
  // outputs 1,000 and (the longest) 1,000: high (2,000 + 2,000) x 25
  assert.equal(a.configs[0].high, round6((68050 + 4000 * 25) / 1e6));
  const empty = SAVED.map((s) => ({ ...s, output_tokens: 0 }));
  const b = estimateRun({ answers: empty, configs: one, prefix: PREFIX, now: NOW });
  assert.equal(b.configs[0].low, round6((68050 + 2 * OUTPUT_UNKNOWN * 0.5 * 25) / 1e6));
  const huge = SAVED.map((s) => ({ ...s, output_tokens: 30000 }));
  const c = estimateRun({ answers: huge, configs: one, prefix: PREFIX, now: NOW });
  assert.equal(c.configs[0].high, round6((68050 + 2 * 32000 * 25) / 1e6), 'capped at max_tokens');
});

test('estimateRun: a model without a price estimates nothing, and says which', () => {
  const est = estimateRun({ answers: SAVED, configs: [...configurations(), { key: 'x', model: 'claude-unknown', effort: null, title: 'x' }], prefix: PREFIX, now: NOW });
  assert.deepEqual(est.unpriced, ['claude-unknown']);
  assert.equal(est.figure, null);
  assert.equal(est.high, null);
});

const round6 = (usd) => Math.round(usd * 1e6) / 1e6;

test('formatUsd: two places from a dollar, four below it', () => {
  assert.equal(formatUsd(2.514), '$2.51');
  assert.equal(formatUsd(0.0431), '$0.0431');
  assert.equal(formatUsd(0.5), '$0.5000');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(null), 'no price');
});

// --- Where the side-by-side may go -------------------------------------------

test('outputPathProblem: inside the repository only under eval-ai-output/; anywhere outside it', () => {
  const root = resolve(repo);
  assert.equal(outputPathProblem({ repoRoot: root, target: join(root, OUTPUT_DIR, 'run.md') }), null);
  assert.equal(outputPathProblem({ repoRoot: root, target: join(root, OUTPUT_DIR, 'a', 'b.md') }), null);
  assert.equal(outputPathProblem({ repoRoot: root, target: join(tmpdir(), 'run.md') }), null);
  assert.equal(outputPathProblem({ repoRoot: root, target: resolve(root, '..', 'run.md') }), null);
  for (const inside of ['run.md', 'docs/run.md', `${OUTPUT_DIR}`, 'eval-ai-output-2/run.md', 'tests/fixtures/run.md']) {
    assert.match(outputPathProblem({ repoRoot: root, target: join(root, inside) }), /inside the repository, which is public/, inside);
  }
  assert.equal(outputPathProblem({ repoRoot: root, target: resolve(root, defaultOutputPath(NOW)) }), null, 'the default is allowed');
  assert.equal(defaultOutputPath(NOW), join(OUTPUT_DIR, 'eval-ai-20261012-180000.md'));
});

test('.gitignore ignores eval-ai-output/, so the side-by-side is never committed', () => {
  assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /^eval-ai-output\/$/m);
  let git = true;
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { git = false; }
  if (git && existsSync(join(repo, '.git'))) {
    const out = execFileSync('git', ['check-ignore', '--no-index', join(OUTPUT_DIR, 'eval-ai-20261012-180000.md')], { cwd: repo, encoding: 'utf8' });
    assert.match(out, /eval-ai-output/);
  }
});

test('callTarget: Anthropic\'s API in production whatever ANTHROPIC_BASE_URL says, else the variable when set', () => {
  assert.equal(callTarget({ NODE_ENV: 'production', ANTHROPIC_BASE_URL: 'http://127.0.0.1:5099' }), 'https://api.anthropic.com');
  assert.equal(callTarget({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:5099' }), 'http://127.0.0.1:5099');
  assert.equal(callTarget({}), 'https://api.anthropic.com');
});

// --- The list, the estimate's lines and the side-by-side ----------------------

const ROW = {
  id: 12, question: 'Who carries\nthe most effort?', parent_id: null, asked_by_username: 'jeff', created_at: '2026-10-01T14:00:00Z',
  refused: false, truncated: false, input_tokens: 57, output_tokens: 1234, cache_read_tokens: 9811, cache_write_tokens: 0,
  cost_usd: '0.0431', book_sha256: 'a'.repeat(64), hidden_at: null, hidden_by_username: null,
};

test('candidateLine: id, date, who, tokens and cost, then the marks, then the question on one line', () => {
  assert.equal(candidateLine(ROW, 'a'.repeat(64)), '#12  2026-10-01  jeff  in 57, cache read 9,811, cache write 0, out 1,234  $0.0431  Who carries the most effort?');
  const marked = candidateLine({ ...ROW, parent_id: 9, hidden_at: '2026-10-02T00:00:00Z', hidden_by_username: 'kevin', refused: true, truncated: true, asked_by_username: null }, 'b'.repeat(64));
  assert.match(marked, /a former account/);
  assert.match(marked, /\[follow-up of #9, asked alone; hidden by kevin; declined; cut off; earlier book\]/);
});

test('listLines: today\'s book, the Asks, how to go on; and an empty list', () => {
  const book = { clientCount: 84, reportingYear: 2026 };
  const lines = listLines({ book, prefix: PREFIX, rows: [ROW], todaySha: 'a'.repeat(64) });
  assert.match(lines[0], /84 clients, reporting year 2026/);
  assert.ok(lines.some((line) => line.startsWith('#12  ')));
  assert.equal(lines.at(-1), 'Nothing was sent.');
  assert.deepEqual(listLines({ book, prefix: PREFIX, rows: [], todaySha: 'x' }).slice(1), ['No saved Asks yet. Nothing was sent.']);
});

test('estimateLines: nothing sent, each configuration\'s range, the ceiling, where calls and the file go, and the confirm command', () => {
  const configs = configurations({ opus55: ['medium'] });
  const estimate = estimateRun({ answers: SAVED, configs, prefix: PREFIX, now: NOW });
  const args = { ids: [1, 2], opus55: ['medium'], out: null, stdout: false };
  const lines = estimateLines({
    book: { clientCount: 3, reportingYear: 2026 }, prefix: PREFIX,
    answers: SAVED.map((s) => ({ ...s, created_at: ROW.created_at, asked_by_username: 'jeff', cost_usd: '0.01' })),
    configs, estimate, target: '/tmp/x.md', keySet: false, callsTo: 'https://api.anthropic.com', args,
  });
  const text = lines.join('\n');
  assert.equal(lines[0], 'Evaluation estimate. Nothing has been sent.');
  assert.match(text, /3\. claude-opus-5-5, effort medium: 2 calls, \$0\.0824 to \$0\.1724\. Runs without the server-side refusal fallback/);
  assert.match(text, /Estimate: \$0\.2935 to \$0\.6085 for 6 calls/);
  assert.match(text, /At most \$4\.83 if every answer ran to its 32,000-token limit/);
  assert.match(text, /S16's evaluation set is 10 to 20 questions/);
  assert.match(text, /not in the AI tab's month total/);
  assert.match(text, /ANTHROPIC_API_KEY is not set/);
  assert.match(text, /written to \/tmp\/x\.md/);
  assert.equal(lines.at(-1), '  node scripts/eval-ai.cjs --ids 1,2 --opus-5-5 medium --confirm 0.61');
  assert.equal(confirmCommand({ ids: [5], out: 'a b.md', figure: '1.00' }), 'node scripts/eval-ai.cjs --ids 5 --out "a b.md" --confirm 1.00');
  assert.equal(confirmCommand({ ids: [5], stdout: true, figure: '1.00' }), 'node scripts/eval-ai.cjs --ids 5 --stdout --confirm 1.00');
  assert.equal(confirmCommand({ ids: [5], out: 'C:\\Users\\jeff\\eval-ai.md', figure: '1.00' }), 'node scripts/eval-ai.cjs --ids 5 --out C:\\Users\\jeff\\eval-ai.md --confirm 1.00', 'a Windows path as typed');
  assert.equal(confirmCommand({ ids: [5], out: '/tmp/eval-ai.md', figure: '1.00' }), 'node scripts/eval-ai.cjs --ids 5 --out /tmp/eval-ai.md --confirm 1.00');
});

test('shownAnswer: a decline and a cut-off as the AI tab words them', () => {
  const page = readFileSync(join(repo, 'src/AIAdvisor.jsx'), 'utf8');
  assert.ok(page.includes('The AI declined to answer this request.'));
  assert.ok(page.includes('The response was cut off; ask a narrower question.'));
  assert.equal(shownAnswer({ refused: true, refusalCategory: 'cyber', text: 'partial' }), '_The AI declined to answer this request. (Category: cyber.)_');
  assert.equal(shownAnswer({ refused: true, refusalCategory: null }), '_The AI declined to answer this request._');
  assert.equal(shownAnswer({ text: 'Half an', truncated: true }), 'Half an\n\n_The response was cut off; ask a narrower question._');
  assert.equal(shownAnswer({ text: '  Kevin.  ' }), 'Kevin.');
  assert.equal(bookLabel('a', 'a'), "given on today's book");
  assert.equal(bookLabel('a', 'b'), 'given on an earlier book');
  assert.equal(bookLabel(null, 'b'), 'the book it was given on is not recorded');
});

test('renderSideBySide: the warning, the totals, each question with its saved answer and each configuration\'s, errors and calls not run', () => {
  const configs = configurations();
  const questions = [
    { ...ROW, answer: 'Kevin carries the most.', model: 'claude-opus-5', served_by: 'claude-opus-5', fell_back: false, refusal_category: null, duration_ms: 21000 },
    { ...ROW, id: 13, question: 'And Paula?', answer: '', refused: true, refusal_category: 'cyber', book_sha256: 'c'.repeat(64), model: 'claude-opus-5', served_by: 'claude-opus-5', fell_back: false, duration_ms: null },
  ];
  const tokens = { inputTokens: 60, outputTokens: 900, cacheReadTokens: 9811, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
  const results = [
    { configKey: 'opus-5-default', answerId: 12, text: 'Kevin.', truncated: false, refused: false, refusalCategory: null, servedBy: 'claude-opus-5', fellBack: false, tokens, costUsd: 0.0277, ms: 12345 },
    { configKey: 'opus-5-default', answerId: 13, text: '', truncated: false, refused: false, refusalCategory: null, servedBy: 'claude-opus-4-8', fellBack: true, tokens, costUsd: 0.03, ms: 2000 },
    { configKey: 'opus-5-medium', answerId: 12, error: 'The AI service is temporarily unavailable.', ms: 100 },
  ];
  const md = renderSideBySide({
    startedAt: NOW, book: { clientCount: 84, reportingYear: 2026, sha: 'a'.repeat(64) }, prefix: PREFIX, configs, questions, results,
    status: 'Stopped at Ctrl-C', approved: '0.44',
  });
  assert.match(md, /^# AI evaluation: side by side\n\n> This file holds the firm's questions, answers and client names\. Do not commit it/);
  assert.match(md, /Run from 2026-10-12 14:00 \(America\/New_York\) on today's book: 84 clients, reporting year 2026, book SHA-256 aaaaaaaaaaaa\./);
  assert.match(md, /Stopped at Ctrl-C \(3 of 4 calls; approved up to \$0\.44\)\./);
  assert.match(md, /\| claude-opus-5, the API's default effort \(high\) \| 2 \| 0 \| 0 \| 1 \| 0 \| 1,800 \| \$0\.0577 \| 7\.2 s \|/);
  assert.match(md, /\| claude-opus-5, effort medium \| 0 \| 0 \| 0 \| 0 \| 1 \| 0 \| \$0\.00 \| — \|/);
  assert.match(md, /## 1\. Question #12\n\nAsked by jeff on 2026-10-01 10:00\.\n\n> Who carries\n> the most effort\?/);
  assert.match(md, /### Saved answer \(given on today's book\)\n\nclaude-opus-5, served by claude-opus-5; tokens in 57, cache read 9,811, cache write 0, out 1,234; \$0\.0431; 21\.0 s\n\nKevin carries the most\./);
  assert.match(md, /### Saved answer \(given on an earlier book\)[\s\S]*time not recorded\n\n_The AI declined to answer this request\. \(Category: cyber\.\)_/);
  assert.match(md, /### claude-opus-5, the API's default effort \(high\)\n\nserved by claude-opus-5; tokens in 60, cache read 9,811, cache write 0, out 900; \$0\.0277; 12\.3 s\n\nKevin\./);
  assert.match(md, /served by claude-opus-4-8 after a decline \(a fallback\)/);
  assert.match(md, /### claude-opus-5, effort medium\n\n_Error: The AI service is temporarily unavailable\._/);
  assert.match(md, /## 2\. Question #13[\s\S]*### claude-opus-5, effort medium\n\n_Not run\._/);
  assert.match(md, /not in the AI tab's month total/);
});

test('orderChosen: the answers in the order given; a missing id or one that is not an Ask refuses', () => {
  const rows = [{ id: 3, kind: 'ask' }, { id: 1, kind: 'ask' }, { id: 2, kind: 'brief' }];
  assert.deepEqual(orderChosen([1, 3], rows).answers.map((a) => a.id), [1, 3]);
  assert.match(orderChosen([1, 9], rows).error, /No saved answer #9/);
  assert.match(orderChosen([1, 2], rows).error, /Not an Ask: #2 \(brief\)/);
});

// --- The transition-plan check -----------------------------------------------

const PEOPLE = [
  { id: 1, name: 'Jeff', role: 'partner', active: true },
  { id: 2, name: 'Kevin', role: 'partner', active: true },
  { id: 3, name: 'Anna', role: 'associate', active: true },
  { id: 4, name: 'Jay', role: 'emeritus', active: false },
];
const planText = (lead, second) => `## TRANSITION STRATEGY\nKeep it warm.\n\n## RECOMMENDED LEAD\n${lead}\n\n## RECOMMENDED SECOND CHAIR\n${second}\n\n## TIMELINE\n60 days`;
const PLANS = [
  { id: 1, client_name: 'Acme', created_at: '2026-10-01T14:00:00Z', answer: planText('Jeff, who holds healthcare.', 'Anna'), refused: false, truncated: false },
  { id: 2, client_name: 'Bay', created_at: '2026-10-01T14:00:00Z', answer: planText('Zed Smith', 'None: Jeff can carry it'), refused: false, truncated: false },
  { id: 3, client_name: 'Cove', created_at: '2026-10-01T14:00:00Z', answer: planText('Jeff (taking over from Kevin)', 'Anna'), refused: false, truncated: false },
  { id: 4, client_name: 'Dune', created_at: '2026-10-01T14:00:00Z', answer: planText('Anna', 'Jeff'), refused: false, truncated: false },
  { id: 5, client_name: 'Echo', created_at: '2026-10-01T14:00:00Z', answer: planText('Kevin', 'Kevin'), refused: false, truncated: false },
  { id: 6, client_name: 'Fern', created_at: '2026-10-01T14:00:00Z', answer: '', refused: true, truncated: false },
  { id: 7, client_name: 'Gale', created_at: '2026-10-01T14:00:00Z', answer: '## TRANSITION STRATEGY\nStart with', refused: false, truncated: true },
];

test('planCheck: each seat resolved as the parser resolves it, against everyone on today\'s People list', () => {
  const check = planCheck(PLANS, PEOPLE);
  assert.equal(check.total, 7);
  assert.equal(check.declined, 1);
  assert.equal(check.cutOff, 1);
  assert.deepEqual(check.rows.map((r) => [r.plan.id, r.outcomes.lead, r.outcomes.second]), [
    [1, 'resolved', 'resolved'],
    [2, 'nobody', 'none'],
    [3, 'several', 'resolved'],
    [4, 'notPartner', 'resolved'],
    [5, 'resolved', 'isLead'],
    [6, 'missing', 'missing'],
    [7, 'missing', 'missing'],
  ]);
  assert.deepEqual(check.lead, { resolved: 2, nobody: 1, several: 1, notPartner: 1, missing: 2 });
  assert.deepEqual(check.second, { resolved: 3, none: 1, isLead: 1, missing: 2 });
  assert.equal(check.neverResolved, 3, 'a name on nobody\'s list, a declined plan and a cut-off one: a lower bound');
  assert.equal(check.maybe, 3, 'several names, a lead not a partner today and the lead named again may have resolved on the plan\'s roster');
  assert.equal(check.rows[0].lead.person.name, 'Jeff');
});

test('planLines: the counts, the lower bound, each plan not resolved with its first line, and nothing changed', () => {
  const lines = planLines(planCheck(PLANS, PEOPLE), PEOPLE);
  const text = lines.join('\n');
  assert.match(text, /^Saved transition plans: 7 \(declined 1, cut off 1\)\./);
  assert.match(text, /against everyone on today's People list \(4 people, active or not\)/);
  assert.match(text, /Recommended lead: resolved to one person 2; no recommendation \(declined, cut off or no section\) 2; names nobody on the People list 1; names more than one person 1; a lead who is not a partner today 1\./);
  assert.match(text, /no roster could resolve[^:]*: 3\. A lower bound/);
  assert.match(text, /may have on the plan's roster[^:]*: 3\./);
  assert.match(text, /#2 {2}2026-10-01 {2}Bay {2}lead: names nobody on the People list {2}"Zed Smith"/);
  assert.match(text, /#5 {2}2026-10-01 {2}Echo {2}second chair: the second chair is the recommended lead {2}"Kevin"/);
  assert.ok(!/#1 /.test(text), 'a resolved plan is not listed');
  assert.match(lines.at(-1), /^Nothing was changed\./);
  assert.deepEqual(planCheck([], PEOPLE).neverResolved, 0);
});

test('the pure half needs no database, environment or network', () => {
  const source = readFileSync(join(repo, 'utils/evalAi.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(['"][./]*(db|data|server)\.cjs|require\(['"][./]*models\/|require\(['"][./]*services\/|process\.env|fetch\(/);
});

// --- The script, on PostgreSQL and the fake Anthropic server ------------------

const initSql = readFileSync(join(repo, 'init-db.sql'), 'utf8');

// Saved answers as the routes save them: three Asks (one a follow-up, one
// hidden), a brief and two transition plans, on an earlier book
const SEED_SQL = `
  INSERT INTO users (username, password_hash) VALUES ('jeff', 'x'), ('kevin', 'x');
  INSERT INTO clients (name, lead_id, conflict_risk, practice_area, stickiness, interaction_frequency)
  VALUES ('Acme Health', (SELECT id FROM people WHERE name = 'Jeff'), 'Low', '{Healthcare}', 4, 'Monthly'),
         ('Bay Energy', (SELECT id FROM people WHERE name = 'Kevin'), 'Medium', '{Energy}', NULL, 'Quarterly');
  INSERT INTO client_revenues (client_id, year, revenue_amount) SELECT id, 2025, 120000 FROM clients;
  INSERT INTO ai_answers (kind, question, answer, asked_by, asked_by_username, model, served_by, stop_reason,
                          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, prices_read_on,
                          book_sha256, reporting_year, duration_ms, created_at)
  VALUES ('ask', 'Who carries the most effort?', 'Kevin carries the most.', 1, 'jeff', 'claude-opus-5', 'claude-opus-5', 'end_turn',
          57, 1200, 0, 3000, 0.0490, '2026-09-26', repeat('e', 64), 2025, 21000, '2026-09-20T14:00:00Z'),
         ('ask', 'Where is the exposure?', 'On Bay Energy.', 2, 'kevin', 'claude-opus-5', 'claude-opus-5', 'end_turn',
          61, 800, 3000, 0, 0.0218, '2026-09-26', repeat('e', 64), 2025, 15000, '2026-09-21T14:00:00Z'),
         ('brief', NULL, 'The brief.', 1, 'jeff', 'claude-opus-5', 'claude-opus-5', 'end_turn',
          40, 2000, 3000, 0, 0.0520, '2026-09-26', repeat('e', 64), 2025, 40000, '2026-09-22T14:00:00Z');
  INSERT INTO ai_answers (kind, question, answer, parent_id, asked_by, asked_by_username, model, served_by, stop_reason,
                          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, prices_read_on,
                          book_sha256, reporting_year, duration_ms, created_at, hidden_at, hidden_by_username)
  VALUES ('ask', 'And for Kevin?', 'Kevin leads Bay Energy.', 1, 1, 'jeff', 'claude-opus-5', 'claude-opus-5', 'end_turn',
          5, 400, 3100, 0, 0.0126, '2026-09-26', repeat('e', 64), 2025, 9000, '2026-09-23T14:00:00Z', '2026-09-24T14:00:00Z', 'kevin');
  INSERT INTO ai_answers (kind, answer, client_id, client_name, asked_by, asked_by_username, model, served_by, stop_reason,
                          input_tokens, output_tokens, cost_usd, created_at)
  VALUES ('transition-plan', E'## RECOMMENDED LEAD\\nJeff\\n\\n## RECOMMENDED SECOND CHAIR\\nNone', '1', 'Acme Health', 1, 'jeff',
          'claude-opus-5', 'claude-opus-5', 'end_turn', 3000, 900, 0.0375, '2026-09-25T14:00:00Z'),
         ('transition-plan', E'## RECOMMENDED LEAD\\nZed Smith\\n\\n## RECOMMENDED SECOND CHAIR\\nMike', '2', 'Bay Energy', 1, 'jeff',
          'claude-opus-5', 'claude-opus-5', 'end_turn', 3000, 900, 0.0375, '2026-09-26T14:00:00Z');`;

// Every table the script could touch, as text: the database byte for byte
const SNAPSHOT_TABLES = ['users', 'people', 'clients', 'client_revenues', 'ai_answers', 'client_changes', 'scenarios'];
async function snapshot(db) {
  const out = {};
  for (const table of SNAPSHOT_TABLES) {
    const { rows } = await db.query(`SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    out[table] = rows.map((r) => r.row);
  }
  return out;
}

describe('scripts/eval-ai.cjs on PostgreSQL and the fake Anthropic server', { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  let fake;
  let scratch;
  before(async () => {
    fake = await startFakeAnthropic();
    scratch = mkdtempSync(join(tmpdir(), 'eval-ai-test-'));
  });
  after(async () => {
    await fake?.close();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  // A seeded database for one test, dropped after it
  async function withBook(fn) {
    const name = `eval_test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: urlFor('postgres') });
    await admin.connect();
    const db = new pg.Client({ connectionString: urlFor(name) });
    try {
      await admin.query(`CREATE DATABASE ${name}`);
      await db.connect();
      await db.query(initSql);
      await db.query(SEED_SQL);
      await fn(db, urlFor(name));
    } finally {
      await db.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  }

  // Runs the script; the key is the fake's unless `env` says otherwise
  async function runEval(url, args, env = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/eval-ai.cjs', ...args], {
        cwd: repo,
        env: { PATH: process.env.PATH, DATABASE_URL: url, DATABASE_SSL: 'false', ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: fake.url, ...env },
        maxBuffer: 16 * 1024 * 1024,
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  const figureOf = (stdout) => stdout.match(/--confirm (\d+\.\d\d)$/m)?.[1];
  const idOf = async (db, question) => (await db.query('SELECT id FROM ai_answers WHERE question = $1', [question])).rows[0].id;

  test('the list: every saved Ask newest first, the follow-up and the hidden one marked, no brief or plan, nothing written or sent', async () => {
    await withBook(async (db, url) => {
      const before = await snapshot(db);
      const sent = fake.requests.length;
      const { code, stdout } = await runEval(url, []);
      assert.equal(code, 0);
      assert.match(stdout, /^Today's book: 2 clients, reporting year 2025\. System blocks: [\d,]+ tokens, estimated from the system blocks'/);
      const listed = stdout.split('\n').filter((line) => /^#\d+ {2}/.test(line));
      assert.deepEqual(listed.map((line) => line.split('  ').at(-1)), ['And for Kevin?', 'Where is the exposure?', 'Who carries the most effort?']);
      assert.match(listed[0], /\[follow-up of #\d+, asked alone; hidden by kevin; earlier book\]/);
      assert.match(listed[2], /^#\d+ {2}2026-09-20 {2}jeff {2}in 57, cache read 0, cache write 3,000, out 1,200 {2}\$0\.0490 {2}\[earlier book\]/);
      assert.equal(stdout.trim().split('\n').at(-1), 'Nothing was sent.');
      assert.equal(fake.requests.length, sent);
      assert.deepEqual(await snapshot(db), before);
    });
  });

  test('the estimate: printed before anything is sent, nothing reaches the fake, exit 1, the database unchanged', async () => {
    await withBook(async (db, url) => {
      const ids = [await idOf(db, 'Who carries the most effort?'), await idOf(db, 'Where is the exposure?')];
      const before = await snapshot(db);
      const sent = fake.requests.length;
      const { code, stdout } = await runEval(url, ['--ids', ids.join(','), '--out', join(scratch, 'never.md')]);
      assert.equal(code, 1);
      assert.match(stdout, /^Evaluation estimate\. Nothing has been sent\./);
      assert.match(stdout, /1\. claude-opus-5, the API's default effort \(high\): 2 calls, \$[\d.]+ to \$[\d.]+\./);
      assert.match(stdout, /2\. claude-opus-5, effort medium: 2 calls/);
      assert.ok(!/claude-opus-5-5/.test(stdout), 'claude-opus-5-5 is off unless asked for');
      assert.match(stdout, new RegExp(`Calls go to ${fake.url.replace(/[.]/g, '\\.')}\\.`));
      assert.match(stdout, /Nothing was sent\. To spend up to \$\d+\.\d\d, run:/);
      assert.ok(figureOf(stdout));
      assert.equal(fake.requests.length, sent, 'nothing sent without --confirm');
      assert.equal(existsSync(join(scratch, 'never.md')), false);
      assert.deepEqual(await snapshot(db), before);
    });
  });

  test('refusals before any call: another figure, no key, an id not saved, a brief, a path inside the repository, a file that exists', async () => {
    await withBook(async (db, url) => {
      const id = await idOf(db, 'Who carries the most effort?');
      const brief = (await db.query("SELECT id FROM ai_answers WHERE kind = 'brief'")).rows[0].id;
      const before = await snapshot(db);
      const sent = fake.requests.length;
      const out = join(scratch, 'refused.md');
      const figure = figureOf((await runEval(url, ['--ids', String(id), '--out', out])).stdout);

      let r = await runEval(url, ['--ids', String(id), '--out', out, '--confirm', '999.00']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, new RegExp(`Refused: --confirm 999\\.00 is not this estimate's figure, \\$${figure.replace('.', '\\.')}`));
      assert.ok(!r.stderr.includes('Evaluation run'), 'no run header on a refusal');
      r = await runEval(url, ['--ids', String(id), '--out', out, '--confirm', figure], { ANTHROPIC_API_KEY: '' });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /Refused: ANTHROPIC_API_KEY is not set\. Nothing was sent\./);
      r = await runEval(url, ['--ids', '999999', '--confirm', figure]);
      assert.match(r.stderr, /Refused: No saved answer #999999\./);
      r = await runEval(url, ['--ids', String(brief)]);
      assert.match(r.stderr, new RegExp(`Not an Ask: #${brief} \\(brief\\)`));
      for (const inside of ['docs/eval.md', 'eval.md', join(repo, 'tests', 'eval.md')]) {
        r = await runEval(url, ['--ids', String(id), '--out', inside, '--confirm', figure]);
        assert.equal(r.code, 1, inside);
        assert.match(r.stderr, /inside the repository, which is public/, inside);
        assert.equal(existsSync(resolve(repo, inside)), false);
      }
      r = await runEval(url, ['--ids', String(id), '--out', join(repo, 'package.json'), '--confirm', figure]);
      assert.match(r.stderr, /inside the repository/);
      const taken = join(scratch, 'taken.md');
      writeFileSync(taken, 'keep');
      r = await runEval(url, ['--ids', String(id), '--out', taken, '--confirm', figure]);
      assert.match(r.stderr, /already exists/);
      assert.equal(readFileSync(taken, 'utf8'), 'keep');

      assert.equal(fake.requests.length, sent, 'no refusal sent anything');
      assert.deepEqual(await snapshot(db), before);
    });
  });

  test('a confirmed run of two configurations: each model and effort, the same book blocks, the Ask route\'s turn and budget, the side-by-side, nothing written', async () => {
    await withBook(async (db, url) => {
      const questions = ['Who carries the most effort?', 'Where is the exposure?', 'And for Kevin?'];
      const ids = [];
      for (const q of questions) ids.push(await idOf(db, q));
      const before = await snapshot(db);
      const out = join(scratch, 'two', 'run.md');
      const estimate = await runEval(url, ['--ids', ids.join(','), '--out', out]);
      const figure = figureOf(estimate.stdout);
      const from = fake.requests.length;
      const r = await runEval(url, ['--ids', ids.join(','), '--out', out, '--confirm', figure]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `Wrote ${out}. It holds the firm's questions, answers and client names: delete it when you are done.\n`);
      const requests = fake.requests.slice(from);
      assert.equal(requests.length, 6, 'three questions under each of two configurations, one call each');

      // Configuration by configuration, questions in the order given
      assert.deepEqual(requests.map((q) => [q.body.model, q.body.output_config?.effort ?? null]), [
        ['claude-opus-5', null], ['claude-opus-5', null], ['claude-opus-5', null],
        ['claude-opus-5', 'medium'], ['claude-opus-5', 'medium'], ['claude-opus-5', 'medium'],
      ]);
      const today = askPrompts.firmDate(new Date());
      requests.forEach((q, i) => {
        assert.equal(q.body.max_tokens, askPrompts.ASK_MAX_TOKENS);
        assert.equal(q.body.stream, true);
        // The Ask route's request: the book blocks, one user turn, no thread
        assert.deepEqual(q.body.system, requests[0].body.system, 'the same system blocks, byte for byte');
        assert.equal(q.body.system[0].text, askPrompts.ASK_INSTRUCTIONS);
        assert.deepEqual(q.body.messages, [{ role: 'user', content: askPrompts.askTurn(questions[i % 3], new Date(`${today}T12:00:00-04:00`)) }]);
        assert.equal(q.body.cache_control, undefined, 'a new question sends no automatic marker');
        // claude-opus-5 is in FALLBACK_MODELS
        assert.equal(q.body.fallbacks, 'default');
        assert.match(q.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
      });
      assert.match(requests[0].body.system[1].text, /Acme Health/);

      const md = readFileSync(out, 'utf8');
      assert.equal(statSync(out).mode & 0o777, 0o600, 'readable by its owner only');
      const bookSha = createHash('sha256').update(requests[0].body.system[1].text, 'utf8').digest('hex');
      assert.match(md, new RegExp(`book SHA-256 ${bookSha.slice(0, 12)}\\.`));
      assert.match(md, /Complete \(6 of 6 calls; approved up to \$\d+\.\d\d\)\./);
      for (const [i, q] of questions.entries()) assert.match(md, new RegExp(`## ${i + 1}\\. Question #${ids[i]}[\\s\\S]*> ${q.replace('?', '\\?')}`));
      assert.match(md, /a follow-up of #\d+ \(asked here alone, without its thread\); hidden in the AI tab/);
      assert.equal((md.match(/### Saved answer \(given on an earlier book\)/g) || []).length, 3);
      assert.equal((md.match(/### claude-opus-5, the API's default effort \(high\)\n\nserved by claude-opus-5; tokens in [\d,]+, cache read 0, cache write 0, out [\d,]+; \$\d/g) || []).length, 3);
      assert.equal((md.match(/### claude-opus-5, effort medium\n\nserved by claude-opus-5;/g) || []).length, 3);
      assert.match(md, /\| claude-opus-5, effort medium \| 3 \| 0 \| 0 \| 0 \| 0 \|/);
      assert.match(md, /The saved answers, for reference: 3 answers, 2,400 output tokens, \$0\.0834 as saved/);
      // The fake's answer names what it received: the book's rows and the question
      assert.match(md, /Who carries the most effort\?/);
      assert.match(r.stderr, /^Evaluation run: the estimate you approved\.\n/);
      assert.ok(!r.stderr.includes('Nothing has been sent') && !r.stderr.includes('--confirm'), 'the header is the estimate without its closing command');
      assert.match(r.stderr, /"event":"ai_call","label":"eval"/);
      assert.match(r.stderr, /\[6\/6\] claude-opus-5, effort medium/);

      assert.deepEqual(await snapshot(db), before, 'the database is byte for byte unchanged');
    });
  });

  test('--opus-5-5 medium: a third configuration on claude-opus-5-5 with its effort set, without the fallback, priced; --stdout prints the side-by-side alone', async () => {
    await withBook(async (db, url) => {
      const id = await idOf(db, 'Where is the exposure?');
      const before = await snapshot(db);
      const estimate = await runEval(url, ['--ids', String(id), '--opus-5-5', 'medium', '--stdout']);
      assert.match(estimate.stdout, /3\. claude-opus-5-5, effort medium: 1 call, \$[\d.]+ to \$[\d.]+\. Runs without the server-side refusal fallback/);
      assert.match(estimate.stdout, /printed to standard output \(--stdout\)/);
      const from = fake.requests.length;
      const r = await runEval(url, ['--ids', String(id), '--opus-5-5', 'medium', '--stdout', '--confirm', figureOf(estimate.stdout)]);
      assert.equal(r.code, 0, r.stderr);
      const requests = fake.requests.slice(from);
      assert.deepEqual(requests.map((q) => [q.body.model, q.body.output_config?.effort ?? null, q.body.fallbacks ?? null]), [
        ['claude-opus-5', null, 'default'],
        ['claude-opus-5', 'medium', 'default'],
        ['claude-opus-5-5', 'medium', null],
      ]);
      assert.equal(requests[2].headers['anthropic-beta'], undefined, 'no fallback beta for claude-opus-5-5 until FALLBACK_MODELS lists it');
      assert.deepEqual(requests[2].body.system, requests[0].body.system);
      // stdout is the Markdown alone; the progress and the ai_call lines are on stderr
      assert.match(r.stdout, /^# AI evaluation: side by side\n/);
      assert.ok(!r.stdout.includes('"event":"ai_call"'));
      assert.ok(!r.stdout.includes('dotenv'));
      assert.match(r.stdout, /### claude-opus-5-5, effort medium\n\nserved by claude-opus-5-5; [^\n]*\$\d+\.\d+; /, 'priced from utils/aiCost.cjs');
      assert.match(r.stdout, /\| claude-opus-5-5, effort medium \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
      assert.deepEqual(await snapshot(db), before);
    });
  });

  test('a decline, a fallback, an error and a cut-off recorded as the tab shows them; the approved figure stops the run', async () => {
    await withBook(async (db, url) => {
      const ids = [];
      for (const q of ['Who carries the most effort?', 'Where is the exposure?', 'And for Kevin?']) ids.push(await idOf(db, q));
      const before = await snapshot(db);
      const out = join(scratch, 'mixed.md');
      const figure = figureOf((await runEval(url, ['--ids', ids.join(','), '--out', out])).stdout);
      // The first configuration: a decline, a fallback served mid-stream and
      // an error the SDK does not retry; then, in the second, an answer cut
      // off at 16,000 output tokens (about $0.41), over the approved figure,
      // so the run stops before the fifth call
      fake.enqueue('refusal-before-output.sse', 'fallback-mid-stream.sse', 'http-400-invalid-request.json', 'max-tokens.sse');
      const from = fake.requests.length;
      const r = await runEval(url, ['--ids', ids.join(','), '--out', out, '--confirm', figure]);
      assert.ok(Number(figure) < 0.4, `the figure (${figure}) is below the cut-off answer's cost`);
      assert.equal(r.code, 1, 'stopped before every call ran');
      assert.equal(fake.requests.length - from, 4, 'nothing sent after the approved figure was spent');
      const md = readFileSync(out, 'utf8');
      assert.match(md, new RegExp(`Stopped: the calls so far cost \\$0\\.4\\d+, at or over the approved figure \\(4 of 6 calls; approved up to \\$${figure.replace('.', '\\.')}\\)`));
      assert.match(md, /## 1\. Question[\s\S]*?### claude-opus-5, the API's default effort \(high\)\n\nserved by claude-opus-5; [^\n]*\n\n_The AI declined to answer this request\. \(Category: cyber\.\)_/);
      assert.match(md, /## 2\. Question[\s\S]*?### claude-opus-5, the API's default effort \(high\)\n\nserved by claude-opus-4-8 after a decline \(a fallback\)/);
      assert.match(md, /## 3\. Question[\s\S]*?### claude-opus-5, the API's default effort \(high\)\n\n_Error: AI request rejected \(400\)\._/);
      assert.match(md, /## 1\. Question[\s\S]*?### claude-opus-5, effort medium\n\nserved by claude-opus-5; [^\n]*\n\n[\s\S]*?_The response was cut off; ask a narrower question\._/);
      assert.match(md, /## 2\. Question[\s\S]*?### claude-opus-5, effort medium\n\n_Not run\._/);
      assert.match(md, /\| claude-opus-5, the API's default effort \(high\) \| 1 \| 1 \| 0 \| 1 \| 1 \|/);
      assert.match(r.stderr, /Stopped: the calls so far cost/);
      assert.deepEqual(await snapshot(db), before);
    });
  });

  test('a key the API refuses stops the run after the first call, keeping what was done', async () => {
    await withBook(async (db, url) => {
      const ids = [await idOf(db, 'Who carries the most effort?'), await idOf(db, 'Where is the exposure?')];
      const out = join(scratch, 'key.md');
      const figure = figureOf((await runEval(url, ['--ids', ids.join(','), '--out', out])).stdout);
      fake.enqueue('http-401-authentication.json');
      const from = fake.requests.length;
      const r = await runEval(url, ['--ids', ids.join(','), '--out', out, '--confirm', figure]);
      assert.equal(r.code, 1);
      assert.equal(fake.requests.length - from, 1);
      const md = readFileSync(out, 'utf8');
      assert.match(md, /Stopped: The AI service rejected the server's API key\. \(1 of 4 calls/);
      assert.match(md, /_Not run\._/);
    });
  });

  test('the system blocks measured by an answer on today\'s book set the estimate\'s prefix', async () => {
    await withBook(async (db, url) => {
      const id = await idOf(db, 'Who carries the most effort?');
      const out = join(scratch, 'measure.md');
      const first = await runEval(url, ['--ids', String(id), '--out', out]);
      const from = fake.requests.length;
      await runEval(url, ['--ids', String(id), '--out', out, '--confirm', figureOf(first.stdout)]);
      const bookSha = createHash('sha256').update(fake.requests[from].body.system[1].text, 'utf8').digest('hex');
      const { rows: [{ id: measuredBy }] } = await db.query(
        `INSERT INTO ai_answers (kind, question, answer, model, cache_read_tokens, cache_write_tokens, book_sha256)
         VALUES ('ask', 'Today?', 'Yes.', 'claude-opus-5', 0, 1234, $1) RETURNING id`, [bookSha]);
      const second = await runEval(url, ['--ids', String(id), '--out', join(scratch, 'measure-2.md')]);
      assert.match(second.stdout, new RegExp(`System blocks: 1,234 tokens, measured by answer #${measuredBy} on today's book\\.`));
      const list = await runEval(url, []);
      assert.match(list.stdout, new RegExp(`^#${measuredBy} {2}.*Today\\?$`, 'm'));
      assert.ok(!new RegExp(`^#${measuredBy} .*earlier book`, 'm').test(list.stdout), "an answer on today's book is not marked");
    });
  });

  test('--plans: the saved transition plans resolved against today\'s People list, a lower bound, nothing written or sent', async () => {
    await withBook(async (db, url) => {
      const before = await snapshot(db);
      const sent = fake.requests.length;
      const { code, stdout } = await runEval(url, ['--plans']);
      assert.equal(code, 0);
      assert.match(stdout, /^Saved transition plans: 2 \(declined 0, cut off 0\)\./);
      assert.match(stdout, /today's People list \(7 people, active or not\)/);
      assert.match(stdout, /Recommended lead: resolved to one person 1; names nobody on the People list 1\./);
      assert.match(stdout, /Recommended second chair: resolved to one person 1; "None" \(no second chair\) 1\./);
      assert.match(stdout, /no roster could resolve[^:]*: 1\. A lower bound/);
      assert.match(stdout, /#\d+ {2}2026-09-26 {2}Bay Energy {2}lead: names nobody on the People list {2}"Zed Smith"/);
      assert.equal(fake.requests.length, sent);
      assert.deepEqual(await snapshot(db), before);
    });
  });
});
