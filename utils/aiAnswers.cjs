// utils/aiAnswers.cjs
//
// Saved AI answers (docs/plans/tier-1.md, WP4; T12, T13): every answer an AI
// route returns (Ask, the brief, a transition plan) is kept in ai_answers
// (init-db.sql) with who asked, the question or the client, the answer, the
// model requested and the one that served it, the flags, the tokens by kind
// and the estimated cost. Errors are logged, not saved. Every partner sees
// every answer; nobody can delete one in Tier 1.
//
// Pure: no database and no environment. models/aiAnswerModel.cjs runs the
// insert; routes/ai.cjs runs the reads. Every placeholder is untyped, so
// PostgreSQL takes each value's type from its column; ai_answers.client_id is
// TEXT, written as String(client.id), because production's client ids are
// integers and init-db.sql's are uuids (CLAUDE.md, File Structure).

const { createHash } = require('node:crypto');
const { PRICES_READ_ON } = require('./aiCost.cjs');
const { FIRM_TIME_ZONE } = require('./askPrompts.cjs');
const { unescapeStored } = require('./escaping.cjs');

const KINDS = Object.freeze(['ask', 'brief', 'transition-plan']);

/** SHA-256 of the book text an answer was given on, as 64 hex characters. */
function bookHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const whole = (n) => {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
};

/**
 * The column values of one saved answer.
 *
 * `result` is what complete() (services/anthropic.cjs) returned; `model` is
 * the model requested (AI_MODEL), which `result` does not carry: its `model`
 * is the one that served. `question` is stored as given (Ask sends it trimmed
 * and otherwise as written; null for the brief and a transition plan).
 * `client` ({ id, name }) is a transition plan's client: the id as text, the
 * name with the request sanitizer's escaping undone (unescapeStored), since
 * the transition-plan route runs behind sanitizeRequestBody and the page
 * sends names as the API stored them. `user` is the JWT payload
 * ({ userId, username }). `bookText` is the book the answer was given on
 * (null for a transition plan until WP6), stored as its hash.
 *
 * A refused answer stores empty text and its category. The cost and the date
 * its prices were read come from utils/aiCost.cjs through complete(), so the
 * row holds the same estimate as the ai_call log line; a model without a
 * price stores a null cost. Never throws, so building the row cannot lose an
 * answer; the table's CHECK refuses a kind outside KINDS, and the save then
 * fails as any failed save does.
 */
function answerRow({
  kind,
  question = null,
  client = null,
  user = null,
  result,
  bookText = null,
  reportingYear = null,
  durationMs = null,
  model,
}) {
  const out = result || {};
  const tokens = out.tokens || {};
  const refused = out.refused === true;
  return {
    kind,
    question: typeof question === 'string' ? question : null,
    answer: refused || typeof out.text !== 'string' ? '' : out.text,
    client_id: client && client.id !== undefined && client.id !== null ? String(client.id) : null,
    client_name: client && typeof client.name === 'string' ? unescapeStored(client.name) : null,
    asked_by: Number.isInteger(user?.userId) ? user.userId : null,
    asked_by_username: typeof user?.username === 'string' ? user.username : null,
    model: model ?? null,
    served_by: out.servedBy ?? null,
    fell_back: out.fellBack === true,
    stop_reason: out.stopReason ?? null,
    truncated: out.truncated === true,
    refused,
    refusal_category: refused ? (out.refusalCategory ?? null) : null,
    input_tokens: whole(tokens.inputTokens),
    output_tokens: whole(tokens.outputTokens),
    cache_read_tokens: whole(tokens.cacheReadTokens),
    cache_write_tokens: whole(tokens.cacheWrite5mTokens) + whole(tokens.cacheWrite1hTokens),
    cost_usd: typeof out.costUsd === 'number' && Number.isFinite(out.costUsd) ? out.costUsd : null,
    prices_read_on: out.pricesReadOn ?? PRICES_READ_ON,
    book_sha256: typeof bookText === 'string' ? bookHash(bookText) : null,
    reporting_year: Number.isInteger(reportingYear) ? reportingYear : null,
    duration_ms: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null,
  };
}

// The insert's columns, in the order of its placeholders.
const ANSWER_COLUMNS = Object.freeze([
  'kind', 'question', 'answer', 'client_id', 'client_name', 'asked_by', 'asked_by_username',
  'model', 'served_by', 'fell_back', 'stop_reason', 'truncated', 'refused', 'refusal_category',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'cost_usd', 'prices_read_on', 'book_sha256', 'reporting_year', 'duration_ms',
]);

// asked_by only when the account still exists: a session outlives a deleted
// account (the JWT is not checked against users), and its answer is saved
// with the username alone rather than refused by the foreign key.
const INSERT_ANSWER_SQL = `
  INSERT INTO ai_answers (${ANSWER_COLUMNS.join(', ')})
  VALUES (${ANSWER_COLUMNS.map((column, i) => (column === 'asked_by' ? `(SELECT id FROM users WHERE id = $${i + 1})` : `$${i + 1}`)).join(', ')})
  RETURNING id, created_at`;

/** INSERT_ANSWER_SQL's values for a row from answerRow. */
function insertParams(row) {
  return ANSWER_COLUMNS.map((column) => row[column]);
}

// Recent answers, newest first, for everyone: what the list shows, and the
// first 200 characters of the answer. The first page takes the limit; later
// pages take the last id shown and the limit, and continue after that row in
// the same order (created_at, then id), which the index serves. Both ask for
// one row more than they show, to tell whether older answers remain.
const LIST_COLUMNS = `
  id, kind, question, client_name, asked_by_username, created_at, served_by,
  truncated, refused, cost_usd, left(answer, 200) AS preview`;

const LIST_ANSWERS_SQL = `
  SELECT ${LIST_COLUMNS.trim()}
    FROM ai_answers
   ORDER BY created_at DESC, id DESC
   LIMIT $1`;

const LIST_ANSWERS_BEFORE_SQL = `
  SELECT ${LIST_COLUMNS.trim()}
    FROM ai_answers
   WHERE (created_at, id) < (SELECT created_at, id FROM ai_answers WHERE id = $1)
   ORDER BY created_at DESC, id DESC
   LIMIT $2`;

// One answer, whole. prices_read_on as text: pg turns a DATE into a Date at
// local midnight, which JSON would shift by the server's zone.
const ONE_ANSWER_SQL = `
  SELECT id, kind, question, answer, client_id, client_name, asked_by, asked_by_username,
         model, served_by, fell_back, stop_reason, truncated, refused, refusal_category,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
         to_char(prices_read_on, 'YYYY-MM-DD') AS prices_read_on, book_sha256,
         reporting_year, duration_ms, created_at
    FROM ai_answers
   WHERE id = $1`;

// This month's answers and their estimated cost: $1 and $2 are the month's
// first instant and the next month's, from firmMonth. cost_usd is NUMERIC,
// which pg returns as text; unpriced counts the answers without a cost (a
// model missing from utils/aiCost.cjs), which the sum leaves out.
const MONTH_SUMMARY_SQL = `
  SELECT count(*)::int AS answers,
         COALESCE(sum(cost_usd), 0) AS cost_usd,
         (count(*) FILTER (WHERE cost_usd IS NULL))::int AS unpriced
    FROM ai_answers
   WHERE created_at >= $1 AND created_at < $2`;

const LIST_LIMIT = 20;
const LIST_LIMIT_MAX = 50;
const INT_MAX = 2147483647; // PostgreSQL INTEGER

/** A positive integer id from a path or query value ('12'), or null. */
function readAnswerId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= INT_MAX ? id : null;
}

/**
 * GET /api/ai/answers's query: { before, limit, error }. `before` is the id
 * of the last answer shown (absent for the first page); `limit` is 1 to 50,
 * 20 when absent. `error` is the 400 message, or null.
 */
function readListQuery(query = {}) {
  let before = null;
  if (query.before !== undefined) {
    before = readAnswerId(query.before);
    if (before === null) return { before: null, limit: LIST_LIMIT, error: 'before must be the id of an answer.' };
  }
  let limit = LIST_LIMIT;
  if (query.limit !== undefined) {
    limit = readAnswerId(query.limit);
    if (limit === null || limit > LIST_LIMIT_MAX) {
      return { before, limit: LIST_LIMIT, error: `limit must be a whole number from 1 to ${LIST_LIMIT_MAX}.` };
    }
  }
  return { before, limit, error: null };
}

// The month is the firm's calendar month: an answer at 10 pm on the 31st in
// Connecticut counts in that month, whatever zone the server's clock is in
// (Render's is UTC).
const firmClock = new Intl.DateTimeFormat('en-US', {
  timeZone: FIRM_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function firmParts(ms) {
  const parts = Object.fromEntries(firmClock.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
  return parts;
}

// The firm's offset from UTC at an instant, in milliseconds (-4 or -5 hours).
function firmOffset(ms) {
  const second = Math.floor(ms / 1000) * 1000;
  const p = firmParts(second);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - second;
}

// The instant of midnight on the first of a month in the firm's zone. The
// offset is read twice, the second time at the first guess, which settles a
// month whose first day follows a change of offset. Midnight never falls in
// a daylight-saving gap in America/New_York (the changes are at 2 am).
function firmMonthStart(year, month) {
  const wall = Date.UTC(year, month - 1, 1);
  const guess = wall - firmOffset(wall);
  return wall - firmOffset(guess);
}

/**
 * The firm's calendar month holding `now`: { month: 'YYYY-MM', from, to },
 * `from` its first instant and `to` the next month's, as ISO strings, which
 * MONTH_SUMMARY_SQL compares with created_at.
 */
function firmMonth(now = new Date()) {
  const { year, month } = firmParts(now.getTime());
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    from: new Date(firmMonthStart(year, month)).toISOString(),
    to: new Date(firmMonthStart(...next)).toISOString(),
  };
}

module.exports = {
  KINDS,
  ANSWER_COLUMNS,
  INSERT_ANSWER_SQL,
  LIST_ANSWERS_SQL,
  LIST_ANSWERS_BEFORE_SQL,
  ONE_ANSWER_SQL,
  MONTH_SUMMARY_SQL,
  LIST_LIMIT,
  LIST_LIMIT_MAX,
  bookHash,
  answerRow,
  insertParams,
  readAnswerId,
  readListQuery,
  firmMonth,
};
