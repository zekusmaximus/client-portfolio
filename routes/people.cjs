const express = require('express');
const router = express.Router();
const db = require('../db.cjs');
const auth = require('../middleware/auth.cjs');
const { validatePersonInput, parseId, personChangeBlockers } = require('../utils/people.cjs');
const { logError } = require('../utils/errorLog.cjs');

// The People list (docs/plans/people-and-second-chair.md, P1-P5). Every
// signed-in partner may read and change it (P2). There is no DELETE: people are
// deactivated, never removed. No request pass: validatePersonInput admits
// only letters, spaces, hyphens, apostrophes and periods and trims the name,
// and the request sanitizer the client routes ran until WP5 would have stored
// "O'Brien" as "O&#x27;Brien".
router.use(auth);

const PEOPLE_SELECT = `
  SELECT p.id, p.name, p.role, p.active,
         (SELECT count(*)::int FROM clients c WHERE c.lead_id = p.id) AS lead_count,
         (SELECT count(*)::int FROM clients c WHERE c.second_chair_id = p.id) AS second_chair_count,
         (SELECT count(*)::int FROM clients c WHERE c.originator_id = p.id) AS originator_count
    FROM people p`;

const duplicateName = (name) => `Someone named ${name} is already on the People list.`;

// GET /api/people - everyone, active first, then partners, emeritus, associates
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`${PEOPLE_SELECT}
      ORDER BY p.active DESC,
               CASE p.role WHEN 'partner' THEN 0 WHEN 'emeritus' THEN 1 ELSE 2 END,
               lower(p.name)`);
    res.json({ success: true, people: rows });
  } catch (error) {
    logError('Error fetching people', error);
    res.status(500).json({ success: false, error: 'Failed to load the People list.' });
  }
});

// POST /api/people { name, role } - add someone, active
router.post('/', async (req, res) => {
  const { errors, value } = validatePersonInput(req.body || {});
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: errors.map((e) => e.message).join(' '), details: errors });
  }
  try {
    const { rows: [inserted] } = await db.query(
      'INSERT INTO people (name, role) VALUES ($1, $2) RETURNING id',
      [value.name, value.role]
    );
    const { rows: [person] } = await db.query(`${PEOPLE_SELECT} WHERE p.id = $1`, [inserted.id]);
    res.status(201).json({ success: true, person });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, error: duplicateName(value.name) });
    logError('Error adding person', error);
    res.status(500).json({ success: false, error: 'Failed to add the person.' });
  }
});

// PUT /api/people/:id { name?, role?, active? } - rename, change role, (de)activate.
// Refuses a change P5 forbids with 409 and the reason. A rename also rewrites
// the legacy text columns that name the person (P6), in the same transaction,
// having locked the person and then every client it rewrites, in id order.
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'No such person.' });

  const { errors, value } = validatePersonInput(req.body || {}, { partial: true });
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: errors.map((e) => e.message).join(' '), details: errors });
  }
  if (Object.keys(value).length === 0) {
    return res.status(400).json({ success: false, error: 'Nothing to change.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // FOR NO KEY UPDATE on the person; client writes read the people they
    // assign FOR SHARE (data.cjs), which waits for it, so a concurrent
    // assignment cannot slip past the counts below. Not FOR UPDATE, as until
    // Tier 3 WP2: a rename updates a client row twice (its lead's text, then
    // its team's), and on a row's second update in one transaction
    // PostgreSQL checks its foreign keys again, reading each person the row
    // names FOR KEY SHARE. FOR UPDATE refuses that lock and FOR NO KEY UPDATE
    // (the lock `UPDATE people` takes anyway) allows it. Held FOR UPDATE, a
    // rename's second update waited for another rename's person while that
    // rename waited for this one's clients: a deadlock (candidate (s)).
    const { rows: [current] } = await client.query(
      'SELECT id, name, role, active FROM people WHERE id = $1 FOR NO KEY UPDATE',
      [id]
    );
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'No such person.' });
    }
    const { rows: [counts] } = await client.query(
      `SELECT (SELECT count(*)::int FROM clients WHERE lead_id = $1) AS lead_count,
              (SELECT count(*)::int FROM clients WHERE second_chair_id = $1) AS second_chair_count`,
      [id]
    );
    const blockers = personChangeBlockers(current, value, counts);
    if (blockers.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: blockers.join(' ') });
    }

    const next = { ...current, ...value };
    await client.query(
      'UPDATE people SET name = $1, role = $2, active = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [next.name, next.role, next.active, id]
    );
    if (next.name !== current.name) {
      // Every client the three updates below rewrite, locked first, in id
      // order (Tier 3 WP2, candidate (s)). Until WP2 each update locked its
      // own rows as it went, so two renames at once, of two people holding
      // seats on the same two clients, could each lock one client with its
      // first update and wait for the other's with its second: a deadlock,
      // which PostgreSQL ended by aborting one rename (40P01, a 500). In one
      // order, the second rename waits for the first (with the person's lock
      // above). The order is the id column's own; the id is not cast.
      await client.query(
        'SELECT id FROM clients WHERE lead_id = $1 OR second_chair_id = $1 OR originator_id = $1 ORDER BY id FOR UPDATE',
        [id]
      );
      await client.query('UPDATE clients SET primary_lobbyist = $1 WHERE lead_id = $2', [next.name, id]);
      await client.query(
        'UPDATE clients SET lobbyist_team = array_replace(lobbyist_team, $1, $2) WHERE lead_id = $3 OR second_chair_id = $3',
        [current.name, next.name, id]
      );
      await client.query(
        'UPDATE clients SET client_originator = $1 WHERE originator_id = $2 AND NOT originator_is_firm',
        [next.name, id]
      );
    }
    await client.query('COMMIT');

    const { rows: [person] } = await db.query(`${PEOPLE_SELECT} WHERE p.id = $1`, [id]);
    res.json({ success: true, person });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ success: false, error: duplicateName(value.name) });
    logError('Error updating person', error);
    res.status(500).json({ success: false, error: 'Failed to update the person.' });
  } finally {
    client.release();
  }
});

module.exports = router;
