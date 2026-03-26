const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const ProblemReport = require('../models/ProblemReport');
const AdminAction = require('../models/AdminAction');
const AppSettings = require('../models/AppSettings');
const { sendWelcomeEmail } = require('../utils/email');
const GameSessionQuizResult               = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt              = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult      = require('../models/GameSessionOrderOfBattleResult');
const GameOrderOfBattle                   = require('../models/GameOrderOfBattle');
const GameFlashcardRecall                 = require('../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult    = require('../models/GameSessionFlashcardRecallResult');
const GameWhosAtAircraft                  = require('../models/GameWhosAtAircraft');
const GameSessionWhosAtAircraftResult     = require('../models/GameSessionWhosAtAircraftResult');
const GameSessionWhereAircraftResult      = require('../models/GameSessionWhereAircraftResult');
const AircoinLog             = require('../models/AircoinLog');
const { awardCoins, CYCLE_THRESHOLD } = require('../utils/awardCoins');
const Rank  = require('../models/Rank');
const Level = require('../models/Level');
const IntelligenceBriefRead  = require('../models/IntelligenceBriefRead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { CATEGORIES, SUBCATEGORIES } = IntelligenceBrief;
const GameQuizQuestion  = require('../models/GameQuizQuestion');
const GameType          = require('../models/GameType');
const Media             = require('../models/Media');
const mongoose          = require('mongoose');
const path              = require('path');
const fs                = require('fs');
const { uploadBuffer, destroyAsset } = require('../utils/cloudinary');
const IntelLead = require('../models/IntelLead');
const seedLeads = require('../seeds/seedLeads');

function normaliseLeadTitle(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Returns { matched: bool, error: string|null }
async function unmarkLeadInDb(briefTitle) {
  try {
    const norm  = normaliseLeadTitle(briefTitle);
    const leads = await IntelLead.find({ isPublished: true }).select('title');
    const match = leads.find(l => normaliseLeadTitle(l.title) === norm);
    if (!match) return { matched: false, error: null };
    await IntelLead.updateOne({ _id: match._id }, { isPublished: false });
    return { matched: true, error: null };
  } catch (err) {
    return { matched: false, error: err.message };
  }
}

router.use(protect, adminOnly);

// Shared helper — all state-changing actions require a reason
const requireReason = (req, res, next) => {
  if (!req.body.reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required for this action' });
  }
  next();
};

// GET /api/admin/actions?page=1&limit=20&type=ban_user
router.get('/actions', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.type) filter.actionType = req.query.type;

    const [actions, total] = await Promise.all([
      AdminAction.find(filter)
        .sort({ time: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId',       'agentNumber email')
        .populate('targetUserId', 'agentNumber email')
        .lean(),
      AdminAction.countDocuments(filter),
    ]);

    res.json({ status: 'success', data: { actions, total, page, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    const passThresholdEasy   = settings.passThresholdEasy   ?? 60;
    const passThresholdMedium = settings.passThresholdMedium ?? 60;

    const [
      totalUsers, freeUsers, trialUsers, silverUsers, goldUsers,
      easyPlayers, mediumPlayers,
      totalBrifsRead, totalBrifsOpened, readTimeAgg,
      totalGamesPlayed, totalGamesCompleted, totalPerfectScores, totalGamesWon,
      easyLost, mediumLost,
      totalGamesAbandoned,
      aircoinAgg, loginAgg,
      quizTimeAgg,
      booTotal, booWon, booDefeated, booAbandoned, booTimeAgg,
      tutorialAgg,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ subscriptionTier: 'free' }),
      User.countDocuments({ subscriptionTier: 'trial' }),
      User.countDocuments({ subscriptionTier: 'silver' }),
      User.countDocuments({ subscriptionTier: 'gold' }),
      User.countDocuments({ difficultySetting: 'easy' }),
      User.countDocuments({ difficultySetting: 'medium' }),
      IntelligenceBriefRead.countDocuments({ completed: true }),
      IntelligenceBriefRead.countDocuments({ completed: false }),
      IntelligenceBriefRead.aggregate([{ $group: { _id: null, total: { $sum: '$timeSpentSeconds' } } }]),
      GameSessionQuizAttempt.countDocuments({ status: { $in: ['completed', 'abandoned'] } }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed' }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', percentageCorrect: 100 }),
      GameSessionQuizAttempt.countDocuments({ won: true }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', difficulty: 'easy',   percentageCorrect: { $lt: passThresholdEasy } }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', difficulty: 'medium', percentageCorrect: { $lt: passThresholdMedium } }),
      GameSessionQuizAttempt.countDocuments({ status: 'abandoned' }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$totalAircoins' } } }]),
      User.aggregate([{ $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$logins', []] } } } } }]),
      // Quiz: sum time for attempts that have both timeStarted and timeFinished
      GameSessionQuizAttempt.aggregate([
        { $match: { timeFinished: { $ne: null } } },
        { $group: { _id: null, total: { $sum: { $divide: [{ $subtract: ['$timeFinished', '$timeStarted'] }, 1000] } } } },
      ]),
      // BOO counts
      GameSessionOrderOfBattleResult.countDocuments(),
      GameSessionOrderOfBattleResult.countDocuments({ won: true,  abandoned: { $ne: true } }),
      GameSessionOrderOfBattleResult.countDocuments({ won: false, abandoned: { $ne: true } }),
      GameSessionOrderOfBattleResult.countDocuments({ abandoned: true }),
      // BOO: sum timeTakenSeconds (null entries treated as 0)
      GameSessionOrderOfBattleResult.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ['$timeTakenSeconds', 0] } } } },
      ]),
      // Tutorial viewed/skipped counts across all users and all 4 tutorial fields
      User.aggregate([{
        $group: {
          _id: null,
          viewed: { $sum: { $add: [
            { $cond: [{ $eq: ['$tutorials.welcome',     'viewed'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.intel_brief', 'viewed'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.user',        'viewed'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.load_up',     'viewed'] }, 1, 0] },
          ]}},
          skipped: { $sum: { $add: [
            { $cond: [{ $eq: ['$tutorials.welcome',     'skipped'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.intel_brief', 'skipped'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.user',        'skipped'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.load_up',     'skipped'] }, 1, 0] },
          ]}},
        },
      }]),
    ]);

    // Combined login streaks — requires virtual, so fetch all users
    const allUsers      = await User.find({}).select('logins');
    const combinedStreaks = allUsers.reduce((sum, u) => sum + (u.loginStreak ?? 0), 0);

    res.json({
      status: 'success',
      data: {
        users: {
          totalUsers, freeUsers, trialUsers,
          subscribedUsers: silverUsers + goldUsers,
          easyPlayers, mediumPlayers,
          totalLogins:      loginAgg[0]?.total ?? 0,
          combinedStreaks,
        },
        games: {
          totalGamesPlayed,
          totalGamesCompleted,
          totalGamesWon,
          totalPerfectScores,
          totalGamesLost:      easyLost + mediumLost,
          totalGamesAbandoned,
          totalAircoinsEarned: aircoinAgg[0]?.total ?? 0,
          passThresholdEasy,
          passThresholdMedium,
          quizTotalSeconds: Math.round(quizTimeAgg[0]?.total ?? 0),
          boo: {
            total:     booTotal,
            won:       booWon,
            defeated:  booDefeated,
            abandoned: booAbandoned,
            totalSeconds: booTimeAgg[0]?.total ?? 0,
          },
        },
        briefs: { totalBrifsRead, totalBrifsOpened, totalReadSeconds: readTimeAgg[0]?.total ?? 0 },
        tutorials: {
          viewed:  tutorialAgg[0]?.viewed  ?? 0,
          skipped: tutorialAgg[0]?.skipped ?? 0,
        },
        server: {
          serverUptimeSeconds: Math.floor(process.uptime()),
        },
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
    // Mixed field tutorialContent needs explicit mark after findOneAndUpdate via set,
    // but findOneAndUpdate at the DB level handles it correctly already.

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

// POST /api/admin/test-email — sends a test welcome email to the admin's own address
router.post('/test-email', async (req, res) => {
  try {
    await sendWelcomeEmail({ email: req.user.email, agentNumber: req.user.agentNumber });
    res.json({ status: 'success', message: `Test email sent to ${req.user.email}` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// PATCH /api/admin/tutorials/content — save an override for one tutorial step
// Body: { key: 'welcome_0', title, body, guestBody (optional) }
// Send title/body as empty string to clear the override for that field.
router.patch('/tutorials/content', requireReason, async (req, res) => {
  try {
    const { key, title, body, guestBody, reason } = req.body;
    const VALID_KEYS = ['welcome_0','welcome_1','intel_brief_0','user_0','user_1','load_up_0'];
    if (!VALID_KEYS.includes(key)) return res.status(400).json({ message: 'Invalid tutorial key' });

    // Build the override object; omit guestBody unless it was provided
    const override = { title: title ?? '', body: body ?? '' };
    if (guestBody !== undefined) override.guestBody = guestBody;

    const settings = await AppSettings.findOne() ?? await AppSettings.create({});
    const existing = settings.tutorialContent ?? {};
    existing[key] = override;
    settings.tutorialContent = existing;
    settings.markModified('tutorialContent');
    await settings.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'edit_tutorial_content', reason });
    res.json({ status: 'success', data: { tutorialContent: settings.tutorialContent } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper — attach profileStats to a list of User documents
async function enrichUsersWithStats(users) {
  if (!users.length) return [];
  const userIds = users.map(u => u._id);

  const [briefCounts, quizCounts, booCounts] = await Promise.all([
    IntelligenceBriefRead.aggregate([
      { $match: { userId: { $in: userIds }, completed: true } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]),
    GameSessionQuizAttempt.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId',
          total:     { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          abandoned: { $sum: { $cond: [{ $eq: ['$status', 'abandoned'] }, 1, 0] } },
      }},
    ]),
    GameSessionOrderOfBattleResult.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId',
          total:    { $sum: 1 },
          won:      { $sum: { $cond: ['$won',      1, 0] } },
          abandoned:{ $sum: { $cond: ['$abandoned', 1, 0] } },
      }},
    ]),
  ]);

  const briefMap = Object.fromEntries(briefCounts.map(b => [b._id.toString(), b.count]));
  const quizMap  = Object.fromEntries(quizCounts.map(q  => [q._id.toString(), q]));
  const booMap   = Object.fromEntries(booCounts.map(b   => [b._id.toString(), b]));

  return users.map(u => {
    const plain = u.toObject({ virtuals: true });
    const uid   = plain._id.toString();
    return {
      ...plain,
      profileStats: {
        brifsRead:        briefMap[uid]          ?? 0,
        quizzesPlayed:    quizMap[uid]?.total     ?? 0,
        quizzesCompleted: quizMap[uid]?.completed ?? 0,
        quizzesAbandoned: quizMap[uid]?.abandoned ?? 0,
        booPlayed:        booMap[uid]?.total      ?? 0,
        booWon:           booMap[uid]?.won        ?? 0,
        booAbandoned:     booMap[uid]?.abandoned  ?? 0,
      },
    };
  });
}

// GET /api/admin/users — all users, oldest first (first registered at top)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().populate('rank').sort({ createdAt: 1 });
    res.json({ status: 'success', data: { users: await enrichUsersWithStats(users) } });
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

    res.json({ status: 'success', data: { users: await enrichUsersWithStats(users) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', requireReason, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot ban your own account.' });
    }
    await User.findByIdAndUpdate(req.params.id, { isBanned: true });
    await AdminAction.create({ userId: req.user._id, actionType: 'ban_user', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', requireReason, async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, { isBanned: false }, { new: true });
    if (!updated) return res.status(404).json({ message: 'User not found.' });
    await AdminAction.create({ userId: req.user._id, actionType: 'unban_user', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/users/:id/aircoins/history — paginated aircoin history for any user
router.get('/users/:id/aircoins/history', async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const userId = req.params.id;

    const [logs, total, user] = await Promise.all([
      AircoinLog.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      AircoinLog.countDocuments({ userId }),
      User.findById(userId).select('totalAircoins agentNumber').lean(),
    ]);

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ status: 'success', data: { logs, total, page: Number(page), limit: Number(limit), user } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/users/:id — permanently delete a user and all their data
router.delete('/users/:id', requireReason, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    const userId = req.params.id;
    await Promise.all([
      AircoinLog.deleteMany({ userId }),
      GameSessionQuizResult.deleteMany({ userId }),
      GameSessionQuizAttempt.deleteMany({ userId }),
      GameSessionOrderOfBattleResult.deleteMany({ userId }),
      IntelligenceBriefRead.deleteMany({ userId }),
      ProblemReport.deleteMany({ userId }),
    ]);
    await User.findByIdAndDelete(userId);
    await AdminAction.create({ userId: req.user._id, actionType: 'delete_user', reason: req.body.reason, targetUserId: userId });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/users/:id/subscription — change a user's subscription tier
router.patch('/users/:id/subscription', requireReason, async (req, res) => {
  try {
    const { tier } = req.body;
    const valid = ['free', 'trial', 'silver', 'gold'];
    if (!valid.includes(tier)) return res.status(400).json({ message: 'Invalid tier' });

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    const settings = await AppSettings.getSettings();
    const ammoMap = {
      free:   settings.ammoFree   ?? 0,
      trial:  settings.ammoSilver ?? 10,
      silver: settings.ammoSilver ?? 10,
      gold:   9999,
    };

    const tierUpdate = { subscriptionTier: tier };
    if (tier === 'trial') {
      tierUpdate.trialStartDate    = new Date();
      tierUpdate.trialDurationDays = settings.trialDurationDays ?? 7;
    }

    const [user] = await Promise.all([
      User.findByIdAndUpdate(req.params.id, tierUpdate, { new: true }).select('-password').populate('rank'),
      IntelligenceBriefRead.updateMany({ userId: req.params.id }, { ammunitionRemaining: ammoMap[tier] }),
    ]);

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'change_subscription',
      reason:       req.body.reason,
      targetUserId: req.params.id,
    });

    res.json({ status: 'success', data: { user } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/self/subscription — admin emulates a subscription tier on their own account
router.patch('/self/subscription', async (req, res) => {
  try {
    const { tier } = req.body;
    const valid = ['free', 'trial', 'silver', 'gold'];
    if (!valid.includes(tier)) return res.status(400).json({ message: 'Invalid tier' });

    const settings = await AppSettings.getSettings();
    const ammoMap = {
      free:   settings.ammoFree   ?? 3,
      trial:  settings.ammoSilver ?? 10,
      silver: settings.ammoSilver ?? 10,
      gold:   9999,
    };

    // When setting trial tier, activate the trial window so isTrialActive returns true
    const tierUpdate = { subscriptionTier: tier };
    if (tier === 'trial') {
      tierUpdate.trialStartDate    = new Date();
      tierUpdate.trialDurationDays = settings.trialDurationDays ?? 7;
    }

    // Update tier and reset all read record ammo counts for this user
    const [user] = await Promise.all([
      User.findByIdAndUpdate(req.user._id, tierUpdate, { new: true }).select('-password').populate('rank'),
      IntelligenceBriefRead.updateMany({ userId: req.user._id }, { ammunitionRemaining: ammoMap[tier] }),
    ]);

    res.json({ status: 'success', data: { user } });
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

// POST /api/admin/users/:id/remove-admin
router.post('/users/:id/remove-admin', requireReason, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot remove your own admin access.' });
    }
    await User.findByIdAndUpdate(req.params.id, { isAdmin: false });
    await AdminAction.create({ userId: req.user._id, actionType: 'remove_admin', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/reset-stats
router.post('/users/:id/reset-stats', requireReason, async (req, res) => {
  try {
    const fields = Array.isArray(req.body.fields) ? req.body.fields : ['aircoins', 'gameHistory', 'intelBriefsRead'];
    const userUpdates = {};
    const ops = [];

    if (fields.includes('aircoins'))        { userUpdates.totalAircoins = 0; userUpdates.cycleAircoins = 0; userUpdates.rank = null; ops.push(AircoinLog.deleteMany({ userId: req.params.id })); }
    if (fields.includes('gameHistory'))     { userUpdates.gameTypesSeen = []; ops.push(GameSessionQuizResult.deleteMany({ userId: req.params.id })); ops.push(GameSessionQuizAttempt.deleteMany({ userId: req.params.id })); ops.push(GameSessionOrderOfBattleResult.deleteMany({ userId: req.params.id })); }
    if (fields.includes('intelBriefsRead')) {
      userUpdates.loginStreak    = 0;
      userUpdates.lastStreakDate = null;
      ops.push(IntelligenceBriefRead.deleteMany({ userId: req.params.id }));
    }
    if (fields.includes('tutorials'))       { userUpdates.tutorialsResetAt = new Date(); }

    if (Object.keys(userUpdates).length) ops.push(User.findByIdAndUpdate(req.params.id, userUpdates));
    await Promise.all(ops);
    await AdminAction.create({ userId: req.user._id, actionType: 'reset_user_stats', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/award-coins — award test coins to the admin's own account
router.post('/award-coins', async (req, res) => {
  try {
    const { amount } = req.body;
    const parsed = parseInt(amount, 10);
    if (!parsed || parsed <= 0) return res.status(400).json({ message: 'Amount must be a positive integer' });

    const result = await awardCoins(req.user._id, parsed, 'admin', 'Test Coins');

    await AdminAction.create({ userId: req.user._id, actionType: 'award_test_coins', reason: `Awarded ${parsed} test coins to self` });
    res.json({ status: 'success', awarded: parsed, totalAircoins: result.totalAircoins, cycleAircoins: result.cycleAircoins, rankPromotion: result.rankPromotion });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/problems/count — unsolved report count for tab badge
router.get('/problems/count', async (req, res) => {
  try {
    const unsolvedCount = await ProblemReport.countDocuments({ solved: false });
    res.json({ status: 'success', data: { unsolvedCount } });
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
      .populate('updates.adminUserId', 'agentNumber email')
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
    if (solved !== undefined) update.$set = { solved };

    const report = await ProblemReport.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ status: 'success', data: { report } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Intel Brief CRUD ──────────────────────────────────────────────────────────

// GET /api/admin/briefs
router.get('/briefs', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (search) filter.$or = [
      { title: new RegExp(search, 'i') },
      { subtitle: new RegExp(search, 'i') },
    ];
    const [briefs, total] = await Promise.all([
      IntelligenceBrief.find(filter)
        .populate('media')
        .sort({ dateAdded: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      IntelligenceBrief.countDocuments(filter),
    ]);
    res.json({ status: 'success', data: { briefs, total } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/titles — lightweight title list for duplicate detection
router.get('/briefs/titles', async (_req, res) => {
  try {
    const briefs = await IntelligenceBrief.find({}).select('title').lean();
    res.json({ status: 'success', data: { titles: briefs.map(b => ({ _id: b._id, title: b.title })) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/duplicates — find all briefs with duplicate normalised titles
router.get('/briefs/duplicates', async (req, res) => {
  try {
    const briefs = await IntelligenceBrief.find({}, '_id title category dateAdded status').lean();
    const groups = {};
    for (const b of briefs) {
      const key = b.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    const duplicates = Object.values(groups)
      .filter(g => g.length > 1)
      .map(g => g.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)));
    res.json({ status: 'success', data: { duplicates } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/related-pool — lightweight list for the Related Briefs picker
// Excludes categories covered by typed link pickers (Bases/Squadrons/Aircrafts/Missions/Training)
const TYPED_LINK_CATEGORIES = ['Bases', 'Squadrons', 'Aircrafts', 'Missions', 'Training'];
router.get('/briefs/related-pool', async (_req, res) => {
  try {
    const briefs = await IntelligenceBrief
      .find({ category: { $nin: TYPED_LINK_CATEGORIES } })
      .select('title category status')
      .sort({ category: 1, title: 1 })
      .lean();
    res.json({ status: 'success', data: { briefs } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/:id
router.get('/briefs/:id', async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs
router.post('/briefs', requireReason, async (req, res) => {
  try {
    const { reason, ...fields } = req.body;
    if (fields.category && !CATEGORIES.includes(fields.category)) {
      return res.status(400).json({ message: `Invalid category "${fields.category}". Must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (fields.subcategory && fields.category) {
      const validSubs = SUBCATEGORIES[fields.category] ?? [];
      if (validSubs.length > 0 && !validSubs.includes(fields.subcategory)) {
        return res.status(400).json({ message: `"${fields.subcategory}" is not a valid subcategory for ${fields.category}` });
      }
    }
    let existing = null;
    if (fields.title && fields.category) {
      existing = await IntelligenceBrief.findOne({
        title: { $regex: new RegExp(`^${fields.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        category: fields.category,
      });
      if (existing && existing.status === 'published') {
        return res.status(409).json({ message: `A brief titled "${fields.title}" already exists in ${fields.category}` });
      }
    }
    let brief;
    if (existing && existing.status === 'stub') {
      // Promote stub to published brief in place, preserving its _id so all
      // existing cross-references (associatedAircraftBriefIds etc.) stay valid.
      const mergeIds = (old, incoming = []) => {
        const seen = new Set(old.map(String));
        return [...old, ...incoming.filter(id => !seen.has(String(id)))];
      };
      const upgradedFields = {
        ...fields,
        status: 'published',
        associatedBaseBriefIds:     mergeIds(existing.associatedBaseBriefIds,     fields.associatedBaseBriefIds),
        associatedSquadronBriefIds: mergeIds(existing.associatedSquadronBriefIds, fields.associatedSquadronBriefIds),
        associatedAircraftBriefIds: mergeIds(existing.associatedAircraftBriefIds, fields.associatedAircraftBriefIds),
        associatedMissionBriefIds:  mergeIds(existing.associatedMissionBriefIds,  fields.associatedMissionBriefIds),
        associatedTrainingBriefIds: mergeIds(existing.associatedTrainingBriefIds, fields.associatedTrainingBriefIds),
        relatedBriefIds:            mergeIds(existing.relatedBriefIds,            fields.relatedBriefIds),
      };
      brief = await IntelligenceBrief.findByIdAndUpdate(
        existing._id,
        upgradedFields,
        { new: true, runValidators: true }
      ).populate('media');
    } else {
      brief = await IntelligenceBrief.create(fields);
    }
    await AdminAction.create({ userId: req.user._id, actionType: 'create_brief', reason });
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/briefs/:id
router.patch('/briefs/:id', requireReason, async (req, res) => {
  try {
    const { reason, ...fields } = req.body;
    const brief = await IntelligenceBrief.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true }).populate('media');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    await AdminAction.create({ userId: req.user._id, actionType: 'edit_brief', reason });
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id
router.delete('/briefs/:id', requireReason, async (req, res) => {
  try {
    const briefId = req.params.id;

    // Fetch brief before deletion to get title + category
    const brief = await IntelligenceBrief.findById(briefId).select('title category');

    // Collect question IDs before deleting so we can wipe their results
    const questionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: briefId });

    await Promise.all([
      IntelligenceBrief.findByIdAndDelete(briefId),
      IntelligenceBriefRead.deleteMany({ intelBriefId: briefId }),
      GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
      AircoinLog.deleteMany({ briefId }),
      // Where's That Aircraft cascade
      GameSessionWhereAircraftResult.deleteMany({ aircraftBriefId: briefId }),
      // Remove deleted brief from all relationship arrays across the collection
      IntelligenceBrief.updateMany({}, { $pull: {
        associatedBaseBriefIds:     new mongoose.Types.ObjectId(briefId),
        associatedSquadronBriefIds: new mongoose.Types.ObjectId(briefId),
        associatedAircraftBriefIds: new mongoose.Types.ObjectId(briefId),
        relatedBriefIds:            new mongoose.Types.ObjectId(briefId),
      } }),
    ]);

    await AdminAction.create({ userId: req.user._id, actionType: 'delete_brief', reason: req.body.reason });

    let leadResult = { matched: false, error: null };
    if (brief?.title) {
      // Only unmark the lead if no other brief with this title still exists
      const sibling = await IntelligenceBrief.findOne({ title: brief.title, _id: { $ne: briefId } });
      if (!sibling) leadResult = await unmarkLeadInDb(brief.title);
    }
    res.json({ status: 'success', leadUnmarked: leadResult.matched, leadError: leadResult.error });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/confirm-regeneration
// Cascade-deletes all user game data and awarded coins tied to this brief,
// then returns deletion counts. The admin has already confirmed a warning modal.
// Must be called before POSTing to /ai/regenerate-brief/:id.
router.post('/briefs/:id/confirm-regeneration', requireReason, async (req, res) => {
  try {
    const briefId = req.params.id;
    if (!await IntelligenceBrief.exists({ _id: briefId })) {
      return res.status(404).json({ message: 'Brief not found' });
    }

    // ── Step 1: collect IDs before any deletion ──────────────────────────
    const [questionIds, booGameIds, flashGameIds, waaGameIds] = await Promise.all([
      GameQuizQuestion.distinct('_id', { intelBriefId: briefId }),
      GameOrderOfBattle.distinct('_id', { anchorBriefId: briefId }),
      GameFlashcardRecall.distinct('_id', { 'cards.intelBriefId': briefId }),
      GameWhosAtAircraft.distinct('_id', { intelBriefId: briefId }),
    ]);

    // ── Step 2: reverse Aircoins per user ────────────────────────────────
    // Group all brief-attributed log entries by userId and sum amounts
    const coinGroups = await AircoinLog.aggregate([
      { $match: { briefId: new mongoose.Types.ObjectId(briefId) } },
      { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);
    await Promise.all(coinGroups.map(({ _id: userId, total }) =>
      User.findByIdAndUpdate(userId, [
        { $set: { totalAircoins: { $max: [0, { $subtract: ['$totalAircoins', total] }] } } },
        { $set: { cycleAircoins: { $max: [0, { $subtract: ['$cycleAircoins', total] }] } } },
      ])
    ));

    // ── Step 3: delete everything ────────────────────────────────────────
    const regenBrief = await IntelligenceBrief.findById(briefId).select('category').lean();

    const [
      briefReadResult,
      quizQResult,
      quizAttemptResult,
      quizResultResult,
      aircoinResult,
      booResultResult,
      booGameResult,
      flashResultResult,
      flashGameResult,
      waaResultResult,
      waaGameResult,
      whereAircraftResult,
    ] = await Promise.all([
      IntelligenceBriefRead.deleteMany({ intelBriefId: briefId }),
      GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
      AircoinLog.deleteMany({ briefId: new mongoose.Types.ObjectId(briefId) }),
      GameSessionOrderOfBattleResult.deleteMany({ gameId: { $in: booGameIds } }),
      GameOrderOfBattle.deleteMany({ anchorBriefId: briefId }),
      GameSessionFlashcardRecallResult.deleteMany({ gameId: { $in: flashGameIds } }),
      GameFlashcardRecall.deleteMany({ 'cards.intelBriefId': briefId }),
      GameSessionWhosAtAircraftResult.deleteMany({ gameId: { $in: waaGameIds } }),
      GameWhosAtAircraft.deleteMany({ intelBriefId: briefId }),
      GameSessionWhereAircraftResult.deleteMany({ aircraftBriefId: briefId }),
      IntelligenceBrief.findByIdAndUpdate(briefId, { $set: {
        quizQuestionsEasy:          [],
        quizQuestionsMedium:        [],
        associatedBaseBriefIds:     [],
        associatedSquadronBriefIds: [],
        associatedAircraftBriefIds: [],
        relatedBriefIds:            [],
      } }),
    ]);

    // Remove from all other briefs' relationship arrays
    await IntelligenceBrief.updateMany({}, { $pull: {
      associatedBaseBriefIds:     new mongoose.Types.ObjectId(briefId),
      associatedSquadronBriefIds: new mongoose.Types.ObjectId(briefId),
      associatedAircraftBriefIds: new mongoose.Types.ObjectId(briefId),
      relatedBriefIds:            new mongoose.Types.ObjectId(briefId),
    } });

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'regenerate_brief_cascade',
      reason:     req.body.reason,
    });

    res.json({
      status: 'success',
      data: {
        coinsReversed:          coinGroups.reduce((s, g) => s + g.total, 0),
        usersAffected:          coinGroups.length,
        briefReadsDeleted:      briefReadResult.deletedCount,
        quizQuestionsDeleted:   quizQResult.deletedCount,
        quizAttemptsDeleted:    quizAttemptResult.deletedCount,
        quizResultsDeleted:     quizResultResult.deletedCount,
        aircoinLogsDeleted:     aircoinResult.deletedCount,
        booResultsDeleted:      booResultResult.deletedCount,
        booGamesDeleted:        booGameResult.deletedCount,
        flashResultsDeleted:    flashResultResult.deletedCount,
        flashGamesDeleted:      flashGameResult.deletedCount,
        waaResultsDeleted:          waaResultResult.deletedCount,
        waaGamesDeleted:            waaGameResult.deletedCount,
        whereAircraftResultsDeleted: whereAircraftResult.deletedCount,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/questions — save quiz questions for a brief (no reason required)
router.post('/briefs/:id/questions', async (req, res) => {
  try {
    const { easyQuestions = [], mediumQuestions = [] } = req.body;
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const gameType = await GameType.findOne({ gameTitle: 'quiz' });
    if (!gameType) return res.status(500).json({ message: 'Quiz game type not seeded — restart the server' });

    // Delete existing questions for this brief
    await GameQuizQuestion.deleteMany({ intelBriefId: req.params.id });

    const createQuestions = async (questions, difficulty) => {
      const ids = [];
      for (const q of questions) {
        const answers = q.answers.map(a => ({
          _id: new mongoose.Types.ObjectId(),
          title: a.title,
        }));
        const doc = await GameQuizQuestion.create({
          gameTypeId:      gameType._id,
          intelBriefId:    req.params.id,
          difficulty,
          question:        q.question,
          answers,
          correctAnswerId: answers[q.correctAnswerIndex]?._id ?? answers[0]._id,
        });
        ids.push(doc._id);
      }
      return ids;
    };

    const [easyIds, mediumIds] = await Promise.all([
      createQuestions(easyQuestions, 'easy'),
      createQuestions(mediumQuestions, 'medium'),
    ]);

    brief.quizQuestionsEasy   = easyIds;
    brief.quizQuestionsMedium = mediumIds;
    await brief.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'change_quiz_questions', reason: 'Generation save' });

    const updatedBrief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    res.json({ status: 'success', data: { brief: updatedBrief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/media — add a media item to a brief
router.post('/briefs/:id/media', async (req, res) => {
  try {
    const { mediaType, mediaUrl, cloudinaryPublicId, showOnSummary } = req.body;
    if (!mediaUrl || !mediaType) return res.status(400).json({ message: 'mediaType and mediaUrl required' });
    const media = await Media.create({
      mediaType,
      mediaUrl: mediaUrl.trim(),
      ...(cloudinaryPublicId ? { cloudinaryPublicId } : {}),
      showOnSummary: showOnSummary !== false,
    });
    const brief = await IntelligenceBrief.findByIdAndUpdate(
      req.params.id,
      { $push: { media: media._id } },
      { new: true }
    ).populate('media');
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/media/:mediaId — update a media item's URL or type
router.patch('/media/:mediaId', async (req, res) => {
  try {
    const { mediaUrl, mediaType, showOnSummary } = req.body;
    const update = {};
    if (mediaUrl       !== undefined) update.mediaUrl       = mediaUrl.trim();
    if (mediaType      !== undefined) update.mediaType      = mediaType;
    if (showOnSummary  !== undefined) update.showOnSummary  = showOnSummary;
    const media = await Media.findByIdAndUpdate(req.params.mediaId, update, { new: true, runValidators: true });
    if (!media) return res.status(404).json({ message: 'Media not found' });
    res.json({ status: 'success', data: { media } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id/media/:mediaId — remove a media item
router.delete('/briefs/:id/media/:mediaId', async (req, res) => {
  try {
    await IntelligenceBrief.findByIdAndUpdate(req.params.id, { $pull: { media: req.params.mediaId } });
    const mediaDoc = await Media.findByIdAndDelete(req.params.mediaId);
    // Delete the asset from Cloudinary, or fall back to local file for legacy images
    if (mediaDoc?.cloudinaryPublicId) {
      await destroyAsset(mediaDoc.cloudinaryPublicId).catch(() => {});
    } else if (mediaDoc?.mediaUrl?.startsWith('/uploads/brief-images/')) {
      const filePath = path.join(__dirname, '..', mediaDoc.mediaUrl);
      fs.unlink(filePath, () => {});
    }
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/questions/bulk — replace all quiz questions for a brief
router.post('/briefs/:id/questions/bulk', requireReason, async (req, res) => {
  try {
    const { easyQuestions = [], mediumQuestions = [], reason } = req.body;
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const gameType = await GameType.findOne({ gameTitle: 'quiz' });
    if (!gameType) return res.status(500).json({ message: 'Quiz game type not seeded — restart the server' });

    // Wipe results tied to the old questions before replacing them
    const oldQuestionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: req.params.id });
    await Promise.all([
      GameQuizQuestion.deleteMany({ intelBriefId: req.params.id }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: oldQuestionIds } }),
    ]);

    const createQuestions = async (questions, difficulty) => {
      const ids = [];
      for (const q of questions) {
        const answers = q.answers.map(a => ({
          _id: new mongoose.Types.ObjectId(),
          title: a.title,
        }));
        const doc = await GameQuizQuestion.create({
          gameTypeId:      gameType._id,
          intelBriefId:    req.params.id,
          difficulty,
          question:        q.question,
          answers,
          correctAnswerId: answers[q.correctAnswerIndex]?._id ?? answers[0]._id,
        });
        ids.push(doc._id);
      }
      return ids;
    };

    const [easyIds, mediumIds] = await Promise.all([
      createQuestions(easyQuestions, 'easy'),
      createQuestions(mediumQuestions, 'medium'),
    ]);

    brief.quizQuestionsEasy   = easyIds;
    brief.quizQuestionsMedium = mediumIds;
    await brief.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'change_quiz_questions', reason });

    const updatedBrief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    res.json({ status: 'success', data: { brief: updatedBrief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id/questions — remove all quiz questions for a brief
router.delete('/briefs/:id/questions', requireReason, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const questionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: req.params.id });
    await Promise.all([
      GameQuizQuestion.deleteMany({ intelBriefId: req.params.id }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
    ]);
    brief.quizQuestionsEasy   = [];
    brief.quizQuestionsMedium = [];
    await brief.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'change_quiz_questions', reason: req.body.reason });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── OpenRouter AI Proxies ──────────────────────────────────────────────────
// All OpenRouter calls are made server-side so OPENROUTER_KEY never reaches the browser.

async function openRouterChat(messages, model, maxTokens = 2048) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title': 'SkyWatch',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function cleanJson(raw) {
  // Strip markdown fences and inline citation markers like [1]
  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/\[\d+\]/g, '').trim();
  // Extract the JSON object — Perplexity Sonar often appends source URLs after the closing brace
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

// ── BOO gameData helpers ────────────────────────────────────────────────────

const BOO_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'];

// Ranks are looked up deterministically — never generated by AI to avoid errors/duplicates
const RANK_HIERARCHY = {
  'Marshal of the Royal Air Force': 1,
  'Air Chief Marshal':              2,
  'Air Marshal':                    3,
  'Air Vice-Marshal':               4,
  'Air Commodore':                  5,
  'Group Captain':                  6,
  'Wing Commander':                 7,
  'Squadron Leader':                8,
  'Flight Lieutenant':              9,
  'Flying Officer':                 10,
  'Pilot Officer':                  11,
  'Warrant Officer':                12,
  'Master Aircrew':                 13,
  'Flight Sergeant':                14,
  'Chief Technician':               15,
  'Sergeant':                       16,
  'Corporal':                       17,
  'Junior Technician':              18,
  'Senior Aircraftman':             19,
  'Leading Aircraftman':            20,
  'Aircraftman':                    21,
};

// Fuzzy lookup: longest-key-first substring match (case-insensitive).
// Handles titles like "Sergeant (RAF)", "Warrant Officer (RAF)",
// "Senior Aircraftman / Senior Aircraftwoman", etc.
function lookupRankHierarchy(title) {
  const t = (title || '').toLowerCase();
  const entries = Object.entries(RANK_HIERARCHY).sort((a, b) => b[0].length - a[0].length);
  for (const [name, order] of entries) {
    if (t.includes(name.toLowerCase())) return order;
  }
  return null;
}

function hasStaleSource(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return sources.some(s => {
    if (!s.articleDate) return true;
    return new Date(s.articleDate).getTime() < cutoff;
  });
}

function booGameDataShape(category) {
  if (category === 'Aircrafts')
    return '"gameData": {"topSpeedKph": 2400, "yearIntroduced": 1976, "yearRetired": null}';
  // Ranks are NOT generated by AI — use lookupRankHierarchy() after generation instead
  if (category === 'Training')
    return '"gameData": {"trainingWeekStart": 3, "trainingWeekEnd": 5}';
  if (['Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'].includes(category))
    return '"gameData": {"startYear": 1976, "endYear": null}';
  return null;
}

// POST /api/admin/ai/news-headlines
router.post('/ai/news-headlines', async (req, res) => {
  try {
    const { timestamp } = req.body;
    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a factual news assistant. Only report real, verified news stories that have actually been published. Never invent or fabricate headlines.',
    }, {
      role: 'user',
      content: `The current date and time is ${timestamp}. Search the web right now for real UK Royal Air Force (RAF) news stories published in the last 24 hours only. Return ONLY a JSON array of up to 6 headline strings taken verbatim or closely paraphrased from actual published sources. No fabricated headlines, no citation markers like [1], no markdown, no code blocks, no extra text. If no real RAF stories exist from the last 24 hours, return an empty array []. Format: ["Headline one", "Headline two"]`,
    }], 'perplexity/sonar');
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    const headlines = JSON.parse(cleanJson(raw));
    res.json({ status: 'success', data: { headlines: Array.isArray(headlines) ? headlines : [] } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-brief
router.post('/ai/generate-brief', async (req, res) => {
  try {
    const { headline, topic, category } = req.body;
    if (!headline && !topic) return res.status(400).json({ message: 'headline or topic required' });

    const SHARED_SECTIONS = `"subtitle": "one factual sentence summarising the subject",\n  "descriptionSections": [\n    "Paragraph one — 50–80 words. Use plain, clear sentences. Introduce the subject clearly for someone building foundational knowledge of the modern RAF.",\n    "Paragraph two — 50–80 words. Cover a different angle: training phases, roles, or bases associated with this subject.",\n    "Paragraph three — 50–80 words (include if there is enough verified content). Operational context, key capabilities, or RAF significance.",\n    "Paragraph four — 50–80 words (only include if genuinely needed — omit if not). Additional important detail about this subject's significance within the modern RAF."\n  ]`;
    const SHARED_RULES = `\nCRITICAL RULES:\n1. descriptionSections must be a JSON array of 2–4 strings. Total word count across all sections must not exceed 240 words. Write each section as plain prose — no bullet points, no headers, no markdown.`;

    // News shape — AI must generate the title
    const JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "title": "concise factual title, max 70 characters",\n  ${SHARED_SECTIONS},\n  "sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}${SHARED_RULES}`;

    // Topic (lead) shape — title is provided externally, omit it from the response
    let TOPIC_JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  ${SHARED_SECTIONS},\n  "historic": <true if this subject is outdated/retired/no longer operationally relevant to the modern RAF — e.g. retired aircraft, concluded operations, obsolete systems, pre-2000 history with no current relevance; false if it has modern-day relevance, is currently in service, or ongoing>,\n  "sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}${SHARED_RULES}`;

    // For BOO-eligible topic briefs, inject a gameData field into the JSON shape
    const gdShape = (!headline && BOO_CATEGORIES.includes(category)) ? booGameDataShape(category) : null;
    if (gdShape) {
      TOPIC_JSON_SHAPE = TOPIC_JSON_SHAPE.replace(
        '\n}\nCRITICAL RULES:',
        `,\n  ${gdShape}\n}\nCRITICAL RULES:`
      );
    }

    const userContent = topic
      ? `Write a comprehensive intelligence brief about this RAF topic: "${topic}"\n\nUsing verified facts from published sources, produce a reference-style brief suitable for someone building foundational knowledge of the modern RAF — not a news story, but an in-depth informative overview. Where relevant, cover: training pathways and which training blocks/phases apply to this subject; RAF bases associated with this subject and which aircraft or squadrons are stationed there and what operations occur there; roles that interact with or are defined by this subject and how those roles relate to specific training pipelines; and the broader operational and modern-day RAF significance.\n\n${TOPIC_JSON_SHAPE}`
      : `Search the web for this specific RAF news story: "${headline}"\n\nUsing only verified facts from published sources, return a JSON object for an RAF news intelligence brief. Be as informative as possible about the current RAF affairs covered by this story.\n\n${JSON_SHAPE}`;

    const isNews = !!headline;
    const systemPrompt = isNews
      ? 'You are a factual intelligence writer for a Royal Air Force news platform. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.'
      : 'You are a factual intelligence writer for a Royal Air Force training platform. Prioritise content that builds genuine understanding of the modern RAF: in-depth training pathways and what each phase involves, RAF bases and which aircraft/squadrons are stationed there and what operations occur there, different roles and how they relate to specific training blocks, and the operational context of aircraft, equipment, and missions. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.';

    const data = await openRouterChat([{
      role: 'system',
      content: systemPrompt,
    }, {
      role: 'user',
      content: userContent,
    }], 'perplexity/sonar', 2048);
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let brief;
    try {
      brief = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[generate-brief] JSON parse failed. Raw response:', raw);
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }
    // Lock title to the lead topic — AI must not rename the subject
    if (topic) brief.title = topic;

    // For Ranks briefs, apply deterministic hierarchy lookup instead of relying on AI
    if (!headline && category === 'Ranks' && brief.title) {
      const rankOrder = lookupRankHierarchy(brief.title);
      if (rankOrder !== null) brief.gameData = { rankHierarchyOrder: rankOrder };
    }
    const staleSourceWarning = isNews && hasStaleSource(brief.sources);
    res.json({ status: 'success', data: { brief: { ...brief, staleSourceWarning } } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/intel-leads — return unpublished leads from DB
router.get('/intel-leads', async (req, res) => {
  try {
    const leads = await IntelLead.find({ isPublished: false })
      .select('title nickname subtitle category subcategory section subsection')
      .sort({ section: 1, subsection: 1, title: 1 })
      .lean();
    res.json({ status: 'success', data: { leads } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/intel-leads/mark-complete — mark a lead as published in DB
router.post('/intel-leads/mark-complete', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });
    const lead = title;

    const result = await IntelLead.updateOne(
      { title: lead.trim(), isPublished: false },
      { isPublished: true }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Lead not found or already marked' });
    }
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/leads/reset — wipe all leads + briefs, re-seed leads, create stub briefs
router.post('/leads/reset', requireReason, async (req, res) => {
  try {
    await seedLeads();

    const [leadCount, briefCount] = await Promise.all([
      IntelLead.countDocuments(),
      IntelligenceBrief.countDocuments({ status: 'stub' }),
    ]);

    await AdminAction.create({ userId: req.user._id, actionType: 'reset_leads', reason: req.body.reason });
    res.json({ status: 'success', data: { leadsInserted: leadCount, stubsCreated: briefCount } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-keywords
// Generates up to `needed` additional keywords sourced from the description.
// Existing keyword strings are passed in so the AI doesn't repeat them.
router.post('/ai/generate-keywords', async (req, res) => {
  try {
    const { description, existingKeywords = [], needed = 10 } = req.body;
    if (!description) return res.status(400).json({ message: 'description required' });
    if (needed <= 0)  return res.json({ status: 'success', data: { keywords: [] } });

    const existingList = existingKeywords.length
      ? `Already used (do NOT repeat these): ${existingKeywords.join(', ')}\n\n`
      : '';

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a keyword extractor for a Royal Air Force training platform. Prioritise terms that build understanding of the modern RAF — training pathways, bases, aircraft, roles, and operational context. You only select terms that appear verbatim in the provided description text. For each keyword you write a general RAF-specific definition of that term — what it is, its role and capabilities — without referencing the specific intel brief it was found in.',
    }, {
      role: 'user',
      content: `Description:\n"""${description}"""\n\n${existingList}Extract exactly ${needed} keywords from the description above. Every keyword string MUST appear verbatim (same spelling and capitalisation) in the description. Choose technical terms, acronyms, aircraft designations, operation names, and proper nouns.\n\nFor "generatedDescription": write a general RAF-specific definition of the term itself (e.g. what that aircraft/system/operation is, its role and capabilities). Do NOT reference or summarise the intel brief — the description should be useful as a standalone glossary entry.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"keywords":[{"keyword":"exact phrase from description","generatedDescription":"general RAF-specific definition of this term"},{"keyword":"...","generatedDescription":"..."}]}`,
    }], 'perplexity/sonar');

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    const desc = description.toLowerCase();
    const existing = new Set(existingKeywords.map(k => k.toLowerCase()));

    const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .filter(k => k.keyword && desc.includes(k.keyword.toLowerCase()) && !existing.has(k.keyword.toLowerCase()))
      .slice(0, needed);

    res.json({ status: 'success', data: { keywords } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-links
// Generic linked-brief suggester. sourceCategory + linkType determine the prompt.
// linkType: 'bases' | 'squadrons' | 'aircraft'
router.post('/ai/generate-links', async (req, res) => {
  try {
    const { sourceTitle, sourceDescription, sourceCategory, linkType, pool } = req.body;
    if (!sourceTitle) return res.status(400).json({ message: 'sourceTitle required' });
    if (!Array.isArray(pool) || pool.length === 0)
      return res.status(400).json({ message: 'pool required' });

    const prompts = {
      'Aircrafts:bases':     `You are an expert on Royal Air Force aircraft and bases. Given an aircraft brief, identify which RAF bases are home/primary operating bases for this aircraft. Only select bases where this aircraft type is permanently stationed.`,
      'Aircrafts:squadrons': `You are an expert on Royal Air Force aircraft and squadrons. Given an aircraft brief, identify which RAF squadrons operate this aircraft type as their primary platform.`,
      'Aircrafts:missions':  `You are an expert on Royal Air Force operations and aircraft. Given an aircraft brief, identify which RAF operations or missions this aircraft type participated in from the list provided.`,
      'Squadrons:bases':     `You are an expert on Royal Air Force squadrons and bases. Given a squadron brief, identify which RAF bases this squadron is or was primarily stationed at.`,
      'Squadrons:aircraft':  `You are an expert on Royal Air Force squadrons and aircraft. Given a squadron brief, identify which aircraft types from the list this squadron operates or historically operated.`,
      'Squadrons:missions':  `You are an expert on Royal Air Force squadrons and operations. Given a squadron brief, identify which operations or missions this squadron participated in from the list provided.`,
      'Bases:squadrons':     `You are an expert on Royal Air Force bases and squadrons. Given a base brief, identify which RAF squadrons are or were stationed at this base.`,
      'Bases:aircraft':      `You are an expert on Royal Air Force bases and aircraft. Given a base brief, identify which aircraft types from the list are or were based at this location.`,
      'Roles:training':      `You are an expert on Royal Air Force careers and training pipelines. Given a role brief, identify which training programmes from the list are required or directly relevant to this role's career pathway.`,
      'Tech:aircraft':       `You are an expert on Royal Air Force technology and aircraft. Given a technology or weapon system brief, identify which aircraft from the list carry or use this system.`,
    };

    const key = `${sourceCategory}:${linkType}`;
    const systemPrompt = prompts[key];
    if (!systemPrompt) return res.status(400).json({ message: `Unsupported combination: ${key}` });

    const poolList = pool.map(b => `- "${b.title}" (id: ${b._id})`).join('\n');
    const data = await openRouterChat([{
      role: 'system',
      content: systemPrompt + ' Return ONLY valid JSON — no markdown, no code blocks.',
    }, {
      role: 'user',
      content: `Brief: "${sourceTitle}"\n\nDescription:\n"""\n${sourceDescription ?? ''}\n"""\n\nAvailable ${linkType} briefs:\n${poolList}\n\nReturn the IDs of matching ${linkType}. If none match, return an empty array.\n\nReturn ONLY valid JSON: {"ids":["id1","id2"]}`,
    }], 'perplexity/sonar', 512);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    const validIds = new Set(pool.map(b => String(b._id)));
    const ids = (Array.isArray(parsed.ids) ? parsed.ids : [])
      .map(String)
      .filter(id => validIds.has(id));

    res.json({ status: 'success', data: { ids } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-bases
// Given an aircraft brief title + body and a list of available base briefs,
// asks the AI which bases are home bases for this aircraft.
router.post('/ai/generate-bases', async (req, res) => {
  try {
    const { title, body, basesBriefs } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });
    if (!Array.isArray(basesBriefs) || basesBriefs.length === 0)
      return res.status(400).json({ message: 'basesBriefs required' });

    const baseList = basesBriefs.map(b => `- "${b.title}" (id: ${b._id})`).join('\n');

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are an expert on Royal Air Force aircraft and their operating bases. Given an aircraft brief and a list of RAF base briefs, identify which bases are home bases for that aircraft. Only select bases where the aircraft is currently stationed or has a known permanent/primary operating presence. Return ONLY valid JSON — no markdown, no code blocks.',
    }, {
      role: 'user',
      content: `Aircraft: "${title}"\n\nBrief body:\n"""\n${body ?? ''}\n"""\n\nAvailable base briefs:\n${baseList}\n\nReturn the IDs of bases that are home bases for this aircraft. Only include bases where this aircraft type is stationed. If none match, return an empty array.\n\nReturn ONLY valid JSON: {"baseIds":["id1","id2"]}`,
    }], 'perplexity/sonar', 512);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    const validIds = new Set(basesBriefs.map(b => String(b._id)));
    const baseIds = (Array.isArray(parsed.baseIds) ? parsed.baseIds : [])
      .map(String)
      .filter(id => validIds.has(id));

    res.json({ status: 'success', data: { baseIds } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-quiz
router.post('/ai/generate-quiz', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title && !description) return res.status(400).json({ message: 'title or description required' });
    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a quiz question writer for a Royal Air Force training platform. Favour questions that test understanding of training pathways, base locations and their resident aircraft/squadrons, role requirements, and operational context. Every question you write must be directly and fully answerable using only the information contained in the provided intel brief description — do not rely on external knowledge, general RAF facts, or anything not stated in the description.',
    }, {
      role: 'user',
      content: `Intel Brief Title: ${title}\n\nIntel Brief Description:\n"""\n${description ?? ''}\n"""\n\nUsing ONLY the facts stated in the description above, generate exactly 10 easy and 10 medium quiz questions.\n\nCRITICAL RULES:\n1. Every question must be directly answerable from the description text — if the answer cannot be found in the description, do not include the question.\n2. Easy questions test direct recall of specific facts stated in the description (names, dates, locations, aircraft types, unit designations, etc.).\n3. Medium questions require understanding of context or relationships between facts stated in the description.\n4. The correct answer must be explicitly supported by the description.\n5. Wrong answers must be plausible but clearly incorrect based on the description.\n6. Exactly 10 answer options per question. correctAnswerIndex is the 0-based index of the correct answer.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"easyQuestions":[{"question":"...","answers":[{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."}],"correctAnswerIndex":0}],"mediumQuestions":[...]}`,
    }], 'perplexity/sonar', 4096);
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let generated;
    try {
      generated = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[generate-quiz] JSON parse failed. Raw response:', raw.slice(0, 500));
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }
    res.json({ status: 'success', data: { easyQuestions: generated.easyQuestions ?? [], mediumQuestions: generated.mediumQuestions ?? [] } });
  } catch (err) {
    console.error('[generate-quiz] error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/regenerate-brief/:id
// Regenerates description sections, keywords, and quiz questions for an existing brief.
router.post('/ai/regenerate-brief/:id', async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    // ── Step 1: regenerate description sections, keywords (+ gameData for BOO) ─
    let TOPIC_JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "descriptionSections": [\n    "Paragraph one — 50–80 words. Use plain, clear sentences. Introduce the subject clearly for someone building foundational knowledge of the modern RAF.",\n    "Paragraph two — 50–80 words. Cover a different angle: training phases, roles, or bases associated with this subject.",\n    "Paragraph three — 50–80 words (include if there is enough verified content). Operational context, key capabilities, or RAF significance.",\n    "Paragraph four — 50–80 words (only include if genuinely needed — omit if not). Additional important detail about this subject's significance within the modern RAF."\n  ],\n  "keywords": [\n    {"keyword": "exact word or phrase that appears verbatim somewhere in the descriptionSections above", "generatedDescription": "2-3 sentences. Explain what this term is and its RAF role or purpose. Where relevant include specific detail: for a base or station — its location, which aircraft types and squadrons are stationed there, and what operations occur there; for a squadron or unit — its primary role and responsibilities, aircraft operated, and home base; for an aircraft or system — its capabilities, current service status, and operating bases/squadrons; for a rank, role, or training concept — its place in the RAF structure and training pathway significance. Draw on broader RAF knowledge beyond this brief — do NOT reference or summarise this intel brief."},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"},\n    {"keyword": "another exact word or phrase from the sections", "generatedDescription": "2-3 sentences covering what it is, its RAF role, and specific contextual detail such as base location and stationed assets, squadron responsibilities, aircraft capabilities, or training pathway relevance — broader RAF knowledge only, not from this brief"}\n  ]\n}\nCRITICAL RULES:\n1. descriptionSections must be a JSON array of 2–4 strings. Total word count across all sections must not exceed 240 words. Write each section as plain prose — no bullet points, no headers, no markdown.\n2. Write all sections first, then extract keywords — every keyword string must appear verbatim (exact same spelling and capitalisation) somewhere across the sections.\n3. Return exactly 10 keyword objects.\n4. Prefer technical terms, acronyms, aircraft designations, operation names, and proper nouns.`;

    const gdShape = booGameDataShape(brief.category);
    if (gdShape) {
      TOPIC_JSON_SHAPE = TOPIC_JSON_SHAPE.replace(
        '\n}\nCRITICAL RULES:',
        `,\n  ${gdShape}\n}\nCRITICAL RULES:`
      );
    }

    const briefData = await openRouterChat([{
      role: 'system',
      content: 'You are a factual intelligence writer for a Royal Air Force training platform. Prioritise content that builds genuine understanding of the modern RAF: in-depth training pathways and what each phase involves, RAF bases and which aircraft/squadrons are stationed there and what operations occur there, different roles and how they relate to specific training blocks, and the operational context of aircraft, equipment, and missions. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
    }, {
      role: 'user',
      content: `Rewrite a comprehensive intelligence brief about this RAF topic: "${brief.title}"\n\nUsing verified facts from published sources, produce a reference-style brief suitable for someone building foundational knowledge of the modern RAF. Where relevant, cover: training pathways and which training blocks/phases apply to this subject; RAF bases associated with this subject and which aircraft or squadrons are stationed there and what operations occur there; roles that interact with or are defined by this subject and how those roles relate to specific training pipelines; and the broader operational and modern-day RAF significance.\n\n${TOPIC_JSON_SHAPE}`,
    }], 'perplexity/sonar', 4096);

    const briefRaw = briefData.choices?.[0]?.message?.content ?? '{}';
    let briefGenerated;
    try {
      briefGenerated = JSON.parse(cleanJson(briefRaw));
    } catch (parseErr) {
      console.error('[regenerate-brief] brief JSON parse failed. Raw:', briefRaw);
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }

    // Safety net: discard keywords that don't appear verbatim in the sections
    const descriptionSections = Array.isArray(briefGenerated.descriptionSections) ? briefGenerated.descriptionSections : [];
    let keywords = Array.isArray(briefGenerated.keywords) ? briefGenerated.keywords : [];
    if (descriptionSections.length) {
      const descText = descriptionSections.join(' ').toLowerCase();
      keywords = keywords.filter(k => k.keyword && descText.includes(k.keyword.toLowerCase()));
    }
    let gameData = (gdShape && briefGenerated.gameData && typeof briefGenerated.gameData === 'object')
      ? briefGenerated.gameData
      : null;

    // For Ranks briefs, always override with deterministic hierarchy lookup
    if (brief.category === 'Ranks') {
      const rankOrder = lookupRankHierarchy(brief.title);
      if (rankOrder !== null) gameData = { rankHierarchyOrder: rankOrder };
    }

    // ── Step 2: regenerate quiz questions from the fresh description ────────
    const freshDescription = descriptionSections.join('\n\n');

    const quizData = await openRouterChat([{
      role: 'system',
      content: 'You are a quiz question writer for a Royal Air Force training platform. Favour questions that test understanding of training pathways, base locations and their resident aircraft/squadrons, role requirements, and operational context. Every question you write must be directly and fully answerable using only the information contained in the provided intel brief description — do not rely on external knowledge, general RAF facts, or anything not stated in the description.',
    }, {
      role: 'user',
      content: `Intel Brief Title: ${brief.title}\n\nIntel Brief Description:\n"""\n${freshDescription}\n"""\n\nUsing ONLY the facts stated in the description above, generate exactly 10 easy and 10 medium quiz questions.\n\nCRITICAL RULES:\n1. Every question must be directly answerable from the description text — if the answer cannot be found in the description, do not include the question.\n2. Easy questions test direct recall of specific facts stated in the description (names, dates, locations, aircraft types, unit designations, etc.).\n3. Medium questions require understanding of context or relationships between facts stated in the description.\n4. The correct answer must be explicitly supported by the description.\n5. Wrong answers must be plausible but clearly incorrect based on the description.\n6. Exactly 10 answer options per question. correctAnswerIndex is the 0-based index of the correct answer.\n7. Wrong answers must be complete sentences or meaningful phrases (minimum 5 words each) — never single words, never just a number or acronym alone.\n8. The correct answer must also be a complete sentence or meaningful phrase drawn directly from the description — never a single word or bare number.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"easyQuestions":[{"question":"...","answers":[{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."}],"correctAnswerIndex":0}],"mediumQuestions":[...]}`,
    }], 'perplexity/sonar');

    const quizRaw = quizData.choices?.[0]?.message?.content ?? '{}';
    let quizGenerated;
    try {
      quizGenerated = JSON.parse(cleanJson(quizRaw));
    } catch (parseErr) {
      console.error('[regenerate-brief] quiz JSON parse failed. Raw:', quizRaw.slice(0, 500));
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }

    res.json({
      status: 'success',
      data: {
        descriptionSections,
        keywords,
        easyQuestions:   quizGenerated.easyQuestions   ?? [],
        mediumQuestions: quizGenerated.mediumQuestions ?? [],
        ...(gameData ? { gameData } : {}),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/regenerate-description/:id
// Regenerates ONLY the description sections for an existing brief (no keywords, no questions).
// Does not cascade-delete any user data — purely a generation endpoint.
router.post('/ai/regenerate-description/:id', async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id).select('title');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const DESC_JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text:\n{\n  "descriptionSections": [\n    "Paragraph one — 50–80 words. Use plain, clear sentences. Introduce the subject clearly for someone building foundational knowledge of the modern RAF.",\n    "Paragraph two — 50–80 words. Cover a different angle: training phases, roles, or bases associated with this subject.",\n    "Paragraph three — 50–80 words (include if there is enough verified content). Operational context, key capabilities, or RAF significance.",\n    "Paragraph four — 50–80 words (only include if genuinely needed — omit if not). Additional important detail about this subject's significance within the modern RAF."\n  ]\n}\nCRITICAL RULES:\n1. descriptionSections must be a JSON array of 2–4 strings.\n2. Total word count across all sections must not exceed 240 words.\n3. Write each section as plain prose — no bullet points, no headers, no markdown.`;

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a factual intelligence writer for a Royal Air Force training platform. Prioritise content that builds genuine understanding of the modern RAF: in-depth training pathways and what each phase involves, RAF bases and which aircraft/squadrons are stationed there and what operations occur there, different roles and how they relate to specific training blocks, and the operational context of aircraft, equipment, and missions. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
    }, {
      role: 'user',
      content: `Write fresh description sections for this RAF intel brief: "${brief.title}"\n\nUsing verified facts from published sources, produce clear, informative paragraphs suitable for someone building foundational knowledge of the modern RAF.\n\n${DESC_JSON_SHAPE}`,
    }], 'perplexity/sonar', 4096);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let generated;
    try {
      generated = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[regenerate-description] JSON parse failed. Raw:', raw);
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }

    const descriptionSections = Array.isArray(generated.descriptionSections) ? generated.descriptionSections : [];
    res.json({ status: 'success', data: { descriptionSections } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/media/brief-image — remove a pending brief image (Cloudinary or legacy local)
router.delete('/media/brief-image', async (req, res) => {
  try {
    const { publicId, url } = req.body;
    if (publicId) {
      await destroyAsset(publicId).catch(() => {});
      return res.json({ status: 'success' });
    }
    // Legacy: local file path
    if (!url || !url.startsWith('/uploads/brief-images/')) {
      return res.status(400).json({ message: 'publicId or valid local url required' });
    }
    const filePath = path.join(__dirname, '..', url);
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') return res.status(500).json({ message: err.message });
      res.json({ status: 'success' });
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-battle-order-data
// Accepts { title, description, category } and returns the relevant gameData fields for that category.
const BOO_ELIGIBLE = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'];
router.post('/ai/generate-battle-order-data', async (req, res) => {
  try {
    const { title, description, category } = req.body;
    if (!title && !description) return res.status(400).json({ message: 'title or description required' });
    if (!BOO_ELIGIBLE.includes(category)) {
      return res.status(400).json({ message: `Category "${category}" is not eligible for Battle of Order data` });
    }

    let fieldSpec = '';
    let jsonShape = '';
    if (category === 'Aircrafts') {
      fieldSpec = 'topSpeedKph (integer, cruise/max speed in km/h), yearIntroduced (integer, year RAF first operated this aircraft), yearRetired (integer or null if still in service)';
      jsonShape = '{"topSpeedKph":2400,"yearIntroduced":1976,"yearRetired":null}';
    } else if (category === 'Ranks') {
      fieldSpec = 'rankHierarchyOrder (integer, 1 = most senior e.g. Marshal of the RAF, higher numbers = more junior)';
      jsonShape = '{"rankHierarchyOrder":5}';
    } else if (category === 'Training') {
      fieldSpec = 'trainingWeekStart (integer, the week number in the training pipeline when this phase/element begins), trainingWeekEnd (integer, the week number when this phase/element ends)';
      jsonShape = '{"trainingWeekStart":3,"trainingWeekEnd":5}';
    } else if (category === 'Bases') {
      fieldSpec = 'startYear (integer, year this RAF base was established/opened), endYear (integer or null if still active)';
      jsonShape = '{"startYear":1936,"endYear":null}';
    } else if (category === 'Squadrons') {
      fieldSpec = 'startYear (integer, year this squadron was formed/reformed), endYear (integer or null if still active)';
      jsonShape = '{"startYear":1915,"endYear":null}';
    } else if (category === 'Threats') {
      fieldSpec = 'startYear (integer, year this weapon/threat system entered service), endYear (integer or null if still in service)';
      jsonShape = '{"startYear":2007,"endYear":null}';
    } else {
      // Missions, Tech, Treaties
      fieldSpec = 'startYear (integer, year this began/was introduced/enacted), endYear (integer or null if still ongoing/in service)';
      jsonShape = '{"startYear":1939,"endYear":1945}';
    }

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a factual data extractor for a Royal Air Force training platform. You only return verified numeric data based on published facts. Return ONLY valid JSON with no markdown, no code blocks, no extra text.',
    }, {
      role: 'user',
      content: `Extract the following data fields for this RAF "${category}" intel brief:\n\nFields needed: ${fieldSpec}\n\nTitle: "${title}"\nDescription:\n"""\n${description ?? ''}\n"""\n\nReturn ONLY valid JSON — no markdown, no code blocks. Use null for unknown/inapplicable values.\nExample shape: ${jsonShape}`,
    }], 'perplexity/sonar');

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    res.json({ status: 'success', data: { gameData: parsed } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-rank-data/:id
// For Ranks category briefs: looks up rankHierarchyOrder deterministically from the title.
// No AI call — uses the canonical RANK_HIERARCHY table to guarantee uniqueness and accuracy.
router.post('/ai/generate-rank-data/:id', async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id).select('title category');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.category !== 'Ranks')
      return res.status(400).json({ message: 'Brief is not a Ranks category' });

    const rankHierarchyOrder = lookupRankHierarchy(brief.title);
    if (rankHierarchyOrder === null)
      return res.status(422).json({ message: `Could not determine rank order from title: "${brief.title}"` });

    res.json({ status: 'success', data: { rankHierarchyOrder } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-image
// 1. Ask OpenRouter for the 3 most visually distinct subjects from the title/subtitle
// 2. Fetch Wikipedia thumbnail for each in parallel
// 3. Download and save all found images, return array
router.post('/ai/generate-image', async (req, res) => {
  try {
    const { title, subtitle } = req.body;
    if (!title) return res.status(400).json({ message: 'title is required' });

    // Step 1 — extract 3 distinct search terms
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
        'X-Title': 'SkyWatch',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Extract the 3 most visually distinct subjects from this RAF article that are each likely to have their own Wikipedia page with a photograph. Prioritise specific aircraft designations, named bases/locations, named operations, or specific units.\n\nReturn ONLY a JSON array of exactly 3 search terms, e.g. ["Eurofighter Typhoon", "RAF Lossiemouth", "Operation Shader"]\n\nTitle: "${title}"${subtitle ? `\nSubtitle: "${subtitle}"` : ''}`,
        }],
      }),
    });
    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message ?? JSON.stringify(aiData.error));
    const raw = aiData.choices?.[0]?.message?.content?.trim() ?? '[]';
    let terms = [];
    try { terms = JSON.parse(raw.replace(/```json\n?|```/g, '').trim()); } catch { terms = [title]; }
    if (!Array.isArray(terms) || terms.length === 0) terms = [title];
    terms = terms.slice(0, 3);

    // Step 2 — fetch Wikipedia image for each term in parallel
    const fetchOneImage = async (term, idx) => {
      const searchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&srlimit=1&origin=*`
      );
      const searchData = await searchRes.json();
      const pageTitle  = searchData.query?.search?.[0]?.title;
      if (!pageTitle) throw new Error(`No Wikipedia page for "${term}"`);

      const thumbRes  = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`
      );
      const thumbData = await thumbRes.json();
      const imageUrl  = Object.values(thumbData.query?.pages ?? {})[0]?.thumbnail?.source;
      if (!imageUrl) throw new Error(`No image on Wikipedia for "${pageTitle}"`);

      const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'SkyWatch/1.0 (educational-platform)' } });
      if (!imgRes.ok) throw new Error(`Download failed (${imgRes.status})`);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const result = await uploadBuffer(buffer, { public_id: `brief-${Date.now()}-${idx}` });

      return { url: result.secure_url, publicId: result.public_id, term, wikiPage: pageTitle };
    };

    const results = await Promise.allSettled(terms.map((term, i) => fetchOneImage(term, i)));
    const images  = results.filter(r => r.status === 'fulfilled').map(r => r.value);

    if (images.length === 0) throw new Error('Could not find Wikipedia images for any of the extracted subjects');

    res.json({ status: 'success', data: { images } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/economy-viability — Aircoins Ceiling check
// Calculates max aircoins achievable with perfect play across all published briefs,
// for both Normal (easy) and Advanced (medium) difficulty scenarios.
const BOO_CATS = new Set(['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']);

router.get('/economy-viability', async (req, res) => {
  try {
    const [settings, briefs, ranks, levels] = await Promise.all([
      AppSettings.getSettings(),
      IntelligenceBrief.find({})
        .select('category gameData quizQuestionsEasy quizQuestionsMedium')
        .lean(),
      Rank.find().sort({ rankNumber: 1 }).lean(),
      Level.find().sort({ levelNumber: 1 }).lean(),
    ]);

    // Aggregate content counts
    let totalEasyQ = 0, briefsWithEasyQ = 0;
    let totalMediumQ = 0, briefsWithMediumQ = 0;
    let booEligibleBriefs = 0;
    for (const b of briefs) {
      const eq = b.quizQuestionsEasy?.length  ?? 0;
      const mq = b.quizQuestionsMedium?.length ?? 0;
      if (eq > 0) { totalEasyQ   += eq; briefsWithEasyQ++;   }
      if (mq > 0) { totalMediumQ += mq; briefsWithMediumQ++; }
      if (BOO_CATS.has(b.category) && b.gameData && Object.values(b.gameData).some(v => v != null)) {
        booEligibleBriefs++;
      }
    }

    const totalBriefs = briefs.length;
    const wtaPerBrief = (settings.aircoinsWhereAircraftRound1 ?? 5)
                      + (settings.aircoinsWhereAircraftRound2 ?? 10)
                      + (settings.aircoinsWhereAircraftBonus  ?? 5);

    function scenarioCoins(difficulty) {
      const isNormal = difficulty === 'normal';
      const reads = totalBriefs * (settings.aircoinsPerBriefRead ?? 5);
      const quiz  = isNormal
        ? totalEasyQ   * (settings.aircoinsPerWinEasy    ?? 10) + briefsWithEasyQ   * (settings.aircoins100Percent ?? 15)
        : totalMediumQ * (settings.aircoinsPerWinMedium  ?? 20) + briefsWithMediumQ * (settings.aircoins100Percent ?? 15);
      const boo = booEligibleBriefs * (isNormal
        ? (settings.aircoinsOrderOfBattleEasy   ?? 8)
        : (settings.aircoinsOrderOfBattleMedium ?? 18));
      const wta = totalBriefs * wtaPerBrief;
      return { reads, quiz, boo, wta, total: reads + quiz + boo + wta };
    }

    function calcProgression(totalCoins) {
      const rankCount       = ranks.length;
      const fullCycles      = rankCount > 0 ? Math.floor(totalCoins / CYCLE_THRESHOLD) : 0;
      const completedCycles = Math.min(fullCycles, rankCount);
      const atMaxRank       = rankCount > 0 && completedCycles >= rankCount;
      const cycleCoins      = atMaxRank
        ? totalCoins - rankCount * CYCLE_THRESHOLD
        : totalCoins % CYCLE_THRESHOLD;

      // Determine level from cycleCoins
      let finalLevel = 1;
      let cumulative = 0;
      for (const lv of levels) {
        if (lv.aircoinsToNextLevel === null) { finalLevel = lv.levelNumber; break; }
        cumulative += lv.aircoinsToNextLevel;
        if (cycleCoins < cumulative) { finalLevel = lv.levelNumber; break; }
        finalLevel = lv.levelNumber + 1;
      }

      const finalRank     = completedCycles > 0 ? ranks[completedCycles - 1] : null;
      const coinsToMaxOut = rankCount * CYCLE_THRESHOLD;
      const shortfall     = Math.max(0, coinsToMaxOut - totalCoins);
      return { completedCycles, atMaxRank, cycleCoins, finalLevel, finalRank, coinsToMaxOut, shortfall };
    }

    const normalCoins   = scenarioCoins('normal');
    const advancedCoins = scenarioCoins('advanced');

    res.json({
      status: 'success',
      data: {
        content: { totalBriefs, wtaBriefs: totalBriefs, booEligibleBriefs, totalEasyQ, briefsWithEasyQ, totalMediumQ, briefsWithMediumQ, wtaPerBrief },
        rates: {
          aircoinsPerBriefRead:        settings.aircoinsPerBriefRead        ?? 5,
          aircoinsPerWinEasy:          settings.aircoinsPerWinEasy          ?? 10,
          aircoinsPerWinMedium:        settings.aircoinsPerWinMedium        ?? 20,
          aircoins100Percent:          settings.aircoins100Percent          ?? 15,
          aircoinsOrderOfBattleEasy:   settings.aircoinsOrderOfBattleEasy   ?? 8,
          aircoinsOrderOfBattleMedium: settings.aircoinsOrderOfBattleMedium ?? 18,
          aircoinsWhereAircraftRound1: settings.aircoinsWhereAircraftRound1 ?? 5,
          aircoinsWhereAircraftRound2: settings.aircoinsWhereAircraftRound2 ?? 10,
          aircoinsWhereAircraftBonus:  settings.aircoinsWhereAircraftBonus  ?? 5,
        },
        cycleThreshold: CYCLE_THRESHOLD,
        totalRanks:     ranks.length,
        ranks:  ranks.map(r => ({ rankNumber: r.rankNumber, rankName: r.rankName })),
        levels: levels.map(l => ({ levelNumber: l.levelNumber, aircoinsToNextLevel: l.aircoinsToNextLevel })),
        normal:   { ...normalCoins,   ...calcProgression(normalCoins.total)   },
        advanced: { ...advancedCoins, ...calcProgression(advancedCoins.total) },
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/save-generated-image — receive base64 image from browser and upload to Cloudinary
router.post('/save-generated-image', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ message: 'imageBase64 required' });

    const buffer = Buffer.from(imageBase64, 'base64');
    const result = await uploadBuffer(buffer, { public_id: `brief-${Date.now()}`, format: 'png' });

    res.json({ status: 'success', data: { url: result.secure_url, publicId: result.public_id } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
