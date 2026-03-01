const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const ProblemReport = require('../models/ProblemReport');
const AdminAction = require('../models/AdminAction');
const AppSettings = require('../models/AppSettings');
const GameSessionQuizResult = require('../models/GameSessionQuizResult');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');

router.use(protect, adminOnly);

// Shared helper — all state-changing actions require a reason
const requireReason = (req, res, next) => {
  if (!req.body.reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required for this action' });
  }
  next();
};

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  try {
    const [totalUsers, freeUsers, trialUsers, silverUsers, goldUsers, totalBrifsRead, totalGamesPlayed, totalGamesWon] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ subscriptionTier: 'free' }),
        User.countDocuments({ subscriptionTier: 'trial' }),
        User.countDocuments({ subscriptionTier: 'silver' }),
        User.countDocuments({ subscriptionTier: 'gold' }),
        IntelligenceBriefRead.countDocuments(),
        GameSessionQuizResult.countDocuments(),
        GameSessionQuizResult.countDocuments({ isCorrect: true }),
      ]);

    res.json({
      status: 'success',
      data: {
        users: { totalUsers, freeUsers, trialUsers, subscribedUsers: silverUsers + goldUsers },
        games: { totalGamesPlayed, totalGamesWon, totalGamesLost: totalGamesPlayed - totalGamesWon },
        briefs: { totalBrifsRead },
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/settings
router.get('/settings', async (_req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    res.json({ status: 'success', data: { settings } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/settings
router.patch('/settings', requireReason, async (req, res) => {
  try {
    const { reason, ...updates } = req.body;
    const settings = await AppSettings.findOneAndUpdate({}, updates, { new: true, upsert: true });

    await AdminAction.create({
      userId: req.user._id,
      actionType: 'change_quiz_questions',
      reason,
    });

    res.json({ status: 'success', data: { settings } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/users/search?q=
router.get('/users/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ message: 'Search query required' });

    const users = await User.find({
      $or: [{ email: new RegExp(q, 'i') }, { agentNumber: q }],
    }).populate('rank').limit(20);

    res.json({ status: 'success', data: { users } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', requireReason, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBanned: true });
    await AdminAction.create({ userId: req.user._id, actionType: 'ban_user', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/make-admin
router.post('/users/:id/make-admin', requireReason, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isAdmin: true });
    await AdminAction.create({ userId: req.user._id, actionType: 'make_admin', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/reset-stats
router.post('/users/:id/reset-stats', requireReason, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { totalAircoins: 0, gameTypesSeen: [] });
    await GameSessionQuizResult.deleteMany({ userId: req.params.id });
    await AdminAction.create({ userId: req.user._id, actionType: 'reset_user_stats', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/problems
router.get('/problems', async (req, res) => {
  try {
    const { solved, search } = req.query;
    const filter = {};
    if (solved !== undefined) filter.solved = solved === 'true';
    if (search) filter.description = new RegExp(search, 'i');

    const problems = await ProblemReport.find(filter)
      .populate('userId', 'email agentNumber')
      .sort({ time: -1 });

    res.json({ status: 'success', data: { problems } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/problems/:id/update
router.post('/problems/:id/update', async (req, res) => {
  try {
    const { description, solved } = req.body;
    const update = { $push: { updates: { adminUserId: req.user._id, description } } };
    if (solved !== undefined) update.solved = solved;

    const report = await ProblemReport.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ status: 'success', data: { report } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
