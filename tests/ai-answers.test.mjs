// Saved AI answers (docs/plans/tier-1.md, WP4; T12, T13): utils/aiAnswers.cjs,
// the row one answer becomes, its SQL and the firm's month; and the AI tab's
// helpers in src/utils/recentAnswers.js. The results come from the real
// service driven by the recorded streams in tests/fixtures/anthropic/
// (fakeFetch), so each row is built from exactly what complete() returns.
// The database side is tests/import-db.test.mjs and tests/schema.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import aiAnswers from '../utils/aiAnswers.cjs';
import aiCost from '../utils/aiCost.cjs';
import ai from '../services/anthropic.cjs';
import { fakeFetch, streamedText } from './helpers/fakeAnthropic.mjs';
import { parseCost, formatCost, answerTitle, monthLine, appendAnswers } from '../src/utils/recentAnswers.js';

const {
  KINDS, ANSWER_COLUMNS, INSERT_ANSWER_SQL, LIST_ANSWERS_SQL, LIST_ANSWERS_BEFORE_SQL, ONE_ANSWER_SQL,
  MONTH_SUMMARY_SQL, bookHash, answerRow, insertParams, readAnswerId, readListQuery, firmMonth,
} = aiAnswers;

const initSql = readFileSync(new URL('../init-db.sql', import.meta.url), 'utf8');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const USER = { userId: 7, username: 'jeff', iat: 1, exp: 2 };
const BOOK = '# The book\n\n| Client | Lead |\n| --- | --- |\n| Smith & Co | Mike |\n';

// One complete() result from a recorded stream, with its log lines silenced
async function resultFrom(fixture, options = {}) {
  const { fetch } = fakeFetch([fixture]);
  const service = ai.createService({ apiKey: 'test', fetch, ...options });
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await service.complete({ prompt: 'x', label: 'test' });
  } finally {
    Object.assign(console, saved);
  }
}

const row = (overrides) => answerRow({
  kind: 'ask',
  question: 'Who carries the most?',
  user: USER,
  bookText: BOOK,
  reportingYear: 2026,
  durationMs: 1234.4,
  model: 'claude-opus-5',
  ...overrides,
});

test('answerRow: a plain answer, with every column the insert names', async () => {
  const result = await resultFrom('text-with-thinking.sse');
  const r = row({ result });
  assert.deepEqual(Object.keys(r).sort(), [...ANSWER_COLUMNS].sort());
  assert.equal(r.kind, 'ask');
  assert.equal(r.answer, result.text);
  assert.equal(r.answer, '## EXECUTIVE SUMMARY\nMike leads six clients and carries the heaviest book.');
  assert.deepEqual([r.client_id, r.client_name], [null, null]);
  assert.deepEqual([r.asked_by, r.asked_by_username], [7, 'jeff']);
  assert.deepEqual([r.model, r.served_by, r.fell_back], ['claude-opus-5', 'claude-opus-5', false]);
  assert.deepEqual([r.stop_reason, r.truncated, r.refused, r.refusal_category], ['end_turn', false, false, null]);
  assert.equal(r.input_tokens, result.tokens.inputTokens);
  assert.equal(r.output_tokens, result.tokens.outputTokens);
  assert.equal(r.cache_read_tokens, result.tokens.cacheReadTokens);
  assert.equal(r.cache_write_tokens, result.tokens.cacheWrite5mTokens + result.tokens.cacheWrite1hTokens);
  assert.ok(r.input_tokens > 0 && r.output_tokens > 0);
  // The cost and its date as complete() gave them, from utils/aiCost.cjs
  assert.equal(r.cost_usd, result.costUsd);
  assert.equal(r.cost_usd, aiCost.callCost(result.usage, result.servedBy, { declined: result.declinedCategories }).usd);
  assert.equal(r.prices_read_on, aiCost.PRICES_READ_ON);
  assert.equal(r.reporting_year, 2026);
  assert.equal(r.duration_ms, 1234);
  // The insert's values line up with its columns
  assert.deepEqual(insertParams(r), ANSWER_COLUMNS.map((column) => r[column]));
});

test('answerRow: the question is stored exactly as given', async () => {
  const result = await resultFrom('text-with-thinking.sse');
  for (const question of ["Is Smith & O'Brien's lead book <1.0× the average?", 'a\n\nb', 'x'.repeat(2000)]) {
    assert.equal(row({ question, result }).question, question);
  }
  assert.equal(row({ kind: 'brief', question: null, result }).question, null);
});

test('answerRow: a truncated answer keeps its text and the flag', async () => {
  const result = await resultFrom('max-tokens.sse');
  const r = row({ result });
  assert.deepEqual([r.truncated, r.stop_reason, r.refused], [true, 'max_tokens', false]);
  assert.equal(r.answer, 'The heaviest lead book belongs to');
});

test('answerRow: a refused answer stores empty text and its category', async () => {
  const before = await resultFrom('refusal-before-output.sse');
  let r = row({ result: before });
  assert.deepEqual([r.refused, r.answer, r.refusal_category, r.stop_reason], [true, '', 'cyber', 'refusal']);
  assert.equal(r.cost_usd, 0, 'a cyber refusal before any output is not billed');

  // Mid-stream: text streamed before the refusal is not stored either (T10)
  const mid = await resultFrom('refusal-mid-stream.sse');
  r = row({ result: mid });
  assert.deepEqual([r.refused, r.answer], [true, '']);
  assert.equal(r.refusal_category, mid.refusalCategory);
  // Even if a result carried text with the flag, the row stores none
  assert.equal(row({ result: { ...mid, text: 'partial' } }).answer, '');
});

test('answerRow: a fallback-served answer records the model requested and the one that served', async () => {
  const result = await resultFrom('fallback-mid-stream.sse');
  const r = row({ result });
  assert.deepEqual([r.model, r.served_by, r.fell_back], ['claude-opus-5', 'claude-opus-4-8', true]);
  assert.equal(r.refused, false);
  assert.equal(r.answer, 'Mike leads six clients and carries the heaviest lead book.');
  assert.equal(r.input_tokens, 1850 + 1862, 'summed over both attempts');
  assert.equal(r.cost_usd, 0.01961);
});

test('answerRow: a model without a price stores a null cost, with the date the prices were read', async () => {
  const sse = streamedText('An answer.', { model: 'claude-future-9' }).join('');
  const result = await resultFrom({ sse }, { model: 'claude-future-9' });
  const r = row({ result, model: 'claude-future-9' });
  assert.equal(r.cost_usd, null);
  assert.equal(r.prices_read_on, aiCost.PRICES_READ_ON);
});

test('answerRow: the book is stored as its SHA-256; none for a transition plan', async () => {
  const result = await resultFrom('text-with-thinking.sse');
  assert.equal(row({ result }).book_sha256, sha256(BOOK));
  assert.equal(bookHash(BOOK), sha256(BOOK));
  assert.match(bookHash(BOOK), /^[0-9a-f]{64}$/);
  assert.equal(row({ result, bookText: `${BOOK} ` }).book_sha256 === sha256(BOOK), false, 'another book, another hash');
  assert.equal(row({ result, bookText: null }).book_sha256, null);
});

test('answerRow: a transition plan stores the client id as text and its name unescaped', async () => {
  const result = await resultFrom('text-with-thinking.sse');
  const plan = (client) => row({ kind: 'transition-plan', question: null, client, bookText: null, result });
  // Production's integer ids and init-db.sql's uuids, both as text
  assert.equal(plan({ id: 42, name: 'Acme' }).client_id, '42');
  const uuid = '3f2b8c1e-8d2a-4a4b-9c3e-2f1a0b9c8d7e';
  assert.equal(plan({ id: uuid, name: 'Acme' }).client_id, uuid);
  // The route runs behind sanitizeRequestBody, and the page sends the name as
  // the API stored it (escaped once by the client form): undone however often
  assert.equal(plan({ id: 1, name: 'Smith &amp; O&#x27;Brien' }).client_name, "Smith & O'Brien");
  assert.equal(plan({ id: 1, name: 'Smith &amp;amp; O&amp;#x27;Brien' }).client_name, "Smith & O'Brien");
  assert.equal(plan({ id: 1, name: "Smith & O'Brien" }).client_name, "Smith & O'Brien");
  assert.equal(plan({ id: 1, name: 'Acme' }).kind, 'transition-plan');
  assert.equal(plan({ id: 1, name: 'Acme' }).question, null);
});

test('answerRow: who asked; nobody when there is no account', async () => {
  const result = await resultFrom('text-with-thinking.sse');
  assert.deepEqual([row({ result, user: null }).asked_by, row({ result, user: null }).asked_by_username], [null, null]);
  assert.equal(row({ result, user: { userId: '7', username: 'jeff' } }).asked_by, null, 'only an integer id');
  assert.equal(row({ result, reportingYear: '2026' }).reporting_year, null);
  assert.equal(row({ result, durationMs: undefined }).duration_ms, null);
});

test('answerRow never throws; the kinds are the table\'s CHECK', async () => {
  const result = await resultFrom('text-with-thinking.sse');
  assert.equal(row({ kind: 'other', result }).kind, 'other', 'the CHECK refuses it and the save fails as any failed save');
  assert.doesNotThrow(() => answerRow({ kind: 'ask', result: undefined, model: 'claude-opus-5' }));
  assert.equal(answerRow({ kind: 'ask', result: undefined, model: 'claude-opus-5' }).answer, '');
  const check = initSql.match(/kind VARCHAR\(20\) NOT NULL CHECK \(kind IN \(([^)]*)\)\)/);
  assert.ok(check, 'init-db.sql has the kind CHECK');
  assert.deepEqual(check[1].split(',').map((k) => k.trim().replace(/'/g, '')), [...KINDS]);
});

test('the SQL: untyped placeholders, the insert\'s columns in order, newest first, cost as stored', () => {
  for (const sql of [INSERT_ANSWER_SQL, LIST_ANSWERS_SQL, LIST_ANSWERS_BEFORE_SQL, ONE_ANSWER_SQL, MONTH_SUMMARY_SQL]) {
    assert.doesNotMatch(sql, /\$\d+\s*::/, 'no cast on a placeholder');
    assert.doesNotMatch(sql, /CAST\s*\(\s*\$/i);
    assert.doesNotMatch(sql, /client_id\s*::|::\s*uuid/i, 'no client id cast');
  }
  const placeholders = [...INSERT_ANSWER_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(placeholders, ANSWER_COLUMNS.map((_, i) => i + 1));
  assert.ok(INSERT_ANSWER_SQL.includes(`(${ANSWER_COLUMNS.join(', ')})`));
  assert.match(INSERT_ANSWER_SQL, /\(SELECT id FROM users WHERE id = \$6\)/, 'asked_by only while the account exists');
  assert.equal(ANSWER_COLUMNS[5], 'asked_by');
  for (const sql of [LIST_ANSWERS_SQL, LIST_ANSWERS_BEFORE_SQL]) {
    assert.match(sql, /ORDER BY created_at DESC, id DESC/);
    assert.match(sql, /left\(answer, 200\) AS preview/);
  }
  assert.match(LIST_ANSWERS_BEFORE_SQL, /\(created_at, id\) < \(SELECT created_at, id FROM ai_answers WHERE id = \$1\)/);
  assert.match(MONTH_SUMMARY_SQL, /created_at >= \$1 AND created_at < \$2/);
  assert.match(initSql, /CREATE INDEX IF NOT EXISTS idx_ai_answers_created_at ON ai_answers \(created_at DESC, id DESC\);/);
});

test('readAnswerId and readListQuery: positive integers only, 20 by default, at most 50', () => {
  assert.equal(readAnswerId('12'), 12);
  assert.equal(readAnswerId('2147483647'), 2147483647);
  for (const bad of ['abc', '0', '-1', '1.5', '01', '12abc', '', ' 12', '2147483648', '99999999999', undefined, 12]) {
    assert.equal(readAnswerId(bad), null, String(bad));
  }
  assert.deepEqual(readListQuery({}), { before: null, limit: 20, error: null });
  assert.deepEqual(readListQuery({ before: '41', limit: '5' }), { before: 41, limit: 5, error: null });
  assert.equal(readListQuery({ limit: '50' }).limit, 50);
  assert.match(readListQuery({ before: 'abc' }).error, /^before must be/);
  assert.match(readListQuery({ before: ['1', '2'] }).error, /^before must be/);
  for (const limit of ['0', '51', 'x', '-3']) assert.match(readListQuery({ limit }).error, /^limit must be a whole number from 1 to 50/);
});

test('firmMonth: the calendar month in America/New_York, across the daylight-saving changes', () => {
  const at = (iso) => firmMonth(new Date(iso));
  assert.deepEqual(at('2026-09-26T12:00:00Z'), { month: '2026-09', from: '2026-09-01T04:00:00.000Z', to: '2026-10-01T04:00:00.000Z' });
  // 11:30 pm on 30 September in Connecticut is still September
  assert.equal(at('2026-10-01T03:30:00Z').month, '2026-09');
  assert.equal(at('2026-10-01T04:00:00Z').month, '2026-10');
  // November starts on daylight time and December on standard time
  assert.deepEqual(at('2026-11-15T00:00:00Z'), { month: '2026-11', from: '2026-11-01T04:00:00.000Z', to: '2026-12-01T05:00:00.000Z' });
  // March starts on standard time, April on daylight time
  assert.deepEqual(at('2026-03-15T00:00:00Z'), { month: '2026-03', from: '2026-03-01T05:00:00.000Z', to: '2026-04-01T04:00:00.000Z' });
  // December runs into the next year
  assert.deepEqual(at('2026-12-31T23:00:00Z'), { month: '2026-12', from: '2026-12-01T05:00:00.000Z', to: '2027-01-01T05:00:00.000Z' });
  assert.equal(at('2027-01-01T04:59:59Z').month, '2026-12');
  assert.equal(at('2027-01-01T05:00:00Z').month, '2027-01');
  // Every instant of a month falls inside its own bounds
  for (let day = 0; day < 400; day += 7) {
    const now = new Date(Date.UTC(2026, 0, 1) + day * 86400000 + 3600000 * (day % 24));
    const m = firmMonth(now);
    assert.ok(new Date(m.from) <= now && now < new Date(m.to), now.toISOString());
  }
});

test('the page: costs arrive as text and are parsed; a row\'s title; the month\'s line', () => {
  assert.equal(parseCost('0.0312'), 0.0312);
  assert.equal(parseCost(0.5), 0.5);
  assert.equal(parseCost('0'), 0);
  for (const none of [null, undefined, '', 'abc']) assert.equal(parseCost(none), null);

  assert.equal(formatCost('0.0312'), '$0.03');
  assert.equal(formatCost('1.2345'), '$1.23');
  assert.equal(formatCost('0.0021'), 'under $0.01');
  assert.equal(formatCost('0.0000'), '$0.00');
  assert.equal(formatCost(null), 'no price');

  assert.equal(answerTitle({ kind: 'ask', question: 'Is Mike overloaded?' }), 'Is Mike overloaded?');
  assert.equal(answerTitle({ kind: 'brief', question: null }), 'Brief');
  assert.equal(answerTitle({ kind: 'transition-plan', client_name: "Smith & O'Brien" }), "Transition plan: Smith & O'Brien");

  assert.equal(monthLine({ answers: 3, costUsd: '0.4210', unpriced: 0 }), 'This month: 3 answers, about $0.42');
  assert.equal(monthLine({ answers: 1, costUsd: '0.0400', unpriced: 0 }), 'This month: 1 answer, about $0.04');
  assert.equal(monthLine({ answers: 0, costUsd: '0', unpriced: 0 }), 'This month: 0 answers, about $0.00');
  assert.equal(monthLine({ answers: 4, costUsd: '1.5000', unpriced: 1 }), 'This month: 4 answers, about $1.50 (1 answer without a price)');
  assert.equal(monthLine(null), '');

  const page = [{ id: 9 }, { id: 8 }];
  assert.deepEqual(appendAnswers(page, [{ id: 8 }, { id: 7 }, { id: 6 }]).map((a) => a.id), [9, 8, 7, 6]);
  assert.deepEqual(appendAnswers(undefined, [{ id: 1 }]).map((a) => a.id), [1]);
});
