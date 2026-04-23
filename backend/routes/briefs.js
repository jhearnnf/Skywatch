const router = require('express').Router();
const { protect, optionalAuth } = require('../middleware/auth');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const AppSettings = require('../models/AppSettings');
const User = require('../models/User');
const AirstarLog = require('../models/AirstarLog');
const { awardCoins, getCycleThreshold } = require('../utils/awardCoins');
const { effectiveTier, getAccessibleCategories, isPathwayUnlocked, getPathwayAccessibleCategories, buildCumulativeThresholds } = require('../utils/subscription');
const { enrichWithMatchTerms } = require('../utils/mentionedBriefs');
const { normalizeSections, sectionBody } = require('../utils/descriptionSections');
// Required to register the schema so populate('quizQuestionsEasy/Medium') works
require('../models/GameQuizQuestion');
const GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt');
const Level = require('../models/Level');
const Rank  = require('../models/Rank');

// Gold ammo sentinel — treated as unlimited throughout
const AMMO_GOLD = 9999;

function getTierAmmo(tier, settings) {
  if (tier === 'gold') return AMMO_GOLD;
  if (tier === 'silver' || tier === 'trial') return settings.ammoSilver ?? 10;
  return settings.ammoFree ?? 3;
}

// GET /api/briefs — list all accessible briefs, sorted by read-priority then dateAdded
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, search, subcategory, dateFrom, status } = req.query;
    const pageNum  = Math.max(1, parseInt(req.query.page)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = {};
    if (category)    filter.category    = category;
    if (subcategory) filter.subcategory = subcategory;
    if (search) filter.$or = [
      { title: new RegExp(search, 'i') },
      { subtitle: new RegExp(search, 'i') },
    ];
    if (dateFrom) filter.dateAdded = { $gte: new Date(dateFrom) };
    if (status) filter.status = status;

    // Pre-fetch user's read/started/quiz IDs so we can sort by priority server-side.
    // Priority: 1=in-progress, 2=unread published, 3=read no quiz, 4=read+quiz, 5=stub
    let startedIds = [], readIds = [], quizIds = [];
    if (req.user) {
      const [startedRecs, readRecs, quizRecs] = await Promise.all([
        IntelligenceBriefRead.find({ userId: req.user._id, completed: false }).select('intelBriefId').lean(),
        IntelligenceBriefRead.find({ userId: req.user._id, completed: true  }).select('intelBriefId').lean(),
        GameSessionQuizAttempt.find({ userId: req.user._id, status: 'completed', won: true }).select('intelBriefId').lean(),
      ]);
      startedIds = startedRecs.map(r => r.intelBriefId);
      readIds    = readRecs.map(r => r.intelBriefId);
      quizIds    = quizRecs.map(r => r.intelBriefId);
    }

    const readSet    = new Set(readIds.map(id => id.toString()));
    const startedSet = new Set(startedIds.map(id => id.toString()));

    const [briefs, total] = await Promise.all([
      IntelligenceBrief.aggregate([
        { $match: filter },
        { $addFields: {
          _priority: {
            $switch: {
              branches: [
                { case: { $eq: ['$status', 'stub'] },                              then: 5 },
                { case: { $in: ['$_id', startedIds] },                             then: 1 },
                { case: { $and: [
                  { $not: { $in: ['$_id', readIds] } },
                  { $ne:  ['$status', 'stub'] },
                ]},                                                                 then: 2 },
                { case: { $and: [
                  { $in:  ['$_id', readIds] },
                  { $not: { $in: ['$_id', quizIds] } },
                ]},                                                                 then: 3 },
              ],
              default: 4,
            },
          },
        }},
        { $sort: { _priority: 1, dateAdded: -1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
      ]).then(docs => IntelligenceBrief.populate(docs, { path: 'media' })),
      IntelligenceBrief.countDocuments(filter),
    ]);

    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier       = req.user ? effectiveTier(req.user) : 'guest';
    const accessible = getAccessibleCategories(tier, settings);

    const briefsOut = briefs.map(b => ({
      ...b,
      isRead:    readSet.has(b._id.toString()),
      isStarted: startedSet.has(b._id.toString()),
      isLocked:  (accessible !== null && !accessible.includes(b.category)) || !isPathwayUnlocked(b.category, req.user, settings, levelThresholds),
    }));

    const totalPages = Math.ceil(total / limitNum);
    res.json({ status: 'success', data: { briefs: briefsOut, total, page: pageNum, totalPages } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/public-stats — totals for the marketing landing page
// Published brief count + total quiz questions (easy + medium) across those briefs
router.get('/public-stats', async (_req, res) => {
  try {
    const rows = await IntelligenceBrief.aggregate([
      { $match: { status: 'published' } },
      {
        $group: {
          _id: null,
          totalBriefs:    { $sum: 1 },
          totalQuestions: {
            $sum: {
              $add: [
                { $size: { $ifNull: ['$quizQuestionsEasy',   []] } },
                { $size: { $ifNull: ['$quizQuestionsMedium', []] } },
              ],
            },
          },
        },
      },
    ]);
    const { totalBriefs = 0, totalQuestions = 0 } = rows[0] || {};
    res.json({ status: 'success', data: { totalBriefs, totalQuestions } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/category-counts — how many briefs exist per category (all categories, no tier filter)
// Locking is a display concern handled on the frontend; counts are always visible.
router.get('/category-counts', async (req, res) => {
  try {
    const rows = await IntelligenceBrief.aggregate([
      { $match: { status: 'published' } },
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
    // Total published briefs per category
    const totals = await IntelligenceBrief.aggregate([
      { $match: { status: 'published' } },
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

// GET /api/briefs/random-unlocked — returns a random published brief accessible to the current user,
// preferring briefs the user has not yet completed (falls back to any accessible brief if all are done)
// GET /api/briefs/random-sample?count=5 — N random accessible published briefs (title/category/status only)
router.get('/random-sample', optionalAuth, async (req, res) => {
  try {
    const count    = Math.min(parseInt(req.query.count) || 5, 20);
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier     = req.user ? effectiveTier(req.user) : 'guest';
    const accessible = getAccessibleCategories(tier, settings);
    const pathway    = getPathwayAccessibleCategories(req.user, settings, levelThresholds);

    // Intersect subscription-accessible and pathway-accessible category lists
    let finalCategories = null;
    if (accessible !== null && pathway !== null) {
      finalCategories = accessible.filter(c => pathway.includes(c));
    } else if (accessible !== null) {
      finalCategories = accessible;
    } else if (pathway !== null) {
      finalCategories = pathway;
    }

    const filter = { status: 'published' };
    if (finalCategories !== null) filter.category = { $in: finalCategories };

    // Exclude the requested brief if provided
    if (req.query.exclude) filter._id = { $ne: req.query.exclude };

    const results = await IntelligenceBrief.aggregate([
      { $match: filter },
      { $sample: { size: count } },
      { $project: { _id: 1, title: 1, category: 1, status: 1 } },
    ]);

    res.json({ status: 'success', data: results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/random-unlocked', optionalAuth, async (req, res) => {
  try {
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier       = req.user ? effectiveTier(req.user) : 'guest';
    const accessible = getAccessibleCategories(tier, settings); // null = gold (all access)
    const pathway    = getPathwayAccessibleCategories(req.user, settings, levelThresholds);

    // Intersect subscription-accessible and pathway-accessible category lists
    let finalCategories = null;
    if (accessible !== null && pathway !== null) {
      finalCategories = accessible.filter(c => pathway.includes(c));
    } else if (accessible !== null) {
      finalCategories = accessible;
    } else if (pathway !== null) {
      finalCategories = pathway;
    }

    const baseFilter = { status: 'published', 'descriptionSections.0': { $exists: true } };
    if (finalCategories !== null) baseFilter.category = { $in: finalCategories };

    // Build a set of brief IDs the user has already completed
    let completedIds = [];
    if (req.user) {
      const reads = await IntelligenceBriefRead.find({
        userId: req.user._id,
        completed: true,
      }).select('intelBriefId').lean();
      completedIds = reads.map(r => r.intelBriefId);
    }

    // Try to find an unread brief first
    const unreadFilter = completedIds.length
      ? { ...baseFilter, _id: { $nin: completedIds } }
      : baseFilter;

    let [result] = await IntelligenceBrief.aggregate([
      { $match: unreadFilter },
      { $sample: { size: 1 } },
      { $project: { _id: 1 } },
    ]);

    // Fall back to any accessible brief if the user has read them all
    if (!result && completedIds.length) {
      [result] = await IntelligenceBrief.aggregate([
        { $match: baseFilter },
        { $sample: { size: 1 } },
        { $project: { _id: 1 } },
      ]);
    }

    if (!result) return res.status(404).json({ message: 'No briefs available.' });
    res.json({ status: 'success', data: { briefId: result._id } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/random-in-progress — returns the in-progress brief with the
// lowest priorityNumber (most foundational first). Null priorities sort last;
// ties break by most recent lastReadAt.
router.get('/random-in-progress', protect, async (req, res) => {
  try {
    const reads = await IntelligenceBriefRead.find({ userId: req.user._id, completed: false })
      .populate('intelBriefId', 'title category _id status priorityNumber')
      .lean();

    const valid = reads.filter(r => r.intelBriefId && r.intelBriefId.status === 'published');
    if (!valid.length) return res.json({ status: 'success', data: null });

    valid.sort((a, b) => {
      const pa = a.intelBriefId.priorityNumber;
      const pb = b.intelBriefId.priorityNumber;
      if (pa == null && pb == null) {
        return new Date(b.lastReadAt ?? 0) - new Date(a.lastReadAt ?? 0);
      }
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pa !== pb) return pa - pb;
      return new Date(b.lastReadAt ?? 0) - new Date(a.lastReadAt ?? 0);
    });

    const pick = valid[0];
    res.json({
      status: 'success',
      data: {
        briefId:        pick.intelBriefId._id,
        title:          pick.intelBriefId.title,
        category:       pick.intelBriefId.category,
        currentSection: pick.currentSection ?? 0,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/next-pathway-brief — returns the next unread stepping stone.
// Picks a random accessible category that has ≥1 eligible unread brief, then returns
// the one with the lowest priorityNumber within it (null priorities sort last).
// Eligible = published (stubs excluded), has descriptionSections, accessible by tier
// AND pathway, and the user has no read record for it (neither completed nor in-progress).
// In-progress briefs are excluded so this pairs cleanly with the Jump Back In card —
// Daily Mission surfaces a fresh next-stepping-stone, Jump Back In covers resume.
router.get('/next-pathway-brief', protect, async (req, res) => {
  try {
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier       = effectiveTier(req.user);
    const accessible = getAccessibleCategories(tier, settings); // null = gold (all access)
    const pathway    = getPathwayAccessibleCategories(req.user, settings, levelThresholds);

    let finalCategories = null;
    if (accessible !== null && pathway !== null) {
      finalCategories = accessible.filter(c => pathway.includes(c));
    } else if (accessible !== null) {
      finalCategories = accessible;
    } else if (pathway !== null) {
      finalCategories = pathway;
    }

    // Exclude any brief the user has a read record for — completed OR in-progress.
    // In-progress briefs are surfaced by the Jump Back In card instead.
    const reads = await IntelligenceBriefRead.find({ userId: req.user._id })
      .select('intelBriefId').lean();
    const excludeIds = reads.map(r => r.intelBriefId);

    const filter = {
      status: 'published',
      'descriptionSections.0': { $exists: true },
    };
    if (finalCategories !== null) filter.category = { $in: finalCategories };
    if (excludeIds.length)        filter._id      = { $nin: excludeIds };

    // Find the set of categories that have at least one eligible brief, then pick one at random
    const categoriesWithBriefs = await IntelligenceBrief.distinct('category', filter);
    if (!categoriesWithBriefs.length) {
      return res.status(404).json({ message: 'No briefs available.' });
    }

    const chosenCategory = categoriesWithBriefs[Math.floor(Math.random() * categoriesWithBriefs.length)];

    // Within the chosen category, pick the lowest priorityNumber (nulls last)
    const candidates = await IntelligenceBrief
      .find({ ...filter, category: chosenCategory })
      .select('_id priorityNumber')
      .lean();

    candidates.sort((a, b) => {
      if (a.priorityNumber == null && b.priorityNumber == null) return 0;
      if (a.priorityNumber == null) return 1;
      if (b.priorityNumber == null) return -1;
      return a.priorityNumber - b.priorityNumber;
    });

    const pick = candidates[0];
    res.json({ status: 'success', data: { briefId: pick._id, category: chosenCategory } });
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

    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);

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
    const pathway    = getPathwayAccessibleCategories(req.user, settings, levelThresholds);

    // Get IDs of briefs this user has already read
    const readRecords = await IntelligenceBriefRead.find({ userId: req.user._id, completed: true })
      .select('intelBriefId').lean();
    const readSet = new Set(readRecords.map(r => r.intelBriefId.toString()));

    const categories = briefsByCat
      .filter(c => (accessible === null || accessible.includes(c._id)) && (pathway === null || pathway.includes(c._id)))
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

    const flashcard = req.query.flashcard === '1';
    const baseMatch = flashcard
      ? { userId: req.user._id, reachedFlashcard: true }
      : { userId: req.user._id, completed: true };

    const populateFields = flashcard ? 'title category subcategory descriptionSections' : 'title category subcategory';

    const [records, total, avgResult] = await Promise.all([
      IntelligenceBriefRead.find(baseMatch)
        .sort({ completedAt: -1, lastReadAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('intelBriefId', populateFields)
        .lean(),
      IntelligenceBriefRead.countDocuments(baseMatch),
      IntelligenceBriefRead.aggregate([
        { $match: baseMatch },
        { $group: { _id: null, avg: { $avg: '$timeSpentSeconds' } } },
      ]),
    ]);

    const avgTimeSeconds = avgResult[0]?.avg ? Math.round(avgResult[0].avg) : 0;

    const reads = records.map(r => {
      const base = {
        _id:              r._id,
        briefId:          r.intelBriefId?._id ?? null,
        title:            r.intelBriefId?.title    ?? 'Unknown Brief',
        category:         r.intelBriefId?.category ?? '',
        subcategory:      r.intelBriefId?.subcategory ?? '',
        timeSpentSeconds: r.timeSpentSeconds,
        completedAt:      r.completedAt,
        firstReadAt:      r.firstReadAt,
        lastReadAt:       r.lastReadAt,
      };
      if (flashcard) {
        const sections = normalizeSections(r.intelBriefId?.descriptionSections);
        base.flashcardQuestion = sections[3]?.body ?? null;
      }
      return base;
    });

    res.json({ status: 'success', data: { reads, total, avgTimeSeconds } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// GET /api/briefs/pathway/:category — ordered pathway briefs with isRead flag.
// News: all briefs sorted by eventDate DESC (newest first).
// Other categories: briefs with priorityNumber set, sorted by priorityNumber ASC.
router.get('/pathway/:category', optionalAuth, async (req, res) => {
  try {
    const { category } = req.params;

    // Enforce both subscription-tier and pathway (level + rank) access
    {
      const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
      const levelThresholds = buildCumulativeThresholds(rawLevels);
      const tier = req.user ? effectiveTier(req.user) : 'guest';
      const accessible = getAccessibleCategories(tier, settings);
      if (accessible !== null && !accessible.includes(category)) {
        return res.status(403).json({ message: 'Upgrade your subscription to access this category.', category });
      }
      if (!isPathwayUnlocked(category, req.user, settings, levelThresholds)) {
        const unlock = settings.pathwayUnlocks.find(p => p.category === category);
        return res.status(403).json({
          message: 'This category requires a higher level or rank.',
          category,
          levelRequired: unlock?.levelRequired,
          rankRequired:  unlock?.rankRequired,
          reason: 'pathway',
        });
      }
    }

    const isNews = category === 'News';

    const query  = isNews
      ? { category }
      : { category, priorityNumber: { $ne: null } };
    const fields = isNews
      ? '_id title subtitle status category subcategory eventDate historic'
      : '_id title subtitle status priorityNumber category subcategory historic';
    const sortBy = isNews
      ? { eventDate: -1 }
      : { priorityNumber: 1 };

    const briefs = await IntelligenceBrief.find(query, fields).sort(sortBy).lean();

    let readSet = new Set();
    let inProgressSet = new Set();
    if (req.user) {
      const readRecs = await IntelligenceBriefRead.find({ userId: req.user._id, completed: true })
        .select('intelBriefId').lean();
      readSet = new Set(readRecs.map(r => r.intelBriefId.toString()));

      const inProgressRecs = await IntelligenceBriefRead.find({ userId: req.user._id, completed: false })
        .select('intelBriefId').lean();
      inProgressSet = new Set(inProgressRecs.map(r => r.intelBriefId.toString()));
    }

    const data = briefs.map(b => ({
      _id:            b._id,
      title:          b.title,
      subtitle:       b.subtitle,
      status:         b.status,
      priorityNumber: b.priorityNumber ?? null,
      eventDate:      b.eventDate ?? null,
      category:       b.category,
      subcategory:    b.subcategory,
      historic:       b.historic ?? false,
      isRead:         readSet.has(b._id.toString()),
      isInProgress:   !readSet.has(b._id.toString()) && inProgressSet.has(b._id.toString()),
    }));

    // Populate image URLs for the first non-stub, unread brief so the pathway
    // page can show a cycling teaser of what's up next.
    let nextBrief = null;
    const nextBriefEntry = data.find(b => !b.isRead && b.status !== 'stub');
    if (nextBriefEntry) {
      const full = await IntelligenceBrief.findById(nextBriefEntry._id)
        .populate({ path: 'media', select: 'mediaType mediaUrl' })
        .lean();
      const images = Array.isArray(full?.media)
        ? full.media
            .filter(m => m && m.mediaType === 'picture' && m.mediaUrl)
            .slice(0, 5)
            .map(m => m.mediaUrl)
        : [];
      if (images.length > 0) {
        nextBrief = { id: nextBriefEntry._id, images };
      }
    }

    res.json({ status: 'success', data: { briefs: data, totalCount: data.length, nextBrief } });
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
      .populate('quizQuestionsMedium')
      .populate('associatedBaseBriefIds',     '_id title subtitle nickname category status')
      .populate('associatedSquadronBriefIds', '_id title subtitle nickname category status')
      .populate('associatedAircraftBriefIds', '_id title subtitle nickname category status')
      .populate('associatedMissionBriefIds',  '_id title subtitle nickname category status')
      .populate('associatedTrainingBriefIds', '_id title subtitle nickname category status')
      .populate('associatedTechBriefIds',     '_id title subtitle nickname category status')
      .populate('relatedBriefIds',            '_id title subtitle nickname category status')
      .populate('relatedHistoric',            '_id title subtitle category status historic')
      .populate('mentionedBriefIds',          '_id title subtitle nickname category');

    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    let readRecord = null;
    let tierAmmo = 0;

    // Category access check — subscription tier then pathway (level + rank)
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier = req.user ? effectiveTier(req.user) : 'guest';
    const accessible = getAccessibleCategories(tier, settings);
    if (accessible !== null && !accessible.includes(brief.category)) {
      return res.status(403).json({ message: 'Upgrade your subscription to access this category.', category: brief.category });
    }
    if (!isPathwayUnlocked(brief.category, req.user, settings, levelThresholds)) {
      const unlock = settings.pathwayUnlocks.find(p => p.category === brief.category);
      return res.status(403).json({
        message: 'This category requires a higher level or rank.',
        category: brief.category,
        levelRequired: unlock?.levelRequired,
        rankRequired:  unlock?.rankRequired,
        reason: 'pathway',
      });
    }

    if (req.user) {
      tierAmmo = getTierAmmo(tier, settings);

      readRecord = await IntelligenceBriefRead.findOne({
        userId: req.user._id,
        intelBriefId: brief._id,
      });

      const AMMO_REGEN_MS = 24 * 60 * 60 * 1000;

      if (!readRecord) {
        try {
          readRecord = await IntelligenceBriefRead.create({
            userId: req.user._id,
            intelBriefId: brief._id,
            ammunitionRemaining: tierAmmo,
          });
        } catch (e) {
          if (e.code !== 11000) throw e
          // Race condition (e.g. StrictMode double-invoke): another request already created
          // the record — just fetch it instead of returning a 500.
          readRecord = await IntelligenceBriefRead.findOne({
            userId: req.user._id,
            intelBriefId: brief._id,
          })
        }
      } else if (readRecord.ammunitionRemaining === 0 && readRecord.ammoDepletedAt) {
        const elapsed = Date.now() - new Date(readRecord.ammoDepletedAt).getTime();
        if (elapsed >= AMMO_REGEN_MS) {
          readRecord = await IntelligenceBriefRead.findByIdAndUpdate(
            readRecord._id,
            { ammunitionRemaining: tierAmmo, ammoDepletedAt: null },
            { returnDocument: 'after' }
          );
        }
      } else if (readRecord.ammunitionRemaining === 0 && !readRecord.ammoDepletedAt) {
        const now = new Date();
        await IntelligenceBriefRead.findByIdAndUpdate(readRecord._id, { ammoDepletedAt: now });
        readRecord = Object.assign(readRecord.toObject(), { ammoDepletedAt: now });
      }
    }

    const ammoMax = req.user ? tierAmmo : 0;

    // Convert to plain object and enrich every associated array with matchTerms
    // so the frontend can flatMap over all variant forms without a live DB scan.
    const briefObj = brief.toObject();
    briefObj.associatedBaseBriefIds     = enrichWithMatchTerms(briefObj.associatedBaseBriefIds);
    briefObj.associatedSquadronBriefIds = enrichWithMatchTerms(briefObj.associatedSquadronBriefIds);
    briefObj.associatedAircraftBriefIds = enrichWithMatchTerms(briefObj.associatedAircraftBriefIds);
    briefObj.associatedMissionBriefIds  = enrichWithMatchTerms(briefObj.associatedMissionBriefIds);
    briefObj.associatedTrainingBriefIds = enrichWithMatchTerms(briefObj.associatedTrainingBriefIds);
    briefObj.associatedTechBriefIds     = enrichWithMatchTerms(briefObj.associatedTechBriefIds);
    briefObj.relatedBriefIds            = enrichWithMatchTerms(briefObj.relatedBriefIds);
    briefObj.mentionedBriefIds          = enrichWithMatchTerms(briefObj.mentionedBriefIds);

    // Strip related/mentioned briefs the user cannot access — stubs, wrong tier, or locked pathway.
    const filterAccessible = (arr) => (arr ?? []).filter(b =>
      b &&
      (accessible === null || accessible.includes(b.category)) &&
      isPathwayUnlocked(b.category, req.user, settings, levelThresholds)
    );
    briefObj.associatedBaseBriefIds     = filterAccessible(briefObj.associatedBaseBriefIds);
    briefObj.associatedSquadronBriefIds = filterAccessible(briefObj.associatedSquadronBriefIds);
    briefObj.associatedAircraftBriefIds = filterAccessible(briefObj.associatedAircraftBriefIds);
    briefObj.associatedMissionBriefIds  = filterAccessible(briefObj.associatedMissionBriefIds);
    briefObj.associatedTrainingBriefIds = filterAccessible(briefObj.associatedTrainingBriefIds);
    briefObj.associatedTechBriefIds     = filterAccessible(briefObj.associatedTechBriefIds);
    briefObj.relatedBriefIds            = filterAccessible(briefObj.relatedBriefIds);
    briefObj.mentionedBriefIds          = filterAccessible(briefObj.mentionedBriefIds);

    // Resolve keyword linked brief titles explicitly — populate can silently return
    // null if linkedBriefId points to a stale/regenerated document, so we do a
    // direct lookup and map titles back regardless of populate result.
    if (briefObj.keywords?.length) {
      const linkedIds = briefObj.keywords
        .map(k => k.linkedBriefId?._id ?? k.linkedBriefId)
        .filter(Boolean);
      if (linkedIds.length) {
        const linkedBriefs = await IntelligenceBrief.find(
          { _id: { $in: linkedIds } },
          '_id title nickname category'
        ).lean();
const idToLinked = new Map(linkedBriefs.map(b => [String(b._id), b]));
        briefObj.keywords = briefObj.keywords.map(k => {
          const rawId = k.linkedBriefId?._id ?? k.linkedBriefId;
          if (!rawId) return k;
          const linked = idToLinked.get(String(rawId));
          return linked ? { ...k, linkedBriefId: linked } : k;
        });
      }
    }

    res.json({ status: 'success', data: { brief: briefObj, readRecord, ammoMax } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/briefs/:id/reward-preview — compute pending coin reward without committing.
// Mirrors the award math in POST /:id/complete so the client can optimistically show
// the airstars notification the instant the user swipes past the final section.
router.get('/:id/reward-preview', protect, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id).select('status descriptionSections');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.status === 'stub' || !brief.descriptionSections?.length) {
      return res.status(400).json({ message: 'Brief has no content yet' });
    }

    const settings   = await AppSettings.getSettings();
    const readRecord = await IntelligenceBriefRead.findOne({
      userId:       req.user._id,
      intelBriefId: brief._id,
    }).select('coinsAwarded');

    // Already rewarded — preview is zero, client should show nothing
    if (readRecord?.coinsAwarded) {
      return res.json({ status: 'success', data: { airstarsEarned: 0, dailyCoinsEarned: 0, unlockedCategories: [] } });
    }

    const airstarsEarned = settings.airstarsPerBriefRead ?? 5;

    let dailyCoinsEarned = 0;
    const todayStr  = new Date().toDateString();
    const lastStr   = req.user.lastStreakDate
      ? new Date(req.user.lastStreakDate).toDateString()
      : null;
    const yesterStr = new Date(Date.now() - 86400000).toDateString();
    if (lastStr !== todayStr) {
      const currentStreak = req.user.loginStreak ?? 0;
      const newStreak     = (lastStr === yesterStr) ? currentStreak + 1 : 1;
      const base          = settings.airstarsFirstLogin  ?? 5;
      const bonus         = settings.airstarsStreakBonus ?? 2;
      dailyCoinsEarned    = base + (newStreak >= 2 ? bonus : 0);
    }

    // ── Project would-be pathway category unlocks (mirrors awardCoins's diff) ──
    // Without committing, simulate the cycleAirstars/rank change that POST /complete
    // would produce and diff the pathway-accessible categories before vs after.
    // Must stay in sync with awardCoins so the preview and commit always agree.
    const totalEarned = airstarsEarned + dailyCoinsEarned;
    let unlockedCategories = [];
    try {
      const levelsList = await Level.find().sort({ levelNumber: 1 }).lean();
      const thresholds = buildCumulativeThresholds(levelsList);
      const cycleThreshold = await getCycleThreshold();

      const startingTotal    = req.user.totalAirstars ?? 0;
      const startingCycle    = req.user.cycleAirstars ?? 0;
      const startingRankNum  = req.user.rank?.rankNumber ?? 0;

      // Simulate awardCoins's rank promotion: keep subtracting threshold and
      // advancing rank until below threshold (or no higher rank exists).
      let projectedCycle   = startingCycle + totalEarned;
      let projectedRankNum = startingRankNum;
      if (projectedCycle >= cycleThreshold) {
        const allRanks = await Rank.find().sort({ rankNumber: 1 }).lean();
        while (projectedCycle >= cycleThreshold) {
          const nextRank = allRanks.find(r => r.rankNumber > projectedRankNum);
          if (!nextRank) break;
          projectedCycle  -= cycleThreshold;
          projectedRankNum = nextRank.rankNumber;
        }
      }

      const beforeUser = { totalAirstars: startingTotal,                rank: { rankNumber: startingRankNum  } };
      const afterUser  = { totalAirstars: startingTotal + totalEarned, rank: { rankNumber: projectedRankNum } };

      const before = getPathwayAccessibleCategories(beforeUser, settings, thresholds) ?? [];
      const after  = getPathwayAccessibleCategories(afterUser,  settings, thresholds) ?? [];
      unlockedCategories = after.filter(c => !before.includes(c));
    } catch (_) {
      // Projection is best-effort — never fail the preview if settings/levels lookup fails.
    }

    res.json({ status: 'success', data: { airstarsEarned, dailyCoinsEarned, unlockedCategories } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/briefs/:id/complete — award coins when user finishes reading a brief
router.post('/:id/complete', protect, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.status === 'stub' || !brief.descriptionSections?.length) return res.status(400).json({ message: 'Brief has no content yet' });

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

    let airstarsEarned   = 0;
    let dailyCoinsEarned = 0;
    let newTotalAirstars;
    let newCycleAirstars;
    let rankPromotion    = null;
    let updatedLoginStreak = req.user.loginStreak ?? 0;
    let unlockedCategories     = [];
    let categoryUnlocksGranted = [];

    if (!readRecord.coinsAwarded) {
      // ── Brief-read coins (first completion only) ──────────────────────
      airstarsEarned = settings.airstarsPerBriefRead ?? 5;
      const briefResult = await awardCoins(
        req.user._id, airstarsEarned, 'brief_read',
        `Intel Brief Read: ${brief.title}`, brief._id
      );
      newTotalAirstars = briefResult.totalAirstars;
      newCycleAirstars = briefResult.cycleAirstars;
      if (briefResult.rankPromotion) rankPromotion = briefResult.rankPromotion;
      if (briefResult.unlockedCategories?.length) {
        unlockedCategories.push(...briefResult.unlockedCategories);
        categoryUnlocksGranted.push(...(briefResult.categoryUnlocksGranted ?? []));
      }

      // ── Daily streak reward (first completion of the calendar day) ────
      const todayStr  = new Date().toDateString();
      const lastStr   = req.user.lastStreakDate
        ? new Date(req.user.lastStreakDate).toDateString()
        : null;
      const yesterStr = new Date(Date.now() - 86400000).toDateString();

      if (lastStr !== todayStr) {
        const currentStreak = req.user.loginStreak ?? 0;
        const newStreak     = (lastStr === yesterStr) ? currentStreak + 1 : 1;
        const base          = settings.airstarsFirstLogin  ?? 5;
        const bonus         = settings.airstarsStreakBonus ?? 2;
        dailyCoinsEarned    = base + (newStreak >= 2 ? bonus : 0);
        const dailyLabel    = newStreak >= 2
          ? `Daily Brief — ${newStreak}-day streak!`
          : 'Daily Brief';
        const dailyResult   = await awardCoins(
          req.user._id, dailyCoinsEarned, 'daily_brief', dailyLabel
        );
        newTotalAirstars    = dailyResult.totalAirstars;
        newCycleAirstars    = dailyResult.cycleAirstars;
        if (dailyResult.rankPromotion) rankPromotion = dailyResult.rankPromotion;
        if (dailyResult.unlockedCategories?.length) {
          for (const cat of dailyResult.unlockedCategories) {
            if (!unlockedCategories.includes(cat)) unlockedCategories.push(cat);
          }
          for (const entry of dailyResult.categoryUnlocksGranted ?? []) {
            if (!categoryUnlocksGranted.find(e => e.category === entry.category)) {
              categoryUnlocksGranted.push(entry);
            }
          }
        }
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

    // Always mark completed and reset section position (handles re-reads where coins were already awarded)
    await IntelligenceBriefRead.findByIdAndUpdate(readRecord._id, { completed: true, currentSection: 0, completedAt: new Date() });

    // ── Game unlock detection (only on first completion) ─────────────────────
    const gameUnlocksGranted = [];
    if (!readRecord.coinsAwarded) {
      // Quiz: unlocks on first brief ever completed
      if (!req.user.gameUnlocks?.quiz?.unlockedAt) {
        await User.findByIdAndUpdate(req.user._id, { 'gameUnlocks.quiz.unlockedAt': new Date() });
        gameUnlocksGranted.push('quiz');
      }
      // WTA: unlocks when user first reaches 2+ Aircraft reads AND 2+ Bases reads
      if (!req.user.gameUnlocks?.wta?.unlockedAt) {
        const [aircraftIds, baseIds] = await Promise.all([
          IntelligenceBrief.distinct('_id', { category: 'Aircrafts', status: 'published' }),
          IntelligenceBrief.distinct('_id', { category: 'Bases',     status: 'published' }),
        ]);
        const [ac, ba] = await Promise.all([
          IntelligenceBriefRead.countDocuments({ userId: req.user._id, completed: true, intelBriefId: { $in: aircraftIds } }),
          IntelligenceBriefRead.countDocuments({ userId: req.user._id, completed: true, intelBriefId: { $in: baseIds   } }),
        ]);
        if (ac >= 2 && ba >= 2) {
          await User.findByIdAndUpdate(req.user._id, { 'gameUnlocks.wta.unlockedAt': new Date() });
          gameUnlocksGranted.push('wta');
        }
      }
    }

    // Re-fetch lastStreakDate so the client can derive missionDone without localStorage
    const freshUser = await User.findById(req.user._id).select('lastStreakDate');

    res.json({
      status: 'success',
      data: {
        airstarsEarned,
        dailyCoinsEarned,
        loginStreak:        updatedLoginStreak,
        lastStreakDate:     freshUser?.lastStreakDate ?? null,
        newTotalAirstars,
        newCycleAirstars,
        rankPromotion,
        gameUnlocksGranted,
        unlockedCategories,
        categoryUnlocksGranted,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/briefs/:id/time — update time spent reading and persist current section position
router.patch('/:id/time', protect, async (req, res) => {
  try {
    const { seconds, currentSection } = req.body;
    const brief = await IntelligenceBrief.findById(req.params.id).select('status');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.status === 'stub') return res.status(400).json({ message: 'Brief is not yet available' });
    const update = { $inc: { timeSpentSeconds: seconds }, $set: { lastReadAt: new Date() } };
    if (typeof currentSection === 'number') update.$set.currentSection = currentSection;
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: req.user._id, intelBriefId: req.params.id },
      update
    );
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/briefs/:id/use-ammo — decrement ammo by 1 on keyword click
router.post('/:id/use-ammo', protect, async (req, res) => {
  try {
    const stubCheck = await IntelligenceBrief.findById(req.params.id).select('status');
    if (!stubCheck) return res.status(404).json({ message: 'Brief not found' });
    if (stubCheck.status === 'stub') return res.status(400).json({ message: 'Brief is not yet available' });
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
      { returnDocument: 'after' }
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

// POST /api/briefs/:id/mnemonic-viewed — record that a user opened a mnemonic sheet for a stat
router.post('/:id/mnemonic-viewed', protect, async (req, res) => {
  try {
    const { statKey } = req.body;
    if (!statKey) return res.status(400).json({ message: 'statKey required' });
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: req.user._id, intelBriefId: req.params.id },
      { $addToSet: { mnemonicsViewed: statKey } },
      { upsert: true }
    );
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Shared logic used by both the POST commit and the GET preview so the two
// can't drift. `commit: true` writes state (reach flag + unlock); `commit: false`
// returns the projected outcome as if the reach had just happened.
async function computeFlashcardReachOutcome(user, briefId, { commit }) {
  const existing = await IntelligenceBriefRead.findOne({
    userId:       user._id,
    intelBriefId: briefId,
  });

  if (existing?.reachedFlashcard || existing?.completed) {
    return { wasNew: false };
  }

  if (commit) {
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: user._id, intelBriefId: briefId },
      { $set: { reachedFlashcard: true } },
      { upsert: true }
    );
  }

  // When News flashcards are disabled, exclude News-category briefs from the
  // unlock count so the gate mirrors what the user actually sees on the Play page.
  const settings   = await AppSettings.getSettings();
  const briefFilter = { status: 'published' };
  if (!settings.newsFlashcardsEnabled) briefFilter.category = { $ne: 'News' };
  const validBriefIds = await IntelligenceBrief.distinct('_id', briefFilter);

  // Projected count after this reach: when committing, the write above has landed;
  // when previewing, add 1 iff the target brief qualifies under the filter.
  const committedCount = await IntelligenceBriefRead.countDocuments({
    userId:       user._id,
    intelBriefId: { $in: validBriefIds },
    $or: [{ completed: true }, { reachedFlashcard: true }],
  });
  let flashcardCount = committedCount;
  if (!commit) {
    const qualifies = validBriefIds.some(id => String(id) === String(briefId));
    if (qualifies) flashcardCount += 1;
  }

  const gameUnlocksGranted = [];
  if (flashcardCount >= 5 && !user.gameUnlocks?.flashcard?.unlockedAt) {
    if (commit) {
      await User.findByIdAndUpdate(user._id, { 'gameUnlocks.flashcard.unlockedAt': new Date() });
    }
    gameUnlocksGranted.push('flashcard');
  }

  return { wasNew: true, flashcardCount, gameUnlocksGranted };
}

// GET /api/briefs/:id/reached-flashcard-preview — read-only projection of the POST
// so the client can pre-fetch the outcome on section 3 and start the collect
// animation the instant the user swipes to section 4, with no network wait.
router.get('/:id/reached-flashcard-preview', protect, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id).select('status');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.status === 'stub') return res.status(400).json({ message: 'Brief has no content yet' });

    const outcome = await computeFlashcardReachOutcome(req.user, req.params.id, { commit: false });
    res.json({ status: 'success', ...outcome });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/briefs/:id/reached-flashcard
// Idempotent — marks that the user has reached section 4 of this brief.
// Returns wasNew: true only the first time (drives the deck notification on the client).
router.post('/:id/reached-flashcard', protect, async (req, res) => {
  try {
    const outcome = await computeFlashcardReachOutcome(req.user, req.params.id, { commit: true });
    res.json({ status: 'success', ...outcome });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
