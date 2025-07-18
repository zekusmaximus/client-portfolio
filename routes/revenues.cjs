const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.cjs');
const { 
  revenueValidationRules, 
  revenueIdValidationRules,
  handleValidationErrors, 
  sanitizeRequestBody 
} = require('../middleware/validation.cjs');
const revenues = require('../models/revenueModel.cjs');

router.use(auth);
router.use(sanitizeRequestBody);

/* PUT /api/revenues/:revId */
router.put('/:revId', revenueIdValidationRules, revenueValidationRules, handleValidationErrors, async (req, res) => {
  try {
    console.log('Updating revenue with validated data:', req.body);
    const updated = await revenues.update(req.params.revId, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found or no changes' });
    res.json(updated);
  } catch (e) {
    console.error('Error updating revenue:', e);
    res.status(500).json({ 
      error: 'Server error', 
      message: process.env.NODE_ENV === 'development' ? e.message : 'Internal server error' 
    });
  }
});

/* DELETE /api/revenues/:revId */
router.delete('/:revId', revenueIdValidationRules, handleValidationErrors, async (req, res) => {
  try {
    await revenues.remove(req.params.revId);
    res.status(204).end();
  } catch (e) {
    console.error('Error deleting revenue:', e);
    res.status(500).json({ 
      error: 'Server error', 
      message: process.env.NODE_ENV === 'development' ? e.message : 'Internal server error' 
    });
  }
});

module.exports = router;