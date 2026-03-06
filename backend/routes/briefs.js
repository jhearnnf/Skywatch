const router = require('express').Router();
const { protect, optionalAuth } = require('../middleware/auth');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const AppSettings = require('../models/AppSettings');
const User = require('../models/User');
const AircoinLog = require('../models/AircoinLog');
const { awardCoins } = require('../utils/awardCoins');
// Required to register the schema so populate('quizQuestionsEasy/Medium') works
require('../models/GameQuizQuestion');

// Gold ammo sentinel — treated as unlimited throughout
const AMMO_GOLD = 9999;

// Returns array of accessible categories for a tier, or null (= all) for gold
function getAccessibleCategories(tier, settings) {
  if (tier === 'gold') return null;
  if (tier === 'silver' || tier === 'trial') return settings.silverCategories ?? [];
  return settings.freeCategories ?? [];
}

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

    if (req.user && briefs.length > 0) {
      const settings = await AppSettings.getSettings();
      const tier = req.user.isTrialActive ? 'trial' : req.user.subscriptionTier;
      const accessible = getAccessibleCategories(tier, settings);

      const briefIds = briefs.map(b => b._id);
      const readRecords = await IntelligenceBriefRead.find({
        userId: req.user._id,
        intelBriefId: { $in: briefIds },
      }).select('intelBriefId');
      const readSet = new Set(readRecords.map(r => r.intelBriefId.toString()));

      briefsOut = briefsOut.map(b => ({
        ...b,
        isRead:   readSet.has(b._id.toString()),
        isLocked: accessible !== null && !accessible.includes(b.category),
      }));
    }

    res.json({ status: 'success', data: { briefs: briefsOut } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/category-counts — how many briefs exist per accessible category
router.get('/category-counts', optionalAuth, async (req, res) => {
  try {
    const settings    = await AppSettings.getSettings();
    const tier        = req.user ? (req.user.isTrialActive ? 'trial' : req.user.subscriptionTier) : 'free';
    const accessible  = getAccessibleCategories(tier, settings); // null = gold (all)
    const match       = accessible !== null ? { category: { $in: accessible } } : {};

    const rows = await IntelligenceBrief.aggregate([
      { $match: match },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const counts = {};
    rows.forEach(r => { counts[r._id] = r.count; });
    res.json({ status: 'success', data: { counts } });
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
      // Guests: only free-tier categories, all treated as unread
      const accessible = getAccessibleCategories('free', settings) ?? [];
      const categories = briefsByCat
        .filter(c => accessible.includes(c._id))
        .map(c => ({ name: c._id, totalBriefs: c.total, unreadCount: c.total }))
        .sort((a, b) => b.unreadCount - a.unreadCount);
      return res.json({ status: 'success', data: { categories } });
    }

    const tier       = req.user.isTrialActive ? 'trial' : req.user.subscriptionTier;
    const accessible = getAccessibleCategories(tier, settings); // null = gold (all access)

    // Get IDs of briefs this user has already read
    const readRecords = await IntelligenceBriefRead.find({ userId: req.user._id })
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

// GET /api/briefs/:id — single brief. Works for guests (no readRecord) and authenticated users.
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    let readRecord = null;
    let aircoinsEarned = 0;
    let newTotalAircoins;
    let newCycleAircoins;
    let briefRankPromotion = null;

    if (req.user) {
      const settings = await AppSettings.getSettings();
      const tier = req.user.isTrialActive ? 'trial' : req.user.subscriptionTier;

      // Category access check
      const accessible = getAccessibleCategories(tier, settings);
      if (accessible !== null && !accessible.includes(brief.category)) {
        return res.status(403).json({ message: 'Upgrade your subscription to access this category.' });
      }

      const tierAmmo = getTierAmmo(tier, settings);

      readRecord = await IntelligenceBriefRead.findOne({
        userId: req.user._id,
        intelBriefId: brief._id,
      });

      if (!readRecord) {
        readRecord = await IntelligenceBriefRead.create({
          userId: req.user._id,
          intelBriefId: brief._id,
          ammunitionRemaining: tierAmmo,
        });
        aircoinsEarned = settings.aircoinsPerBriefRead ?? 5;
        const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'brief_read', `Intel Brief Read: ${brief.title}`, brief._id);
        newTotalAircoins  = coinResult.totalAircoins;
        newCycleAircoins  = coinResult.cycleAircoins;
        briefRankPromotion = coinResult.rankPromotion;
      } else if (readRecord.ammunitionRemaining < tierAmmo && readRecord.ammunitionRemaining === 0) {
        // Ammo was zero — refresh to current tier default (covers tier upgrades and old zero defaults)
        readRecord = await IntelligenceBriefRead.findByIdAndUpdate(
          readRecord._id,
          { ammunitionRemaining: tierAmmo },
          { new: true }
        );
      }
    }

    res.json({ status: 'success', data: { brief, readRecord, aircoinsEarned: aircoinsEarned ?? 0, newTotalAircoins, newCycleAircoins, rankPromotion: briefRankPromotion } });
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
    const updated = await IntelligenceBriefRead.findByIdAndUpdate(
      record._id,
      { $inc: { ammunitionRemaining: -1 } },
      { new: true }
    );
    res.json({ status: 'success', data: { ammunitionRemaining: updated.ammunitionRemaining } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
