const router  = require('express').Router();
const crypto  = require('crypto');
const { protect } = require('../middleware/auth');
const GameSessionQuizResult  = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult    = require('../models/GameSessionOrderOfBattleResult');
const GameSessionWheresThatAircraftResult   = require('../models/GameSessionWheresThatAircraftResult');
const GameSessionWhereAircraftResult    = require('../models/GameSessionWhereAircraftResult');
const GameSessionFlashcardRecallResult  = require('../models/GameSessionFlashcardRecallResult');
const GameQuizQuestion = require('../models/GameQuizQuestion');
const AppSettings = require('../models/AppSettings');
const Level = require('../models/Level');
const User = require('../models/User');
const AircoinLog = require('../models/AircoinLog');
const { awardCoins } = require('../utils/awardCoins');
const IntelligenceBrief     = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const GameOrderOfBattle = require('../models/GameOrderOfBattle');
const { BATTLE_CATEGORIES, ORDER_TYPES, REQUIRED_FIELD } = require('../models/GameOrderOfBattle');
const AptitudeSyncUsage = require('../models/AptitudeSyncUsage');

function getDisplayValue(orderType, gameData) {
  if (!gameData) return null;
  const cy = new Date().getFullYear();
  switch (orderType) {
    case 'speed':           return gameData.topSpeedKph        != null ? `${gameData.topSpeedKph.toLocaleString()} kph` : null;
    case 'year_introduced': return gameData.yearIntroduced      != null ? String(gameData.yearIntroduced)  : null;
    case 'year_retired':    return gameData.yearRetired         != null ? String(gameData.yearRetired)     : `Present (${cy})`;
    case 'rank_hierarchy':  return gameData.rankHierarchyOrder  != null ? `Order: ${gameData.rankHierarchyOrder}` : null;
    case 'training_week':   return gameData.trainingWeekStart   != null
      ? `Wk ${gameData.trainingWeekStart}${gameData.trainingWeekEnd ? `–${gameData.trainingWeekEnd}` : ''}` : null;
    case 'start_year':        return gameData.startYear           != null ? String(gameData.startYear)      : null;
    case 'end_year':          return gameData.endYear             != null ? String(gameData.endYear)        : `Ongoing (${cy})`;
    case 'aircraft_count_asc': return gameData.aircraftCount      != null ? `${gameData.aircraftCount} aircraft` : null;
    default: return null;
  }
}

// Returns a Set of briefId strings where the user has won ALL available order types
async function computeFullyCompletedBriefIds(userId, needed) {
  const results = await GameSessionOrderOfBattleResult.find({ userId, won: true })
    .populate({ path: 'gameId', select: 'anchorBriefId orderType' }).lean();

  const wonByBrief = new Map();
  for (const r of results) {
    if (!r.gameId?.anchorBriefId) continue;
    const bid = r.gameId.anchorBriefId.toString();
    if (!wonByBrief.has(bid)) wonByBrief.set(bid, new Set());
    wonByBrief.get(bid).add(r.gameId.orderType);
  }
  if (wonByBrief.size === 0) return new Set();

  const ObjectId = require('mongoose').Types.ObjectId;
  const briefIds = [...wonByBrief.keys()].map(id => new ObjectId(id));
  const briefs   = await IntelligenceBrief.find({ _id: { $in: briefIds } })
    .select('category gameData').lean();

  const categories = [...new Set(briefs.map(b => b.category))];
  const availByCategory = {};
  for (const category of categories) {
    availByCategory[category] = new Set();
    for (const orderType of (ORDER_TYPES[category] ?? [])) {
      const fieldKey = REQUIRED_FIELD[orderType];
      const count = await IntelligenceBrief.countDocuments({
        category, [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
      });
      if (count >= needed) availByCategory[category].add(orderType);
    }
  }

  const fullyCompleted = new Set();
  for (const brief of briefs) {
    const bid = brief._id.toString();
    const catAvail = availByCategory[brief.category] ?? new Set();
    const availForBrief = [...catAvail].filter(ot => brief.gameData?.[REQUIRED_FIELD[ot]] != null);
    if (availForBrief.length === 0) continue;
    const won = wonByBrief.get(bid) ?? new Set();
    if (availForBrief.every(ot => won.has(ot))) fullyCompleted.add(bid);
  }
  return fullyCompleted;
}

// POST /api/games/quiz/start — fetch questions, create attempt, return question set
router.post('/quiz/start', protect, async (req, res) => {
  try {
    const { briefId } = req.body;
    if (!briefId) return res.status(400).json({ message: 'briefId required' });

    const { effectiveTier, canAccessCategory, isPathwayUnlocked, buildCumulativeThresholds } = require('../utils/subscription');

    const brief = await IntelligenceBrief.findById(briefId).select('category title');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const user = await User.findById(req.user._id);
    const difficulty  = user.difficultySetting ?? 'easy';
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier = effectiveTier(user);

    if (!canAccessCategory(brief.category, tier, settings)) {
      return res.status(403).json({
        message: 'Upgrade your subscription to access quizzes for this category.',
        category: brief.category,
      });
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

    const answerCount = difficulty === 'easy' ? (settings.easyAnswerCount ?? 3) : (settings.mediumAnswerCount ?? 5);

    const allQuestions = await GameQuizQuestion.find({ intelBriefId: briefId, difficulty });
    if (allQuestions.length < 5) {
      return res.status(400).json({ message: `Not enough ${difficulty} questions for this brief (need 5, have ${allQuestions.length}).` });
    }

    // Pick 5 at random
    const picked = allQuestions.sort(() => Math.random() - 0.5).slice(0, 5);

    // Build display questions: correct answer + (answerCount-1) random others, all shuffled
    const questions = picked.map(q => {
      const correct = q.answers.find(a => a._id.equals(q.correctAnswerId));
      const others  = q.answers.filter(a => !a._id.equals(q.correctAnswerId));
      const display = [correct, ...others.sort(() => Math.random() - 0.5).slice(0, answerCount - 1)]
        .sort(() => Math.random() - 0.5)
        .map(a => ({ _id: a._id, title: a.title }));
      return {
        _id:               q._id,
        question:          q.question,
        answers:           display,
        correctAnswerId:   q.correctAnswerId, // exposed for instant client feedback
        displayedAnswerIds: display.map(a => a._id),
      };
    });

    const priorCompleted = await GameSessionQuizAttempt.findOne({
      userId: req.user._id,
      intelBriefId: briefId,
      status: 'completed',
      won: true,
    });
    const isFirstAttempt = !priorCompleted;

    const gameSessionId = crypto.randomUUID();
    const attempt = await GameSessionQuizAttempt.create({
      userId: req.user._id,
      intelBriefId: briefId,
      gameSessionId,
      difficulty,
      isFirstAttempt,
      totalQuestions: 5,
    });

    res.json({ status: 'success', data: { attemptId: attempt._id, gameSessionId, difficulty, questions } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/quiz/result — save per-question result (isCorrect computed server-side)
router.post('/quiz/result', protect, async (req, res) => {
  try {
    const { questionId, displayedAnswerIds, selectedAnswerId, timeTakenSeconds, gameSessionId, attemptId } = req.body;

    // Compute isCorrect server-side
    const question  = await GameQuizQuestion.findById(questionId);
    const isCorrect = question ? question.correctAnswerId.equals(selectedAnswerId) : false;

    // Coins are awarded at the end of the quiz, not per-question
    const result = await GameSessionQuizResult.create({
      userId: req.user._id,
      questionId,
      displayedAnswerIds,
      selectedAnswerId,
      timeTakenSeconds,
      isCorrect,
      gameSessionId,
      attemptId: attemptId || undefined,
      aircoinsEarned: 0,
    });

    res.status(201).json({ status: 'success', data: { result, isCorrect, aircoinsEarned: 0 } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/quiz/attempt/:id/finish — complete or abandon an attempt
router.post('/quiz/attempt/:id/finish', protect, async (req, res) => {
  try {
    const { status } = req.body; // 'completed' | 'abandoned'
    if (!['completed', 'abandoned'].includes(status)) {
      return res.status(400).json({ message: 'status must be completed or abandoned' });
    }

    const attempt = await GameSessionQuizAttempt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });

    const results = await GameSessionQuizResult.find({
      gameSessionId: attempt.gameSessionId,
      userId: req.user._id,
    });
    const correct = results.filter(r => r.isCorrect).length;
    const total   = attempt.totalQuestions;
    const percentageCorrect = total > 0 ? Math.round((correct / total) * 100) : 0;

    const settings       = await AppSettings.getSettings();
    const passThreshold  = attempt.difficulty === 'medium'
      ? (settings.passThresholdMedium ?? 60)
      : (settings.passThresholdEasy   ?? 60);
    const won = status === 'completed' && percentageCorrect >= passThreshold;

    // Fetch brief once (needed for coins log label and BOO unlock check)
    const brief = won
      ? await IntelligenceBrief.findById(attempt.intelBriefId).select('title category').lean()
      : null;

    // Award coins only on first win
    let aircoinsEarned = 0;
    const breakdown = [];
    if (won && attempt.isFirstAttempt) {
      const coinRate   = attempt.difficulty === 'medium'
        ? (settings.aircoinsPerWinMedium ?? 20)
        : (settings.aircoinsPerWinEasy   ?? 10);
      const perCorrect = correct * coinRate;
      if (perCorrect > 0) {
        aircoinsEarned += perCorrect;
        breakdown.push({ label: `${correct} correct answer${correct !== 1 ? 's' : ''} × ${coinRate}`, amount: perCorrect });
      }
      // Bonus for 100% score
      if (correct === total) {
        const bonus = settings.aircoins100Percent ?? 15;
        aircoinsEarned += bonus;
        breakdown.push({ label: 'Perfect score bonus', amount: bonus });
      }
      if (aircoinsEarned > 0) {
        const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'quiz', `Quiz (${attempt.difficulty}): ${brief?.title ?? 'Unknown Brief'} — ${correct}/${total} correct`, attempt.intelBriefId);
        attempt.rankPromotion = coinResult.rankPromotion;
        attempt.cycleAircoins = coinResult.cycleAircoins;
      }
    }

    attempt.status            = status;
    attempt.won               = won;
    attempt.timeFinished      = new Date();
    attempt.correctAnswers    = correct;
    attempt.percentageCorrect = percentageCorrect;
    attempt.aircoinsEarned    = aircoinsEarned;
    await attempt.save();

    // ── BOO unlock detection (server-driven, fires on first qualifying win) ──
    const gameUnlocksGranted = [];
    if (won && brief && BATTLE_CATEGORIES.includes(brief.category)) {
      const freshUser = await User.findById(req.user._id).select('gameUnlocks difficultySetting').lean();
      if (!freshUser?.gameUnlocks?.boo?.unlockedAt) {
        const diff   = freshUser?.difficultySetting ?? 'easy';
        const needed = diff === 'medium' ? 5 : 3;

        // Check category has enough BOO game data
        let hasBooData = false;
        for (const orderType of (ORDER_TYPES[brief.category] ?? [])) {
          const fieldKey = REQUIRED_FIELD[orderType];
          const count = await IntelligenceBrief.countDocuments({
            category: brief.category,
            [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
          });
          if (count >= needed) { hasBooData = true; break; }
        }

        if (hasBooData) {
          // Check user meets the read gate for this category
          const categoryBriefIds = await IntelligenceBrief.distinct('_id', {
            category: brief.category, status: 'published',
          });
          const readsCount = await IntelligenceBriefRead.countDocuments({
            userId: req.user._id, completed: true, intelBriefId: { $in: categoryBriefIds },
          });

          if (readsCount >= needed) {
            await User.findByIdAndUpdate(req.user._id, { 'gameUnlocks.boo.unlockedAt': new Date() });
            gameUnlocksGranted.push('boo');
          }
        }
      }
    }

    res.json({ status: 'success', data: { attempt, won, aircoinsEarned, breakdown, isFirstAttempt: attempt.isFirstAttempt, rankPromotion: attempt.rankPromotion ?? null, cycleAircoins: attempt.cycleAircoins ?? null, gameUnlocksGranted } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/quiz/playable-brief-ids — briefIds with enough questions for user's difficulty
router.get('/quiz/playable-brief-ids', protect, async (req, res) => {
  try {
    const user       = await User.findById(req.user._id).select('difficultySetting').lean();
    const difficulty = user.difficultySetting ?? 'easy';

    const agg = await GameQuizQuestion.aggregate([
      { $match: { difficulty } },
      { $group: { _id: '$intelBriefId', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ]);
    const ids = agg.map(r => r._id.toString());
    res.json({ status: 'success', data: { ids } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/battle-of-order/available-categories — categories with enough BOO game data
router.get('/battle-of-order/available-categories', protect, async (req, res) => {
  try {
    const user       = await User.findById(req.user._id).select('difficultySetting').lean();
    const difficulty = user.difficultySetting ?? 'easy';
    const needed     = difficulty === 'medium' ? 5 : 3;

    const available = [];
    for (const category of BATTLE_CATEGORIES) {
      const orderTypes = ORDER_TYPES[category] ?? [];
      for (const orderType of orderTypes) {
        const fieldKey = REQUIRED_FIELD[orderType];
        const count    = await IntelligenceBrief.countDocuments({
          category,
          [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
        });
        if (count >= needed) { available.push(category); break; }
      }
    }
    res.json({ status: 'success', data: { categories: available } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/quiz/completed-brief-ids — all briefIds this user has ever won a quiz for
router.get('/quiz/completed-brief-ids', protect, async (req, res) => {
  try {
    const attempts = await GameSessionQuizAttempt.find({
      userId: req.user._id,
      status: 'completed',
      won: true,
    }).select('intelBriefId').lean();
    const ids = [...new Set(attempts.map(a => a.intelBriefId.toString()))];
    res.json({ status: 'success', data: { ids } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/battle-of-order/completed-brief-ids — all briefIds this user has ever won a BOO game for
router.get('/battle-of-order/completed-brief-ids', protect, async (req, res) => {
  try {
    const userDoc = await User.findById(req.user._id).select('difficultySetting').lean();
    const needed  = (userDoc.difficultySetting ?? 'easy') === 'medium' ? 5 : 3;
    const fullyCompleted = await computeFullyCompletedBriefIds(req.user._id, needed);
    res.json({ status: 'success', data: { ids: [...fullyCompleted] } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/quiz/briefs?state=available|completed|all&page=1&limit=20&search=
// Paginated brief list with server-computed quizState per brief.
// state=available : playable briefs the user has NOT yet passed
// state=completed : briefs the user HAS passed (won ≥ threshold)
// state=all       : all playable briefs
// Each brief has quizState: 'active' | 'needs-read' | 'passed'
// Response also includes availableMode for the 'available' tab banner.
router.get('/quiz/briefs', protect, async (req, res) => {
  try {
    const state  = ['available', 'completed', 'all'].includes(req.query.state) ? req.query.state : 'all';
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const search = req.query.search?.trim() || '';

    const { effectiveTier, canAccessCategory, isPathwayUnlocked, buildCumulativeThresholds } = require('../utils/subscription');
    const diff     = req.user.difficultySetting ?? 'easy';
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier     = effectiveTier(req.user);

    // Brief IDs that have ≥5 questions at user's difficulty
    const groups = await GameQuizQuestion.aggregate([
      { $match: { difficulty: diff } },
      { $group: { _id: '$intelBriefId', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ]);
    const playableIds = groups.map(g => g._id);

    // User's completed read records
    const readRecords = await IntelligenceBriefRead.find({
      userId: req.user._id, completed: true,
    }).select('intelBriefId').lean();
    const readSet = new Set(readRecords.map(r => r.intelBriefId.toString()));

    // User's won quiz attempts
    const passedRecords = await GameSessionQuizAttempt.find({
      userId: req.user._id, status: 'completed', won: true,
    }).select('intelBriefId').lean();
    const passedSet = new Set(passedRecords.map(r => r.intelBriefId.toString()));

    // Determine candidate IDs based on requested state
    let candidateIds;
    if (state === 'completed') {
      // Passed briefs — shown even if questions were later removed
      candidateIds = [...passedSet].map(id => new (require('mongoose').Types.ObjectId)(id));
    } else if (state === 'available') {
      candidateIds = playableIds.filter(id => !passedSet.has(id.toString()));
    } else {
      candidateIds = playableIds;
    }

    if (candidateIds.length === 0) {
      // For available state: if playable briefs exist but all are passed, signal all-passed
      const availableMode = state === 'available' && playableIds.length > 0 ? 'all-passed' : null;
      return res.json({ status: 'success', data: { briefs: [], total: 0, page, totalPages: 0, availableMode } });
    }

    // Fetch all matching docs (in-memory sort by state is needed for correct pagination)
    const dbFilter = { _id: { $in: candidateIds } };
    if (search) dbFilter.$or = [{ title: new RegExp(search, 'i') }, { subtitle: new RegExp(search, 'i') }];

    const allDocs = await IntelligenceBrief
      .find(dbFilter)
      .select('_id title category subcategory dateAdded')
      .sort({ dateAdded: -1 })
      .lean();

    // Annotate with quizState + apply subscription + pathway filters
    // (completed tab skips the filter — past completions are always visible)
    const annotated = allDocs
      .filter(b => state === 'completed' || (canAccessCategory(b.category, tier, settings) && isPathwayUnlocked(b.category, req.user, settings, levelThresholds)))
      .map(b => {
        const id = b._id.toString();
        const quizState = passedSet.has(id) ? 'passed' : readSet.has(id) ? 'active' : 'needs-read';
        return { _id: b._id, title: b.title, category: b.category, subcategory: b.subcategory, quizState };
      });

    // Sort: active → needs-read → passed (consistent with previous client-side sort)
    const STATE_ORDER = { active: 0, 'needs-read': 1, passed: 2 };
    annotated.sort((a, b) => (STATE_ORDER[a.quizState] ?? 99) - (STATE_ORDER[b.quizState] ?? 99));

    const total      = annotated.length;
    const totalPages = Math.ceil(total / limit) || 0;
    const briefs     = annotated.slice((page - 1) * limit, page * limit);

    // Compute availableMode for the available tab banner (full dataset, not just this page)
    let availableMode = null;
    if (state === 'available') {
      if (annotated.some(b => b.quizState === 'active'))      availableMode = 'active';
      else if (annotated.some(b => b.quizState === 'needs-read')) availableMode = 'needs-read';
      else availableMode = 'all-passed';
    }

    res.json({ status: 'success', data: { briefs, total, page, totalPages, availableMode } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/battle-of-order/briefs?state=available|completed|all&page=1&limit=20&search=
// Paginated brief list with server-computed booState per brief.
// state=available : BOO-category briefs the user has NOT yet won a BOO game for
// state=completed : briefs the user HAS won a BOO game for
// state=all       : all BOO-category briefs
// Each brief has booState: 'active' | 'needs-quiz' | 'needs-read' | 'no-data' | 'completed'
router.get('/battle-of-order/briefs', protect, async (req, res) => {
  try {
    const state  = ['available', 'completed', 'all'].includes(req.query.state) ? req.query.state : 'all';
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const search = req.query.search?.trim() || '';

    const { effectiveTier, canAccessCategory, isPathwayUnlocked, buildCumulativeThresholds } = require('../utils/subscription');
    const diff     = req.user.difficultySetting ?? 'easy';
    const needed   = diff === 'medium' ? 5 : 3;
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier     = effectiveTier(req.user);

    // Which BOO categories have enough game data?
    const booCategories = new Set();
    for (const category of BATTLE_CATEGORIES) {
      for (const orderType of (ORDER_TYPES[category] ?? [])) {
        const fieldKey = REQUIRED_FIELD[orderType];
        const count = await IntelligenceBrief.countDocuments({
          category,
          [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
        });
        if (count >= needed) { booCategories.add(category); break; }
      }
    }

    // Brief IDs where the user has won ALL available order types
    const wonBooSet = await computeFullyCompletedBriefIds(req.user._id, needed);

    // DB filter by state
    const dbFilter = { category: { $in: BATTLE_CATEGORIES }, status: 'published' };
    if (state === 'completed') dbFilter._id = { $in: [...wonBooSet].map(id => new (require('mongoose').Types.ObjectId)(id)) };
    if (state === 'available') dbFilter._id = { $nin: [...wonBooSet].map(id => new (require('mongoose').Types.ObjectId)(id)) };
    if (search) dbFilter.$or = [{ title: new RegExp(search, 'i') }, { subtitle: new RegExp(search, 'i') }];

    const allDocs = await IntelligenceBrief
      .find(dbFilter)
      .select('_id title category subcategory dateAdded')
      .sort({ dateAdded: -1 })
      .lean();

    // User's read records + passed quiz (fetched after getting brief IDs)
    const briefIds = allDocs.map(b => b._id);
    const [readRecords, passedQuizRecords] = await Promise.all([
      IntelligenceBriefRead.find({ userId: req.user._id, intelBriefId: { $in: briefIds }, completed: true })
        .select('intelBriefId').lean(),
      GameSessionQuizAttempt.find({ userId: req.user._id, status: 'completed', won: true, intelBriefId: { $in: briefIds } })
        .select('intelBriefId').lean(),
    ]);
    const readSet       = new Set(readRecords.map(r => r.intelBriefId.toString()));
    const passedQuizSet = new Set(passedQuizRecords.map(r => r.intelBriefId.toString()));

    // Brief IDs that have ≥5 quiz questions at the user's difficulty (quiz is playable)
    const quizGroups = await GameQuizQuestion.aggregate([
      { $match: { difficulty: diff, intelBriefId: { $in: briefIds } } },
      { $group: { _id: '$intelBriefId', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ]);
    const quizPlayableSet = new Set(quizGroups.map(g => g._id.toString()));

    // Category-reads gate: Bases briefs gate on bases reads; all others gate on aircraft reads
    const aircraftBriefIds = await IntelligenceBrief.find({ category: 'Aircrafts', status: 'published' })
      .select('_id').lean().then(docs => docs.map(d => d._id));
    const aircraftReadsCount = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id, completed: true, intelBriefId: { $in: aircraftBriefIds },
    });
    const meetsAircraftThreshold = aircraftReadsCount >= needed;

    const basesBriefIds = await IntelligenceBrief.find({ category: 'Bases', status: 'published' })
      .select('_id').lean().then(docs => docs.map(d => d._id));
    const basesReadsCount = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id, completed: true, intelBriefId: { $in: basesBriefIds },
    });
    const meetsBasesThreshold = basesReadsCount >= needed;

    // Per-category: does the user have enough READ briefs with game data for at least one orderType?
    // This ensures the "active" state only shows when a game can actually be generated from read briefs.
    const categoryPlayable = {};
    for (const category of BATTLE_CATEGORIES) {
      let playable = false;
      for (const orderType of (ORDER_TYPES[category] ?? [])) {
        const fieldKey = REQUIRED_FIELD[orderType];
        const withDataIds = await IntelligenceBrief.distinct('_id', {
          category, status: 'published',
          [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
        });
        const readCount = await IntelligenceBriefRead.countDocuments({
          userId: req.user._id, completed: true,
          intelBriefId: { $in: withDataIds },
        });
        if (readCount >= needed) { playable = true; break; }
      }
      categoryPlayable[category] = playable;
    }

    // Annotate + subscription + pathway filter
    const annotated = allDocs
      .filter(b => canAccessCategory(b.category, tier, settings) && isPathwayUnlocked(b.category, req.user, settings, levelThresholds))
      .map(b => {
        const id = b._id.toString();
        const hasData = booCategories.has(b.category);
        const meetsGate = b.category === 'Bases' ? meetsBasesThreshold : meetsAircraftThreshold;
        let booState;
        if      (!meetsGate)                                          booState = b.category === 'Bases' ? 'needs-bases-reads' : 'needs-aircraft-reads';
        else if (wonBooSet.has(id))                                   booState = 'completed';
        else if (!hasData)                                            booState = 'no-data';
        else if (!readSet.has(id))                                    booState = 'needs-read';
        else if (!passedQuizSet.has(id) && !quizPlayableSet.has(id)) booState = 'quiz-pending';
        else if (!passedQuizSet.has(id))                              booState = 'needs-quiz';
        else if (!categoryPlayable[b.category])                       booState = 'needs-more-reads';
        else                                                          booState = 'active';
        return { _id: b._id, title: b.title, category: b.category, subcategory: b.subcategory, booState };
      });

    // Sort: active → needs-quiz → quiz-pending → needs-read → needs-more-reads → completed → no-data → gates
    const STATE_ORDER = { active: 0, 'needs-quiz': 1, 'quiz-pending': 2, 'needs-read': 3, 'needs-more-reads': 3, completed: 4, 'no-data': 5, 'needs-aircraft-reads': 6, 'needs-bases-reads': 6 };
    annotated.sort((a, b) => (STATE_ORDER[a.booState] ?? 99) - (STATE_ORDER[b.booState] ?? 99));

    const total      = annotated.length;
    const totalPages = Math.ceil(total / limit) || 0;
    const briefs     = annotated.slice((page - 1) * limit, page * limit);

    res.json({ status: 'success', data: { briefs, total, page, totalPages } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/battle-of-order/recommended-briefs?limit=6
// Returns up to `limit` BOO-eligible briefs sorted by readiness: active → completed → needs-quiz → no-data
// "active"    = category has BOO data + quiz passed + BOO not yet won
// "completed" = category has BOO data + quiz passed + BOO already won
// "needs-quiz"= category has BOO data + quiz not yet passed
// "no-data"   = brief is in a BOO category but the category has no game data yet
router.get('/battle-of-order/recommended-briefs', protect, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit, 10) || 6, 20);
    const user     = await User.findById(req.user._id).lean();
    const diff     = user.difficultySetting ?? 'easy';
    const needed   = diff === 'medium' ? 5 : 3;
    const { effectiveTier, canAccessCategory, isPathwayUnlocked, buildCumulativeThresholds } = require('../utils/subscription');
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier = effectiveTier(user);

    // Which BOO categories have enough game data?
    const booCategories = new Set();
    for (const category of BATTLE_CATEGORIES) {
      for (const orderType of (ORDER_TYPES[category] ?? [])) {
        const fieldKey = REQUIRED_FIELD[orderType];
        const count = await IntelligenceBrief.countDocuments({
          category,
          [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
        });
        if (count >= needed) { booCategories.add(category); break; }
      }
    }

    // All briefs in BOO categories accessible to this user
    const allBooBriefs = await IntelligenceBrief.find({ category: { $in: BATTLE_CATEGORIES }, status: 'published' })
      .select('_id title category subcategory')
      .sort({ createdAt: -1 })
      .lean();
    const accessible = allBooBriefs.filter(b => canAccessCategory(b.category, tier, settings) && isPathwayUnlocked(b.category, req.user, settings, levelThresholds));
    if (accessible.length === 0) return res.json({ status: 'success', data: { briefs: [] } });

    const accessibleIds = accessible.map(b => b._id);

    // User's completed read records for these briefs
    const readRecords = await IntelligenceBriefRead.find({
      userId: req.user._id,
      intelBriefId: { $in: accessibleIds },
      completed: true,
    }).select('intelBriefId').lean();
    const readSet = new Set(readRecords.map(r => r.intelBriefId.toString()));

    // User's won quiz attempts for these briefs (quiz is prerequisite for BOO)
    const passedQuizRecords = await GameSessionQuizAttempt.find({
      userId: req.user._id, status: 'completed', won: true,
      intelBriefId: { $in: accessibleIds },
    }).select('intelBriefId').lean();
    const passedQuizSet = new Set(passedQuizRecords.map(r => r.intelBriefId.toString()));

    // Brief IDs that have ≥5 quiz questions at the user's difficulty (quiz is playable)
    const quizGroupsRec = await GameQuizQuestion.aggregate([
      { $match: { difficulty: diff, intelBriefId: { $in: accessibleIds } } },
      { $group: { _id: '$intelBriefId', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ]);
    const quizPlayableSetRec = new Set(quizGroupsRec.map(g => g._id.toString()));

    // Brief IDs where the user has won ALL available order types
    const wonBooSet = await computeFullyCompletedBriefIds(req.user._id, needed);

    // Category-reads gate: Bases briefs gate on bases reads; all others gate on aircraft reads
    const aircraftBriefIdsRec = await IntelligenceBrief.find({ category: 'Aircrafts', status: 'published' })
      .select('_id').lean().then(docs => docs.map(d => d._id));
    const aircraftReadsCountRec = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id, completed: true, intelBriefId: { $in: aircraftBriefIdsRec },
    });
    const meetsAircraftThresholdRec = aircraftReadsCountRec >= needed;

    const basesBriefIdsRec = await IntelligenceBrief.find({ category: 'Bases', status: 'published' })
      .select('_id').lean().then(docs => docs.map(d => d._id));
    const basesReadsCountRec = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id, completed: true, intelBriefId: { $in: basesBriefIdsRec },
    });
    const meetsBasesThresholdRec = basesReadsCountRec >= needed;

    // Bucket each brief — full prerequisite chain: gate → read → quiz → BOO
    const active = [], completed = [], needsQuiz = [], quizPending = [], needsRead = [], noData = [], needsAircraftReads = [], needsBasesReads = [];
    for (const brief of accessible) {
      const id      = brief._id.toString();
      const hasData = booCategories.has(brief.category);
      const meetsGate = brief.category === 'Bases' ? meetsBasesThresholdRec : meetsAircraftThresholdRec;
      if      (!meetsGate)                                              brief.category === 'Bases' ? needsBasesReads.push(brief) : needsAircraftReads.push(brief);
      else if (!hasData)                                                noData.push(brief);
      else if (!readSet.has(id))                                        needsRead.push(brief);
      else if (!passedQuizSet.has(id) && !quizPlayableSetRec.has(id))  quizPending.push(brief);
      else if (!passedQuizSet.has(id))                                  needsQuiz.push(brief);
      else if (wonBooSet.has(id))                                       completed.push(brief);
      else                                                              active.push(brief);
    }

    const result = [];
    const addBriefs = (list, state) => {
      const remaining = limit - result.length;
      if (remaining <= 0 || list.length === 0) return;
      list.slice(0, remaining).forEach(b => result.push({ ...b, booState: state }));
    };
    addBriefs(active,             'active');
    addBriefs(needsQuiz,          'needs-quiz');
    addBriefs(quizPending,        'quiz-pending');
    addBriefs(needsRead,          'needs-read');
    addBriefs(completed,          'completed');
    addBriefs(noData,             'no-data');
    addBriefs(needsAircraftReads, 'needs-aircraft-reads');
    addBriefs(needsBasesReads,    'needs-bases-reads');

    res.json({ status: 'success', data: { briefs: result } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/quiz/recommended-briefs?limit=6
// Returns up to `limit` briefs sorted by quiz readiness: active → needs-read → passed
// Subscription-locked categories are excluded. No-questions briefs are never returned.
router.get('/quiz/recommended-briefs', protect, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit, 10) || 6, 20);
    const user     = await User.findById(req.user._id).lean();
    const diff     = user.difficultySetting ?? 'easy';
    const { effectiveTier, canAccessCategory, isPathwayUnlocked, buildCumulativeThresholds } = require('../utils/subscription');
    const [settings, rawLevels] = await Promise.all([AppSettings.getSettings(), Level.find().sort({ levelNumber: 1 }).lean()]);
    const levelThresholds = buildCumulativeThresholds(rawLevels);
    const tier = effectiveTier(user);

    // Brief IDs with enough questions for this difficulty
    const groups = await GameQuizQuestion.aggregate([
      { $match: { difficulty: diff } },
      { $group: { _id: '$intelBriefId', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ]);
    if (groups.length === 0) return res.json({ status: 'success', data: { briefs: [] } });

    const playableIds = groups.map(g => g._id);

    // User's completed read records
    const readRecords = await IntelligenceBriefRead.find({
      userId: req.user._id, completed: true,
    }).select('intelBriefId').lean();
    const readSet = new Set(readRecords.map(r => r.intelBriefId.toString()));

    // User's won quiz attempts
    const passedRecords = await GameSessionQuizAttempt.find({
      userId: req.user._id, status: 'completed', won: true,
    }).select('intelBriefId').lean();
    const passedSet = new Set(passedRecords.map(r => r.intelBriefId.toString()));

    const activeIds    = playableIds.filter(id => readSet.has(id.toString()) && !passedSet.has(id.toString()));
    const needsReadIds = playableIds.filter(id => !readSet.has(id.toString()) && !passedSet.has(id.toString()));
    const passedIds    = playableIds.filter(id => passedSet.has(id.toString()));


    // For active briefs, sort by most recent read date so recently-read briefs appear first
    const activeReadMap = new Map();
    if (activeIds.length > 0) {
      const activeReads = await IntelligenceBriefRead.find({
        userId: req.user._id,
        intelBriefId: { $in: activeIds },
      }).select('intelBriefId lastReadAt').lean();
      for (const r of activeReads) activeReadMap.set(r.intelBriefId.toString(), r.lastReadAt);
    }
    const activeIdsSorted = [...activeIds].sort((a, b) => {
      const ta = activeReadMap.get(a.toString()) ?? 0;
      const tb = activeReadMap.get(b.toString()) ?? 0;
      return new Date(tb) - new Date(ta);
    });

    const result = [];
    const addBriefs = async (ids, state) => {
      if (result.length >= limit || ids.length === 0) return;
      // Fetch ALL docs for these ids (no DB-level limit) so we can reorder in JS
      const docs = await IntelligenceBrief.find({ _id: { $in: ids } })
        .select('_id title category subcategory')
        .lean();
      const docMap = new Map(docs.map(d => [d._id.toString(), d]));
      for (const id of ids) {
        if (result.length >= limit) break;
        const doc = docMap.get(id.toString());
        if (!doc) continue;
        if (!canAccessCategory(doc.category, tier, settings) || !isPathwayUnlocked(doc.category, req.user, settings, levelThresholds)) continue;
        result.push({ ...doc, quizState: state });
      }
    };

    await addBriefs(activeIdsSorted, 'active');
    await addBriefs(needsReadIds,    'needs-read');
    await addBriefs(passedIds,       'passed');

    res.json({ status: 'success', data: { briefs: result } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/quiz/status/:briefId — check if user has completed a quiz for this brief
router.get('/quiz/status/:briefId', protect, async (req, res) => {
  try {
    const completed = await GameSessionQuizAttempt.findOne({
      userId: req.user._id,
      intelBriefId: req.params.briefId,
      status: 'completed',
      won: true,
    });
    res.json({ status: 'success', data: { hasCompleted: !!completed } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/battle-of-order/options — check available order types for a brief's category
router.get('/battle-of-order/options', protect, async (req, res) => {
  try {
    const { briefId } = req.query;
    if (!briefId) return res.status(400).json({ message: 'briefId required' });

    const anchor = await IntelligenceBrief.findById(briefId).select('category gameData').lean();
    if (!anchor) return res.status(404).json({ message: 'Brief not found' });

    // Prerequisite 1: user must have completed the brief
    const readRecord = await IntelligenceBriefRead.findOne({
      userId: req.user._id, intelBriefId: briefId, completed: true,
    }).lean();
    if (!readRecord) return res.json({ status: 'success', data: { available: false, reason: 'not_read' } });

    // Fetch difficulty now — needed for the aircraft-reads threshold
    const userDoc    = await User.findById(req.user._id).select('difficultySetting').lean();
    const difficulty = userDoc.difficultySetting ?? 'easy';
    const needed     = difficulty === 'medium' ? 5 : 3;

    // Prerequisite 2: category-reads gate (Bases gates on bases reads; all others gate on aircraft reads)
    const gateCategory = anchor.category === 'Bases' ? 'Bases' : 'Aircrafts';
    const gateBriefIds = await IntelligenceBrief.find({ category: gateCategory, status: 'published' })
      .select('_id').lean().then(docs => docs.map(d => d._id));
    const gateReadsCount = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id, completed: true, intelBriefId: { $in: gateBriefIds },
    });
    if (gateReadsCount < needed) {
      const reason = anchor.category === 'Bases' ? 'needs-bases-reads' : 'needs-aircraft-reads';
      return res.json({ status: 'success', data: { available: false, reason, threshold: needed } });
    }

    // Prerequisite 3: user must have passed the quiz
    const quizPassed = await GameSessionQuizAttempt.findOne({
      userId: req.user._id, intelBriefId: briefId, status: 'completed', won: true,
    }).lean();
    if (!quizPassed) return res.json({ status: 'success', data: { available: false, reason: 'quiz_not_passed' } });

    const category   = anchor.category;
    const orderTypes = ORDER_TYPES[category];
    if (!orderTypes) return res.json({ status: 'success', data: { available: false, reason: 'ineligible_category' } });

    const options = [];
    for (const orderType of orderTypes) {
      const fieldKey = REQUIRED_FIELD[orderType];
      if (anchor.gameData?.[fieldKey] == null) continue;
      // Only count briefs the user has actually read — these are the ones that can appear in the game
      const withDataIds = await IntelligenceBrief.distinct('_id', {
        category,
        [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
      });
      const readCount = await IntelligenceBriefRead.countDocuments({
        userId: req.user._id, completed: true,
        intelBriefId: { $in: withDataIds },
      });
      if (readCount >= needed) options.push({ orderType });
    }

    if (options.length === 0) {
      return res.json({ status: 'success', data: { available: false, reason: 'insufficient_read_pool', threshold: needed, difficulty } });
    }
    res.json({ status: 'success', data: { available: true, options, difficulty } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/battle-of-order/generate — create a game for the selected order type
router.post('/battle-of-order/generate', protect, async (req, res) => {
  try {
    const { briefId, orderType } = req.body;
    if (!briefId || !orderType) return res.status(400).json({ message: 'briefId and orderType required' });

    const anchor = await IntelligenceBrief.findById(briefId).select('category gameData title').lean();
    if (!anchor) return res.status(404).json({ message: 'Brief not found' });

    // Prerequisite 1: user must have completed the brief
    const readRecord = await IntelligenceBriefRead.findOne({
      userId: req.user._id, intelBriefId: briefId, completed: true,
    }).lean();
    if (!readRecord) return res.status(403).json({ message: 'You must read and complete this brief first.' });

    const userDoc    = await User.findById(req.user._id).select('difficultySetting').lean();
    const difficulty = userDoc.difficultySetting ?? 'easy';
    const needed     = difficulty === 'medium' ? 5 : 3;

    // Prerequisite 2: category-reads gate
    const gateCategory2 = anchor.category === 'Bases' ? 'Bases' : 'Aircrafts';
    const gateBriefIds2 = await IntelligenceBrief.find({ category: gateCategory2, status: 'published' })
      .select('_id').lean().then(docs => docs.map(d => d._id));
    const gateReadsCount2 = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id, completed: true, intelBriefId: { $in: gateBriefIds2 },
    });
    if (gateReadsCount2 < needed) {
      return res.status(403).json({ message: `Read ${needed} ${gateCategory2} briefs to unlock Battle of Order.` });
    }

    // Prerequisite 3: user must have passed the quiz
    const quizPassed = await GameSessionQuizAttempt.findOne({
      userId: req.user._id, intelBriefId: briefId, status: 'completed', won: true,
    }).lean();
    if (!quizPassed) return res.status(403).json({ message: 'You must pass the Intel Quiz for this brief first.' });

    const category        = anchor.category;
    const validOrderTypes = ORDER_TYPES[category];
    if (!validOrderTypes?.includes(orderType)) return res.status(400).json({ message: 'Invalid orderType for this category' });

    const fieldKey   = REQUIRED_FIELD[orderType];
    if (anchor.gameData?.[fieldKey] == null) return res.status(400).json({ message: 'Anchor brief missing required game data' });

    const pool = await IntelligenceBrief.find({
      category,
      [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
    }).select('_id title media gameData').lean();

    // Filter pool to only briefs the user has completed — players should only see briefs they've read
    const readBriefIds = await IntelligenceBriefRead.distinct('intelBriefId', {
      userId: req.user._id, completed: true,
    });
    const readIdSet  = new Set(readBriefIds.map(id => id.toString()));
    const readablePool = pool.filter(b => readIdSet.has(b._id.toString()));

    if (readablePool.length < needed) {
      return res.status(400).json({ message: `Not enough read briefs to generate a game. You need ${needed} read briefs with game data in this category (you have ${readablePool.length}).` });
    }

    const others         = readablePool.filter(b => b._id.toString() !== briefId.toString());
    const shuffledOthers = others.sort(() => Math.random() - 0.5).slice(0, needed - 1);
    const selected       = [anchor, ...shuffledOthers];

    const cy = new Date().getFullYear();
    const getValue = (brief) => {
      const gd = brief.gameData ?? {};
      if (orderType === 'speed')           return gd.topSpeedKph       ?? Infinity;
      if (orderType === 'year_introduced') return gd.yearIntroduced    ?? Infinity;
      if (orderType === 'year_retired')    return gd.yearRetired       ?? cy;
      if (orderType === 'rank_hierarchy')  return gd.rankHierarchyOrder ?? Infinity;
      if (orderType === 'training_week')   return gd.trainingWeekStart  ?? Infinity;
      if (orderType === 'start_year')        return gd.startYear          ?? Infinity;
      if (orderType === 'end_year')          return gd.endYear            ?? cy;
      if (orderType === 'aircraft_count_asc') return gd.aircraftCount     ?? Infinity;
      return 0;
    };

    const sorted  = [...selected].sort((a, b) => getValue(a) - getValue(b));
    const choices = sorted.map((brief, i) => ({ briefId: brief._id, correctOrder: i + 1 }));

    const game = await Promise.race([
      GameOrderOfBattle.create({ anchorBriefId: briefId, category, difficulty, orderType, choices }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('BOO create timed out')), 10000)),
    ]);

    // Populate media for each choice
    const MediaModel = require('../models/Media');
    const mediaById  = {};
    const allMediaIds = pool.flatMap(b => b.media ?? []).filter(Boolean);
    if (allMediaIds.length > 0) {
      const mediaItems = await MediaModel.find({ _id: { $in: allMediaIds } }).select('_id mediaUrl mediaType').lean();
      mediaItems.forEach(m => { mediaById[m._id.toString()] = m; });
    }

    const getBriefMedia = (b) => (b.media ?? []).map(id => mediaById[id?.toString()]).filter(Boolean);

    const choiceDetails = game.choices.map(c => {
      const brief = pool.find(b => b._id.toString() === c.briefId.toString()) ??
                    (anchor._id.toString() === c.briefId.toString() ? anchor : null);
      return {
        choiceId:     c._id,
        briefTitle:   brief?.title,
        briefMedia:   getBriefMedia(brief ?? {}),
        displayValue: getDisplayValue(orderType, brief?.gameData),
      };
    });

    // Shuffle for presentation
    const shuffledChoices = [...choiceDetails].sort(() => Math.random() - 0.5);

    res.json({
      status: 'success',
      data: { gameId: game._id, category, difficulty, orderType, choices: shuffledChoices },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/battle-of-order/status/:briefId — completion status for this user+brief
router.get('/battle-of-order/status/:briefId', protect, async (req, res) => {
  try {
    const { briefId } = req.params;

    const wonResults = await GameSessionOrderOfBattleResult.find({
      userId: req.user._id, won: true,
    }).populate({ path: 'gameId', select: 'anchorBriefId orderType difficulty' }).lean();

    const completedOrderTypes = wonResults
      .filter(r => r.gameId?.anchorBriefId?.toString() === briefId)
      .map(r => ({ orderType: r.gameId.orderType, difficulty: r.gameId.difficulty }));

    // hasCompleted = true only when ALL available order types for this brief are won
    let hasCompleted = false;
    if (completedOrderTypes.length > 0) {
      const userDoc = await User.findById(req.user._id).select('difficultySetting').lean();
      const needed  = (userDoc.difficultySetting ?? 'easy') === 'medium' ? 5 : 3;
      const anchor  = await IntelligenceBrief.findById(briefId).select('category gameData').lean();
      if (anchor) {
        const wonSet       = new Set(completedOrderTypes.map(c => c.orderType));
        const catOrderTypes = ORDER_TYPES[anchor.category] ?? [];
        const available    = [];
        for (const ot of catOrderTypes) {
          const fieldKey = REQUIRED_FIELD[ot];
          if (anchor.gameData?.[fieldKey] == null) continue;
          const count = await IntelligenceBrief.countDocuments({
            category: anchor.category, [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
          });
          if (count >= needed) available.push(ot);
        }
        hasCompleted = available.length > 0 && available.every(ot => wonSet.has(ot));
      }
    }

    res.json({ status: 'success', data: { hasCompleted, completedOrderTypes } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/battle-of-order/submit — validate user order, award coins
router.post('/battle-of-order/submit', protect, async (req, res) => {
  try {
    const { gameId, userChoices, timeTakenSeconds } = req.body;
    if (!gameId || !userChoices) return res.status(400).json({ message: 'gameId and userChoices required' });

    const game = await GameOrderOfBattle.findById(gameId);
    if (!game) return res.status(404).json({ message: 'Game not found' });

    let won = userChoices.length === game.choices.length;
    if (won) {
      for (const uc of userChoices) {
        const choice = game.choices.find(c => c._id.toString() === uc.choiceId.toString());
        if (!choice || choice.correctOrder !== uc.userOrderNumber) { won = false; break; }
      }
    }

    const settings        = await AppSettings.getSettings();
    let aircoinsEarned    = 0;
    let rankPromotion     = null;
    let cycleAircoins     = null;

    if (won) {
      // Only award coins on first win for this brief + orderType + difficulty combination
      const priorGameIds = (await GameOrderOfBattle.find({
        anchorBriefId: game.anchorBriefId,
        orderType:     game.orderType,
        difficulty:    game.difficulty,
        _id:           { $ne: game._id },
      }).select('_id').lean()).map(g => g._id);

      const isFirstWin = !(await GameSessionOrderOfBattleResult.findOne({
        userId: req.user._id,
        gameId: { $in: priorGameIds },
        won: true,
      }));

      if (isFirstWin) {
        aircoinsEarned = game.difficulty === 'medium'
          ? (settings.aircoinsOrderOfBattleMedium ?? 18)
          : (settings.aircoinsOrderOfBattleEasy   ?? 8);
        const brief      = await IntelligenceBrief.findById(game.anchorBriefId).select('title').lean();
        const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'battle_of_order',
          `Battle of Order - Mini Game (${game.difficulty}): ${brief?.title ?? 'Unknown'} — ${game.orderType}`, game.anchorBriefId);
        rankPromotion = coinResult.rankPromotion;
        cycleAircoins = coinResult.cycleAircoins;
      }
    }

    await GameSessionOrderOfBattleResult.create({ userId: req.user._id, gameId, won, abandoned: false, userChoices, aircoinsEarned, timeTakenSeconds: timeTakenSeconds ?? null });

    // Build correct reveal (populate gameData for display values)
    const populated = await GameOrderOfBattle.findById(gameId)
      .populate({ path: 'choices.briefId', select: 'title gameData' })
      .lean();

    const correctReveal = [...populated.choices]
      .sort((a, b) => a.correctOrder - b.correctOrder)
      .map(c => ({
        choiceId:      c._id,
        briefTitle:    c.briefId?.title,
        correctOrder:  c.correctOrder,
        displayValue:  getDisplayValue(game.orderType, c.briefId?.gameData),
      }));

    res.json({ status: 'success', data: { won, aircoinsEarned, rankPromotion, cycleAircoins, correctReveal, alreadyCompleted: won && aircoinsEarned === 0 } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/battle-of-order/abandon
router.post('/battle-of-order/abandon', protect, async (req, res) => {
  try {
    const { gameId, timeTakenSeconds } = req.body;
    if (gameId) {
      await GameSessionOrderOfBattleResult.create({ userId: req.user._id, gameId, won: false, abandoned: true, userChoices: [], aircoinsEarned: 0, timeTakenSeconds: timeTakenSeconds ?? null });
    }
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/wheres-that-aircraft/result
router.post('/wheres-that-aircraft/result', protect, async (req, res) => {
  try {
    const { gameId, userAnswer, isCorrect, timeTakenSeconds, gameSessionId } = req.body;

    const settings       = await AppSettings.getSettings();
    const aircoinsEarned = isCorrect ? settings.aircoinsPerWin : 0;

    const result = await GameSessionWheresThatAircraftResult.create({
      userId: req.user._id, gameId, userAnswer, isCorrect, timeTakenSeconds, gameSessionId, aircoinsEarned,
    });

    let rankPromotion = null;
    if (aircoinsEarned > 0) {
      const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'wheres_that_aircraft', "Where's That Aircraft — correct identification");
      rankPromotion = coinResult.rankPromotion;
    }

    res.status(201).json({ status: 'success', data: { result, rankPromotion } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/flashcard-recall/available-briefs
// Returns the count of completed briefs available for flashcard rounds.
router.get('/flashcard-recall/available-briefs', protect, async (req, res) => {
  try {
    const validBriefIds = await IntelligenceBrief.distinct('_id', { status: 'published' });
    const count = await IntelligenceBriefRead.countDocuments({
      userId: req.user._id,
      intelBriefId: { $in: validBriefIds },
      $or: [{ completed: true }, { reachedFlashcard: true }],
    });
    res.json({ status: 'success', data: { count } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/flashcard-recall/start
// Picks N random completed briefs, creates a GameFlashcardRecall doc, returns cards (no title).
router.post('/flashcard-recall/start', protect, async (req, res) => {
  try {
    const { count = 5 } = req.body;
    const cardCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);

    const gameType = await require('../models/GameType').findOne({ key: 'flashcard_recall' }).lean();

    // All valid published brief IDs
    const validBriefIds = await IntelligenceBrief.distinct('_id', { status: 'published' });

    // User's eligible read records — completed briefs OR briefs where they reached section 4
    const readRecords = await IntelligenceBriefRead.find({
      userId: req.user._id,
      intelBriefId: { $in: validBriefIds },
      $or: [{ completed: true }, { reachedFlashcard: true }],
    }).select('intelBriefId').lean();

    if (readRecords.length < cardCount) {
      return res.status(400).json({
        message: `Not enough eligible briefs. You have ${readRecords.length}, need ${cardCount}.`,
        available: readRecords.length,
      });
    }

    // Build play-count map from past non-abandoned sessions for this user
    const pastSessions = await GameSessionFlashcardRecallResult.find(
      { userId: req.user._id, abandoned: false },
      { 'cardResults.intelBriefId': 1 }
    ).lean();

    const playCountMap = {};
    for (const session of pastSessions) {
      for (const cr of (session.cardResults || [])) {
        const id = cr.intelBriefId.toString();
        playCountMap[id] = (playCountMap[id] || 0) + 1;
      }
    }

    // Weighted sampling without replacement — fresher (less-played) cards have higher weight
    // weight = max(0.15, 1 / (timesPlayed + 1))  so never-played = 1.0, floor at 0.15
    function weightedSample(items, weights, k) {
      const pool = items.map((item, i) => ({ item, w: weights[i] }));
      const result = [];
      while (result.length < k && pool.length > 0) {
        const total = pool.reduce((s, p) => s + p.w, 0);
        let r = Math.random() * total;
        let chosen = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
          r -= pool[i].w;
          if (r <= 0) { chosen = i; break; }
        }
        result.push(pool[chosen].item);
        pool.splice(chosen, 1);
      }
      return result;
    }

    const eligibleIds = readRecords.map(r => r.intelBriefId);
    const weights     = eligibleIds.map(id => Math.max(0.15, 1 / ((playCountMap[id.toString()] || 0) + 1)));
    const picked      = weightedSample(eligibleIds, weights, cardCount);

    // Fetch the full brief data for the picked IDs
    // descriptionSections[3] = section 4: name-free 1–2 sentence summary designed for flashcard recall
    const briefs = await IntelligenceBrief.find({ _id: { $in: picked } })
      .select('_id title category subcategory descriptionSections')
      .lean();

    // All published brief titles for typeahead (client-side filtering)
    const allBriefs = await IntelligenceBrief.find({ status: 'published' })
      .select('_id title')
      .lean();

    // Build cards — title deliberately excluded from card data
    // contentSnippet uses section 4 (index 3) which is AI-generated to never include the brief's name/title
    const cards = briefs.map((brief, idx) => ({
      cardIndex:      idx,
      intelBriefId:   brief._id,
      category:       brief.category,
      subcategory:    brief.subcategory ?? '',
      contentSnippet: brief.descriptionSections?.[3] ?? '',
    }));

    // Shuffle cards so they don't appear in same order as picked
    cards.sort(() => Math.random() - 0.5);
    cards.forEach((c, i) => { c.cardIndex = i; });

    // Build GameFlashcardRecall cards with required fields
    const gameCards = briefs.map(b => ({
      intelBriefId:      b._id,
      displayedQuestion: b.descriptionSections?.[3] || b.category,
      displayedAnswer:   b.title,
    }));

    const gameDoc = await require('../models/GameFlashcardRecall').create({
      gameTypeId: gameType?._id ?? new (require('mongoose').Types.ObjectId)(),
      cards: gameCards,
    });

    const gameSessionId = crypto.randomUUID();

    res.json({
      status: 'success',
      data: {
        gameId: gameDoc._id,
        gameSessionId,
        cards,
        totalCards: cards.length,
        allBriefTitles: allBriefs.map(b => ({ _id: b._id, title: b.title })),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/flashcard-recall/result
router.post('/flashcard-recall/result', protect, async (req, res) => {
  try {
    const { gameId, cardResults, gameSessionId } = req.body;

    const settings        = await AppSettings.getSettings();
    const correctCount    = cardResults.filter(c => c.recalled).length;
    const allCorrect      = correctCount === cardResults.length;
    const perCard         = settings.aircoinsFlashcardPerCard     ?? 2;
    const perfectBonus    = settings.aircoinsFlashcardPerfectBonus ?? 5;
    const aircoinsEarned  = (correctCount * perCard) + (allCorrect ? perfectBonus : 0);

    const result = await GameSessionFlashcardRecallResult.create({
      userId: req.user._id, gameId, cardResults, gameSessionId, aircoinsEarned,
    });

    const label = `Flashcard Recall — ${correctCount}/${cardResults.length}${allCorrect ? ' (perfect)' : ''}`;
    const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'flashcard', label);

    res.status(201).json({
      status: 'success',
      data: {
        result,
        rankPromotion:  coinResult.rankPromotion,
        cycleAircoins:  coinResult.cycleAircoins,
        totalAircoins:  coinResult.totalAircoins,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/flashcard-recall/abandon
router.post('/flashcard-recall/abandon', protect, async (req, res) => {
  try {
    const { gameId, cardResults, gameSessionId } = req.body;
    if (!gameId || !gameSessionId) return res.status(400).json({ message: 'gameId and gameSessionId required' });

    await GameSessionFlashcardRecallResult.create({
      userId:        req.user._id,
      gameId,
      gameSessionId,
      cardResults:   Array.isArray(cardResults) ? cardResults : [],
      aircoinsEarned: 0,
      abandoned:     true,
      cardsAnswered: Array.isArray(cardResults) ? cardResults.length : 0,
    });

    res.status(201).json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Where's That Aircraft ─────────────────────────────────────────────────

// POST /api/games/wheres-aircraft/spawn-check
// Called after an Aircraft brief read is completed.
// Increments the user's counter; spawns a game if prerequisites are met.
router.post('/wheres-aircraft/spawn-check', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // Prerequisites: ≥2 completed Bases reads AND ≥2 completed Aircrafts reads
    const [basesCount, aircraftCount] = await Promise.all([
      IntelligenceBriefRead.countDocuments({ userId, completed: true,
        intelBriefId: { $in: await IntelligenceBrief.distinct('_id', { category: 'Bases' }) },
      }),
      IntelligenceBriefRead.countDocuments({ userId, completed: true,
        intelBriefId: { $in: await IntelligenceBrief.distinct('_id', { category: 'Aircrafts' }) },
      }),
    ]);

    if (basesCount < 2 || aircraftCount < 2) {
      return res.json({ status: 'success', data: { spawn: false } });
    }

    // Fetch current spawn state
    const user = await User.findById(userId).select('whereAircraftReadsSinceLastGame whereAircraftSpawnThreshold');
    const newCount = (user.whereAircraftReadsSinceLastGame ?? 0) + 1;

    if (newCount < (user.whereAircraftSpawnThreshold ?? 3)) {
      await User.findByIdAndUpdate(userId, { whereAircraftReadsSinceLastGame: newCount });
      return res.json({ status: 'success', data: { spawn: false } });
    }

    // Spawn! Find eligible aircraft briefs:
    // - user has read the aircraft brief
    // - brief has ≥1 associatedBaseBriefIds
    // - user has also read at least one of those base briefs
    const readAircraftIds = (await IntelligenceBriefRead.find({ userId, completed: true })
      .distinct('intelBriefId'));

    const eligibleAircraft = await IntelligenceBrief.find({
      _id: { $in: readAircraftIds },
      category: 'Aircrafts',
      'associatedBaseBriefIds.0': { $exists: true },
    }).select('_id title associatedBaseBriefIds media').populate('media', 'mediaUrl').lean();

    const readBaseIds = new Set(
      (await IntelligenceBriefRead.distinct('intelBriefId', { userId, completed: true,
        intelBriefId: { $in: await IntelligenceBrief.distinct('_id', { category: 'Bases' }) },
      })).map(id => id.toString())
    );

    const eligible = eligibleAircraft.filter(b =>
      b.associatedBaseBriefIds.some(id => readBaseIds.has(id.toString()))
    );

    if (eligible.length === 0) {
      // No eligible briefs yet — increment counter but don't spawn
      await User.findByIdAndUpdate(userId, { whereAircraftReadsSinceLastGame: newCount });
      return res.json({ status: 'success', data: { spawn: false } });
    }

    // Exclude aircraft the user has already won, unless they've cleared all eligible ones
    const wonAircraftIds = new Set(
      (await GameSessionWhereAircraftResult.distinct('aircraftBriefId', { userId, won: true }))
        .map(id => id.toString())
    );
    const unplayed = eligible.filter(b => !wonAircraftIds.has(b._id.toString()));
    const pool = unplayed.length > 0 ? unplayed : eligible; // fall back to all if all won

    // Pick a random aircraft from the pool
    const aircraft = pool[Math.floor(Math.random() * pool.length)];
    const mediaUrl = aircraft.media?.[0]?.mediaUrl ?? null;

    // Reset counter; set new random threshold 2–5
    const newThreshold = 2 + Math.floor(Math.random() * 4);
    await User.findByIdAndUpdate(userId, {
      whereAircraftReadsSinceLastGame: 0,
      whereAircraftSpawnThreshold: newThreshold,
    });

    // Fetch base brief names for the eligible bases
    const eligibleBaseIds = aircraft.associatedBaseBriefIds.filter(id => readBaseIds.has(id.toString()));
    const baseBriefs = await IntelligenceBrief.find(
      { _id: { $in: eligibleBaseIds } }
    ).select('_id title').lean();

    res.json({ status: 'success', data: {
      spawn: true,
      aircraftBriefId: aircraft._id,
      aircraftTitle:   aircraft.title,
      mediaUrl,
      baseBriefCount:  baseBriefs.length,
    }});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/wheres-aircraft/round1
// Returns aircraft name options (1 correct + 4 random wrong) and records round 1 result.
router.post('/wheres-aircraft/round1', protect, async (req, res) => {
  try {
    const { aircraftBriefId, gameSessionId } = req.body;
    if (!aircraftBriefId || !gameSessionId) {
      return res.status(400).json({ message: 'aircraftBriefId and gameSessionId required' });
    }

    const correct = await IntelligenceBrief.findById(aircraftBriefId).select('_id title media associatedBaseBriefIds').populate('media', 'mediaUrl').lean();
    if (!correct) return res.status(404).json({ message: 'Aircraft brief not found' });

    // Pick 4 other random aircraft brief titles (regardless of user read status)
    const others = await IntelligenceBrief.aggregate([
      { $match: { category: 'Aircrafts', _id: { $ne: correct._id } } },
      { $sample: { size: 4 } },
      { $project: { _id: 1, title: 1 } },
    ]);

    const options = [
      { _id: correct._id, title: correct.title, isCorrect: true },
      ...others.map(o => ({ _id: o._id, title: o.title, isCorrect: false })),
    ].sort(() => Math.random() - 0.5);

    const mediaUrl = correct.media?.[0]?.mediaUrl ?? null;

    res.json({ status: 'success', data: {
      gameSessionId,
      mediaUrl,
      aircraftBriefId: correct._id,
      options,
      baseCount: correct.associatedBaseBriefIds?.length ?? 0,
    }});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/wheres-aircraft/round2
// Returns base options and records the full session result.
router.post('/wheres-aircraft/round2', protect, async (req, res) => {
  try {
    const { aircraftBriefId, gameSessionId } = req.body;
    if (!aircraftBriefId || !gameSessionId) {
      return res.status(400).json({ message: 'aircraftBriefId and gameSessionId required' });
    }

    const aircraft = await IntelligenceBrief.findById(aircraftBriefId)
      .select('associatedBaseBriefIds title').lean();
    if (!aircraft) return res.status(404).json({ message: 'Aircraft brief not found' });

    // Fetch all base briefs the user has read (for map highlighting)
    const userId = req.user._id;
    const readBaseIds = new Set(
      (await IntelligenceBriefRead.distinct('intelBriefId', { userId, completed: true,
        intelBriefId: { $in: await IntelligenceBrief.distinct('_id', { category: 'Bases' }) },
      })).map(id => id.toString())
    );

    const correctBaseIds = aircraft.associatedBaseBriefIds ?? [];

    // Fetch names for all base briefs for the map
    const allBases = await IntelligenceBrief.find({ category: 'Bases' }).select('_id title').lean();

    const basesWithReadStatus = allBases.map(b => ({
      _id:     b._id,
      title:   b.title,
      isRead:  readBaseIds.has(b._id.toString()),
      isCorrect: correctBaseIds.map(id => id.toString()).includes(b._id.toString()),
    }));

    const settings = await AppSettings.getSettings();

    res.json({ status: 'success', data: {
      gameSessionId,
      aircraftTitle:    aircraft.title,
      correctBaseIds,
      correctBaseCount: correctBaseIds.length,
      bases:            basesWithReadStatus,
      round1Aircoins:   settings.aircoinsWhereAircraftRound1 ?? 5,
    }});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/wheres-aircraft/submit
// Final submission — records full result and awards coins.
router.post('/wheres-aircraft/submit', protect, async (req, res) => {
  try {
    const {
      aircraftBriefId, gameSessionId,
      round1Correct, round2Attempted, round2Correct,
      selectedBaseIds, correctBaseIds,
      timeTakenSeconds,
      status, // 'completed' | 'abandoned'
      round1AlreadyAwarded, // true if frontend already called awardAircoins for round 1
    } = req.body;

    if (!aircraftBriefId || !gameSessionId) {
      return res.status(400).json({ message: 'aircraftBriefId and gameSessionId required' });
    }

    const settings = await AppSettings.getSettings();
    const won = !!(round1Correct && round2Attempted && round2Correct);

    let aircoinsEarned = 0;
    if (status === 'abandoned') {
      // no coins
    } else if (status === 'round1_only') {
      // User passed round 1 then abandoned — only award round 1 coins if not already given
      if (round1Correct && !round1AlreadyAwarded) aircoinsEarned += (settings.aircoinsWhereAircraftRound1 ?? 5);
    } else {
      // 'completed' — full award logic
      // Skip round 1 coins if frontend already awarded them (to avoid double-notification)
      if (round1Correct && !round1AlreadyAwarded) aircoinsEarned += (settings.aircoinsWhereAircraftRound1 ?? 5);
      if (round2Attempted && round2Correct) {
        aircoinsEarned += (settings.aircoinsWhereAircraftRound2 ?? 10);
        if (round1Correct) aircoinsEarned += (settings.aircoinsWhereAircraftBonus ?? 5); // full completion bonus
      }
    }

    await GameSessionWhereAircraftResult.create({
      userId: req.user._id,
      aircraftBriefId,
      gameSessionId,
      status: status ?? 'completed',
      round1Correct:   !!round1Correct,
      round2Attempted: !!round2Attempted,
      round2Correct:   !!round2Correct,
      selectedBaseIds: selectedBaseIds ?? [],
      correctBaseIds:  correctBaseIds  ?? [],
      won,
      aircoinsEarned,
      timeTakenSeconds: timeTakenSeconds ?? 0,
    });

    let rankPromotion = null;
    if (aircoinsEarned > 0) {
      const coinResult = await awardCoins(
        req.user._id, aircoinsEarned, 'wheres_aircraft',
        `Where's That Aircraft — ${won ? 'full completion' : 'partial'}`,
        aircraftBriefId
      );
      rankPromotion = coinResult.rankPromotion;
    }

    res.status(201).json({ status: 'success', data: { won, aircoinsEarned, rankPromotion } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/history — unified game history across all game types
router.get('/history', protect, async (req, res) => {
  try {
    const userId       = req.user._id;
    const page         = Math.max(1, parseInt(req.query.page)  || 1);
    const limit        = Math.min(50, parseInt(req.query.limit) || 20);
    const typeFilter   = req.query.type   || 'all';
    const resultFilter = req.query.result || 'all';

    const [quizAttempts, whos, oob, flash, whereAircraft, aptitudeSync] = await Promise.all([
      GameSessionQuizAttempt.find({ userId, status: { $in: ['completed', 'abandoned'] } })
        .populate('intelBriefId', 'title')
        .sort({ timeStarted: -1 })
        .lean(),
      GameSessionWheresThatAircraftResult.find({ userId }).sort({ createdAt: -1 }).lean(),
      GameSessionOrderOfBattleResult.find({ userId }).populate({ path: 'gameId', select: 'category difficulty orderType anchorBriefId', populate: { path: 'anchorBriefId', select: 'title' } }).sort({ createdAt: -1 }).lean(),
      GameSessionFlashcardRecallResult.find({ userId }).sort({ createdAt: -1 }).lean(),
      GameSessionWhereAircraftResult.find({ userId })
        .populate('aircraftBriefId', 'title')
        .sort({ createdAt: -1 })
        .lean(),
      AptitudeSyncUsage.find({ userId, $or: [{ completedAt: { $ne: null } }, { abandoned: true }] })
        .populate('briefId', 'title')
        .sort({ _id: -1 })
        .lean(),
    ]);

    const sessions = [
      ...quizAttempts.map(a => {
        let resultCategory;
        if (a.status === 'abandoned')        resultCategory = 'abandoned';
        else if (a.percentageCorrect === 100) resultCategory = 'perfect';
        else if (a.percentageCorrect >= 60)   resultCategory = 'passed';
        else                                  resultCategory = 'failed';
        return {
          _id:              a._id,
          type:             'quiz',
          gameSessionId:    a.gameSessionId,
          date:             a.timeStarted,
          status:           a.status,
          briefTitle:       a.intelBriefId?.title ?? 'Unknown Brief',
          briefId:          a.intelBriefId?._id,
          difficulty:       a.difficulty,
          correctAnswers:   a.correctAnswers,
          totalQuestions:   a.totalQuestions,
          percentageCorrect: a.percentageCorrect,
          aircoinsEarned:   a.aircoinsEarned,
          isFirstAttempt:   a.isFirstAttempt,
          timeTakenSeconds: a.timeFinished && a.timeStarted
            ? Math.round((new Date(a.timeFinished) - new Date(a.timeStarted)) / 1000)
            : null,
          canDrillDown:    a.status === 'completed',
          resultCategory,
        };
      }),
      ...whos.map(r => ({
        _id:             r._id,
        type:            'wheres_that_aircraft',
        gameSessionId:   r.gameSessionId,
        date:            r.createdAt,
        status:          r.isCorrect ? 'correct' : 'incorrect',
        isCorrect:       r.isCorrect,
        userAnswer:      r.userAnswer,
        aircoinsEarned:  r.aircoinsEarned,
        timeTakenSeconds: r.timeTakenSeconds,
        canDrillDown:    false,
        resultCategory:  r.isCorrect ? 'passed' : 'failed',
      })),
      ...whereAircraft.map(r => {
        let resultCategory;
        if (r.status === 'abandoned')    resultCategory = 'abandoned';
        else if (r.won)                  resultCategory = 'perfect';
        else if (r.round1Correct)        resultCategory = 'passed';
        else                             resultCategory = 'failed';
        return {
          _id:             r._id,
          type:            'wheres_aircraft',
          gameSessionId:   r.gameSessionId,
          date:            r.createdAt,
          status:          r.status === 'abandoned' ? 'abandoned' : r.won ? 'won' : r.round1Correct ? 'partial' : 'lost',
          won:             r.won,
          briefTitle:      r.aircraftBriefId?.title ?? 'Unknown Aircraft',
          briefId:         r.aircraftBriefId?._id,
          round1Correct:   r.round1Correct,
          round2Attempted: r.round2Attempted,
          round2Correct:   r.round2Correct,
          aircoinsEarned:  r.aircoinsEarned,
          timeTakenSeconds: r.timeTakenSeconds,
          canDrillDown:    r.status !== 'abandoned',
          resultCategory,
        };
      }),
      ...oob.map(r => ({
        _id:           r._id,
        type:          'order_of_battle',
        date:          r.createdAt,
        status:        r.abandoned ? 'abandoned' : r.won ? 'won' : 'lost',
        won:           r.won,
        abandoned:     r.abandoned,
        briefTitle:    r.gameId?.anchorBriefId?.title ?? null,
        category:      r.gameId?.category,
        difficulty:    r.gameId?.difficulty,
        orderType:     r.gameId?.orderType,
        aircoinsEarned:   r.aircoinsEarned,
        timeTakenSeconds: r.timeTakenSeconds ?? null,
        canDrillDown:     !r.abandoned,
        resultCategory:   r.abandoned ? 'abandoned' : r.won ? 'passed' : 'failed',
      })),
      ...aptitudeSync.map(r => ({
        _id:            r._id,
        type:           'aptitude_sync',
        date:           r.completedAt ?? r._id.getTimestamp(),
        status:         r.abandoned ? 'abandoned' : 'completed',
        briefTitle:     r.briefId?.title ?? 'Unknown Brief',
        briefId:        r.briefId?._id ?? r.briefId,
        aircoinsEarned: r.aircoinsEarned ?? null,
        finalSummary:   r.finalSummary   ?? null,
        knowledgeGaps:  r.knowledgeGaps  ?? null,
        canDrillDown:   !r.abandoned && !!(r.finalSummary || r.knowledgeGaps),
        resultCategory: r.abandoned ? 'abandoned' : 'passed',
      })),
      ...flash.map(r => {
        const recalled         = r.cardResults?.filter(c => c.recalled).length ?? 0;
        const total            = r.cardResults?.length ?? 0;
        const perfect          = recalled === total && total > 0;
        const timeTakenSeconds = r.cardResults?.reduce((sum, c) => sum + (c.timeTakenSeconds ?? 0), 0) ?? 0;
        if (r.abandoned) {
          return {
            _id:             r._id,
            type:            'flashcard',
            gameSessionId:   r.gameSessionId,
            date:            r.createdAt,
            status:          'abandoned',
            recalled,
            cardCount:       total,
            timeTakenSeconds,
            aircoinsEarned:  0,
            canDrillDown:    total > 0,
            resultCategory:  'abandoned',
          };
        }
        return {
          _id:             r._id,
          type:            'flashcard',
          gameSessionId:   r.gameSessionId,
          date:            r.createdAt,
          status:          perfect ? 'perfect' : 'completed',
          recalled,
          cardCount:       total,
          timeTakenSeconds,
          aircoinsEarned:  r.aircoinsEarned,
          canDrillDown:    total > 0,
          resultCategory:  perfect ? 'perfect' : 'passed',
        };
      }),
    ];

    const VALID_TYPES   = ['quiz', 'order_of_battle', 'wheres_aircraft', 'flashcard', 'wheres_that_aircraft', 'aptitude_sync'];
    const VALID_RESULTS = ['perfect', 'passed', 'failed', 'abandoned'];

    const filtered = sessions.filter(s => {
      if (typeFilter   !== 'all' && VALID_TYPES.includes(typeFilter)   && s.type           !== typeFilter)   return false;
      if (resultFilter !== 'all' && VALID_RESULTS.includes(resultFilter) && s.resultCategory !== resultFilter) return false;
      return true;
    });

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total     = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit);
    res.json({ status: 'success', data: { sessions: paginated, total, page, limit } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/history/quiz/:attemptId — per-question drill-down for a completed quiz
router.get('/history/quiz/:attemptId', protect, async (req, res) => {
  try {
    const attempt = await GameSessionQuizAttempt.findOne({
      _id: req.params.attemptId,
      userId: req.user._id,
    }).lean();
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });

    const results = await GameSessionQuizResult.find({
      gameSessionId: attempt.gameSessionId,
      userId: req.user._id,
    }).lean();

    const questionIds = results.map(r => r.questionId);
    const questions   = await GameQuizQuestion.find({ _id: { $in: questionIds } }).lean();
    const qMap        = new Map(questions.map(q => [q._id.toString(), q]));

    const detailed = results
      .filter(r => qMap.has(r.questionId.toString())) // skip orphaned results (question was deleted/regenerated)
      .map(r => {
        const q              = qMap.get(r.questionId.toString());
        const correctId      = q.correctAnswerId?.toString();
        const selectedId     = r.selectedAnswerId?.toString();
        const displayedSet   = new Set((r.displayedAnswerIds || []).map(id => id.toString()));
        const correctAnswer  = q.answers.find(a => a._id.toString() === correctId);
        const selectedAnswer = q.answers.find(a => a._id.toString() === selectedId);
        const displayedAnswers = q.answers
          .filter(a => displayedSet.has(a._id.toString()))
          .map(a => ({ title: a.title, isCorrect: a._id.toString() === correctId, isSelected: a._id.toString() === selectedId }));
        return {
          questionText:       q.question,
          isCorrect:          r.isCorrect,
          timeTakenSeconds:   r.timeTakenSeconds,
          selectedAnswerText: selectedAnswer?.title ?? '—',
          correctAnswerText:  correctAnswer?.title ?? '—',
          displayedAnswers,
        };
      });

    res.json({ status: 'success', data: { attempt, questions: detailed } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/history/battle-of-order/:sessionId — per-choice drill-down for a BOO session
router.get('/history/battle-of-order/:sessionId', protect, async (req, res) => {
  try {
    const session = await GameSessionOrderOfBattleResult.findOne({
      _id: req.params.sessionId,
      userId: req.user._id,
    }).lean();
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const game = await GameOrderOfBattle.findById(session.gameId)
      .populate({ path: 'choices.briefId', select: 'title gameData' })
      .lean();
    if (!game) return res.status(404).json({ message: 'Game not found' });

    const items = game.choices.map(c => {
      const userChoice = session.userChoices.find(uc => uc.choiceId.toString() === c._id.toString());
      return {
        choiceId:     c._id,
        briefTitle:   c.briefId?.title ?? 'Unknown',
        correctOrder: c.correctOrder,
        userOrder:    userChoice?.userOrderNumber ?? null,
        isCorrect:    userChoice?.userOrderNumber === c.correctOrder,
        displayValue: getDisplayValue(game.orderType, c.briefId?.gameData),
      };
    }).sort((a, b) => a.correctOrder - b.correctOrder);

    res.json({ status: 'success', data: {
      won:       session.won,
      abandoned: session.abandoned,
      category:  game.category,
      orderType: game.orderType,
      difficulty: game.difficulty,
      items,
    }});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/history/wheres-aircraft/:sessionId — round breakdown for a WTA session
router.get('/history/wheres-aircraft/:sessionId', protect, async (req, res) => {
  try {
    const session = await GameSessionWhereAircraftResult.findOne({
      _id:    req.params.sessionId,
      userId: req.user._id,
    })
      .populate('aircraftBriefId',  'title')
      .populate('selectedBaseIds',  'title')
      .populate('correctBaseIds',   'title')
      .lean();

    if (!session) return res.status(404).json({ message: 'Session not found' });

    res.json({ status: 'success', data: {
      aircraftName:    session.aircraftBriefId?.title ?? 'Unknown Aircraft',
      status:          session.status,
      round1Correct:   session.round1Correct,
      round2Attempted: session.round2Attempted,
      round2Correct:   session.round2Correct,
      selectedBases:   (session.selectedBaseIds ?? []).map(b => ({ _id: b._id, title: b.title })),
      correctBases:    (session.correctBaseIds  ?? []).map(b => ({ _id: b._id, title: b.title })),
      won:             session.won,
      aircoinsEarned:  session.aircoinsEarned,
    }});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/history/flashcard/:sessionId — per-card drill-down for a flashcard recall session
router.get('/history/flashcard/:sessionId', protect, async (req, res) => {
  try {
    const session = await GameSessionFlashcardRecallResult.findOne({
      _id:    req.params.sessionId,
      userId: req.user._id,
    })
      .populate('cardResults.intelBriefId', 'title descriptionSections')
      .lean();

    if (!session) return res.status(404).json({ message: 'Session not found' });

    const cards = (session.cardResults ?? []).map(c => ({
      briefId:          c.intelBriefId?._id ? String(c.intelBriefId._id) : null,
      briefTitle:       c.intelBriefId?.title ?? 'Unknown Brief',
      contentSnippet:   c.intelBriefId?.descriptionSections?.[3] ?? '',
      recalled:         c.recalled ?? false,
      timeTakenSeconds: c.timeTakenSeconds ?? 0,
    }));

    res.json({ status: 'success', data: { cards, abandoned: session.abandoned ?? false } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── CBAT — Plane Turn: aircraft cutouts for character selection ────────────
// Returns published Aircraft briefs that have a cutout image.
router.get('/cbat/aircraft-cutouts', protect, async (_req, res) => {
  try {
    const Media = require('../models/Media');
    const briefs = await IntelligenceBrief.find({
      category: 'Aircrafts',
      status: 'published',
    })
      .select('title media')
      .populate('media')
      .lean();

    const results = briefs
      .map(b => {
        const img = (b.media || []).find(m => m.cutoutUrl);
        return img ? { briefId: b._id, title: b.title, cutoutUrl: img.cutoutUrl } : null;
      })
      .filter(Boolean);

    res.json({ status: 'success', data: results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
