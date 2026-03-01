const router = require('express').Router();
const { protect } = require('../middleware/auth');
const GameSessionQuizResult = require('../models/GameSessionQuizResult');
const GameSessionOrderOfBattleResult = require('../models/GameSessionOrderOfBattleResult');
const GameSessionWhosAtAircraftResult = require('../models/GameSessionWhosAtAircraftResult');
const GameSessionFlashcardRecallResult = require('../models/GameSessionFlashcardRecallResult');
const AppSettings = require('../models/AppSettings');
const User = require('../models/User');

// POST /api/games/quiz/result — save quiz question result
router.post('/quiz/result', protect, async (req, res) => {
  try {
    const { questionId, displayedQuestionIds, displayedAnswerIds, selectedAnswerId, timeTakenSeconds, isCorrect, gameSessionId } = req.body;

    const settings = await AppSettings.getSettings();
    const aircoinsEarned = isCorrect ? settings.aircoinsPerWin : 0;

    const result = await GameSessionQuizResult.create({
      userId: req.user._id,
      questionId,
      displayedQuestionIds,
      displayedAnswerIds,
      selectedAnswerId,
      timeTakenSeconds,
      isCorrect,
      gameSessionId,
      aircoinsEarned,
    });

    if (aircoinsEarned > 0) {
      await User.findByIdAndUpdate(req.user._id, { $inc: { totalAircoins: aircoinsEarned } });
    }

    res.status(201).json({ status: 'success', data: { result } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/games/order-of-battle/result
router.post('/order-of-battle/result', protect, async (req, res) => {
  try {
    const { gameId, userSubmittedOrder, isCorrect, timeTakenSeconds, gameSessionId } = req.body;

    const settings = await AppSettings.getSettings();
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

    const settings = await AppSettings.getSettings();
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

    const settings = await AppSettings.getSettings();
    const allCorrect = cardResults.every(c => c.recalled);
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
