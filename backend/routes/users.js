const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { effectiveTier } = require('../utils/subscription');
const GameSessionQuizResult              = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt             = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult     = require('../models/GameSessionOrderOfBattleResult');
const GameSessionWhereAircraftResult     = require('../models/GameSessionWhereAircraftResult');
const GameSessionFlashcardRecallResult   = require('../models/GameSessionFlashcardRecallResult');
const IntelligenceBriefRead  = require('../models/IntelligenceBriefRead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const ProblemReport = require('../models/ProblemReport');
const UserNotification = require('../models/UserNotification');
const AppSettings = require('../models/AppSettings');
const Level = require('../models/Level');
const Rank = require('../models/Rank');
const AirstarLog = require('../models/AirstarLog');
const AptitudeSyncUsage = require('../models/AptitudeSyncUsage');

// GET /api/users/stats — current user's stats for profile page
router.get('/stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('rank');

    const validBriefIds = await IntelligenceBrief.distinct('_id');
    const brifsRead = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id,
      intelBriefId: { $in: validBriefIds },
      completed: true,
    });

    const completedQuizAttempts = await GameSessionQuizAttempt.countDocuments({ userId: req.user._id, status: 'completed' });
    const abandonedQuizAttempts = await GameSessionQuizAttempt.countDocuments({ userId: req.user._id, status: 'abandoned' });

    // Quiz avg: count every individually answered question (includes abandoned partial attempts)
    const quizResults  = await GameSessionQuizResult.find({ userId: req.user._id }).lean();
    const quizAnswered = quizResults.length;
    const quizCorrect  = quizResults.filter(r => r.isCorrect).length;

    // BOO avg: each non-abandoned game counts as 100 (win) or 0 (loss)
    const booResults   = await GameSessionOrderOfBattleResult.find({ userId: req.user._id, abandoned: false }).lean();
    const booPlayed    = booResults.length;
    const booWins      = booResults.filter(r => r.won).length;
    const booAbandoned = await GameSessionOrderOfBattleResult.countDocuments({ userId: req.user._id, abandoned: true });

    // Where's That Aircraft: completed (non-abandoned) games only
    const wtaResults   = await GameSessionWhereAircraftResult.find({ userId: req.user._id, status: 'completed' }).lean();
    const wtaPlayed    = wtaResults.length;
    const wtaWins      = wtaResults.filter(r => r.won).length;
    const wtaAbandoned = await GameSessionWhereAircraftResult.countDocuments({ userId: req.user._id, status: 'abandoned' });

    // Flashcard Recall: each card is a data point (recalled = correct)
    const flashSessions  = await GameSessionFlashcardRecallResult.find({ userId: req.user._id, abandoned: { $ne: true } }).lean();
    const flashAbandoned = await GameSessionFlashcardRecallResult.countDocuments({ userId: req.user._id, abandoned: true });
    const flashPlayed    = flashSessions.length;
    const flashTotal     = flashSessions.reduce((s, r) => s + (r.cardResults?.length ?? 0), 0);
    const flashRecalled  = flashSessions.reduce((s, r) => s + (r.cardResults?.filter(c => c.recalled).length ?? 0), 0);

    const aptitudeSyncTotal     = await AptitudeSyncUsage.countDocuments({ userId: req.user._id });
    const aptitudeSyncPlayed    = await AptitudeSyncUsage.countDocuments({ userId: req.user._id, completedAt: { $ne: null } });
    const aptitudeSyncAbandoned = aptitudeSyncTotal - aptitudeSyncPlayed;

    const gamesPlayed    = completedQuizAttempts + booPlayed + wtaPlayed + flashPlayed + aptitudeSyncPlayed;
    const abandonedGames = abandonedQuizAttempts + booAbandoned + wtaAbandoned + flashAbandoned + aptitudeSyncAbandoned;
    const totalDataPoints = quizAnswered + booPlayed + wtaPlayed + flashTotal;
    const winPercent = totalDataPoints > 0 ? Math.round((quizCorrect + booWins + wtaWins + flashRecalled) / totalDataPoints * 100) : 0;

    const flashcardsCollected = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id,
      reachedFlashcard: true,
    });

    res.json({
      status: 'success',
      data: {
        agentNumber:      user.agentNumber,
        subscriptionTier: user.subscriptionTier,
        difficultySetting: user.difficultySetting,
        rank:             user.rank,
        brifsRead,
        gamesPlayed,
        abandonedGames,
        winPercent,
        totalAirstars:    user.totalAirstars,
        flashcardsCollected,
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
    if (difficulty === 'medium') {
      const tier = effectiveTier(req.user);
      if (!['silver', 'gold', 'trial'].includes(tier)) {
        return res.status(403).json({ message: 'Advanced difficulty requires a Silver subscription or higher.' });
      }
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { difficultySetting: difficulty },
      { returnDocument: 'after' }
    ).populate('rank');
    res.json({ status: 'success', data: { user } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/leaderboard — top 20 agents by total airstars (public)
router.get('/leaderboard', async (req, res) => {
  try {
    const agents = await User.find({})
      .select('agentNumber totalAirstars')
      .sort({ totalAirstars: -1 })
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
    res.json({ status: 'success', data: {
      useLiveLeaderboard: settings.useLiveLeaderboard,
      combatReadinessTitle:          settings.combatReadinessTitle          || '',
      combatReadinessSubtitle:       settings.combatReadinessSubtitle       || '',
      combatReadinessEasyLabel:      settings.combatReadinessEasyLabel      || '',
      combatReadinessEasyTag:        settings.combatReadinessEasyTag        || '',
      combatReadinessEasyFlavor:     settings.combatReadinessEasyFlavor     || '',
      combatReadinessEasyStars:      settings.combatReadinessEasyStars      || '',
      combatReadinessMediumLabel:    settings.combatReadinessMediumLabel    || '',
      combatReadinessMediumTag:      settings.combatReadinessMediumTag      || '',
      combatReadinessMediumFlavor:   settings.combatReadinessMediumFlavor   || '',
      combatReadinessMediumStars:    settings.combatReadinessMediumStars    || '',
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/levels — all levels with computed cumulativeAirstars (public)
router.get('/levels', async (req, res) => {
  try {
    const levels = await Level.find({}).sort({ levelNumber: 1 });
    let cumulative = 0;
    const withCumulative = levels.map(l => {
      const item = {
        levelNumber: l.levelNumber,
        airstarsToNextLevel: l.airstarsToNextLevel,
        cumulativeAirstars: cumulative,
      };
      if (l.airstarsToNextLevel) cumulative += l.airstarsToNextLevel;
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

// GET /api/users/airstars/history — paginated airstar award history for current user
router.get('/airstars/history', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      AirstarLog.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AirstarLog.countDocuments({ userId: req.user._id }),
    ]);

    res.json({ status: 'success', data: { logs, total, page: Number(page), limit: Number(limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/users/me/tutorials — update a single tutorial status
// ⚠ Keep in sync with the tutorials sub-schema in backend/models/User.js
const VALID_TUTORIAL_IDS = [
  'welcome', 'intel_brief', 'user', 'load_up',
  'home', 'learn', 'briefReader', 'quiz', 'play', 'profile', 'rankings', 'wheres_aircraft',
  'learn_priority', 'pathway_swipe', 'stat_mnemonic',
];
const TUTORIAL_PRIORITY  = { unseen: 0, skipped: 1, viewed: 2 };

router.patch('/me/tutorials', protect, async (req, res) => {
  try {
    const { tutorialId, status } = req.body;
    // Normalise hyphenated keys (e.g. 'learn-priority') to underscore to match schema fields
    const dbId = (tutorialId || '').replace(/-/g, '_');
    if (!VALID_TUTORIAL_IDS.includes(dbId))
      return res.status(400).json({ message: 'Invalid tutorialId' });
    if (!['unseen','skipped','viewed'].includes(status))
      return res.status(400).json({ message: 'Invalid status' });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { [`tutorials.${dbId}`]: status },
      { returnDocument: 'after' }
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

const VALID_UNLOCK_KEYS = ['quiz', 'flashcard', 'boo', 'wta'];

// POST /api/users/me/game-unlocks/:key/unlock — idempotent, marks a game as unlocked
router.post('/me/game-unlocks/:key/unlock', protect, async (req, res) => {
  try {
    const { key } = req.params;
    if (!VALID_UNLOCK_KEYS.includes(key)) return res.status(400).json({ message: 'Invalid key' });
    const user = await User.findById(req.user._id).select('gameUnlocks');
    if (user?.gameUnlocks?.[key]?.unlockedAt) return res.json({ status: 'success', wasNew: false });
    const unlockedAt = new Date();
    await User.findByIdAndUpdate(req.user._id, { [`gameUnlocks.${key}.unlockedAt`]: unlockedAt });
    res.json({ status: 'success', wasNew: true, unlockedAt });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/users/me/game-unlocks/:key/seen — marks the new-game badge as seen
router.patch('/me/game-unlocks/:key/seen', protect, async (req, res) => {
  try {
    const { key } = req.params;
    if (!VALID_UNLOCK_KEYS.includes(key)) return res.status(400).json({ message: 'Invalid key' });
    await User.findByIdAndUpdate(req.user._id, { [`gameUnlocks.${key}.badgeSeen`]: true });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/users/me/game-unlocks/:key/unlock — revokes a game unlock (e.g. after history reset)
router.delete('/me/game-unlocks/:key/unlock', protect, async (req, res) => {
  try {
    const { key } = req.params;
    if (!VALID_UNLOCK_KEYS.includes(key)) return res.status(400).json({ message: 'Invalid key' });
    await User.findByIdAndUpdate(req.user._id, {
      $unset: { [`gameUnlocks.${key}.unlockedAt`]: '', [`gameUnlocks.${key}.badgeSeen`]: '' },
    });
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

// GET /api/users/me/wta-spawn — current WTA spawn counter + prerequisite status for the logged-in user
router.get('/me/wta-spawn', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const [user, basesIds, aircraftIds] = await Promise.all([
      User.findById(userId).select('whereAircraftReadsSinceLastGame whereAircraftSpawnThreshold'),
      IntelligenceBrief.distinct('_id', { category: 'Bases' }),
      IntelligenceBrief.distinct('_id', { category: 'Aircrafts' }),
    ]);
    const [basesRead, aircraftsRead] = await Promise.all([
      IntelligenceBriefRead.countDocuments({ userId, completed: true, intelBriefId: { $in: basesIds } }),
      IntelligenceBriefRead.countDocuments({ userId, completed: true, intelBriefId: { $in: aircraftIds } }),
    ]);
    const readsSince = user.whereAircraftReadsSinceLastGame ?? 0;
    const threshold  = user.whereAircraftSpawnThreshold     ?? 3;
    const prereqsMet = basesRead >= 2 && aircraftsRead >= 2;
    res.json({ status: 'success', data: { readsSince, threshold, remaining: Math.max(0, threshold - readsSince), prereqsMet, basesRead, aircraftsRead } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/me/notifications — unread in-app notifications for the current user
router.get('/me/notifications', protect, async (req, res) => {
  try {
    const notifications = await UserNotification.find({ userId: req.user._id, read: false })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ status: 'success', data: { notifications } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users/me/notifications/:id/read — mark a notification as read
router.post('/me/notifications/:id/read', protect, async (req, res) => {
  try {
    await UserNotification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true }
    );
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/users/me/read-briefs — list of brief IDs the current user has completed or started
router.get('/me/read-briefs', protect, async (req, res) => {
  try {
    const [completedRecords, startedRecords] = await Promise.all([
      IntelligenceBriefRead.find({ userId: req.user._id, completed: true  }).select('intelBriefId'),
      IntelligenceBriefRead.find({ userId: req.user._id, completed: false }).select('intelBriefId'),
    ]);
    const briefIds   = completedRecords.map(r => r.intelBriefId.toString());
    const startedIds = startedRecords.map(r => r.intelBriefId.toString());
    res.json({ status: 'success', data: { briefIds, startedIds } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
