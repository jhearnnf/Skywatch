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

    // Award coins only on first completion
    let aircoinsEarned = 0;
    const breakdown = [];
    if (status === 'completed' && attempt.isFirstAttempt) {
      const settings  = await AppSettings.getSettings();
      const coinRate  = attempt.difficulty === 'medium'
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
    attempt.timeFinished      = new Date();
    attempt.correctAnswers    = correct;
    attempt.percentageCorrect = total > 0 ? Math.round((correct / total) * 100) : 0;
    attempt.aircoinsEarned    = aircoinsEarned;
    await attempt.save();

    res.json({ status: 'success', data: { attempt, aircoinsEarned, breakdown, isFirstAttempt: attempt.isFirstAttempt, rankPromotion: attempt.rankPromotion ?? null, cycleAircoins: attempt.cycleAircoins ?? null } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/games/quiz/completed-brief-ids — all briefIds this user has ever completed a quiz for
router.get('/quiz/completed-brief-ids', protect, async (req, res) => {
  try {
    const attempts = await GameSessionQuizAttempt.find({
      userId: req.user._id,
      status: 'completed',
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
    });
    res.json({ status: 'success', data: { hasCompleted: !!completed } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/order-of-battle/result
router.post('/order-of-battle/result', protect, async (req, res) => {
  try {
    const { gameId, userSubmittedOrder, isCorrect, timeTakenSeconds, gameSessionId } = req.body;

    const settings       = await AppSettings.getSettings();
    const aircoinsEarned = isCorrect ? settings.aircoinsPerWin : 0;

    const result = await GameSessionOrderOfBattleResult.create({
      userId: req.user._id, gameId, userSubmittedOrder, isCorrect, timeTakenSeconds, gameSessionId, aircoinsEarned,
    });

    let rankPromotion = null;
    if (aircoinsEarned > 0) {
      const coinResult = await awardCoins(req.user._id, aircoinsEarned, 'order_of_battle', 'Order of Battle — correct sequence');
      rankPromotion = coinResult.rankPromotion;
    }

    res.status(201).json({ status: 'success', data: { result, rankPromotion } });
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
      GameSessionOrderOfBattleResult.find({ userId }).sort({ createdAt: -1 }).lean(),
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
        _id:             r._id,
        type:            'order_of_battle',
        gameSessionId:   r.gameSessionId,
        date:            r.createdAt,
        status:          r.isCorrect ? 'correct' : 'incorrect',
        isCorrect:       r.isCorrect,
        aircoinsEarned:  r.aircoinsEarned,
        timeTakenSeconds: r.timeTakenSeconds,
        canDrillDown:    false,
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

module.exports = router;
