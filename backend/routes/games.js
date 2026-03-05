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
    if (status === 'completed' && attempt.isFirstAttempt) {
      const settings  = await AppSettings.getSettings();
      const coinRate  = attempt.difficulty === 'medium'
        ? (settings.aircoinsPerWinMedium ?? 20)
        : (settings.aircoinsPerWinEasy   ?? 10);
      aircoinsEarned  = correct * coinRate;
      if (aircoinsEarned > 0) {
        await User.findByIdAndUpdate(req.user._id, { $inc: { totalAircoins: aircoinsEarned } });
      }
    }

    attempt.status            = status;
    attempt.timeFinished      = new Date();
    attempt.correctAnswers    = correct;
    attempt.percentageCorrect = total > 0 ? Math.round((correct / total) * 100) : 0;
    attempt.aircoinsEarned    = aircoinsEarned;
    await attempt.save();

    res.json({ status: 'success', data: { attempt, aircoinsEarned, isFirstAttempt: attempt.isFirstAttempt } });
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

    if (aircoinsEarned > 0) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { totalAircoins: aircoinsEarned } });
    }

    res.status(201).json({ status: 'success', data: { result } });
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

    if (aircoinsEarned > 0) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { totalAircoins: aircoinsEarned } });
    }

    res.status(201).json({ status: 'success', data: { result } });
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
    const aircoinsEarned = allCorrect ? settings.aircoins100PercentBonus : settings.aircoinsPerWin;

    const result = await GameSessionFlashcardRecallResult.create({
      userId: req.user._id, gameId, cardResults, gameSessionId, aircoinsEarned,
    });

    await User.findByIdAndUpdate(req.user._id, { $inc: { totalAircoins: aircoinsEarned } });

    res.status(201).json({ status: 'success', data: { result } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
