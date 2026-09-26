const db = require('../db.cjs');
const clientModel = require('./clientModel.cjs');
const { buildBook } = require('../utils/book.cjs');

// The book as the AI sees it (docs/plans/tier-1.md, WP2), read from the
// database: the database side of utils/book.cjs, as models/aiAnswerModel.cjs
// is of utils/aiAnswers.cjs. Shared by routes/ai.cjs (GET /api/ai/book, Ask
// and the brief) and routes/scenarios.cjs (transition plans, WP6), so every AI
// request builds its book from the same reads and the same code, which the
// shared cache prefix needs (T8). It lived in routes/ai.cjs until WP6.

/**
 * The book at `now`: the clients as listWithMetrics scores them (people read
 * from the nested lead, secondChair and originator, not the legacy text) and
 * the People list, built by buildBook. Returns buildBook's result plus
 * `people`, the People list rows as read ({ id, name, role, active }), so a
 * transition plan checks its roster against the list the book was built from.
 * Two queries, not one snapshot (WP2).
 */
async function loadBook(now = new Date()) {
  const [clients, { rows: people }] = await Promise.all([
    clientModel.listWithMetrics(),
    db.query('SELECT id, name, role, active FROM people'),
  ]);
  return { ...buildBook({ people, clients, now }), people };
}

module.exports = { loadBook };
