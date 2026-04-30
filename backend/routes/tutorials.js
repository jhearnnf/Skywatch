const router   = require('express').Router();
const Tutorial = require('../models/Tutorial');

// GET /api/tutorials — public read of all tutorials with steps.
// Used by the frontend tutorial runtime (AppTutorialContext) on mount.
router.get('/', async (_req, res) => {
  try {
    const tutorials = await Tutorial.find({}).lean();
    res.json({ status: 'success', data: { tutorials } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
