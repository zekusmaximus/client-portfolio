// utils/aiThreads.cjs
//
// Follow-up questions (docs/plans/tier-2.md, S14, WP10): a partner can ask up
// to FOLLOW_UP_MAX follow-ups on an Ask or a brief. A follow-up sends the book
// blocks unchanged, then the thread's earlier turns as they were saved, then
// the new question: the history is append-only, as the claude-api skill
// requires for a multi-turn request. Each user turn goes back as it was sent
// and each assistant turn as the API returned its content blocks, thinking
// blocks and their signatures included (a model reads only blocks it can, and
// the API drops the rest unbilled, so nothing is stripped), with one exception
// the skill names: after a fallback in the middle of an answer, the thinking
// and other model-internal blocks before the last `fallback` block are left
// out, and its text blocks and everything after the boundary go back as they
// are (replayBlocks).
//
// A saved answer's `content` (ai_answers.content, JSONB) is the one turn it
// added to its thread:
//   { system_sha256, messages: [{ role: 'user', content: <the turn as sent> },
//                               { role: 'assistant', content: [<blocks as returned>] }] }
// The user turn is stored as sent because it holds the day it was asked, which
// no later rebuild could reproduce exactly. system_sha256 is the hash of the
// system blocks the turn followed: a follow-up is refused (409) when today's
// differ, because the earlier turns were answered on another book (or other
// instructions), and replaying them after different system blocks would edit
// the conversation's prefix, which invalidates the earlier thinking blocks.
// Only a whole answer is stored: a refusal (the skill: discard what streamed),
// a cut-off answer or one without text keeps content null and cannot be
// followed up; neither can an answer saved before WP10 (no content) or a
// transition plan (T14: plans stay one request each).
//
// Pure: no database and no environment. routes/ai.cjs runs it with the rows
// THREAD_SQL (utils/aiAnswers.cjs) reads, root first.

const { createHash } = require('node:crypto');

/** Follow-ups a thread may hold after its first answer. */
const FOLLOW_UP_MAX = 5;

/** The kinds a thread is made of: an Ask or a brief first, then Asks. */
const THREAD_KINDS = Object.freeze(['ask', 'brief']);

// The blocks the skill says go back before a mid-answer fallback's boundary:
// text, and the fallback marker itself ("keep or drop"; kept, as returned).
// There are no tools, so there is no server-tool pair to keep.
const KEPT_BEFORE_FALLBACK = new Set(['text', 'fallback']);

const INT_MAX = 2147483647; // PostgreSQL INTEGER

/** SHA-256 of the system blocks as JSON, as 64 hex characters: the same blocks give the same hash. */
function systemHash(system) {
  return createHash('sha256').update(JSON.stringify(system ?? null), 'utf8').digest('hex');
}

/**
 * What an answer stores so that it can be followed up, or null when it
 * cannot be: `system` the blocks sent, `prompt` the user turn sent, `result`
 * what complete() returned (its `content`, the message's content blocks as
 * returned). Null for a refusal, a cut-off answer and an answer without text.
 */
function turnContent({ system, prompt, result }) {
  if (!result || result.refused === true || result.truncated === true) return null;
  if (typeof result.text !== 'string' || result.text === '') return null;
  if (typeof prompt !== 'string' || !Array.isArray(result.content) || result.content.length === 0) return null;
  return {
    system_sha256: systemHash(system),
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: result.content },
    ],
  };
}

/** Whether `content` is a turn as turnContent builds it. */
function isTurn(content) {
  const messages = content?.messages;
  return typeof content?.system_sha256 === 'string'
    && Array.isArray(messages) && messages.length === 2
    && messages[0]?.role === 'user' && typeof messages[0].content === 'string'
    && messages[1]?.role === 'assistant' && Array.isArray(messages[1].content) && messages[1].content.length > 0;
}

/**
 * An assistant turn's blocks as a later request sends them: as returned,
 * except that after a fallback in the middle of the answer only text blocks
 * (and the marker) go back from before the last `fallback` block.
 */
function replayBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const boundary = list.map((block) => block?.type).lastIndexOf('fallback');
  if (boundary === -1) return list;
  return list.filter((block, i) => i >= boundary || KEPT_BEFORE_FALLBACK.has(block?.type));
}

/**
 * The earlier turns of a thread as the Messages API takes them, oldest first:
 * each saved turn's user message as it was sent, then its assistant message.
 * `turns` are the saved `content` objects, root first. The same turns always
 * give the same messages, so each follow-up's request begins with the one
 * before it (the history is appended to, never edited).
 */
function threadHistory(turns = []) {
  return turns.flatMap((turn) => [
    turn.messages[0],
    { role: 'assistant', content: replayBlocks(turn.messages[1].content) },
  ]);
}

/**
 * The request body's parentId: { parentId, error }. Absent or null is a new
 * question; otherwise it must be an answer's id (a positive integer).
 */
function readParentId(value) {
  if (value === undefined || value === null) return { parentId: null, error: null };
  if (Number.isInteger(value) && value >= 1 && value <= INT_MAX) return { parentId: value, error: null };
  return { parentId: null, error: 'parentId must be the id of an answer.' };
}

const NEW_QUESTION = 'Ask a new question.';

/**
 * Whether a follow-up to the last answer of `chain` may be asked now: null,
 * or { status, error } for the route to answer. `chain` is the thread as
 * THREAD_SQL reads it, root first, ending with the answer being followed up
 * (each row: id, parent_id, kind, answer, refused, truncated, book_sha256,
 * content). `current` is today's { systemSha, bookSha }. The checks, in order:
 * the answer exists (404); it is an Ask or a brief (a transition plan is not
 * followed up); the thread has room; the answer is whole and stored with its
 * turn; then the book and the instructions are the ones the thread was
 * answered on (409).
 */
function checkFollowUp(chain, current = {}) {
  if (!Array.isArray(chain) || chain.length === 0) return { status: 404, error: 'No such answer.' };
  const root = chain[0];
  const answer = chain[chain.length - 1];
  if (chain.some((turn) => !THREAD_KINDS.includes(turn.kind))) {
    return { status: 400, error: `A transition plan cannot be followed up. ${NEW_QUESTION}` };
  }
  // A root with a parent means the read stopped before the thread's start: too long in any case
  if ((root.parent_id !== null && root.parent_id !== undefined) || chain.length - 1 >= FOLLOW_UP_MAX) {
    return { status: 400, error: `This thread already has its ${FOLLOW_UP_MAX} follow-ups. ${NEW_QUESTION}` };
  }
  if (answer.refused === true) return { status: 400, error: `The AI declined this one, so it cannot be followed up. ${NEW_QUESTION}` };
  if (answer.truncated === true) {
    return { status: 400, error: 'This answer was cut off, so it cannot be followed up. Ask a new, narrower question.' };
  }
  if (typeof answer.answer === 'string' && answer.answer === '') {
    return { status: 400, error: `This answer has no text, so it cannot be followed up. ${NEW_QUESTION}` };
  }
  if (!chain.every((turn) => isTurn(turn.content))) {
    return { status: 400, error: `This answer was saved before follow-ups were possible, so it cannot be followed up. ${NEW_QUESTION}` };
  }
  if (!chain.every((turn) => turn.content.system_sha256 === current.systemSha)) {
    const bookChanged = chain.some((turn) => turn.book_sha256 !== current.bookSha);
    return {
      status: 409,
      error: bookChanged
        ? `The book has changed since this answer was given, so a follow-up would not read the same book. ${NEW_QUESTION}`
        : `The AI's instructions have changed since this answer was given, so it cannot be followed up. ${NEW_QUESTION}`,
    };
  }
  return null;
}

/**
 * Where an answer stands in its thread: `followUp`, its number (0 for the
 * first answer, 1 to FOLLOW_UP_MAX for a follow-up), and `canFollowUp`,
 * whether a follow-up to it may be asked now (checkFollowUp passes).
 */
function threadPlace(chain, current) {
  const list = Array.isArray(chain) ? chain : [];
  return { followUp: Math.max(0, list.length - 1), canFollowUp: list.length > 0 && checkFollowUp(list, current) === null };
}

// What GET /api/ai/answers/:id shows of each earlier turn
const TURN_FIELDS = Object.freeze(['id', 'kind', 'question', 'answer', 'refused', 'truncated', 'asked_by_username', 'created_at']);

/** The turns before the last one in `chain`, oldest first, with what the page shows of each. */
function earlierTurns(chain) {
  const list = Array.isArray(chain) ? chain.slice(0, -1) : [];
  return list.map((turn) => Object.fromEntries(TURN_FIELDS.map((field) => [field, turn[field] ?? null])));
}

module.exports = {
  FOLLOW_UP_MAX,
  THREAD_KINDS,
  TURN_FIELDS,
  systemHash,
  turnContent,
  isTurn,
  replayBlocks,
  threadHistory,
  readParentId,
  checkFollowUp,
  threadPlace,
  earlierTurns,
};
