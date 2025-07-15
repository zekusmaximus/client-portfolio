const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const clients = require('../models/clientModel');
const revenues = require('../models/revenueModel');

router.use(auth);

/* GET /api/clients */
router.get('/', async (req, res) => {
  try {
    const data = await clients.listWithRevenues(req.user.userId);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/clients */
router.post('/', async (req, res) => {
  try {
    const created = await clients.create(req.user.userId, req.body);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Invalid data' });
  }
});

/* GET /api/clients/:id */
router.get('/:id', async (req, res) => {
  const c = await clients.get(req.params.id, req.user.userId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

/* PUT /api/clients/:id */
router.put('/:id', async (req, res) => {
  const updated = await clients.update(req.params.id, req.user.userId, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found or no changes' });
  res.json(updated);
});

/* DELETE /api/clients/:id */
router.delete('/:id', async (req, res) => {
  await clients.remove(req.params.id, req.user.userId);
  res.status(204).end();
});

/* POST /api/clients/:id/revenues */
router.post('/:id/revenues', async (req, res) => {
  try {
    const { year, revenue_amount, contract_end_date } = req.body || {};
    if (!year || !revenue_amount)
      return res.status(400).json({ error: 'year and revenue_amount required' });

    const rev = await revenues.upsert(
      req.params.id,
      year,
      revenue_amount,
      contract_end_date
    );
    res.status(201).json(rev);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Invalid data' });
  }
});

module.exports = router;