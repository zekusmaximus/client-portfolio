const db = require('../db.cjs');
const {
  INSERT_ANSWER_SQL,
  LIST_ANSWERS_SQL,
  LIST_ANSWERS_BEFORE_SQL,
  ONE_ANSWER_SQL,
  THREAD_SQL,
  HIDE_ANSWER_SQL,
  SHOW_ANSWER_SQL,
  ANSWER_HIDDEN_SQL,
  MONTH_SUMMARY_SQL,
  insertParams,
  firmMonth,
} = require('../utils/aiAnswers.cjs');

// Saved AI answers (docs/plans/tier-1.md, WP4): the database side of
// utils/aiAnswers.cjs, shared by routes/ai.cjs (Ask and the brief, and the
// recent answers) and routes/scenarios.cjs (transition plans); since Tier 2
// WP10 also threads (follow-ups) and hiding.

/**
 * Saves one answer (a row from answerRow). Never throws: the partner has paid
 * for the answer, so a failed save returns { id: null, saved: false } and
 * logs one ai_answer_save_failed line, and the route still returns the
 * answer. Otherwise { id, saved: true }.
 */
async function saveAnswer(row, { label, userId } = {}) {
  try {
    const { rows: [saved] } = await db.query(INSERT_ANSWER_SQL, insertParams(row));
    return { id: saved.id, saved: true };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'ai_answer_save_failed',
      label,
      userId,
      kind: row?.kind,
      code: error?.code ?? null,
      message: error?.message,
    }));
    return { id: null, saved: false };
  }
}

/**
 * The newest answers, `limit` of them, after the answer `before` when given;
 * and whether older ones remain. `hidden` true lists the hidden answers
 * only, false the others (WP10).
 */
async function listAnswers({ before = null, limit, hidden = false }) {
  const { rows } = before === null
    ? await db.query(LIST_ANSWERS_SQL, [limit + 1, hidden])
    : await db.query(LIST_ANSWERS_BEFORE_SQL, [before, limit + 1, hidden]);
  return { answers: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** One answer, whole, or null. */
async function getAnswer(id) {
  const { rows } = await db.query(ONE_ANSWER_SQL, [id]);
  return rows[0] || null;
}

/** The thread ending at answer `id`, root first (THREAD_SQL); [] when there is no such answer. */
async function getThread(id) {
  const { rows } = await db.query(THREAD_SQL, [id]);
  return rows;
}

/**
 * Hides answer `id` for everyone, as `user` ({ userId, username }), unless it
 * is hidden already (who hid it first stays); `show` true shows it again.
 * Returns { id, hidden_at, hidden_by_username } as the row now is, or null
 * when there is no such answer.
 */
async function setHidden(id, user, show = false) {
  if (show) await db.query(SHOW_ANSWER_SQL, [id]);
  else await db.query(HIDE_ANSWER_SQL, [id, Number.isInteger(user?.userId) ? user.userId : null, user?.username ?? null]);
  const { rows } = await db.query(ANSWER_HIDDEN_SQL, [id]);
  return rows[0] || null;
}

/** The firm's calendar month holding `now`: its answers and their estimated cost (cost_usd as text). */
async function monthSummary(now = new Date()) {
  const month = firmMonth(now);
  const { rows: [sums] } = await db.query(MONTH_SUMMARY_SQL, [month.from, month.to]);
  return { ...month, answers: sums.answers, costUsd: sums.cost_usd, unpriced: sums.unpriced };
}

module.exports = { saveAnswer, listAnswers, getAnswer, getThread, setHidden, monthSummary };
