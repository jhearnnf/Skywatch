const router = require('express').Router();
const { protect } = require('../middleware/auth');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const AppSettings = require('../models/AppSettings');

// GET /api/briefs — list all accessible briefs
router.get('/', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (search) filter.$or = [
      { title: new RegExp(search, 'i') },
      { subtitle: new RegExp(search, 'i') },
    ];

    const briefs = await IntelligenceBrief.find(filter)
      .populate('media')
      .sort({ dateAdded: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ status: 'success', data: { briefs } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/:id — single brief (records read + sets ammo)
router.get('/:id', protect, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    // Get or create the read record
    let readRecord = await IntelligenceBriefRead.findOne({
      userId: req.user._id,
      intelBriefId: brief._id,
    });

    if (!readRecord) {
      const settings = await AppSettings.getSettings();
      const ammoMap = { free: settings.ammoFree, trial: settings.ammoSilver, silver: settings.ammoSilver, gold: settings.ammoGold };
      // Trial uses silver ammo while active, otherwise free
      const tier = req.user.isTrialActive ? 'trial' : req.user.subscriptionTier;
      const ammo = ammoMap[tier] ?? 0;

      readRecord = await IntelligenceBriefRead.create({
        userId: req.user._id,
        intelBriefId: brief._id,
        ammunitionRemaining: ammo,
      });
    }

    res.json({ status: 'success', data: { brief, readRecord } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/briefs/:id/time — update time spent reading
router.patch('/:id/time', protect, async (req, res) => {
  try {
    const { seconds } = req.body;
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: req.user._id, intelBriefId: req.params.id },
      { $inc: { timeSpentSeconds: seconds }, lastReadAt: new Date() }
    );
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/briefs/:id/use-ammo — decrement ammo by 1 on keyword click
router.post('/:id/use-ammo', protect, async (req, res) => {
  try {
    const record = await IntelligenceBriefRead.findOneAndUpdate(
      { userId: req.user._id, intelBriefId: req.params.id, ammunitionRemaining: { $gt: 0 } },
      { $inc: { ammunitionRemaining: -1 } },
      { new: true }
    );
    if (!record) return res.status(400).json({ message: 'No ammo remaining' });
    res.json({ status: 'success', data: { ammunitionRemaining: record.ammunitionRemaining } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
