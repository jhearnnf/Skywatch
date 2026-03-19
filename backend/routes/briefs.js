const router = require('express').Router();
const { protect, optionalAuth } = require('../middleware/auth');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const AppSettings = require('../models/AppSettings');
const User = require('../models/User');
const AircoinLog = require('../models/AircoinLog');
const { awardCoins } = require('../utils/awardCoins');
const { effectiveTier, getAccessibleCategories } = require('../utils/subscription');
// Required to register the schema so populate('quizQuestionsEasy/Medium') works
require('../models/GameQuizQuestion');

// Gold ammo sentinel — treated as unlimited throughout
const AMMO_GOLD = 9999;

function getTierAmmo(tier, settings) {
  if (tier === 'gold') return AMMO_GOLD;
  if (tier === 'silver' || tier === 'trial') return settings.ammoSilver ?? 10;
  return settings.ammoFree ?? 3;
}

// GET /api/briefs — list all accessible briefs
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, dateFrom } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (search) filter.$or = [
      { title: new RegExp(search, 'i') },
      { subtitle: new RegExp(search, 'i') },
    ];
    if (dateFrom) filter.dateAdded = { $gte: new Date(dateFrom) };

    const briefs = await IntelligenceBrief.find(filter)
      .populate('media')
      .sort({ dateAdded: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    let briefsOut = briefs.map(b => b.toObject());

    if (briefs.length > 0) {
      const settings   = await AppSettings.getSettings();
      const tier       = req.user ? effectiveTier(req.user) : 'guest';
      const accessible = getAccessibleCategories(tier, settings);

      let readSet    = new Set();
      let startedSet = new Set();
      if (req.user) {
        const briefIds = briefs.map(b => b._id);
        const [readRecords, startedRecords] = await Promise.all([
          IntelligenceBriefRead.find({
            userId: req.user._id,
            intelBriefId: { $in: briefIds },
            completed: true,
          }).select('intelBriefId'),
          IntelligenceBriefRead.find({
            userId: req.user._id,
            intelBriefId: { $in: briefIds },
            completed: false,
          }).select('intelBriefId'),
        ]);
        readSet    = new Set(readRecords.map(r => r.intelBriefId.toString()));
        startedSet = new Set(startedRecords.map(r => r.intelBriefId.toString()));
      }

      briefsOut = briefsOut.map(b => ({
        ...b,
        isRead:    readSet.has(b._id.toString()),
        isStarted: startedSet.has(b._id.toString()),
        isLocked:  accessible !== null && !accessible.includes(b.category),
      }));
    }

    res.json({ status: 'success', data: { briefs: briefsOut } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/category-counts — how many briefs exist per category (all categories, no tier filter)
// Locking is a display concern handled on the frontend; counts are always visible.
router.get('/category-counts', async (req, res) => {
  try {
    const rows = await IntelligenceBrief.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const counts = {};
    rows.forEach(r => { counts[r._id] = r.count; });
    res.json({ status: 'success', data: { counts } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/category-stats — total + done (read) count per category for the current user
router.get('/category-stats', optionalAuth, async (req, res) => {
  try {
    // Total briefs per category
    const totals = await IntelligenceBrief.aggregate([
      { $group: { _id: '$category', total: { $sum: 1 } } },
    ]);

    const stats = {};
    totals.forEach(r => { stats[r._id] = { total: r.total, done: 0 }; });

    if (req.user) {
      // How many briefs per category has this user read?
      const reads = await IntelligenceBriefRead.aggregate([
        { $match: { userId: req.user._id, completed: true } },
        {
          $lookup: {
            from: 'intelligencebriefs',
            localField: 'intelBriefId',
            foreignField: '_id',
            as: 'brief',
          },
        },
        { $unwind: '$brief' },
        { $group: { _id: '$brief.category', done: { $sum: 1 } } },
      ]);
      reads.forEach(r => { if (stats[r._id]) stats[r._id].done = r.done; });
    }

    res.json({ status: 'success', data: { stats } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/unread-categories — categories with ≥1 unread brief for the current user
router.get('/unread-categories', optionalAuth, async (req, res) => {
  try {
    // Aggregate brief counts per category
    const briefsByCat = await IntelligenceBrief.aggregate([
      { $group: { _id: '$category', total: { $sum: 1 }, briefIds: { $push: '$_id' } } },
    ]);

    const settings   = await AppSettings.getSettings();

    if (!req.user) {
      // Guests: only guest-tier categories, all treated as unread
      const accessible = getAccessibleCategories('guest', settings) ?? [];
      const categories = briefsByCat
        .filter(c => accessible.includes(c._id))
        .map(c => ({ name: c._id, totalBriefs: c.total, unreadCount: c.total }))
        .sort((a, b) => b.unreadCount - a.unreadCount);
      return res.json({ status: 'success', data: { categories } });
    }

    const tier       = effectiveTier(req.user);
    const accessible = getAccessibleCategories(tier, settings); // null = gold (all access)

    // Get IDs of briefs this user has already read
    const readRecords = await IntelligenceBriefRead.find({ userId: req.user._id, completed: true })
      .select('intelBriefId').lean();
    const readSet = new Set(readRecords.map(r => r.intelBriefId.toString()));

    const categories = briefsByCat
      .filter(c => accessible === null || accessible.includes(c._id))
      .map(c => ({
        name: c._id,
        totalBriefs: c.total,
        unreadCount: c.briefIds.filter(id => !readSet.has(id.toString())).length,
      }))
      .filter(c => c.unreadCount > 0)
      .sort((a, b) => b.unreadCount - a.unreadCount);

    res.json({ status: 'success', data: { categories } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/history — paginated list of briefs this user has read
router.get('/history', protect, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 30);
    const skip  = (page - 1) * limit;

    const baseMatch = { userId: req.user._id, completed: true };

    const [records, total, avgResult] = await Promise.all([
      IntelligenceBriefRead.find(baseMatch)
        .sort({ lastReadAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('intelBriefId', 'title category')
        .lean(),
      IntelligenceBriefRead.countDocuments(baseMatch),
      IntelligenceBriefRead.aggregate([
        { $match: baseMatch },
        { $group: { _id: null, avg: { $avg: '$timeSpentSeconds' } } },
      ]),
    ]);

    const avgTimeSeconds = avgResult[0]?.avg ? Math.round(avgResult[0].avg) : 0;

    const reads = records.map(r => ({
      _id:              r._id,
      briefId:          r.intelBriefId?._id ?? null,
      title:            r.intelBriefId?.title    ?? 'Unknown Brief',
      category:         r.intelBriefId?.category ?? '',
      timeSpentSeconds: r.timeSpentSeconds,
      firstReadAt:      r.firstReadAt,
      lastReadAt:       r.lastReadAt,
    }));

    res.json({ status: 'success', data: { reads, total, avgTimeSeconds } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/:id — single brief. Works for guests (no readRecord) and authenticated users.
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    let readRecord = null;
    let tierAmmo = 0;

    // Category access check — applies to guests and authenticated users alike
    {
      const settings = await AppSettings.getSettings();
      const tier = req.user ? effectiveTier(req.user) : 'guest';
      const accessible = getAccessibleCategories(tier, settings);
      if (accessible !== null && !accessible.includes(brief.category)) {
        return res.status(403).json({ message: 'Upgrade your subscription to access this category.', category: brief.category });
      }
    }

    if (req.user) {
      const settings = await AppSettings.getSettings();
      const tier = effectiveTier(req.user);
      tierAmmo = getTierAmmo(tier, settings);

      readRecord = await IntelligenceBriefRead.findOne({
        userId: req.user._id,
        intelBriefId: brief._id,
      });

      const AMMO_REGEN_MS = 24 * 60 * 60 * 1000;

      if (!readRecord) {
        readRecord = await IntelligenceBriefRead.create({
          userId: req.user._id,
          intelBriefId: brief._id,
          ammunitionRemaining: tierAmmo,
        });
      } else if (readRecord.ammunitionRemaining === 0 && readRecord.ammoDepletedAt) {
        const elapsed = Date.now() - new Date(readRecord.ammoDepletedAt).getTime();
        if (elapsed >= AMMO_REGEN_MS) {
          readRecord = await IntelligenceBriefRead.findByIdAndUpdate(
            readRecord._id,
            { ammunitionRemaining: tierAmmo, ammoDepletedAt: null },
            { new: true }
          );
        }
      } else if (readRecord.ammunitionRemaining === 0 && !readRecord.ammoDepletedAt) {
        const now = new Date();
        await IntelligenceBriefRead.findByIdAndUpdate(readRecord._id, { ammoDepletedAt: now });
        readRecord = Object.assign(readRecord.toObject(), { ammoDepletedAt: now });
      }
    }

    const ammoMax = req.user ? tierAmmo : 0;
    res.json({ status: 'success', data: { brief, readRecord, ammoMax } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/briefs/:id/complete — award coins when user finishes reading a brief
router.post('/:id/complete', protect, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const settings = await AppSettings.getSettings();

    // Idempotency: look up the read record to check if coins already awarded
    let readRecord = await IntelligenceBriefRead.findOne({
      userId: req.user._id,
      intelBriefId: brief._id,
    });

    // If no read record exists the user never opened the brief — create one now
    if (!readRecord) {
      const tier   = effectiveTier(req.user);
      const tierAmmo = getTierAmmo(tier, settings);
      readRecord = await IntelligenceBriefRead.create({
        userId: req.user._id,
        intelBriefId: brief._id,
        ammunitionRemaining: tierAmmo,
      });
    }

    let aircoinsEarned   = 0;
    let dailyCoinsEarned = 0;
    let newTotalAircoins;
    let newCycleAircoins;
    let rankPromotion    = null;
    let updatedLoginStreak = req.user.loginStreak ?? 0;

    if (!readRecord.coinsAwarded) {
      // ── Brief-read coins (first completion only) ──────────────────────
      aircoinsEarned = settings.aircoinsPerBriefRead ?? 5;
      const briefResult = await awardCoins(
        req.user._id, aircoinsEarned, 'brief_read',
        `Intel Brief Read: ${brief.title}`, brief._id
      );
      newTotalAircoins = briefResult.totalAircoins;
      newCycleAircoins = briefResult.cycleAircoins;
      if (briefResult.rankPromotion) rankPromotion = briefResult.rankPromotion;

      // ── Daily streak reward (first completion of the calendar day) ────
      const todayStr  = new Date().toDateString();
      const lastStr   = req.user.lastStreakDate
        ? new Date(req.user.lastStreakDate).toDateString()
        : null;
      const yesterStr = new Date(Date.now() - 86400000).toDateString();

      if (lastStr !== todayStr) {
        const currentStreak = req.user.loginStreak ?? 0;
        const newStreak     = (lastStr === yesterStr) ? currentStreak + 1 : 1;
        const base          = settings.aircoinsFirstLogin  ?? 5;
        const bonus         = settings.aircoinsStreakBonus ?? 2;
        dailyCoinsEarned    = base + (newStreak >= 2 ? bonus : 0);
        const dailyLabel    = newStreak >= 2
          ? `Daily Brief — ${newStreak}-day streak!`
          : 'Daily Brief';
        const dailyResult   = await awardCoins(
          req.user._id, dailyCoinsEarned, 'daily_brief', dailyLabel
        );
        newTotalAircoins    = dailyResult.totalAircoins;
        newCycleAircoins    = dailyResult.cycleAircoins;
        if (dailyResult.rankPromotion) rankPromotion = dailyResult.rankPromotion;
        updatedLoginStreak  = newStreak;
        await User.findByIdAndUpdate(req.user._id, {
          loginStreak: newStreak,
          lastStreakDate: new Date(),
        });
      }

      // Mark coins as awarded so re-completing the brief gives nothing
      await IntelligenceBriefRead.findByIdAndUpdate(readRecord._id, { coinsAwarded: true, completed: true });

      // Stamp today so the Home page "mission complete" banner updates
      // (This is a server-side complement to the client-side localStorage flag)
    }

    // Always mark completed (handles re-reads where coins were already awarded)
    await IntelligenceBriefRead.findByIdAndUpdate(readRecord._id, { completed: true });

    // Re-fetch lastStreakDate so the client can derive missionDone without localStorage
    const freshUser = await User.findById(req.user._id).select('lastStreakDate');

    res.json({
      status: 'success',
      data: {
        aircoinsEarned,
        dailyCoinsEarned,
        loginStreak:     updatedLoginStreak,
        lastStreakDate:  freshUser?.lastStreakDate ?? null,
        newTotalAircoins,
        newCycleAircoins,
        rankPromotion,
      },
    });
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
    const record = await IntelligenceBriefRead.findOne({
      userId: req.user._id,
      intelBriefId: req.params.id,
    });
    if (!record || record.ammunitionRemaining === 0) {
      return res.status(400).json({ message: 'No ammo remaining' });
    }
    // Unlimited sentinel — don't decrement
    if (record.ammunitionRemaining >= AMMO_GOLD) {
      return res.json({ status: 'success', data: { ammunitionRemaining: AMMO_GOLD } });
    }
    const willDeplete = record.ammunitionRemaining === 1;
    const updated = await IntelligenceBriefRead.findByIdAndUpdate(
      record._id,
      { $inc: { ammunitionRemaining: -1 }, ...(willDeplete ? { ammoDepletedAt: new Date() } : {}) },
      { new: true }
    );
    res.json({ status: 'success', data: { ammunitionRemaining: updated.ammunitionRemaining, ammoDepletedAt: updated.ammoDepletedAt ?? null } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/completed-brief-ids — all briefIds this user has fully read (completed: true)
router.get('/completed-brief-ids', protect, async (req, res) => {
  try {
    const reads = await IntelligenceBriefRead.find({
      userId:      req.user._id,
      completed:   true,
    }).select('intelBriefId').lean();
    const ids = [...new Set(reads.map(r => r.intelBriefId.toString()))];
    res.json({ status: 'success', data: { ids } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
