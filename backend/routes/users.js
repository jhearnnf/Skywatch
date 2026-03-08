const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const GameSessionQuizResult  = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt');
const IntelligenceBriefRead  = require('../models/IntelligenceBriefRead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const ProblemReport = require('../models/ProblemReport');
const AppSettings = require('../models/AppSettings');
const Level = require('../models/Level');
const Rank = require('../models/Rank');
const AircoinLog = require('../models/AircoinLog');

// GET /api/users/stats — current user's stats for profile page
router.get('/stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('rank');

    const validBriefIds = await IntelligenceBrief.distinct('_id');
    const brifsRead = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id,
      intelBriefId: { $in: validBriefIds },
    });

    const allAttempts      = await GameSessionQuizAttempt.find({ userId: req.user._id, status: { $in: ['completed', 'abandoned'] } });
    const completedAttempts = allAttempts.filter(a => a.status === 'completed');
    const gamesPlayed      = allAttempts.length;
    const totalPct         = completedAttempts.reduce((s, a) => s + (a.percentageCorrect ?? 0), 0);
    const winPercent       = completedAttempts.length > 0 ? Math.round(totalPct / completedAttempts.length) : 0;

    res.json({
      status: 'success',
      data: {
        agentNumber:      user.agentNumber,
        subscriptionTier: user.subscriptionTier,
        difficultySetting: user.difficultySetting,
        rank:             user.rank,
        brifsRead,
        gamesPlayed,
        winPercent,
        totalAircoins:    user.totalAircoins,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/users/me/difficulty — update the user's preferred quiz difficulty
router.patch('/me/difficulty', protect, async (req, res) => {
  try {
    const { difficulty } = req.body;
    if (!['easy', 'medium'].includes(difficulty)) {
      return res.status(400).json({ message: 'difficulty must be easy or medium' });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { difficultySetting: difficulty },
      { new: true }
    ).populate('rank');
    res.json({ status: 'success', data: { user } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/leaderboard — top 20 agents by total aircoins (public)
router.get('/leaderboard', async (req, res) => {
  try {
    const agents = await User.find({})
      .select('agentNumber totalAircoins')
      .sort({ totalAircoins: -1 })
      .limit(20);

    res.json({ status: 'success', data: { agents } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/settings — public read-only app settings subset
router.get('/settings', async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    res.json({ status: 'success', data: { useLiveLeaderboard: settings.useLiveLeaderboard } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/levels — all levels with computed cumulativeAircoins (public)
router.get('/levels', async (req, res) => {
  try {
    const levels = await Level.find({}).sort({ levelNumber: 1 });
    let cumulative = 0;
    const withCumulative = levels.map(l => {
      const item = {
        levelNumber: l.levelNumber,
        aircoinsToNextLevel: l.aircoinsToNextLevel,
        cumulativeAircoins: cumulative,
      };
      if (l.aircoinsToNextLevel) cumulative += l.aircoinsToNextLevel;
      return item;
    });
    res.json({ status: 'success', data: { levels: withCumulative } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/ranks — all RAF ranks (public)
router.get('/ranks', async (req, res) => {
  try {
    const ranks = await Rank.find({}).sort({ rankNumber: 1 });
    res.json({ status: 'success', data: { ranks } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/aircoins/history — paginated aircoin award history for current user
router.get('/aircoins/history', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      AircoinLog.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AircoinLog.countDocuments({ userId: req.user._id }),
    ]);

    res.json({ status: 'success', data: { logs, total, page: Number(page), limit: Number(limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/users/me/tutorials — update a single tutorial status
const VALID_TUTORIAL_IDS = ['welcome', 'intel_brief', 'user', 'load_up'];
const TUTORIAL_PRIORITY  = { unseen: 0, skipped: 1, viewed: 2 };

router.patch('/me/tutorials', protect, async (req, res) => {
  try {
    const { tutorialId, status } = req.body;
    if (!VALID_TUTORIAL_IDS.includes(tutorialId))
      return res.status(400).json({ message: 'Invalid tutorialId' });
    if (!['unseen','skipped','viewed'].includes(status))
      return res.status(400).json({ message: 'Invalid status' });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { [`tutorials.${tutorialId}`]: status },
      { new: true }
    );
    res.json({ status: 'success', data: { tutorials: user.tutorials } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/users/me/tutorials/sync — sync localStorage tutorial states to DB on login
router.patch('/me/tutorials/sync', protect, async (req, res) => {
  try {
    const incoming = req.body; // { welcome: 'viewed', intel_brief: 'skipped', ... }
    const user     = await User.findById(req.user._id);
    const updates  = {};
    for (const [id, status] of Object.entries(incoming)) {
      if (!VALID_TUTORIAL_IDS.includes(id)) continue;
      if (!['unseen','skipped','viewed'].includes(status)) continue;
      const current = user.tutorials?.[id] ?? 'unseen';
      if (TUTORIAL_PRIORITY[status] > TUTORIAL_PRIORITY[current]) {
        updates[`tutorials.${id}`] = status;
      }
    }
    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(req.user._id, { $set: updates });
    }
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users/report-problem
router.post('/report-problem', protect, async (req, res) => {
  try {
    const { pageReported, description } = req.body;
    if (!description) return res.status(400).json({ message: 'Description required' });

    const report = await ProblemReport.create({
      userId: req.user._id,
      pageReported: pageReported || 'unknown',
      description,
    });

    res.status(201).json({ status: 'success', data: { report } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
