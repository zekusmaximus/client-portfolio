const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const revenues = require('../models/revenueModel.cjs');

router.use(auth);

/* PUT /api/revenues/:revId */
router.put('/:revId', async (req, res) => {
  const updated = await revenues.update(req.params.revId, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found or no changes' });
  res.json(updated);
});

/* DELETE /api/revenues/:revId */
router.delete('/:revId', async (req, res) => {
  await revenues.remove(req.params.revId);
  res.status(204).end();
});

module.exports = router;