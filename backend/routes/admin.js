const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const ProblemReport = require('../models/ProblemReport');
const AdminAction = require('../models/AdminAction');
const AppSettings = require('../models/AppSettings');
const GameSessionQuizResult           = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt          = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult  = require('../models/GameSessionOrderOfBattleResult');
const AircoinLog             = require('../models/AircoinLog');
const { awardCoins }         = require('../utils/awardCoins');
const IntelligenceBriefRead  = require('../models/IntelligenceBriefRead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const GameQuizQuestion  = require('../models/GameQuizQuestion');
const GameType          = require('../models/GameType');
const Media             = require('../models/Media');
const mongoose          = require('mongoose');
const path              = require('path');
const fs                = require('fs');

const LEADS_FILE = path.join(__dirname, '../../APPLICATION_INFO/intel_brief_leads.txt');

router.use(protect, adminOnly);

// Shared helper — all state-changing actions require a reason
const requireReason = (req, res, next) => {
  if (!req.body.reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required for this action' });
  }
  next();
};

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    const passThresholdEasy   = settings.passThresholdEasy   ?? 60;
    const passThresholdMedium = settings.passThresholdMedium ?? 60;

    const [
      totalUsers, freeUsers, trialUsers, silverUsers, goldUsers,
      easyPlayers, mediumPlayers,
      totalBrifsRead,
      totalGamesPlayed, totalGamesCompleted, totalGamesWon,
      easyLost, mediumLost,
      totalGamesAbandoned,
      aircoinAgg, loginAgg,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ subscriptionTier: 'free' }),
      User.countDocuments({ subscriptionTier: 'trial' }),
      User.countDocuments({ subscriptionTier: 'silver' }),
      User.countDocuments({ subscriptionTier: 'gold' }),
      User.countDocuments({ difficultySetting: 'easy' }),
      User.countDocuments({ difficultySetting: 'medium' }),
      IntelligenceBriefRead.countDocuments(),
      GameSessionQuizAttempt.countDocuments({ status: { $in: ['completed', 'abandoned'] } }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed' }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', percentageCorrect: 100 }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', difficulty: 'easy',   percentageCorrect: { $lt: passThresholdEasy } }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', difficulty: 'medium', percentageCorrect: { $lt: passThresholdMedium } }),
      GameSessionQuizAttempt.countDocuments({ status: 'abandoned' }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$totalAircoins' } } }]),
      User.aggregate([{ $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$logins', []] } } } } }]),
    ]);

    // Combined login streaks — requires virtual, so fetch all users
    const allUsers      = await User.find({}).select('logins');
    const combinedStreaks = allUsers.reduce((sum, u) => sum + (u.loginStreak ?? 0), 0);

    res.json({
      status: 'success',
      data: {
        users: {
          totalUsers, freeUsers, trialUsers,
          subscribedUsers: silverUsers + goldUsers,
          easyPlayers, mediumPlayers,
          totalLogins:      loginAgg[0]?.total ?? 0,
          combinedStreaks,
        },
        games: {
          totalGamesPlayed,
          totalGamesCompleted,
          totalPerfectScores:  totalGamesWon,
          totalGamesLost:      easyLost + mediumLost,
          totalGamesAbandoned,
          totalAircoinsEarned: aircoinAgg[0]?.total ?? 0,
          passThresholdEasy,
          passThresholdMedium,
        },
        briefs: { totalBrifsRead },
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/settings
router.get('/settings', async (_req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    res.json({ status: 'success', data: { settings } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/settings
router.patch('/settings', requireReason, async (req, res) => {
  try {
    const { reason, ...updates } = req.body;
    const settings = await AppSettings.findOneAndUpdate({}, updates, { new: true, upsert: true });

    await AdminAction.create({
      userId: req.user._id,
      actionType: 'change_quiz_questions',
      reason,
    });

    res.json({ status: 'success', data: { settings } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/users — all users, oldest first (first registered at top)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().populate('rank').sort({ createdAt: 1 });
    res.json({ status: 'success', data: { users } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/users/search?q=
router.get('/users/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ message: 'Search query required' });

    const users = await User.find({
      $or: [{ email: new RegExp(q, 'i') }, { agentNumber: q }],
    }).populate('rank').limit(20);

    res.json({ status: 'success', data: { users } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', requireReason, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBanned: true });
    await AdminAction.create({ userId: req.user._id, actionType: 'ban_user', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/self/subscription — admin emulates a subscription tier on their own account
router.patch('/self/subscription', async (req, res) => {
  try {
    const { tier } = req.body;
    const valid = ['free', 'trial', 'silver', 'gold'];
    if (!valid.includes(tier)) return res.status(400).json({ message: 'Invalid tier' });

    const settings = await AppSettings.getSettings();
    const ammoMap = {
      free:   settings.ammoFree   ?? 3,
      trial:  settings.ammoSilver ?? 10,
      silver: settings.ammoSilver ?? 10,
      gold:   9999,
    };

    // Update tier and reset all read record ammo counts for this user
    const [user] = await Promise.all([
      User.findByIdAndUpdate(req.user._id, { subscriptionTier: tier }, { new: true }).select('-password'),
      IntelligenceBriefRead.updateMany({ userId: req.user._id }, { ammunitionRemaining: ammoMap[tier] }),
    ]);

    res.json({ status: 'success', data: { user } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/make-admin
router.post('/users/:id/make-admin', requireReason, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isAdmin: true });
    await AdminAction.create({ userId: req.user._id, actionType: 'make_admin', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/remove-admin
router.post('/users/:id/remove-admin', requireReason, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot remove your own admin access.' });
    }
    await User.findByIdAndUpdate(req.params.id, { isAdmin: false });
    await AdminAction.create({ userId: req.user._id, actionType: 'remove_admin', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/reset-stats
router.post('/users/:id/reset-stats', requireReason, async (req, res) => {
  try {
    const fields = Array.isArray(req.body.fields) ? req.body.fields : ['aircoins', 'gameHistory', 'intelBriefsRead'];
    const userUpdates = {};
    const ops = [];

    if (fields.includes('aircoins'))        { userUpdates.totalAircoins = 0; userUpdates.cycleAircoins = 0; userUpdates.rank = null; ops.push(AircoinLog.deleteMany({ userId: req.params.id })); }
    if (fields.includes('gameHistory'))     { userUpdates.gameTypesSeen = []; ops.push(GameSessionQuizResult.deleteMany({ userId: req.params.id })); ops.push(GameSessionQuizAttempt.deleteMany({ userId: req.params.id })); ops.push(GameSessionOrderOfBattleResult.deleteMany({ userId: req.params.id })); }
    if (fields.includes('intelBriefsRead')) ops.push(IntelligenceBriefRead.deleteMany({ userId: req.params.id }));

    if (Object.keys(userUpdates).length) ops.push(User.findByIdAndUpdate(req.params.id, userUpdates));
    await Promise.all(ops);
    await AdminAction.create({ userId: req.user._id, actionType: 'reset_user_stats', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/award-coins — award test coins to the admin's own account
router.post('/award-coins', async (req, res) => {
  try {
    const { amount } = req.body;
    const parsed = parseInt(amount, 10);
    if (!parsed || parsed <= 0) return res.status(400).json({ message: 'Amount must be a positive integer' });

    const result = await awardCoins(req.user._id, parsed, 'admin', 'Test Coins');

    await AdminAction.create({ userId: req.user._id, actionType: 'award_test_coins', reason: `Awarded ${parsed} test coins to self` });
    res.json({ status: 'success', awarded: parsed, totalAircoins: result.totalAircoins, cycleAircoins: result.cycleAircoins, rankPromotion: result.rankPromotion });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/problems
router.get('/problems', async (req, res) => {
  try {
    const { solved, search } = req.query;
    const filter = {};
    if (solved !== undefined) filter.solved = solved === 'true';
    if (search) filter.description = new RegExp(search, 'i');

    const problems = await ProblemReport.find(filter)
      .populate('userId', 'email agentNumber')
      .sort({ time: -1 });

    res.json({ status: 'success', data: { problems } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/problems/:id/update
router.post('/problems/:id/update', async (req, res) => {
  try {
    const { description, solved } = req.body;
    const update = { $push: { updates: { adminUserId: req.user._id, description } } };
    if (solved !== undefined) update.$set = { solved };

    const report = await ProblemReport.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ status: 'success', data: { report } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Intel Brief CRUD ──────────────────────────────────────────────────────────

// GET /api/admin/briefs
router.get('/briefs', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (search) filter.$or = [
      { title: new RegExp(search, 'i') },
      { subtitle: new RegExp(search, 'i') },
    ];
    const [briefs, total] = await Promise.all([
      IntelligenceBrief.find(filter)
        .populate('media')
        .sort({ dateAdded: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      IntelligenceBrief.countDocuments(filter),
    ]);
    res.json({ status: 'success', data: { briefs, total } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/:id
router.get('/briefs/:id', async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs
router.post('/briefs', requireReason, async (req, res) => {
  try {
    const { reason, ...fields } = req.body;
    const brief = await IntelligenceBrief.create(fields);
    await AdminAction.create({ userId: req.user._id, actionType: 'create_brief', reason });
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/briefs/:id
router.patch('/briefs/:id', requireReason, async (req, res) => {
  try {
    const { reason, ...fields } = req.body;
    const brief = await IntelligenceBrief.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true }).populate('media');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    await AdminAction.create({ userId: req.user._id, actionType: 'edit_brief', reason });
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id
router.delete('/briefs/:id', requireReason, async (req, res) => {
  try {
    const briefId = req.params.id;

    // Collect question IDs before deleting so we can wipe their results
    const questionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: briefId });

    await Promise.all([
      IntelligenceBrief.findByIdAndDelete(briefId),
      IntelligenceBriefRead.deleteMany({ intelBriefId: briefId }),
      GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
      AircoinLog.deleteMany({ briefId }),
    ]);

    await AdminAction.create({ userId: req.user._id, actionType: 'delete_brief', reason: req.body.reason });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/media — add a media item to a brief
router.post('/briefs/:id/media', async (req, res) => {
  try {
    const { mediaType, mediaUrl, showOnSummary } = req.body;
    if (!mediaUrl || !mediaType) return res.status(400).json({ message: 'mediaType and mediaUrl required' });
    const media = await Media.create({ mediaType, mediaUrl: mediaUrl.trim(), showOnSummary: showOnSummary !== false });
    const brief = await IntelligenceBrief.findByIdAndUpdate(
      req.params.id,
      { $push: { media: media._id } },
      { new: true }
    ).populate('media');
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/media/:mediaId — update a media item's URL or type
router.patch('/media/:mediaId', async (req, res) => {
  try {
    const { mediaUrl, mediaType, showOnSummary } = req.body;
    const update = {};
    if (mediaUrl       !== undefined) update.mediaUrl       = mediaUrl.trim();
    if (mediaType      !== undefined) update.mediaType      = mediaType;
    if (showOnSummary  !== undefined) update.showOnSummary  = showOnSummary;
    const media = await Media.findByIdAndUpdate(req.params.mediaId, update, { new: true, runValidators: true });
    if (!media) return res.status(404).json({ message: 'Media not found' });
    res.json({ status: 'success', data: { media } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id/media/:mediaId — remove a media item
router.delete('/briefs/:id/media/:mediaId', async (req, res) => {
  try {
    await IntelligenceBrief.findByIdAndUpdate(req.params.id, { $pull: { media: req.params.mediaId } });
    await Media.findByIdAndDelete(req.params.mediaId);
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/questions/bulk — replace all quiz questions for a brief
router.post('/briefs/:id/questions/bulk', requireReason, async (req, res) => {
  try {
    const { easyQuestions = [], mediumQuestions = [], reason } = req.body;
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const gameType = await GameType.findOne({ gameTitle: 'quiz' });
    if (!gameType) return res.status(500).json({ message: 'Quiz game type not seeded — restart the server' });

    // Wipe results tied to the old questions before replacing them
    const oldQuestionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: req.params.id });
    await Promise.all([
      GameQuizQuestion.deleteMany({ intelBriefId: req.params.id }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: oldQuestionIds } }),
    ]);

    const createQuestions = async (questions, difficulty) => {
      const ids = [];
      for (const q of questions) {
        const answers = q.answers.map(a => ({
          _id: new mongoose.Types.ObjectId(),
          title: a.title,
        }));
        const doc = await GameQuizQuestion.create({
          gameTypeId:      gameType._id,
          intelBriefId:    req.params.id,
          difficulty,
          question:        q.question,
          answers,
          correctAnswerId: answers[q.correctAnswerIndex]?._id ?? answers[0]._id,
        });
        ids.push(doc._id);
      }
      return ids;
    };

    const [easyIds, mediumIds] = await Promise.all([
      createQuestions(easyQuestions, 'easy'),
      createQuestions(mediumQuestions, 'medium'),
    ]);

    brief.quizQuestionsEasy   = easyIds;
    brief.quizQuestionsMedium = mediumIds;
    await brief.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'change_quiz_questions', reason });

    const updatedBrief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    res.json({ status: 'success', data: { brief: updatedBrief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id/questions — remove all quiz questions for a brief
router.delete('/briefs/:id/questions', requireReason, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const questionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: req.params.id });
    await Promise.all([
      GameQuizQuestion.deleteMany({ intelBriefId: req.params.id }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
    ]);
    brief.quizQuestionsEasy   = [];
    brief.quizQuestionsMedium = [];
    await brief.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'change_quiz_questions', reason: req.body.reason });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── OpenRouter AI Proxies ──────────────────────────────────────────────────
// All OpenRouter calls are made server-side so OPENROUTER_KEY never reaches the browser.

async function openRouterChat(messages, model) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title': 'Skywatch',
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function cleanJson(raw) {
  return raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/\[\d+\]/g, '').trim();
}

// POST /api/admin/ai/news-headlines
router.post('/ai/news-headlines', async (req, res) => {
  try {
    const { timestamp } = req.body;
    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a factual news assistant. Only report real, verified news stories that have actually been published. Never invent or fabricate headlines.',
    }, {
      role: 'user',
      content: `The current date and time is ${timestamp}. Search the web right now for real UK Royal Air Force (RAF) news stories published in the last 24 hours only. Return ONLY a JSON array of up to 6 headline strings taken verbatim or closely paraphrased from actual published sources. No fabricated headlines, no citation markers like [1], no markdown, no code blocks, no extra text. If no real RAF stories exist from the last 24 hours, return an empty array []. Format: ["Headline one", "Headline two"]`,
    }], 'perplexity/sonar');
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    const headlines = JSON.parse(cleanJson(raw));
    res.json({ status: 'success', data: { headlines: Array.isArray(headlines) ? headlines : [] } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-brief
router.post('/ai/generate-brief', async (req, res) => {
  try {
    const { headline, topic } = req.body;
    if (!headline && !topic) return res.status(400).json({ message: 'headline or topic required' });

    const JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "title": "concise factual title, max 70 characters",\n  "subtitle": "one factual sentence summarising the subject",\n  "description": "200-300 word factual brief written for RAF trainees. Write in 2-3 paragraphs where appropriate — separate each paragraph with a double newline (\\n\\n) in the JSON string. Only include details confirmed by published sources, no speculation.",\n  "keywords": [\n    {"keyword": "exact word or phrase that appears verbatim in the description above", "generatedDescription": "general RAF-specific definition of this term — e.g. what this aircraft/system/operation is, its role and capabilities — do NOT reference this intel brief"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"},\n    {"keyword": "another exact word or phrase from the description", "generatedDescription": "general RAF-specific definition"}\n  ],\n  "sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}\nCRITICAL RULES:\n1. Write the description first, then extract keywords FROM that description — every keyword string must appear verbatim (exact same spelling and capitalisation) somewhere in the description text.\n2. Return exactly 10 keyword objects.\n3. Prefer technical terms, acronyms, aircraft designations, operation names, and proper nouns.`;

    const TOPIC_JSON_SHAPE = JSON_SHAPE.replace(
      '"sources": [',
      '"historic": <true if this subject is outdated/retired/no longer operationally relevant to the modern RAF — e.g. retired aircraft, concluded operations, obsolete systems, pre-2000 history with no current relevance; false if it has modern-day relevance, is currently in service, or ongoing>,\n  "sources": ['
    );

    const userContent = topic
      ? `Write a comprehensive intelligence brief about this RAF topic: "${topic}"\n\nUsing verified facts from published sources, produce a reference-style brief suitable for RAF trainees learning about this subject — not a news story, but an informative overview covering its role, history, key facts, and RAF significance.\n\n${TOPIC_JSON_SHAPE}`
      : `Search the web for this specific RAF news story: "${headline}"\n\nUsing only verified facts from published sources, return a JSON object for an RAF trainee intelligence brief.\n\n${JSON_SHAPE}`;

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a factual intelligence writer for a Royal Air Force training platform. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
    }, {
      role: 'user',
      content: userContent,
    }], 'perplexity/sonar');
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const brief = JSON.parse(cleanJson(raw));
    // Safety net: discard any keyword that doesn't appear verbatim in the description
    if (Array.isArray(brief.keywords) && brief.description) {
      const desc = brief.description.toLowerCase();
      brief.keywords = brief.keywords.filter(k =>
        k.keyword && desc.includes(k.keyword.toLowerCase())
      );
    }
    res.json({ status: 'success', data: { brief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/intel-leads — parse intel_brief_leads.txt, return topics not yet marked [DB]
router.get('/intel-leads', (req, res) => {
  try {
    const content = fs.readFileSync(LEADS_FILE, 'utf8');
    const lines = content.split('\n');
    const leads = [];
    let currentSection = '';
    let currentSubsection = '';

    const SKIP = /^(SKYWATCH|Comprehensive seeding|All topics|LEGEND|END OF|Total categories|Approximate total|\[DB\]\s*=|News briefs are excluded)/i;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('=')) continue;
      if (/^SECTION \d+:/i.test(trimmed)) { currentSection = trimmed; currentSubsection = ''; continue; }
      if (trimmed.startsWith('---') && trimmed.endsWith('---')) {
        currentSubsection = trimmed.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
        continue;
      }
      if (SKIP.test(trimmed)) continue;
      if (trimmed.endsWith('[DB]')) continue; // already published

      leads.push({ text: trimmed, section: currentSection, subsection: currentSubsection });
    }

    res.json({ status: 'success', data: { leads } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/intel-leads/mark-complete — append [DB] to a lead line in the file
router.post('/intel-leads/mark-complete', (req, res) => {
  try {
    const { lead } = req.body;
    if (!lead) return res.status(400).json({ message: 'lead required' });

    const content = fs.readFileSync(LEADS_FILE, 'utf8');
    let found = false;
    const updated = content.split('\n').map(line => {
      if (line.trim() === lead.trim() && !line.includes('[DB]')) {
        found = true;
        return line.trimEnd() + ' [DB]';
      }
      return line;
    });

    if (!found) return res.status(404).json({ message: 'Lead not found or already marked' });
    fs.writeFileSync(LEADS_FILE, updated.join('\n'), 'utf8');
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-keywords
// Generates up to `needed` additional keywords sourced from the description.
// Existing keyword strings are passed in so the AI doesn't repeat them.
router.post('/ai/generate-keywords', async (req, res) => {
  try {
    const { description, existingKeywords = [], needed = 10 } = req.body;
    if (!description) return res.status(400).json({ message: 'description required' });
    if (needed <= 0)  return res.json({ status: 'success', data: { keywords: [] } });

    const existingList = existingKeywords.length
      ? `Already used (do NOT repeat these): ${existingKeywords.join(', ')}\n\n`
      : '';

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a keyword extractor for a Royal Air Force training platform. You only select terms that appear verbatim in the provided description text. For each keyword you write a general RAF-specific definition of that term — what it is, its role and capabilities — without referencing the specific intel brief it was found in.',
    }, {
      role: 'user',
      content: `Description:\n"""${description}"""\n\n${existingList}Extract exactly ${needed} keywords from the description above. Every keyword string MUST appear verbatim (same spelling and capitalisation) in the description. Choose technical terms, acronyms, aircraft designations, operation names, and proper nouns.\n\nFor "generatedDescription": write a general RAF-specific definition of the term itself (e.g. what that aircraft/system/operation is, its role and capabilities). Do NOT reference or summarise the intel brief — the description should be useful as a standalone glossary entry.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"keywords":[{"keyword":"exact phrase from description","generatedDescription":"general RAF-specific definition of this term"},{"keyword":"...","generatedDescription":"..."}]}`,
    }], 'perplexity/sonar');

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    const desc = description.toLowerCase();
    const existing = new Set(existingKeywords.map(k => k.toLowerCase()));

    const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .filter(k => k.keyword && desc.includes(k.keyword.toLowerCase()) && !existing.has(k.keyword.toLowerCase()))
      .slice(0, needed);

    res.json({ status: 'success', data: { keywords } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-quiz
router.post('/ai/generate-quiz', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title && !description) return res.status(400).json({ message: 'title or description required' });
    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a quiz question writer for a Royal Air Force training platform. Every question you write must be directly and fully answerable using only the information contained in the provided intel brief description — do not rely on external knowledge, general RAF facts, or anything not stated in the description.',
    }, {
      role: 'user',
      content: `Intel Brief Title: ${title}\n\nIntel Brief Description:\n"""\n${description ?? ''}\n"""\n\nUsing ONLY the facts stated in the description above, generate exactly 10 easy and 10 medium quiz questions.\n\nCRITICAL RULES:\n1. Every question must be directly answerable from the description text — if the answer cannot be found in the description, do not include the question.\n2. Easy questions test direct recall of specific facts stated in the description (names, dates, locations, aircraft types, unit designations, etc.).\n3. Medium questions require understanding of context or relationships between facts stated in the description.\n4. The correct answer must be explicitly supported by the description.\n5. Wrong answers must be plausible but clearly incorrect based on the description.\n6. Exactly 10 answer options per question. correctAnswerIndex is the 0-based index of the correct answer.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"easyQuestions":[{"question":"...","answers":[{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."},{"title":"..."}],"correctAnswerIndex":0}],"mediumQuestions":[...]}`,
    }], 'perplexity/sonar');
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const generated = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    res.json({ status: 'success', data: { easyQuestions: generated.easyQuestions ?? [], mediumQuestions: generated.mediumQuestions ?? [] } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/media/brief-image — remove a locally stored brief image from disk
router.delete('/media/brief-image', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.startsWith('/uploads/brief-images/')) {
      return res.status(400).json({ message: 'Invalid or non-local URL' });
    }
    const filePath = path.join(__dirname, '..', url);
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') return res.status(500).json({ message: err.message });
      res.json({ status: 'success' });
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-battle-order-data
// Accepts { title, description, category } and returns the relevant gameData fields for that category.
const BOO_ELIGIBLE = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties'];
router.post('/ai/generate-battle-order-data', async (req, res) => {
  try {
    const { title, description, category } = req.body;
    if (!title && !description) return res.status(400).json({ message: 'title or description required' });
    if (!BOO_ELIGIBLE.includes(category)) {
      return res.status(400).json({ message: `Category "${category}" is not eligible for Battle of Order data` });
    }

    let fieldSpec = '';
    let jsonShape = '';
    if (category === 'Aircrafts') {
      fieldSpec = 'topSpeedKph (integer, cruise/max speed in km/h), yearIntroduced (integer, year RAF first operated this aircraft), yearRetired (integer or null if still in service)';
      jsonShape = '{"topSpeedKph":2400,"yearIntroduced":1976,"yearRetired":null}';
    } else if (category === 'Ranks') {
      fieldSpec = 'rankHierarchyOrder (integer, 1 = most senior e.g. Marshal of the RAF, higher numbers = more junior)';
      jsonShape = '{"rankHierarchyOrder":5}';
    } else if (category === 'Training') {
      fieldSpec = 'trainingWeekStart (integer, the week number in the training pipeline when this phase/element begins), trainingWeekEnd (integer, the week number when this phase/element ends)';
      jsonShape = '{"trainingWeekStart":3,"trainingWeekEnd":5}';
    } else {
      // Missions, Tech, Treaties
      fieldSpec = 'startYear (integer, year this began/was introduced/enacted), endYear (integer or null if still ongoing/in service)';
      jsonShape = '{"startYear":1939,"endYear":1945}';
    }

    const data = await openRouterChat([{
      role: 'system',
      content: 'You are a factual data extractor for a Royal Air Force training platform. You only return verified numeric data based on published facts. Return ONLY valid JSON with no markdown, no code blocks, no extra text.',
    }, {
      role: 'user',
      content: `Extract the following data fields for this RAF "${category}" intel brief:\n\nFields needed: ${fieldSpec}\n\nTitle: "${title}"\nDescription:\n"""\n${description ?? ''}\n"""\n\nReturn ONLY valid JSON — no markdown, no code blocks. Use null for unknown/inapplicable values.\nExample shape: ${jsonShape}`,
    }], 'perplexity/sonar');

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    res.json({ status: 'success', data: { gameData: parsed } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-image
// 1. Ask OpenRouter for the 3 most visually distinct subjects from the title/subtitle
// 2. Fetch Wikipedia thumbnail for each in parallel
// 3. Download and save all found images, return array
router.post('/ai/generate-image', async (req, res) => {
  try {
    const { title, subtitle } = req.body;
    if (!title) return res.status(400).json({ message: 'title is required' });

    // Step 1 — extract 3 distinct search terms
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
        'X-Title': 'Skywatch',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Extract the 3 most visually distinct subjects from this RAF article that are each likely to have their own Wikipedia page with a photograph. Prioritise specific aircraft designations, named bases/locations, named operations, or specific units.\n\nReturn ONLY a JSON array of exactly 3 search terms, e.g. ["Eurofighter Typhoon", "RAF Lossiemouth", "Operation Shader"]\n\nTitle: "${title}"${subtitle ? `\nSubtitle: "${subtitle}"` : ''}`,
        }],
      }),
    });
    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message ?? JSON.stringify(aiData.error));
    const raw = aiData.choices?.[0]?.message?.content?.trim() ?? '[]';
    let terms = [];
    try { terms = JSON.parse(raw.replace(/```json\n?|```/g, '').trim()); } catch { terms = [title]; }
    if (!Array.isArray(terms) || terms.length === 0) terms = [title];
    terms = terms.slice(0, 3);

    // Step 2 — fetch Wikipedia image for each term in parallel
    const dir = path.join(__dirname, '..', 'uploads', 'brief-images');
    fs.mkdirSync(dir, { recursive: true });

    const fetchOneImage = async (term, idx) => {
      const searchRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&srlimit=1&origin=*`
      );
      const searchData = await searchRes.json();
      const pageTitle  = searchData.query?.search?.[0]?.title;
      if (!pageTitle) throw new Error(`No Wikipedia page for "${term}"`);

      const thumbRes  = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`
      );
      const thumbData = await thumbRes.json();
      const imageUrl  = Object.values(thumbData.query?.pages ?? {})[0]?.thumbnail?.source;
      if (!imageUrl) throw new Error(`No image on Wikipedia for "${pageTitle}"`);

      const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'Skywatch/1.0 (educational-platform)' } });
      if (!imgRes.ok) throw new Error(`Download failed (${imgRes.status})`);
      const buffer   = Buffer.from(await imgRes.arrayBuffer());
      const ext      = /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.exec(imageUrl)?.[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      const filename = `brief-${Date.now()}-${idx}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);

      return { url: `/uploads/brief-images/${filename}`, term, wikiPage: pageTitle };
    };

    const results = await Promise.allSettled(terms.map((term, i) => fetchOneImage(term, i)));
    const images  = results.filter(r => r.status === 'fulfilled').map(r => r.value);

    if (images.length === 0) throw new Error('Could not find Wikipedia images for any of the extracted subjects');

    res.json({ status: 'success', data: { images } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/save-generated-image — receive base64 image from browser and save it locally
router.post('/save-generated-image', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ message: 'imageBase64 required' });

    const buffer   = Buffer.from(imageBase64, 'base64');
    const dir      = path.join(__dirname, '..', 'uploads', 'brief-images');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `brief-${Date.now()}.png`;
    fs.writeFileSync(path.join(dir, filename), buffer);

    res.json({ status: 'success', data: { url: `/uploads/brief-images/${filename}` } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
