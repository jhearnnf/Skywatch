const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const GameSessionQuizResult = require('../models/GameSessionQuizResult');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const ProblemReport = require('../models/ProblemReport');

// GET /api/users/stats — current user's stats for profile page
router.get('/stats', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('rank');

    const brifsRead = await IntelligenceBriefRead.countDocuments({ userId: req.user._id });

    const quizResults = await GameSessionQuizResult.find({ userId: req.user._id });
    const gamesPlayed = quizResults.length;
    const gamesWon = quizResults.filter(r => r.isCorrect).length;
    const winPercent = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;

    res.json({
      status: 'success',
      data: {
        agentNumber: user.agentNumber,
        subscriptionTier: user.subscriptionTier,
        rank: user.rank,
        brifsRead,
        gamesPlayed,
        winPercent,
        totalAircoins: user.totalAircoins,
      },
    });
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

module.exports = router;
