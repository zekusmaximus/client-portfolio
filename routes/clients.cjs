const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { 
  clientValidationRules, 
  idValidationRules,
  handleValidationErrors, 
  sanitizeRequestBody 
} = require('../middleware/validation.cjs');
const clients = require('../models/clientModel.cjs');
const revenues = require('../models/revenueModel.cjs');

router.use(auth);
router.use(sanitizeRequestBody);

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
router.post('/', clientValidationRules, handleValidationErrors, async (req, res) => {
  try {
    console.log('Creating client with validated data:', req.body);
    const created = await clients.create(req.user.userId, req.body);
    res.status(201).json(created);
  } catch (e) {
    console.error('Error creating client:', e);
    res.status(500).json({ 
      error: 'Server error', 
      message: process.env.NODE_ENV === 'development' ? e.message : 'Internal server error' 
    });
  }
});

/* GET /api/clients/:id */
router.get('/:id', idValidationRules, handleValidationErrors, async (req, res) => {
  try {
    const c = await clients.get(req.params.id, req.user.userId);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (e) {
    console.error('Error fetching client:', e);
    res.status(500).json({ 
      error: 'Server error', 
      message: process.env.NODE_ENV === 'development' ? e.message : 'Internal server error' 
    });
  }
});

/* PUT /api/clients/:id */
router.put('/:id', idValidationRules, clientValidationRules, handleValidationErrors, async (req, res) => {
  try {
    console.log('Updating client with validated data:', req.body);
    const updated = await clients.update(req.params.id, req.user.userId, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found or no changes' });
    res.json(updated);
  } catch (e) {
    console.error('Error updating client:', e);
    res.status(500).json({ 
      error: 'Server error', 
      message: process.env.NODE_ENV === 'development' ? e.message : 'Internal server error' 
    });
  }
});

/* DELETE /api/clients/:id */
router.delete('/:id', idValidationRules, handleValidationErrors, async (req, res) => {
  try {
    await clients.remove(req.params.id, req.user.userId);
    res.status(204).end();
  } catch (e) {
    console.error('Error deleting client:', e);
    res.status(500).json({ 
      error: 'Server error', 
      message: process.env.NODE_ENV === 'development' ? e.message : 'Internal server error' 
    });
  }
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