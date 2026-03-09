const router  = require('express').Router();
const crypto  = require('crypto');
const { protect } = require('../middleware/auth');
const GameSessionQuizResult  = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult    = require('../models/GameSessionOrderOfBattleResult');
const GameSessionWhosAtAircraftResult   = require('../models/GameSessionWhosAtAircraftResult');
const GameSessionFlashcardRecallResult  = require('../models/GameSessionFlashcardRecallResult');
const GameQuizQuestion = require('../models/GameQuizQuestion');
const AppSettings = require('../models/AppSettings');
const User = require('../models/User');
const AircoinLog = require('../models/AircoinLog');
const { awardCoins } = require('../utils/awardCoins');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const GameOrderOfBattle = require('../models/GameOrderOfBattle');
const { BATTLE_CATEGORIES, ORDER_TYPES, REQUIRED_FIELD } = require('../models/GameOrderOfBattle');

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
    case 'start_year':      return gameData.startYear           != null ? String(gameData.startYear)      : null;
    case 'end_year':        return gameData.endYear             != null ? String(gameData.endYear)        : `Ongoing (${cy})`;
    default: return null;
  }
}

// POST /api/games/quiz/start — fetch questions, create attempt, return question set
router.post('/quiz/start', protect, async (req, res) => {
  try {
    const { briefId } = req.body;
    if (!briefId) return res.status(400).json({ message: 'briefId required' });

    const user = await User.findById(req.user._id);
    const difficulty  = user.difficultySetting ?? 'easy';
    const settings    = await AppSettings.getSettings();
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
        breakdown.push({ label: 'PERFECT SCORE BONUS', amount: bonus });
      }
      if (aircoinsEarned > 0) {
        const brief = await IntelligenceBrief.findById(attempt.intelBriefId).select('title').lean();
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

    res.json({ status: 'success', data: { attempt, won, aircoinsEarned, breakdown, isFirstAttempt: attempt.isFirstAttempt, rankPromotion: attempt.rankPromotion ?? null, cycleAircoins: attempt.cycleAircoins ?? null } });
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

    const category   = anchor.category;
    const orderTypes = ORDER_TYPES[category];
    if (!orderTypes) return res.json({ status: 'success', data: { available: false, reason: 'ineligible_category' } });

    const user       = await User.findById(req.user._id).select('difficultySetting').lean();
    const difficulty = user.difficultySetting ?? 'easy';
    const needed     = difficulty === 'medium' ? 5 : 3;

    const options = [];
    for (const orderType of orderTypes) {
      const fieldKey = REQUIRED_FIELD[orderType];
      if (anchor.gameData?.[fieldKey] == null) continue;
      const count = await IntelligenceBrief.countDocuments({
        category,
        [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
      });
      if (count >= needed) options.push({ orderType });
    }

    if (options.length === 0) {
      return res.json({ status: 'success', data: { available: false, reason: 'insufficient_briefs', difficulty } });
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

    const category        = anchor.category;
    const validOrderTypes = ORDER_TYPES[category];
    if (!validOrderTypes?.includes(orderType)) return res.status(400).json({ message: 'Invalid orderType for this category' });

    const fieldKey   = REQUIRED_FIELD[orderType];
    if (anchor.gameData?.[fieldKey] == null) return res.status(400).json({ message: 'Anchor brief missing required game data' });

    const user       = await User.findById(req.user._id).select('difficultySetting').lean();
    const difficulty = user.difficultySetting ?? 'easy';
    const needed     = difficulty === 'medium' ? 5 : 3;

    const pool = await IntelligenceBrief.find({
      category,
      [`gameData.${fieldKey}`]: { $ne: null, $exists: true },
    }).select('_id title media gameData').lean();

    if (pool.length < needed) return res.status(400).json({ message: `Not enough qualifying briefs (need ${needed}, found ${pool.length})` });

    const others         = pool.filter(b => b._id.toString() !== briefId.toString());
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
      if (orderType === 'start_year')      return gd.startYear         ?? Infinity;
      if (orderType === 'end_year')        return gd.endYear           ?? cy;
      return 0;
    };

    const sorted  = [...selected].sort((a, b) => getValue(a) - getValue(b));
    const choices = sorted.map((brief, i) => ({ briefId: brief._id, correctOrder: i + 1 }));

    const game = await GameOrderOfBattle.create({ anchorBriefId: briefId, category, difficulty, orderType, choices });

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
        choiceId:   c._id,
        briefTitle: brief?.title,
        briefMedia: getBriefMedia(brief ?? {}),
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
      userId: req.user._id,
      won: true,
    }).populate({ path: 'gameId', select: 'anchorBriefId orderType difficulty' }).lean();

    const completedOrderTypes = wonResults
      .filter(r => r.gameId?.anchorBriefId?.toString() === briefId)
      .map(r => ({ orderType: r.gameId.orderType, difficulty: r.gameId.difficulty }));

    res.json({ status: 'success', data: { hasCompleted: completedOrderTypes.length > 0, completedOrderTypes } });
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

// POST /api/games/whos-that-aircraft/result
router.post('/whos-that-aircraft/result', protect, async (req, res) => {
  try {
    const { gameId, userAnswer, isCorrect, timeTakenSeconds, gameSessionId } = req.body;

    const settings       = await AppSettings.getSettings();
    const aircoinsEarned = isCorrect ? settings.aircoinsPerWin : 0;

    const result = await GameSessionWhosAtAircraftResult.create({
      userId: req.user._id, gameId, userAnswer, isCorrect, timeTakenSeconds, gameSessionId, aircoinsEarned,
    });

    let rankPromotion = null;
    if (aircoinsEarned > 0) {
      const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'whos_at_aircraft', "Who's That Aircraft — correct identification");
      rankPromotion = coinResult.rankPromotion;
    }

    res.status(201).json({ status: 'success', data: { result, rankPromotion } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/flashcard-recall/result
router.post('/flashcard-recall/result', protect, async (req, res) => {
  try {
    const { gameId, cardResults, gameSessionId } = req.body;

    const settings       = await AppSettings.getSettings();
    const allCorrect     = cardResults.every(c => c.recalled);
    const aircoinsEarned = allCorrect ? (settings.aircoins100Percent ?? 15) : (settings.aircoinsPerWin ?? 10);

    const result = await GameSessionFlashcardRecallResult.create({
      userId: req.user._id, gameId, cardResults, gameSessionId, aircoinsEarned,
    });

    const coinResult  = await awardCoins(req.user._id, aircoinsEarned, 'flashcard', `Flashcard Recall — ${allCorrect ? '100% bonus' : 'completed'}`);

    res.status(201).json({ status: 'success', data: { result, rankPromotion: coinResult.rankPromotion } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/history — unified game history across all game types
router.get('/history', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);

    const [quizAttempts, whos, oob, flash] = await Promise.all([
      GameSessionQuizAttempt.find({ userId, status: { $in: ['completed', 'abandoned'] } })
        .populate('intelBriefId', 'title')
        .sort({ timeStarted: -1 })
        .lean(),
      GameSessionWhosAtAircraftResult.find({ userId }).sort({ createdAt: -1 }).lean(),
      GameSessionOrderOfBattleResult.find({ userId }).populate({ path: 'gameId', select: 'category difficulty orderType anchorBriefId', populate: { path: 'anchorBriefId', select: 'title' } }).sort({ createdAt: -1 }).lean(),
      GameSessionFlashcardRecallResult.find({ userId }).sort({ createdAt: -1 }).lean(),
    ]);

    const sessions = [
      ...quizAttempts.map(a => ({
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
        canDrillDown: a.status === 'completed',
      })),
      ...whos.map(r => ({
        _id:             r._id,
        type:            'whos_at_aircraft',
        gameSessionId:   r.gameSessionId,
        date:            r.createdAt,
        status:          r.isCorrect ? 'correct' : 'incorrect',
        isCorrect:       r.isCorrect,
        userAnswer:      r.userAnswer,
        aircoinsEarned:  r.aircoinsEarned,
        timeTakenSeconds: r.timeTakenSeconds,
        canDrillDown:    false,
      })),
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
      })),
      ...flash.map(r => {
        const recalled = r.cardResults?.filter(c => c.recalled).length ?? 0;
        const total    = r.cardResults?.length ?? 0;
        return {
          _id:             r._id,
          type:            'flashcard',
          gameSessionId:   r.gameSessionId,
          date:            r.createdAt,
          status:          recalled === total && total > 0 ? 'perfect' : 'completed',
          recalled,
          cardCount:       total,
          aircoinsEarned:  r.aircoinsEarned,
          canDrillDown:    false,
        };
      }),
    ];

    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total     = sessions.length;
    const paginated = sessions.slice((page - 1) * limit, page * limit);
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
        const correctAnswer  = q.answers.find(a => a._id.equals(q.correctAnswerId));
        const selectedAnswer = q.answers.find(a => a._id.equals(r.selectedAnswerId));
        const displayedAnswers = q.answers
          .filter(a => r.displayedAnswerIds.some(id => a._id.equals(id)))
          .map(a => ({ title: a.title, isCorrect: a._id.equals(q.correctAnswerId), isSelected: a._id.equals(r.selectedAnswerId) }));
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

module.exports = router;
