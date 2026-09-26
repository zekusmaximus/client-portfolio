const express = require('express');
const router = express.Router();
const db = require('../db.cjs');
const auth = require('../middleware/auth.cjs');
const clientModel = require('../models/clientModel.cjs');
const { buildBook } = require('../utils/book.cjs');

// The AI routes that work on the whole book (docs/plans/tier-1.md). WP2: the
// book itself, as the AI will see it (utils/book.cjs), for the AI tab's "What
// the AI is given" panel. No Anthropic call here, so no AI rate limiter (T16);
// and no sanitizeRequestBody, as in routes/people.cjs: the book decodes names
// the client form stored escaped (unescapeText), and later POST routes will
// validate their own input.
router.use(auth);

// GET /api/ai/book - { success, reportingYear, clientCount, peopleCount,
// chars, estimatedTokens, text }. Built at each request from the database:
// the clients as listWithMetrics scores them (people read from the nested
// lead, secondChair and originator, not the legacy text) and the People list.
// estimatedTokens is chars / 4, an estimate: nothing here counts tokens.
router.get('/book', async (req, res) => {
  try {
    const [clients, { rows: people }] = await Promise.all([
      clientModel.listWithMetrics(),
      db.query('SELECT id, name, role, active FROM people'),
    ]);
    const { reportingYear, clientCount, peopleCount, chars, estimatedTokens, text } = buildBook({ people, clients, now: new Date() });
    res.json({ success: true, reportingYear, clientCount, peopleCount, chars, estimatedTokens, text });
  } catch (error) {
    console.error(JSON.stringify({ event: 'ai_book_error', message: error.message }));
    res.status(500).json({ success: false, error: 'Failed to build the book.' });
  }
});

module.exports = router;
