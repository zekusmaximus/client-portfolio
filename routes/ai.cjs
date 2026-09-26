const express = require('express');
const router = express.Router();
const db = require('../db.cjs');
const auth = require('../middleware/auth.cjs');
const { aiUserLimiter, aiGlobalLimiter } = require('../middleware/rateLimit.cjs');
const clientModel = require('../models/clientModel.cjs');
const { AI_MODEL, complete, describeError } = require('../services/anthropic.cjs');
const { buildBook } = require('../utils/book.cjs');
const { systemBlocks, askTurn, briefTurn, checkQuestion, FIRM_TIME_ZONE } = require('../utils/askPrompts.cjs');
const { answerRow, readAnswerId, readListQuery } = require('../utils/aiAnswers.cjs');
const { saveAnswer, listAnswers, getAnswer, monthSummary } = require('../models/aiAnswerModel.cjs');

// The AI routes that work on the whole book (docs/plans/tier-1.md): the book
// itself, as the AI sees it (WP2, utils/book.cjs), Ask the book and the
// brief (WP3, utils/askPrompts.cjs), which send it, and the saved answers
// (WP4, utils/aiAnswers.cjs), which every AI route writes.
//
// Sign-in for every route. The two AI rate limiters (D11, T16) only on the
// POST routes, which call the model: opening the book or the saved answers
// spends no AI budget.
// No sanitizeRequestBody, as in routes/people.cjs: a question is stored and
// sent exactly as the partner wrote it ("Smith & Co", not "Smith &amp; Co"),
// checked by checkQuestion, and rendered by React as text; the book decodes
// names the client form stored escaped (unescapeText).
router.use(auth);

// The book, built at each request from the database: the clients as
// listWithMetrics scores them (people read from the nested lead, secondChair
// and originator, not the legacy text) and the People list.
async function loadBook(now) {
  const [clients, { rows: people }] = await Promise.all([
    clientModel.listWithMetrics(),
    db.query('SELECT id, name, role, active FROM people'),
  ]);
  return buildBook({ people, clients, now });
}

// GET /api/ai/book - { success, reportingYear, clientCount, peopleCount,
// chars, estimatedTokens, text }. estimatedTokens is chars / 4, an estimate:
// nothing here counts tokens.
router.get('/book', async (req, res) => {
  try {
    const { reportingYear, clientCount, peopleCount, chars, estimatedTokens, text } = await loadBook(new Date());
    res.json({ success: true, reportingYear, clientCount, peopleCount, chars, estimatedTokens, text });
  } catch (error) {
    console.error(JSON.stringify({ event: 'ai_book_error', message: error.message }));
    res.status(500).json({ success: false, error: 'Failed to build the book.' });
  }
});

const MAX_TOKENS = 32000; // T11: thinking and the answer together

// One answer on the whole book: Ask (a question) or the brief (question
// null). The system blocks are the same for both and for every question, so
// the book is read from the prompt cache within five minutes (T8).
// `model` is the model requested (AI_MODEL, as in the ai_call log line);
// `servedBy` is the one that answered, which differs after a fallback (T10).
// The answer is saved (WP4, T12) and returned with the saved row's `id`; a
// failed save returns it with `saved: false` and id null, never an error.
async function answer(req, res, { kind, question }) {
  try {
    const now = new Date();
    const book = await loadBook(now);
    if (book.clientCount === 0) {
      return res.status(400).json({ success: false, error: 'The book has no clients yet.' });
    }
    const started = Date.now();
    const result = await complete({
      system: systemBlocks(book.text),
      prompt: kind === 'ask' ? askTurn(question, now) : briefTurn(now),
      maxTokens: MAX_TOKENS,
      userId: req.user.userId,
      label: kind,
    });
    const { id, saved } = await saveAnswer(answerRow({
      kind,
      question,
      user: req.user,
      result,
      bookText: book.text,
      reportingYear: book.reportingYear,
      durationMs: Date.now() - started,
      model: AI_MODEL,
    }), { label: kind, userId: req.user.userId });
    return res.json({
      success: true,
      id,
      saved,
      kind,
      question,
      answer: result.text,
      truncated: result.truncated,
      refused: result.refused,
      refusalCategory: result.refusalCategory,
      servedBy: result.servedBy,
      model: AI_MODEL,
      usage: result.usage,
      costUsd: result.costUsd,
      reportingYear: book.reportingYear,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    // A missing key or an API error is already described by the ai_error log
    // line; keep the stack trace for unexpected failures only.
    const expected = error?.code === 'AI_NOT_CONFIGURED' || typeof error?.status === 'number';
    if (!expected) console.error(`ai_${kind} failed:`, error);
    const { status, message } = describeError(error);
    return res.status(status).json({ success: false, error: message });
  }
}

// POST /api/ai/ask { question } - one question on the whole book. The
// question is trimmed at its ends and otherwise sent as written.
router.post('/ask', aiUserLimiter, aiGlobalLimiter, (req, res) => {
  const { question } = req.body || {};
  const problem = checkQuestion(question);
  if (problem) return res.status(400).json({ success: false, error: problem });
  return answer(req, res, { kind: 'ask', question: question.trim() });
});

// POST /api/ai/brief {} - the brief under T6's five headings.
router.post('/brief', aiUserLimiter, aiGlobalLimiter, (req, res) => answer(req, res, { kind: 'brief', question: null }));

// The saved answers (WP4, T12, T13): every partner sees every answer. No AI
// limiter: these read the database and call no model (T16).
const answersFailed = (res, error) => {
  console.error(JSON.stringify({ event: 'ai_answers_error', message: error.message }));
  return res.status(500).json({ success: false, error: 'Failed to read the saved answers.' });
};

// GET /api/ai/answers?before=<id>&limit=20 - newest first: { success,
// answers: [{ id, kind, question, client_name, asked_by_username, created_at,
// served_by, truncated, refused, cost_usd, preview }], hasMore }. preview is
// the answer's first 200 characters; cost_usd is NUMERIC, so text (or null).
router.get('/answers', async (req, res) => {
  const { before, limit, error } = readListQuery(req.query);
  if (error) return res.status(400).json({ success: false, error });
  try {
    const { answers, hasMore } = await listAnswers({ before, limit });
    return res.json({ success: true, answers, hasMore });
  } catch (err) {
    return answersFailed(res, err);
  }
});

// GET /api/ai/answers/summary - this calendar month's answers and their
// estimated cost, the month taken in the firm's zone (America/New_York):
// { success, month, timeZone, from, to, answers, costUsd, unpriced }.
// Registered before /answers/:id, which would otherwise take "summary" as an id.
router.get('/answers/summary', async (req, res) => {
  try {
    const summary = await monthSummary(new Date());
    return res.json({ success: true, timeZone: FIRM_TIME_ZONE, ...summary });
  } catch (err) {
    return answersFailed(res, err);
  }
});

// GET /api/ai/answers/:id - one answer, whole; 404 for an id that is not a
// positive integer or not found.
router.get('/answers/:id', async (req, res) => {
  const id = readAnswerId(req.params.id);
  const notFound = () => res.status(404).json({ success: false, error: 'No such answer.' });
  if (id === null) return notFound();
  try {
    const row = await getAnswer(id);
    return row ? res.json({ success: true, answer: row }) : notFound();
  } catch (err) {
    return answersFailed(res, err);
  }
});

module.exports = router;
