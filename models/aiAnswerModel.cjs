const db = require('../db.cjs');
const {
  INSERT_ANSWER_SQL,
  LIST_ANSWERS_SQL,
  LIST_ANSWERS_BEFORE_SQL,
  ONE_ANSWER_SQL,
  MONTH_SUMMARY_SQL,
  insertParams,
  firmMonth,
} = require('../utils/aiAnswers.cjs');

// Saved AI answers (docs/plans/tier-1.md, WP4): the database side of
// utils/aiAnswers.cjs, shared by routes/ai.cjs (Ask and the brief, and the
// recent answers) and routes/scenarios.cjs (transition plans).

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

/** The newest answers, `limit` of them, after the answer `before` when given; and whether older ones remain. */
async function listAnswers({ before = null, limit }) {
  const { rows } = before === null
    ? await db.query(LIST_ANSWERS_SQL, [limit + 1])
    : await db.query(LIST_ANSWERS_BEFORE_SQL, [before, limit + 1]);
  return { answers: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** One answer, whole, or null. */
async function getAnswer(id) {
  const { rows } = await db.query(ONE_ANSWER_SQL, [id]);
  return rows[0] || null;
}

/** The firm's calendar month holding `now`: its answers and their estimated cost (cost_usd as text). */
async function monthSummary(now = new Date()) {
  const month = firmMonth(now);
  const { rows: [sums] } = await db.query(MONTH_SUMMARY_SQL, [month.from, month.to]);
  return { ...month, answers: sums.answers, costUsd: sums.cost_usd, unpriced: sums.unpriced };
}

module.exports = { saveAnswer, listAnswers, getAnswer, monthSummary };
