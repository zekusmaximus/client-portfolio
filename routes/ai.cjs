const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { aiUserLimiter, aiGlobalLimiter } = require('../middleware/rateLimit.cjs');
const { AI_MODEL, complete, describeError } = require('../services/anthropic.cjs');
const { loadBook } = require('../models/bookModel.cjs');
const { systemBlocks, askTurn, briefTurn, checkQuestion, FIRM_TIME_ZONE, ASK_MAX_TOKENS } = require('../utils/askPrompts.cjs');
const { answerRow, bookHash, readAnswerId, readListQuery, listRow } = require('../utils/aiAnswers.cjs');
const {
  systemHash, turnContent, threadHistory, readParentId, checkFollowUp, threadPlace, earlierTurns,
} = require('../utils/aiThreads.cjs');
const { sseEvent, ssePing, wantsStream, pingInterval, SSE_HEADERS } = require('../utils/sse.cjs');
const { logError } = require('../utils/errorLog.cjs');
const {
  saveAnswer, listAnswers, getAnswer, getThread, setHidden, monthSummary,
} = require('../models/aiAnswerModel.cjs');

// The AI routes that work on the whole book (docs/plans/tier-1.md): the book
// itself, as the AI sees it (WP2, utils/book.cjs), Ask the book and the
// brief (WP3, utils/askPrompts.cjs), which send it, and the saved answers
// (WP4, utils/aiAnswers.cjs), which every AI route writes. Since Tier 2 WP10
// (S14, S15) an Ask may follow up a saved answer (utils/aiThreads.cjs), the
// list marks an answer given on an earlier book, and any partner can hide an
// answer from the list and show it again.
//
// Sign-in for every route. The two AI rate limiters (D11, T16) only on the
// POST routes, which call the model: opening the book or the saved answers
// spends no AI budget.
// No request pass, as in routes/people.cjs: a question is stored and sent
// exactly as the partner wrote it ("Smith & Co", not "Smith &amp; Co"),
// checked by checkQuestion, and rendered by React as text. The book shows
// names as stored, which since Tier 2 WP5 is as typed.
router.use(auth);

// The book is built at each request from the database (loadBook,
// models/bookModel.cjs, shared with the transition plan's route).

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

// A comment line on a streamed answer this often until done (WP5, T9): the
// model thinks before its first words, for minutes on a long answer, and the
// proxies in between may close a connection that stays silent.
// AI_STREAM_PING_MS is for tests; the default is 15 seconds.
const PING_MS = pingInterval(process.env.AI_STREAM_PING_MS);

// One answer on the whole book: Ask (a question) or the brief (question
// null). The system blocks are the same for both and for every question, so
// the book is read from the prompt cache within five minutes (T8).
// `model` is the model requested (AI_MODEL, as in the ai_call log line);
// `servedBy` is the one that answered, which differs after a fallback (T10).
// The answer is saved (WP4, T12) and returned with the saved row's `id`; a
// failed save returns it with `saved: false` and id null, never an error.
//
// Streamed (WP5, T9) when the request carries Accept: text/event-stream: the
// headers go out only when Anthropic's stream produces its first event, so
// everything before it (sign-in, the rate limits and the question check,
// ahead of this function; the empty book, a missing key, an upstream error
// before its first event) answers JSON as it always has. Then a `start`
// event, a `text` event for each piece of the answer, a ping every PING_MS,
// and `done` with the saved answer, or an `error` event for a failure after
// the stream opened. `done` carries the JSON answer's fields but `success`,
// `kind` and `question` (the page sent them), with the saved row's id as
// `answerId`, as section 10 names it and the transition plan's response
// does; and `answer`, the text as saved, which the page shows in place of
// the pieces it joined: separate text blocks are saved one to a line,
// trimmed, and a refusal nothing rescued discards what streamed (T10).
// When the page's connection closes, the route stops writing and lets the
// call finish and save (T15): the answer appears under Recent answers.
//
// A follow-up (Tier 2 WP10, S14) is an Ask with `parentId`, the answer it
// follows: the route reads the thread up to its first answer and refuses,
// before any call, what checkFollowUp refuses (a missing answer 404; a
// transition plan, a full thread, or an answer declined, cut off or saved
// without its turn 400; a book or instructions changed since 409). The
// request then sends the same system blocks, the thread's earlier turns as
// saved (threadHistory) and the new question; the answer is saved with its
// parent. Every answer that can be followed up is saved with its turn
// (turnContent). The answer adds `parentId`, `followUp` (its number in the
// thread, 0 for a first answer) and `canFollowUp`. The ai_call line's label
// is `follow-up`.
async function answer(req, res, { kind, question, parentId = null }) {
  const streaming = wantsStream(req.get('accept'));
  const userId = req.user.userId;
  const label = parentId === null ? kind : 'follow-up';
  // open: the stream's headers are sent; closed: the page's connection is gone
  let open = false;
  let closed = false;
  let ping = null;
  const stopPing = () => {
    if (ping) clearInterval(ping);
    ping = null;
  };
  const write = (chunk) => {
    if (open && !closed && !res.writableEnded) res.write(chunk);
  };
  res.on('close', () => {
    if (res.writableFinished) return;
    closed = true;
    stopPing();
    if (streaming) console.warn(JSON.stringify({ event: 'ai_stream_closed', label, userId, opened: open }));
  });

  try {
    const now = new Date();
    const book = await loadBook(now);
    if (book.clientCount === 0) {
      return res.status(400).json({ success: false, error: 'The book has no clients yet.' });
    }
    const system = systemBlocks(book.text);
    const current = { systemSha: systemHash(system), bookSha: bookHash(book.text) };
    let chain = [];
    if (parentId !== null) {
      chain = await getThread(parentId);
      const problem = checkFollowUp(chain, current);
      if (problem) return res.status(problem.status).json({ success: false, error: problem.error });
    }
    const prompt = kind === 'ask' ? askTurn(question, now) : briefTurn(now);
    const started = Date.now();
    const result = await complete({
      system,
      prompt,
      history: threadHistory(chain.map((turn) => turn.content)),
      maxTokens: ASK_MAX_TOKENS,
      userId,
      label,
      ...(streaming ? {
        onStart: () => {
          if (closed) return;
          res.status(200).set(SSE_HEADERS);
          res.flushHeaders();
          open = true;
          write(sseEvent('start', { model: AI_MODEL }));
          ping = setInterval(() => write(ssePing()), PING_MS);
        },
        onText: (text) => write(sseEvent('text', { text })),
      } : {}),
    });
    const content = turnContent({ system, prompt, result });
    const { id, saved } = await saveAnswer(answerRow({
      kind,
      question,
      user: req.user,
      result,
      bookText: book.text,
      reportingYear: book.reportingYear,
      durationMs: Date.now() - started,
      model: AI_MODEL,
      parentId,
      content,
    }), { label, userId });
    const place = threadPlace([...chain, {
      id, parent_id: parentId, kind, answer: result.text, refused: result.refused, truncated: result.truncated,
      book_sha256: current.bookSha, content,
    }], current);
    const answered = {
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
      parentId,
      followUp: place.followUp,
      canFollowUp: saved && place.canFollowUp,
    };
    if (open) {
      stopPing();
      write(sseEvent('done', { answerId: id, saved, ...answered }));
      return res.end();
    }
    if (closed) return undefined;
    return res.json({ success: true, id, saved, kind, question, ...answered });
  } catch (error) {
    stopPing();
    // An API error is already described by the ai_error log line. A missing
    // key writes no line (complete() refuses it before any call; /api/health
    // shows it). An unexpected failure (the database, a bug) is logged by its
    // code and message (logError, Tier 3 WP2): never the error object, which
    // for a failed query carries the refused row, so no stack trace either.
    const expected = error?.code === 'AI_NOT_CONFIGURED' || typeof error?.status === 'number';
    if (!expected) logError(`ai_${label} failed`, error);
    const { status, message } = describeError(error);
    if (open) {
      write(sseEvent('error', { error: message }));
      return res.end();
    }
    if (closed) return undefined;
    return res.status(status).json({ success: false, error: message });
  }
}

// POST /api/ai/ask { question, parentId? } - one question on the whole
// book, or with parentId a follow-up to that saved answer (WP10). The
// question is trimmed at its ends and otherwise sent as written. A follow-up
// counts once on the AI limiters, as any Ask (T16).
router.post('/ask', aiUserLimiter, aiGlobalLimiter, (req, res) => {
  const { question, parentId: parent } = req.body || {};
  const problem = checkQuestion(question);
  if (problem) return res.status(400).json({ success: false, error: problem });
  const { parentId, error } = readParentId(parent);
  if (error) return res.status(400).json({ success: false, error });
  return answer(req, res, { kind: 'ask', question: question.trim(), parentId });
});

// POST /api/ai/brief {} - the brief under T6's five headings.
router.post('/brief', aiUserLimiter, aiGlobalLimiter, (req, res) => answer(req, res, { kind: 'brief', question: null }));

// The saved answers (WP4, T12, T13): every partner sees every answer. No AI
// limiter: these read the database and call no model (T16).
const answersFailed = (res, error) => {
  console.error(JSON.stringify({ event: 'ai_answers_error', message: error.message }));
  return res.status(500).json({ success: false, error: 'Failed to read the saved answers.' });
};

// Today's book, and the hashes a thread is checked against (WP10)
async function currentBook() {
  const book = await loadBook(new Date());
  return { book, systemSha: systemHash(systemBlocks(book.text)), bookSha: bookHash(book.text) };
}

// GET /api/ai/answers?before=<id>&limit=20&hidden=0 - newest first: { success,
// answers: [{ id, kind, question, client_name, asked_by_username, created_at,
// served_by, truncated, refused, cost_usd, preview, parent_id, earlier_book,
// hidden_at, hidden_by_username }], hasMore }. preview is the answer's first
// 200 characters; cost_usd is NUMERIC, so text (or null). The answers shown,
// or with hidden=1 the hidden ones (WP10, "Show hidden"); earlier_book is
// true for an answer given on a book other than today's (built here, as the
// book route builds it), null when the answer records none.
router.get('/answers', async (req, res) => {
  const { before, limit, hidden, error } = readListQuery(req.query);
  if (error) return res.status(400).json({ success: false, error });
  try {
    const [{ answers, hasMore }, { bookSha }] = await Promise.all([listAnswers({ before, limit, hidden }), currentBook()]);
    return res.json({ success: true, answers: answers.map((row) => listRow(row, bookSha)), hasMore });
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

const answerNotFound = (res) => res.status(404).json({ success: false, error: 'No such answer.' });

// GET /api/ai/answers/:id - one answer, whole (not its stored turn); 404 for
// an id that is not a positive integer or not found. From WP10 also its
// place in its thread: `thread`, the answers before it, oldest first;
// `follow_up`, its number (0 for a first answer); `can_follow_up`, whether a
// follow-up to it may be asked now; and `earlier_book`.
router.get('/answers/:id', async (req, res) => {
  const id = readAnswerId(req.params.id);
  if (id === null) return answerNotFound(res);
  try {
    const row = await getAnswer(id);
    if (!row) return answerNotFound(res);
    const [chain, current] = await Promise.all([getThread(id), currentBook()]);
    const place = threadPlace(chain, current);
    return res.json({
      success: true,
      answer: {
        ...row,
        earlier_book: row.book_sha256 === null ? null : row.book_sha256 !== current.bookSha,
        follow_up: place.followUp,
        can_follow_up: place.canFollowUp,
        thread: earlierTurns(chain),
      },
    });
  } catch (err) {
    return answersFailed(res, err);
  }
});

// POST /api/ai/answers/:id/hide and /show (WP10, S15): any partner hides an
// answer from the list, or shows it again; nothing deletes one. Answers
// { success, answer: { id, hidden_at, hidden_by_username } } as the row now
// is: hiding an answer already hidden keeps who hid it first. 404 as above.
// No AI limiter (T16).
const hiding = (show) => async (req, res) => {
  const id = readAnswerId(req.params.id);
  if (id === null) return answerNotFound(res);
  try {
    const row = await setHidden(id, req.user, show);
    return row ? res.json({ success: true, answer: row }) : answerNotFound(res);
  } catch (err) {
    return answersFailed(res, err);
  }
};
router.post('/answers/:id/hide', hiding(false));
router.post('/answers/:id/show', hiding(true));

module.exports = router;
