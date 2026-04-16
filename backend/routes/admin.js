const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const ProblemReport = require('../models/ProblemReport');
const AdminAction = require('../models/AdminAction');
const EmailLog    = require('../models/EmailLog');
const AppSettings = require('../models/AppSettings');
const { sendWelcomeEmail, sendReportReplyEmail } = require('../utils/email');
const UserNotification = require('../models/UserNotification');
const GameSessionQuizResult               = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt              = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult      = require('../models/GameSessionOrderOfBattleResult');
const GameWheresThatAircraft                  = require('../models/GameWheresThatAircraft');
const GameSessionWheresThatAircraftResult     = require('../models/GameSessionWheresThatAircraftResult');
const GameOrderOfBattle                   = require('../models/GameOrderOfBattle');
const GameFlashcardRecall                 = require('../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult    = require('../models/GameSessionFlashcardRecallResult');
const GameSessionWhereAircraftResult      = require('../models/GameSessionWhereAircraftResult');
const AircoinLog             = require('../models/AircoinLog');
const { awardCoins, getCycleThreshold, CYCLE_THRESHOLD } = require('../utils/awardCoins');
const Rank  = require('../models/Rank');
const Level = require('../models/Level');
const IntelligenceBriefRead  = require('../models/IntelligenceBriefRead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { CATEGORIES, SUBCATEGORIES } = require('../constants/categories');
const GameQuizQuestion  = require('../models/GameQuizQuestion');
const GameType          = require('../models/GameType');
const Media             = require('../models/Media');
const mongoose          = require('mongoose');
const crypto            = require('crypto');
const { uploadBuffer, destroyAsset } = require('../utils/cloudinary');
const { generateBriefImages } = require('../utils/briefImages');
const { extractSubjectToCloudinary } = require('../utils/extractCutout');
const IntelLead = require('../models/IntelLead');
const seedLeads = require('../seeds/seedLeads');
const { scanMentionedBriefIds } = require('../utils/mentionedBriefs');
const { autoLinkKeywords, buildTitleRejectCheck } = require('../utils/keywordLinking');
const { reprioritizeCategory } = require('../utils/priorityRanking');
const SystemLog                = require('../models/SystemLog');
const AptitudeSyncUsage        = require('../models/AptitudeSyncUsage');
const { enrichSourceDates }    = require('../utils/scrapeArticleDate');

// ── Shared quiz prompt fragments ──────────────────────────────────────────────
// Single source of truth for answer format rules and core question rules,
// embedded in every system prompt and user message that generates quiz content.

const QUIZ_ANSWER_FORMAT_RULES = 'Answer options must never include the attribute being asked about in the question — e.g. if the question asks which squadron operates a specific aircraft, all answer options must be plain squadron names/numbers only, with no aircraft type appended. Do not add parenthetical qualifiers (e.g. "(A400M Atlas)", "(Voyager)") to any answer option. All options must follow the same plain format.';

const QUIZ_QUESTION_RULES = `CRITICAL RULES:\n1. Every question must be directly answerable from the description text — if the answer cannot be found in the description, do not include the question.\n2. The correct answer must be explicitly supported by the description.\n3. Wrong answers must be plausible but clearly incorrect based on the description.\n4. Exactly 7 answer options per question. correctAnswerIndex is the 0-based index of the correct answer.\n5. Wrong answers must be complete sentences or meaningful phrases (minimum 5 words each) — never single words, never just a number or acronym alone.\n6. The correct answer must also be a complete sentence or meaningful phrase drawn directly from the description.\n7. ${QUIZ_ANSWER_FORMAT_RULES}`;

function getDifficultyLabel(difficulty) {
  return difficulty === 'medium'
    ? 'medium (require understanding of context or relationships between facts in the description)'
    : 'easy (test direct recall of the most important specific facts: names, dates, locations, aircraft types, unit designations, etc.)';
}

// ── AI prompt defaults ────────────────────────────────────────────────────────
// These are the canonical system prompts used throughout the AI generation
// routes. Each key maps to AppSettings.aiPrompts — an absent or empty value
// falls back to the string below. Edit via GET/PATCH /api/admin/ai-prompts.
const AI_PROMPT_DEFAULTS = {
  // Content generation
  'brief.news':              'You are a factual intelligence writer for a Royal Air Force news platform. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
  'brief.topic':             'You are a factual intelligence writer for a Royal Air Force training platform. Prioritise content that builds genuine understanding of the modern RAF: in-depth training pathways and what each phase involves, RAF bases and which aircraft/squadrons are stationed there and what operations occur there, different roles and how they relate to specific training blocks, and the operational context of aircraft, equipment, and missions. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
  'brief.actors':            'You are writing a factual operational dossier on a named individual of UK defence interest. Stick to verifiable facts: full name, current role or title, appointment date, chain of command, remit, notable operational decisions or actions, and the region, organisation, or force they influence. Do NOT include political commentary, moral judgement, ideology, or speculation about intent. Where the individual is deceased, removed, or has stepped down, state the date and their successor. Tone: neutral intelligence-summary style suitable for someone building foundational situational awareness of the modern operating environment. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail. If a fact cannot be confirmed from a real source, omit it.',
  'brief.threats':           'You are writing a factual threat assessment for a Royal Air Force training platform. Focus on adversary capability, how the threat is employed operationally, and the UK / NATO counter-response (aircraft, weapons, tactics, bases, squadrons involved). Cover: origin and operator, technical specifications that matter operationally (range, speed, payload, seeker type where relevant), typical employment doctrine, and the RAF or allied assets that counter it. Keep the focus on what a junior officer would need to recognise and respond to — not geopolitical commentary. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail. If a fact cannot be confirmed from a real source, omit it.',
  'brief.terminology':       'You are writing a factual RAF terminology entry for a training platform. Lead with a short, plain-English definition of the term. Then explain how the term is used in the briefing room or operational context, with concrete examples (which aircraft, which phase of flight, which planning cycle, which tactical situation). Keep it definition-first and example-driven — not an essay. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail. If a fact cannot be confirmed from a real source, omit it.',
  'brief.treaties':          'You are writing a factual entry on a defence treaty, alliance, or agreement for a Royal Air Force training platform. Cover: signatories, date of signing, core obligations (especially mutual defence or basing/overflight rights), enforcement or triggering mechanism, current status, and specific UK implications — what RAF assets, bases, or operations does this treaty enable or constrain. Keep the framing legal and structural, not operational narrative. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail. If a fact cannot be confirmed from a real source, omit it.',
  'regenerateBrief':         'You are a factual intelligence writer for a Royal Air Force training platform. Prioritise content that builds genuine understanding of the modern RAF: in-depth training pathways and what each phase involves, RAF bases and which aircraft/squadrons are stationed there and what operations occur there, different roles and how they relate to specific training blocks, and the operational context of aircraft, equipment, and missions. You only write content based on verified, published facts retrieved from the web. You never invent, speculate, or fabricate any detail — not dates, names, figures, locations, or outcomes. If a fact cannot be confirmed from a real source, omit it.',
  // Quiz generation
  'quiz':                    `You are a quiz question writer for a Royal Air Force training platform. Prioritise the most important and high-value facts from the brief — operational capabilities, training pathways and their phases, aircraft designations and roles, base locations and resident units, command structures, and key distinguishing facts that define this subject. Questions should test knowledge that builds genuine understanding of the RAF, not trivial details. Every question must be directly and fully answerable using only the information in the provided intel brief description — do not rely on external knowledge or anything not stated in the description. ANSWER FORMAT RULES: ${QUIZ_ANSWER_FORMAT_RULES}`,
  'quizMissing':             `You are a quiz question writer for a Royal Air Force training platform. Prioritise the most important and high-value facts from the brief — operational capabilities, training pathways and their phases, aircraft designations and roles, base locations and resident units, command structures, and key distinguishing facts that define this subject. Questions should test knowledge that builds genuine understanding of the RAF, not trivial details. Every question must be directly and fully answerable using only the information in the provided intel brief description — do not rely on external knowledge or anything not stated in the description. You will be given a list of existing questions — do not repeat or closely paraphrase any of them. ANSWER FORMAT RULES: ${QUIZ_ANSWER_FORMAT_RULES}`,
  // Keywords
  'keywords':                'You are a keyword extractor for a Royal Air Force training platform. Prioritise terms that build understanding of the modern RAF — training pathways, bases, aircraft, squadrons, roles, and operational context. You only select terms that appear verbatim in the provided description text. For each keyword you write a general RAF-specific definition of that term — what it is, its role and capabilities — without referencing the specific intel brief it was found in.',
  // Linking — current
  'links.Aircrafts:bases':     'You are an expert on Royal Air Force aircraft and bases. Given an aircraft brief, identify which RAF bases are home/primary operating bases for this aircraft. Only select bases where this aircraft type is permanently stationed.',
  'links.Aircrafts:squadrons': 'You are an expert on Royal Air Force aircraft and squadrons. Given an aircraft brief, identify which RAF squadrons operate this aircraft type as their primary platform.',
  'links.Aircrafts:missions':  'You are an expert on Royal Air Force operations and aircraft. Given an aircraft brief, identify which RAF operations or missions this aircraft type participated in from the list provided.',
  'links.Squadrons:bases':     'You are an expert on Royal Air Force squadrons and bases. Given a squadron brief, identify which RAF bases this squadron is primarily stationed at.',
  'links.Squadrons:aircraft':  'You are an expert on Royal Air Force squadrons and aircraft. Given a squadron brief, identify which aircraft types from the list this squadron operates or historically operated.',
  'links.Squadrons:missions':  'You are an expert on Royal Air Force squadrons and operations. Given a squadron brief, identify which operations or missions this squadron participated in from the list provided.',
  'links.Bases:squadrons':     'You are an expert on Royal Air Force bases and squadrons. Given a base brief, identify which RAF squadrons are or were stationed at this base.',
  'links.Bases:aircraft':      'You are an expert on Royal Air Force bases and aircraft. Given a base brief, identify which aircraft types from the list are or were based at this location.',
  'links.Roles:training':      'You are an expert on Royal Air Force careers and training pipelines. Given a role brief, identify which training programmes from the list are required or directly relevant to this role\'s career pathway.',
  'links.Tech:aircraft':       'You are an expert on Royal Air Force technology and aircraft. Given a technology or weapon system brief, identify which aircraft from the list carry or use this system.',
  'links.Actors:aor':          'You are an intelligence analyst. Given a brief on a named individual (head of state, commander, or non-state leader), identify which areas of responsibility (AOR) from the list they most directly influence through their role, forces, or organisation. Only select AORs with a direct, verifiable operational connection.',
  // Linking — historic
  'links.historic.Aircrafts:bases':     'You are an expert on Royal Air Force aircraft and bases. Given a HISTORIC aircraft brief, identify which RAF bases historically served as home or primary operating bases for this aircraft type during its service life.',
  'links.historic.Aircrafts:squadrons': 'You are an expert on Royal Air Force aircraft and squadrons. Given a HISTORIC aircraft brief, identify which RAF squadrons historically operated this aircraft type as their primary platform.',
  'links.historic.Aircrafts:missions':  'You are an expert on Royal Air Force operations and aircraft. Given a HISTORIC aircraft brief, identify which RAF operations or missions this aircraft type participated in from the list provided.',
  'links.historic.Squadrons:bases':     'You are an expert on Royal Air Force squadrons and bases. Given a HISTORIC squadron brief, identify which RAF bases this squadron was historically stationed at during its service.',
  'links.historic.Squadrons:aircraft':  'You are an expert on Royal Air Force squadrons and aircraft. Given a HISTORIC squadron brief, identify which aircraft types from the list this squadron historically operated.',
  'links.historic.Squadrons:missions':  'You are an expert on Royal Air Force squadrons and operations. Given a HISTORIC squadron brief, identify which operations or missions this squadron participated in from the list provided.',
  'links.historic.Bases:squadrons':     'You are an expert on Royal Air Force bases and squadrons. Given a HISTORIC base brief, identify which RAF squadrons were historically stationed at this base.',
  'links.historic.Bases:aircraft':      'You are an expert on Royal Air Force bases and aircraft. Given a HISTORIC base brief, identify which aircraft types from the list were historically based at this location.',
  // Bases
  'bases.current':           'You are an expert on Royal Air Force aircraft and their operating bases. Given an aircraft brief and a list of RAF base briefs, identify which bases are home bases for that aircraft. Only select bases where the aircraft is currently stationed or has a known permanent/primary operating presence. Return ONLY valid JSON — no markdown, no code blocks.',
  'bases.historic':          'You are an expert on Royal Air Force aircraft and their operating bases. Given a HISTORIC aircraft brief and a list of RAF base briefs, identify which bases historically served as home or primary operating bases for this aircraft type during its service life. Return ONLY valid JSON — no markdown, no code blocks.',
  // Utility
  'newsHeadlines':           'You are a factual news assistant. Only report real, verified news stories that have actually been published. Never invent or fabricate headlines.',
  'battleOrderData':         'You are a factual data extractor for a Royal Air Force training platform. You only return verified numeric data based on published facts. Return ONLY valid JSON with no markdown, no code blocks, no extra text.',
  'imageExtraction':         'Extract the 2 most visually distinct subjects from this RAF article that are each likely to have their own Wikipedia page with a photograph. Prioritise specific aircraft designations, named bases/locations, named operations, or specific units.\n\nReturn ONLY a JSON array of exactly 2 search terms, e.g. ["Eurofighter Typhoon", "RAF Lossiemouth"]',
  // Mnemonics
  'mnemonic.single':         'You are a memory coach creating strikingly memorable mnemonics for RAF applicants (18–25). Your goal is a mnemonic so vivid it cannot be forgotten. TECHNIQUE: exploit what that number MEANS — its cultural weight, symbolism, or universal associations (e.g. 18 = finally an adult, 21 = key to the door, 007 = James Bond, 2020 = perfect vision, 42 = answer to life). Then anchor it to a movie quote, video game moment, TV catchphrase, or famous phrase that reinforces that meaning. Prioritise in this order: (1) iconic movie quotes or scenes, (2) video game references, (3) TV show catchphrases or moments, (4) famous phrases or cultural touchstones. The number MUST carry its own meaning in the sentence — not just appear in it. Write one punchy sentence, max 20 words. Return ONLY the plain sentence — no markdown, no asterisks, no bold, no italics, no preamble, no quotes, no citation markers.',
  'mnemonic.batch':          'You are a memory coach creating strikingly memorable mnemonics for RAF applicants (18–25). Your goal is a mnemonic so vivid it cannot be forgotten. TECHNIQUE: exploit what that number MEANS — its cultural weight, symbolism, or universal associations (e.g. 18 = finally an adult, 21 = key to the door, 007 = James Bond, 2020 = perfect vision, 42 = answer to life). Then anchor it to a movie quote, video game moment, TV catchphrase, or famous phrase that reinforces that meaning. Prioritise in this order: (1) iconic movie quotes or scenes, (2) video game references, (3) TV show catchphrases or moments, (4) famous phrases or cultural touchstones. The number MUST carry its own meaning in the sentence — not just appear in it. Each mnemonic must be a single plain-text sentence, max 20 words — no markdown, no asterisks, no bold, no italics, no citation markers.',
};

// Returns the DB override if set, otherwise the hardcoded default.
function getPrompt(settings, key) {
  const override = settings?.aiPrompts?.get?.(key);
  return (override && override.trim()) ? override : AI_PROMPT_DEFAULTS[key];
}

// Per-category system prompt resolver for topic (non-news) brief generation.
// Categories without a tuned prompt fall back to the shared 'brief.topic'.
const TOPIC_PROMPT_BY_CATEGORY = {
  Actors:      'brief.actors',
  Threats:     'brief.threats',
  Terminology: 'brief.terminology',
  Treaties:    'brief.treaties',
};
function getTopicPrompt(settings, category) {
  const key = TOPIC_PROMPT_BY_CATEGORY[category] || 'brief.topic';
  return getPrompt(settings, key);
}

function normaliseLeadTitle(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Returns { matched: bool, error: string|null }
async function unmarkLeadInDb(briefTitle) {
  try {
    const norm  = normaliseLeadTitle(briefTitle);
    const leads = await IntelLead.find({ isPublished: true }).select('title');
    const match = leads.find(l => normaliseLeadTitle(l.title) === norm);
    if (!match) return { matched: false, error: null };
    await IntelLead.updateOne({ _id: match._id }, { isPublished: false });
    return { matched: true, error: null };
  } catch (err) {
    return { matched: false, error: err.message };
  }
}

// POST /api/admin/loading-time — open (no auth), accumulates frontend fetch durations
router.post('/loading-time', async (req, res) => {
  try {
    const { durationMs } = req.body;
    if (typeof durationMs !== 'number' || durationMs < 0 || durationMs > 300000) {
      return res.status(400).json({ message: 'Invalid durationMs' });
    }
    await AppSettings.findOneAndUpdate({}, { $inc: { totalLoadingMs: durationMs } }, { upsert: true });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.use(protect, adminOnly);

// Shared helper — all state-changing actions require a reason
const requireReason = (req, res, next) => {
  if (!req.body.reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required for this action' });
  }
  next();
};

// GET /api/admin/actions?page=1&limit=20&type=ban_user
router.get('/actions', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.type) filter.actionType = req.query.type;

    const [actions, total] = await Promise.all([
      AdminAction.find(filter)
        .sort({ time: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId',       'agentNumber email')
        .populate('targetUserId', 'agentNumber email')
        .lean(),
      AdminAction.countDocuments(filter),
    ]);

    res.json({ status: 'success', data: { actions, total, page, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/stats
router.get('/stats', async (_req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    const passThresholdEasy   = settings.passThresholdEasy   ?? 60;
    const passThresholdMedium = settings.passThresholdMedium ?? 60;

    const [
      totalUsers, freeUsers, trialUsers, silverUsers, goldUsers,
      easyPlayers, mediumPlayers,
      totalBrifsRead, totalBrifsOpened, readTimeAgg,
      totalGamesPlayed, totalGamesCompleted, totalPerfectScores, totalGamesWon,
      easyLost, mediumLost,
      totalGamesAbandoned,
      aircoinAgg, loginAgg,
      quizTimeAgg,
      booTotal, booWon, booDefeated, booAbandoned, booTimeAgg,
      wtaTotal, wtaWon, wtaAbandoned, wtaRound1Correct, wtaRound2Correct, wtaTimeAgg,
      flashTotal, flashRecalled, flashSessions, flashAbandoned, flashTimeAgg,
      tutorialAgg,
      aptitudeSyncTotal,
      aptitudeSyncCompleted,
      aptitudeSyncAircoinsAgg,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ subscriptionTier: 'free' }),
      User.countDocuments({ subscriptionTier: 'trial' }),
      User.countDocuments({ subscriptionTier: 'silver' }),
      User.countDocuments({ subscriptionTier: 'gold' }),
      User.countDocuments({ difficultySetting: 'easy' }),
      User.countDocuments({ difficultySetting: 'medium' }),
      IntelligenceBriefRead.countDocuments({ completed: true }),
      IntelligenceBriefRead.countDocuments({ completed: false }),
      IntelligenceBriefRead.aggregate([{ $group: { _id: null, total: { $sum: '$timeSpentSeconds' } } }]),
      GameSessionQuizAttempt.countDocuments({ status: { $in: ['completed', 'abandoned'] } }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed' }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', percentageCorrect: 100 }),
      GameSessionQuizAttempt.countDocuments({ won: true }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', difficulty: 'easy',   percentageCorrect: { $lt: passThresholdEasy } }),
      GameSessionQuizAttempt.countDocuments({ status: 'completed', difficulty: 'medium', percentageCorrect: { $lt: passThresholdMedium } }),
      GameSessionQuizAttempt.countDocuments({ status: 'abandoned' }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$totalAircoins' } } }]),
      User.aggregate([{ $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$logins', []] } } } } }]),
      // Quiz: sum time for attempts that have both timeStarted and timeFinished
      GameSessionQuizAttempt.aggregate([
        { $match: { timeFinished: { $ne: null } } },
        { $group: { _id: null, total: { $sum: { $divide: [{ $subtract: ['$timeFinished', '$timeStarted'] }, 1000] } } } },
      ]),
      // BOO counts
      GameSessionOrderOfBattleResult.countDocuments(),
      GameSessionOrderOfBattleResult.countDocuments({ won: true,  abandoned: { $ne: true } }),
      GameSessionOrderOfBattleResult.countDocuments({ won: false, abandoned: { $ne: true } }),
      GameSessionOrderOfBattleResult.countDocuments({ abandoned: true }),
      // BOO: sum timeTakenSeconds (null entries treated as 0)
      GameSessionOrderOfBattleResult.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ['$timeTakenSeconds', 0] } } } },
      ]),
      // Where's That Aircraft (WhereAircraftResult)
      GameSessionWhereAircraftResult.countDocuments(),
      GameSessionWhereAircraftResult.countDocuments({ won: true }),
      GameSessionWhereAircraftResult.countDocuments({ status: 'abandoned' }),
      GameSessionWhereAircraftResult.countDocuments({ round1Correct: true }),
      GameSessionWhereAircraftResult.countDocuments({ round2Correct: true }),
      GameSessionWhereAircraftResult.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ['$timeTakenSeconds', 0] } } } },
      ]),
      // Flashcard Recall
      GameSessionFlashcardRecallResult.aggregate([
        { $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$cardResults', []] } } } } },
      ]),
      GameSessionFlashcardRecallResult.aggregate([
        { $unwind: '$cardResults' },
        { $group: { _id: null, total: { $sum: { $cond: ['$cardResults.recalled', 1, 0] } } } },
      ]),
      GameSessionFlashcardRecallResult.countDocuments({ abandoned: { $ne: true } }),
      GameSessionFlashcardRecallResult.countDocuments({ abandoned: true }),
      // Flashcard: sum per-card timeTakenSeconds
      GameSessionFlashcardRecallResult.aggregate([
        { $unwind: '$cardResults' },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$cardResults.timeTakenSeconds', 0] } } } },
      ]),
      // Tutorial viewed/skipped counts across all users and all 4 tutorial fields
      User.aggregate([{
        $group: {
          _id: null,
          viewed: { $sum: { $add: [
            { $cond: [{ $eq: ['$tutorials.welcome',     'viewed'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.intel_brief', 'viewed'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.user',        'viewed'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.load_up',     'viewed'] }, 1, 0] },
          ]}},
          skipped: { $sum: { $add: [
            { $cond: [{ $eq: ['$tutorials.welcome',     'skipped'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.intel_brief', 'skipped'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.user',        'skipped'] }, 1, 0] },
            { $cond: [{ $eq: ['$tutorials.load_up',     'skipped'] }, 1, 0] },
          ]}},
        },
      }]),
      // AptitudeSync
      AptitudeSyncUsage.countDocuments(),
      AptitudeSyncUsage.countDocuments({ completedAt: { $ne: null } }),
      AptitudeSyncUsage.aggregate([{ $group: { _id: null, total: { $sum: { $ifNull: ['$aircoinsEarned', 0] } } } }]),
    ]);

    const aptitudeSyncAbandoned = aptitudeSyncTotal - aptitudeSyncCompleted;

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
          totalGamesPlayed:    totalGamesPlayed    + aptitudeSyncCompleted + aptitudeSyncAbandoned,
          totalGamesCompleted: totalGamesCompleted + aptitudeSyncCompleted,
          totalGamesWon,
          totalPerfectScores,
          totalGamesLost:      easyLost + mediumLost,
          totalGamesAbandoned: totalGamesAbandoned + aptitudeSyncAbandoned,
          totalAircoinsEarned: aircoinAgg[0]?.total ?? 0,
          passThresholdEasy,
          passThresholdMedium,
          quizTotalSeconds: Math.round(quizTimeAgg[0]?.total ?? 0),
          boo: {
            total:     booTotal,
            won:       booWon,
            defeated:  booDefeated,
            abandoned: booAbandoned,
            totalSeconds: booTimeAgg[0]?.total ?? 0,
          },
          wta: {
            total:         wtaTotal,
            won:           wtaWon,
            abandoned:     wtaAbandoned,
            round1Correct: wtaRound1Correct,
            round2Correct: wtaRound2Correct,
            totalSeconds:  wtaTimeAgg[0]?.total ?? 0,
          },
          flashcard: {
            sessions:     flashSessions,
            totalCards:   flashTotal[0]?.total    ?? 0,
            recalled:     flashRecalled[0]?.total ?? 0,
            abandoned:    flashAbandoned,
            totalSeconds: Math.round(flashTimeAgg[0]?.total ?? 0),
          },
          aptitudeSync: {
            total:          aptitudeSyncTotal,
            completed:      aptitudeSyncCompleted,
            abandoned:      aptitudeSyncAbandoned,
            aircoinsEarned: aptitudeSyncAircoinsAgg[0]?.total ?? 0,
          },
        },
        briefs: { totalBrifsRead, totalBrifsOpened, totalReadSeconds: readTimeAgg[0]?.total ?? 0 },
        tutorials: {
          viewed:  tutorialAgg[0]?.viewed  ?? 0,
          skipped: tutorialAgg[0]?.skipped ?? 0,
        },
        server: {
          serverUptimeSeconds: Math.floor(process.uptime()),
          totalLoadingMs: settings.totalLoadingMs ?? 0,
        },
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
    const settings = await AppSettings.findOneAndUpdate({}, updates, { returnDocument: 'after', upsert: true });
    // Mixed field tutorialContent needs explicit mark after findOneAndUpdate via set,
    // but findOneAndUpdate at the DB level handles it correctly already.

    const updatedKeys = Object.keys(updates);
    const actionType = (() => {
      if (updatedKeys.includes('betaTesterAutoGold')) return 'change_beta_settings';
      if (updatedKeys.some(k => k.startsWith('volume') || k.startsWith('soundEnabled') || k.startsWith('duration'))) return 'change_sound_settings';
      if (updatedKeys.some(k => k.startsWith('ammo') || k.startsWith('aircoins') || k === 'trialDurationDays')) return 'change_economy_settings';
      if (updatedKeys.some(k => k.startsWith('passThreshold') || k.endsWith('AnswerCount') || k.startsWith('easyAnswer') || k.startsWith('mediumAnswer'))) return 'change_quiz_settings';
      if (updatedKeys.some(k => k === 'tutorialContent')) return 'edit_tutorial_content';
      if (updatedKeys.some(k => k.startsWith('pathway') || k.endsWith('Categories'))) return 'change_pathway_settings';
      if (updatedKeys.some(k => k.startsWith('email') || k.startsWith('welcome') || k.startsWith('combatReadiness'))) return 'change_content_settings';
      if (updatedKeys.some(k => k.startsWith('aiKeywords') || k.startsWith('aiQuestions') || k.startsWith('aiPrompts'))) return 'change_ai_settings';
      return 'change_app_settings';
    })();

    await AdminAction.create({
      userId: req.user._id,
      actionType,
      reason,
    });

    res.json({ status: 'success', data: { settings } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/ai-prompts — return all prompts (DB overrides merged over defaults)
router.get('/ai-prompts', async (_req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    const prompts = {};
    for (const key of Object.keys(AI_PROMPT_DEFAULTS)) {
      const override = settings.aiPrompts?.get?.(key);
      prompts[key] = (override && override.trim()) ? override : AI_PROMPT_DEFAULTS[key];
    }
    res.json({ status: 'success', data: { prompts, defaults: AI_PROMPT_DEFAULTS } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/ai-prompts — save one or more prompt overrides
// Body: { prompts: { 'brief.news': '...', ... } }
// Send empty string to restore a prompt to its default.
router.patch('/ai-prompts', async (req, res) => {
  try {
    const { prompts } = req.body;
    if (!prompts || typeof prompts !== 'object') return res.status(400).json({ message: 'prompts object required' });
    const settings = await AppSettings.findOne() ?? await AppSettings.create({});
    for (const [key, value] of Object.entries(prompts)) {
      if (!(key in AI_PROMPT_DEFAULTS)) continue; // ignore unknown keys
      settings.aiPrompts.set(key, typeof value === 'string' ? value : '');
    }
    settings.markModified('aiPrompts');
    await settings.save();
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/test-email — sends a test welcome email to the admin's own address
router.post('/test-email', async (req, res) => {
  try {
    await sendWelcomeEmail({ email: req.user.email, agentNumber: req.user.agentNumber, userId: req.user._id });
    res.json({ status: 'success', message: `Test email sent to ${req.user.email}` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// PATCH /api/admin/tutorials/content — save an override for one tutorial step
// Body: { key: 'welcome_0', title, body, guestBody (optional) }
// Send title/body as empty string to clear the override for that field.
router.patch('/tutorials/content', requireReason, async (req, res) => {
  try {
    const { key, title, body, emoji, guestBody, reason } = req.body;
    const VALID_KEYS = ['welcome_0','welcome_1','intel_brief_0','user_0','user_1','load_up_0'];
    if (!VALID_KEYS.includes(key)) return res.status(400).json({ message: 'Invalid tutorial key' });

    // Build the override object; omit guestBody unless it was provided
    const override = { title: title ?? '', body: body ?? '', emoji: emoji ?? '' };
    if (guestBody !== undefined) override.guestBody = guestBody;

    const settings = await AppSettings.findOne() ?? await AppSettings.create({});
    const existing = settings.tutorialContent ?? {};
    existing[key] = override;
    settings.tutorialContent = existing;
    settings.markModified('tutorialContent');
    await settings.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'edit_tutorial_content', reason });
    res.json({ status: 'success', data: { tutorialContent: settings.tutorialContent } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper — attach profileStats to a list of User documents
async function enrichUsersWithStats(users) {
  if (!users.length) return [];
  const userIds = users.map(u => u._id);

  const [briefCounts, quizCounts, booCounts, wtaCounts, whereCounts, flashCounts] = await Promise.all([
    IntelligenceBriefRead.aggregate([
      { $match: { userId: { $in: userIds }, completed: true } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]),
    GameSessionQuizAttempt.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId',
          total:     { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          abandoned: { $sum: { $cond: [{ $eq: ['$status', 'abandoned'] }, 1, 0] } },
      }},
    ]),
    GameSessionOrderOfBattleResult.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId',
          total:    { $sum: 1 },
          won:      { $sum: { $cond: ['$won',      1, 0] } },
          abandoned:{ $sum: { $cond: ['$abandoned', 1, 0] } },
      }},
    ]),
    GameSessionWheresThatAircraftResult.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', total: { $sum: 1 } } },
    ]),
    GameSessionWhereAircraftResult.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', total: { $sum: 1 } } },
    ]),
    GameSessionFlashcardRecallResult.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', total: { $sum: 1 } } },
    ]),
  ]);

  const briefMap = Object.fromEntries(briefCounts.map(b  => [b._id.toString(), b.count]));
  const quizMap  = Object.fromEntries(quizCounts.map(q   => [q._id.toString(), q]));
  const booMap   = Object.fromEntries(booCounts.map(b    => [b._id.toString(), b]));
  const wtaMap   = Object.fromEntries(wtaCounts.map(w    => [w._id.toString(), w.total]));
  const whereMap = Object.fromEntries(whereCounts.map(w  => [w._id.toString(), w.total]));
  const flashMap = Object.fromEntries(flashCounts.map(f  => [f._id.toString(), f.total]));

  return users.map(u => {
    const plain = u.toObject({ virtuals: true });
    const uid   = plain._id.toString();
    return {
      ...plain,
      profileStats: {
        brifsRead:        briefMap[uid]          ?? 0,
        quizzesPlayed:    quizMap[uid]?.total     ?? 0,
        quizzesCompleted: quizMap[uid]?.completed ?? 0,
        quizzesAbandoned: quizMap[uid]?.abandoned ?? 0,
        booPlayed:        booMap[uid]?.total      ?? 0,
        booWon:           booMap[uid]?.won        ?? 0,
        booAbandoned:     booMap[uid]?.abandoned  ?? 0,
        wtaPlayed:        wtaMap[uid]            ?? 0,
        wherePlayed:      whereMap[uid]          ?? 0,
        flashcardsPlayed: flashMap[uid]          ?? 0,
      },
    };
  });
}

// GET /api/admin/users — all users, oldest first (first registered at top)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().populate('rank').sort({ createdAt: 1 });
    res.json({ status: 'success', data: { users: await enrichUsersWithStats(users) } });
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

    res.json({ status: 'success', data: { users: await enrichUsersWithStats(users) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', requireReason, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot ban your own account.' });
    }
    await User.findByIdAndUpdate(req.params.id, { isBanned: true });
    await AdminAction.create({ userId: req.user._id, actionType: 'ban_user', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', requireReason, async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, { isBanned: false }, { returnDocument: 'after' });
    if (!updated) return res.status(404).json({ message: 'User not found.' });
    await AdminAction.create({ userId: req.user._id, actionType: 'unban_user', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/users/:id/aircoins/history — paginated aircoin history for any user
router.get('/users/:id/aircoins/history', async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const userId = req.params.id;

    const [logs, total, user] = await Promise.all([
      AircoinLog.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      AircoinLog.countDocuments({ userId }),
      User.findById(userId).select('totalAircoins agentNumber').lean(),
    ]);

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ status: 'success', data: { logs, total, page: Number(page), limit: Number(limit), user } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/users/:id — permanently delete a user and all their data
router.delete('/users/:id', requireReason, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    const userId = req.params.id;
    await Promise.all([
      AircoinLog.deleteMany({ userId }),
      GameSessionQuizResult.deleteMany({ userId }),
      GameSessionQuizAttempt.deleteMany({ userId }),
      GameSessionOrderOfBattleResult.deleteMany({ userId }),
      IntelligenceBriefRead.deleteMany({ userId }),
      ProblemReport.deleteMany({ userId }),
    ]);
    await User.findByIdAndDelete(userId);
    await AdminAction.create({ userId: req.user._id, actionType: 'delete_user', reason: req.body.reason, targetUserId: userId });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/users/:id/subscription — change a user's subscription tier
router.patch('/users/:id/subscription', requireReason, async (req, res) => {
  try {
    const { tier } = req.body;
    const valid = ['free', 'trial', 'silver', 'gold'];
    if (!valid.includes(tier)) return res.status(400).json({ message: 'Invalid tier' });

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    const settings = await AppSettings.getSettings();
    const ammoMap = {
      free:   settings.ammoFree   ?? 0,
      trial:  settings.ammoSilver ?? 10,
      silver: settings.ammoSilver ?? 10,
      gold:   9999,
    };

    const tierUpdate = { subscriptionTier: tier };
    if (tier === 'trial') {
      tierUpdate.trialStartDate    = new Date();
      tierUpdate.trialDurationDays = settings.trialDurationDays ?? 7;
    }

    const [user] = await Promise.all([
      User.findByIdAndUpdate(req.params.id, tierUpdate, { returnDocument: 'after' }).select('-password').populate('rank'),
      IntelligenceBriefRead.updateMany({ userId: req.params.id }, { ammunitionRemaining: ammoMap[tier] }),
    ]);

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'change_subscription',
      reason:       req.body.reason,
      targetUserId: req.params.id,
    });

    res.json({ status: 'success', data: { user } });
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

    // When setting trial tier, activate the trial window so isTrialActive returns true
    const tierUpdate = { subscriptionTier: tier };
    if (tier === 'trial') {
      tierUpdate.trialStartDate    = new Date();
      tierUpdate.trialDurationDays = settings.trialDurationDays ?? 7;
    }

    // Update tier and reset all read record ammo counts for this user
    const [user] = await Promise.all([
      User.findByIdAndUpdate(req.user._id, tierUpdate, { returnDocument: 'after' }).select('-password').populate('rank'),
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

// Reset gameHistory: deletes the user's session records AND the
// per-session game-definition docs they created (flashcard decks, BOO games),
// so reset actually wipes everything. GameWheresThatAircraft is content
// (seeded), not user-generated, so it's left alone. A game-definition doc
// is only deleted if no other user's sessions still reference it.
async function cleanupUserGameHistory(userId) {
  const [flashGameIds, booGameIds] = await Promise.all([
    GameSessionFlashcardRecallResult.distinct('gameId', { userId }),
    GameSessionOrderOfBattleResult.distinct('gameId', { userId }),
  ]);

  await Promise.all([
    GameSessionQuizResult.deleteMany({ userId }),
    GameSessionQuizAttempt.deleteMany({ userId }),
    GameSessionOrderOfBattleResult.deleteMany({ userId }),
    GameSessionWheresThatAircraftResult.deleteMany({ userId }),
    GameSessionWhereAircraftResult.deleteMany({ userId }),
    GameSessionFlashcardRecallResult.deleteMany({ userId }),
    AptitudeSyncUsage.deleteMany({ userId }),
  ]);

  const [flashStillReferenced, booStillReferenced] = await Promise.all([
    flashGameIds.length
      ? GameSessionFlashcardRecallResult.distinct('gameId', { gameId: { $in: flashGameIds } })
      : [],
    booGameIds.length
      ? GameSessionOrderOfBattleResult.distinct('gameId', { gameId: { $in: booGameIds } })
      : [],
  ]);
  const flashRefSet = new Set(flashStillReferenced.map(String));
  const booRefSet   = new Set(booStillReferenced.map(String));
  const flashOrphans = flashGameIds.filter(id => !flashRefSet.has(String(id)));
  const booOrphans   = booGameIds.filter(id => !booRefSet.has(String(id)));

  await Promise.all([
    flashOrphans.length ? GameFlashcardRecall.deleteMany({ _id: { $in: flashOrphans } }) : Promise.resolve(),
    booOrphans.length   ? GameOrderOfBattle.deleteMany({ _id: { $in: booOrphans } })     : Promise.resolve(),
  ]);
}

// POST /api/admin/users/:id/reset-stats
router.post('/users/:id/reset-stats', requireReason, async (req, res) => {
  try {
    const fields = Array.isArray(req.body.fields) ? req.body.fields : ['aircoins', 'gameHistory', 'intelBriefsRead'];
    const userUpdates = {};
    const ops = [];

    if (fields.includes('aircoins')) {
      const acRank = await Rank.findOne({ rankNumber: 1 }).select('_id');
      userUpdates.totalAircoins = 0;
      userUpdates.cycleAircoins = 0;
      userUpdates.rank = acRank?._id ?? null;
      ops.push(AircoinLog.deleteMany({ userId: req.params.id }));
    }
    if (fields.includes('gameHistory')) {
      userUpdates.gameTypesSeen = [];
      await cleanupUserGameHistory(req.params.id);
    }
    if (fields.includes('streak'))          { userUpdates.loginStreak = 0; userUpdates.lastStreakDate = null; }
    if (fields.includes('intelBriefsRead')) {
      userUpdates.loginStreak    = 0;
      userUpdates.lastStreakDate = null;
      ops.push(IntelligenceBriefRead.deleteMany({ userId: req.params.id }));
    }
    if (fields.includes('tutorials')) {
      // Fetch the user to derive tutorial keys dynamically from the schema —
      // so any new tutorial field added to User.js is automatically reset here.
      const tutUser = await User.findById(req.params.id).select('tutorials');
      userUpdates.tutorialsResetAt = new Date();
      for (const k of Object.keys(tutUser?.tutorials?.toObject() ?? {})) {
        userUpdates[`tutorials.${k}`] = 'unseen';
      }
    }
    if (fields.includes('gameBadges')) {
      ops.push(User.findByIdAndUpdate(req.params.id, { $unset: { gameUnlocks: '' } }));
    }

    if (Object.keys(userUpdates).length) ops.push(User.findByIdAndUpdate(req.params.id, userUpdates));
    await Promise.all(ops);
    await AdminAction.create({ userId: req.user._id, actionType: 'reset_user_stats', reason: req.body.reason, targetUserId: req.params.id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/reset-game-badges
router.post('/users/:id/reset-game-badges', requireReason, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { $unset: { gameUnlocks: '' } });
    await AdminAction.create({ userId: req.user._id, actionType: 'reset_game_badges', reason: req.body.reason, targetUserId: req.params.id });
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

// POST /api/admin/users/:id/award-coins — award aircoins to any user
router.post('/users/:id/award-coins', requireReason, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const parsed = parseInt(amount, 10);
    if (!parsed || parsed <= 0) return res.status(400).json({ message: 'Amount must be a positive integer' });

    const target = await User.findById(req.params.id).select('_id agentNumber');
    if (!target) return res.status(404).json({ message: 'User not found' });

    const result = await awardCoins(target._id, parsed, 'admin', reason || 'Admin Award');

    await AdminAction.create({ userId: req.user._id, actionType: 'award_coins_to_user', reason: `Awarded ${parsed} coins to Agent ${target.agentNumber}: ${reason}`, targetUserId: target._id });
    res.json({ status: 'success', awarded: parsed, totalAircoins: result.totalAircoins, cycleAircoins: result.cycleAircoins, rankPromotion: result.rankPromotion });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── SYSTEM LOGS ───────────────────────────────────────────────────────────────

// GET /api/admin/system-logs/count — unresolved count for tab badge
router.get('/system-logs/count', async (req, res) => {
  try {
    const unresolvedCount = await SystemLog.countDocuments({ resolved: false });
    res.json({ status: 'success', data: { unresolvedCount } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/system-logs?page=1&limit=20&resolved=false
router.get('/system-logs', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const filter = {};
    if (req.query.resolved !== undefined) filter.resolved = req.query.resolved === 'true';

    const [logs, total] = await Promise.all([
      SystemLog.find(filter)
        .sort({ time: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SystemLog.countDocuments(filter),
    ]);

    res.json({ status: 'success', data: { logs, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/system-logs/:id/resolve
router.patch('/system-logs/:id/resolve', async (req, res) => {
  try {
    const log = await SystemLog.findByIdAndUpdate(
      req.params.id,
      { resolved: true },
      { returnDocument: 'after' }
    );
    if (!log) return res.status(404).json({ message: 'Log not found' });
    res.json({ status: 'success', data: { log } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/system-logs/:id/retry
// Currently only supports priority_ranking_failure — re-runs reprioritizeCategory
// for the failed category and, if every lead in that category now has a
// priorityNumber, marks the log resolved.
router.post('/system-logs/:id/retry', async (req, res) => {
  try {
    const log = await SystemLog.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    if (log.type !== 'priority_ranking_failure') {
      return res.status(400).json({ message: `Retry not supported for log type "${log.type}"` });
    }

    await reprioritizeCategory(
      log.category,
      log.newStubs || [],
      log.sourceBriefId,
      log.sourceBriefTitle,
      openRouterChat,
    );

    // Success check: no unranked leads left in that category.
    const stillUnranked = await IntelLead.countDocuments({
      category: log.category,
      priorityNumber: null,
    });

    if (stillUnranked === 0) {
      log.resolved = true;
      await log.save();
      return res.json({ status: 'success', data: { resolved: true, stillUnranked: 0 } });
    }

    res.json({ status: 'success', data: { resolved: false, stillUnranked } });
  } catch (err) {
    console.error('[system-logs retry] error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/problems/count — unsolved report count for tab badge
router.get('/problems/count', async (req, res) => {
  try {
    const unsolvedCount = await ProblemReport.countDocuments({ solved: false });
    res.json({ status: 'success', data: { unsolvedCount } });
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
      .populate('updates.adminUserId', 'agentNumber email')
      .sort({ time: -1 });

    res.json({ status: 'success', data: { problems } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/problems/:id/update
router.post('/problems/:id/update', async (req, res) => {
  try {
    const { description, solved, notifyUser, sendEmail } = req.body;

    const isUserVisible = notifyUser === true;
    const updateEntry   = { adminUserId: req.user._id, description, isUserVisible, emailSent: false };

    const mongoUpdate = { $push: { updates: updateEntry } };
    if (solved !== undefined) mongoUpdate.$set = { solved };

    const report = await ProblemReport.findByIdAndUpdate(req.params.id, mongoUpdate, { returnDocument: 'after' })
      .populate('userId', 'email agentNumber');

    if (isUserVisible && report?.userId) {
      const { email, agentNumber } = report.userId;

      if (sendEmail) {
        // Fire email — errors caught inside sendReportReplyEmail
        await sendReportReplyEmail({
          email,
          agentNumber,
          pageReported: report.pageReported,
          replyMessage: description,
        });
        // Mark the update entry as email-sent
        await ProblemReport.updateOne(
          { _id: report._id },
          { $set: { [`updates.${report.updates.length - 1}.emailSent`]: true } }
        );
      } else {
        // In-app notification
        await UserNotification.create({
          userId:          report.userId._id,
          type:            'report_reply',
          title:           'Update on your report',
          message:         description,
          relatedReportId: report._id,
        });
      }
    }

    res.json({ status: 'success', data: { report } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Intel Brief CRUD ──────────────────────────────────────────────────────────

// GET /api/admin/briefs
router.get('/briefs', async (req, res) => {
  try {
    const { search, category, subcategory, page = 1, limit = 20, sort = 'default', hideStubs } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (subcategory && category) filter.subcategory = subcategory;
    if (hideStubs === 'true' || hideStubs === '1') filter.status = { $ne: 'stub' };
    if (search) filter.$or = [
      { title: new RegExp(search, 'i') },
      { subtitle: new RegExp(search, 'i') },
    ];
    const skip = (Number(page) - 1) * Number(limit);

    // Thresholds for "uncompleted-*" sorts mirror the K/Q/D status pills in
    // Admin.jsx: a brief is "complete" only when its counts meet these limits.
    const settings = await AppSettings.getSettings();
    const keywordsPerBrief       = settings?.aiKeywordsPerBrief ?? 20;
    const questionsPerDifficulty = settings?.aiQuestionsPerDifficulty ?? 7;
    const descriptionSectionMin  = 4;

    const sortStage =
      sort === 'newest' ? { updatedAt: -1 }
      : sort === 'oldest' ? { updatedAt:  1 }
      : sort === 'no-priority' ? { _isNews: 1, _hasPriority: 1, updatedAt: -1 }
      : sort === 'uncompleted-keywords'    ? { _incompleteKeywords: -1, updatedAt: -1 }
      : sort === 'uncompleted-questions'   ? { _incompleteQuestions: -1, updatedAt: -1 }
      : sort === 'uncompleted-description' ? { _incompleteDescription: -1, updatedAt: -1 }
      : { _effectivePublishedAt: -1, _id: -1 };

    const [briefs, total] = await Promise.all([
      IntelligenceBrief.aggregate([
        { $match: filter },
        { $lookup: { from: Media.collection.name, localField: 'media', foreignField: '_id', as: 'media' } },
        { $addFields: {
          // Default sort uses publishedAt desc, so briefs appear in the order
          // they were marked published. Stubs have no publishedAt and fall to
          // the bottom (null sorts last in desc order). For published briefs
          // predating this field, fall back to updatedAt so they still sort.
          _effectivePublishedAt: {
            $cond: [
              { $eq: ['$status', 'published'] },
              { $ifNull: ['$publishedAt', '$updatedAt'] },
              null,
            ],
          },
          _hasPriority: {
            $cond: [{ $ne: [{ $ifNull: ['$priorityNumber', null] }, null] }, 1, 0],
          },
          _isNews: { $cond: [{ $eq: ['$category', 'News'] }, 1, 0] },
          _incompleteKeywords: {
            $cond: [
              { $lt: [{ $size: { $ifNull: ['$keywords', []] } }, keywordsPerBrief] },
              1,
              0,
            ],
          },
          _incompleteDescription: {
            $cond: [
              {
                $lt: [
                  {
                    $size: {
                      $filter: {
                        input: { $ifNull: ['$descriptionSections', []] },
                        as: 's',
                        cond: {
                          $gt: [
                            { $strLenCP: { $ifNull: [{ $trim: { input: '$$s' } }, ''] } },
                            0,
                          ],
                        },
                      },
                    },
                  },
                  descriptionSectionMin,
                ],
              },
              1,
              0,
            ],
          },
          _incompleteQuestions: {
            $cond: [
              {
                $or: [
                  { $lt: [{ $size: { $ifNull: ['$quizQuestionsEasy', []] } }, questionsPerDifficulty] },
                  { $lt: [{ $size: { $ifNull: ['$quizQuestionsMedium', []] } }, questionsPerDifficulty] },
                ],
              },
              1,
              0,
            ],
          },
        }},
        { $sort: sortStage },
        { $skip: skip },
        { $limit: Number(limit) },
      ]),
      IntelligenceBrief.countDocuments(filter),
    ]);
    res.json({ status: 'success', data: { briefs, total } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/stubs-for-bulk
// Returns the next N stub briefs per category, ordered by priorityNumber ASC (nulls last) then createdAt ASC.
router.get('/briefs/stubs-for-bulk', async (req, res) => {
  try {
    const { categories = '', countPerCategory = '5' } = req.query;
    const categoriesArray = categories.split(',').map(c => c.trim()).filter(Boolean);
    const count = Math.max(1, Math.min(50, parseInt(countPerCategory, 10) || 5));
    if (!categoriesArray.length) return res.json({ status: 'success', data: { stubs: [] } });

    const stubs = await IntelligenceBrief
      .find({ status: 'stub', category: { $in: categoriesArray } }, 'title category priorityNumber createdAt')
      .lean();

    // Group by category, sort each group by priority (null last) then creation date, take top N
    const grouped = {};
    for (const s of stubs) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push(s);
    }
    const result = [];
    for (const cat of categoriesArray) {
      const group = grouped[cat] ?? [];
      group.sort((a, b) => {
        const pa = a.priorityNumber ?? Infinity;
        const pb = b.priorityNumber ?? Infinity;
        if (pa !== pb) return pa - pb;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      result.push(...group.slice(0, count));
    }
    res.json({ status: 'success', data: { stubs: result } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/titles — lightweight title list for duplicate detection
router.get('/briefs/titles', async (_req, res) => {
  try {
    const briefs = await IntelligenceBrief.find({}).select('title').lean();
    res.json({ status: 'success', data: { titles: briefs.map(b => ({ _id: b._id, title: b.title })) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/duplicates — find all briefs with duplicate normalised titles
router.get('/briefs/duplicates', async (req, res) => {
  try {
    const briefs = await IntelligenceBrief.find({}, '_id title category dateAdded status').lean();
    const groups = {};
    for (const b of briefs) {
      const key = b.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    const duplicates = Object.values(groups)
      .filter(g => g.length > 1)
      .map(g => g.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)));
    res.json({ status: 'success', data: { duplicates } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/briefs/related-pool — lightweight list for the Related Briefs picker
// Excludes categories covered by typed link pickers (Bases/Squadrons/Aircrafts/Missions/Training)
const TYPED_LINK_CATEGORIES = ['Bases', 'Squadrons', 'Aircrafts', 'Missions', 'Training'];
router.get('/briefs/related-pool', async (_req, res) => {
  try {
    const briefs = await IntelligenceBrief
      .find({ category: { $nin: TYPED_LINK_CATEGORIES } })
      .select('title category status')
      .sort({ category: 1, title: 1 })
      .lean();
    res.json({ status: 'success', data: { briefs } });
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
      .populate('quizQuestionsMedium')
      .populate({ path: 'keywords.linkedBriefId', select: 'title' });
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
    if (fields.category && !CATEGORIES.includes(fields.category)) {
      return res.status(400).json({ message: `Invalid category "${fields.category}". Must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (fields.subcategory && fields.category) {
      const validSubs = SUBCATEGORIES[fields.category] ?? [];
      if (validSubs.length > 0 && !validSubs.includes(fields.subcategory)) {
        return res.status(400).json({ message: `"${fields.subcategory}" is not a valid subcategory for ${fields.category}` });
      }
    }
    let existing = null;
    if (fields.title && fields.category) {
      existing = await IntelligenceBrief.findOne({
        title: { $regex: new RegExp(`^${fields.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        category: fields.category,
      });
      if (existing && existing.status === 'published') {
        return res.status(409).json({ message: `A brief titled "${fields.title}" already exists in ${fields.category}` });
      }
    }
    let brief;
    if (existing && existing.status === 'stub') {
      // Promote stub to published brief in place, preserving its _id so all
      // existing cross-references (associatedAircraftBriefIds etc.) stay valid.
      const mergeIds = (old, incoming = []) => {
        const seen = new Set(old.map(String));
        return [...old, ...incoming.filter(id => !seen.has(String(id)))];
      };
      const upgradedFields = {
        ...fields,
        status: 'published',
        publishedAt: existing.publishedAt ?? new Date(),
        associatedBaseBriefIds:     mergeIds(existing.associatedBaseBriefIds,     fields.associatedBaseBriefIds),
        associatedSquadronBriefIds: mergeIds(existing.associatedSquadronBriefIds, fields.associatedSquadronBriefIds),
        associatedAircraftBriefIds: mergeIds(existing.associatedAircraftBriefIds, fields.associatedAircraftBriefIds),
        associatedMissionBriefIds:  mergeIds(existing.associatedMissionBriefIds,  fields.associatedMissionBriefIds),
        associatedTrainingBriefIds: mergeIds(existing.associatedTrainingBriefIds, fields.associatedTrainingBriefIds),
        relatedBriefIds:            mergeIds(existing.relatedBriefIds,            fields.relatedBriefIds),
        relatedHistoric:            mergeIds(existing.relatedHistoric ?? [],       fields.relatedHistoric),
      };
      brief = await IntelligenceBrief.findByIdAndUpdate(
        existing._id,
        upgradedFields,
        { returnDocument: 'after', runValidators: true }
      ).populate('media');
    } else {
      const createFields = { ...fields };
      if ((createFields.status ?? 'published') === 'published' && !createFields.publishedAt) {
        createFields.publishedAt = new Date();
      }
      brief = await IntelligenceBrief.create(createFields);
    }
    // If the saved brief is historic, push its _id into relatedHistoric on all linked target briefs
    if (brief.historic) {
      const targetIds = [
        ...(brief.associatedBaseBriefIds     ?? []),
        ...(brief.associatedSquadronBriefIds ?? []),
        ...(brief.associatedAircraftBriefIds ?? []),
        ...(brief.associatedMissionBriefIds  ?? []),
      ].filter(id => id);
      if (targetIds.length > 0) {
        await IntelligenceBrief.updateMany(
          { _id: { $in: targetIds } },
          { $addToSet: { relatedHistoric: brief._id } }
        );
      }
    }
    // Scan for text-mentioned briefs if description was provided at creation time
    if (fields.descriptionSections?.length) {
      try {
        const mentionedIds = await scanMentionedBriefIds(brief, openRouterChat);
        if (mentionedIds.length) {
          await IntelligenceBrief.findByIdAndUpdate(brief._id, { mentionedBriefIds: mentionedIds });
          brief.mentionedBriefIds = mentionedIds;
        }
      } catch (scanErr) {
        console.error('[POST briefs] mentionedBriefIds scan failed (non-fatal):', scanErr.message);
      }
    }

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
    if (fields.status === 'published') {
      const existing = await IntelligenceBrief.findById(req.params.id).select('publishedAt').lean();
      if (existing && !existing.publishedAt) fields.publishedAt = new Date();
    }
    const brief = await IntelligenceBrief.findByIdAndUpdate(req.params.id, fields, { returnDocument: 'after', runValidators: true }).populate('media');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    // Re-scan mentioned briefs whenever description content changes
    if (fields.descriptionSections) {
      try {
        const mentionedIds = await scanMentionedBriefIds(brief, openRouterChat);
        await IntelligenceBrief.findByIdAndUpdate(brief._id, { mentionedBriefIds: mentionedIds });
        brief.mentionedBriefIds = mentionedIds;
      } catch (scanErr) {
        console.error('[PATCH briefs] mentionedBriefIds scan failed (non-fatal):', scanErr.message);
      }
    }
    if (brief.historic) {
      const targetIds = [
        ...(brief.associatedBaseBriefIds     ?? []),
        ...(brief.associatedSquadronBriefIds ?? []),
        ...(brief.associatedAircraftBriefIds ?? []),
        ...(brief.associatedMissionBriefIds  ?? []),
      ].filter(id => id);
      if (targetIds.length > 0) {
        await IntelligenceBrief.updateMany(
          { _id: { $in: targetIds } },
          { $addToSet: { relatedHistoric: brief._id } }
        );
      }
    }
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

    // Fetch brief before deletion to get title + category + media list. The
    // media ids are captured *before* the brief is deleted so the cleanup
    // helpers can apply share-guards against a coherent state.
    const brief = await IntelligenceBrief.findById(briefId).select('title category media');
    const mediaIds = (brief?.media ?? []).map(m => String(m));

    // Collect dependent IDs before deleting so we can cascade their results
    const [questionIds, booGameIds, flashGameIds, waaGameIds] = await Promise.all([
      GameQuizQuestion.distinct('_id', { intelBriefId: briefId }),
      GameOrderOfBattle.distinct('_id', { anchorBriefId: briefId }),
      GameFlashcardRecall.distinct('_id', { 'cards.intelBriefId': briefId }),
      GameWheresThatAircraft.distinct('_id', { intelBriefId: briefId }),
    ]);

    // ── Reverse aircoins per user (excluding daily_brief coins) ──────
    const coinGroups = await AircoinLog.aggregate([
      { $match: { briefId: new mongoose.Types.ObjectId(briefId) } },
      { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);
    await Promise.all(coinGroups.map(async ({ _id: userId, total }) => {
      const u = await User.findById(userId).select('totalAircoins cycleAircoins');
      if (!u) return;
      u.totalAircoins = Math.max(0, (u.totalAircoins ?? 0) - total);
      u.cycleAircoins = Math.max(0, (u.cycleAircoins ?? 0) - total);
      await u.save();
    }));

    await Promise.all([
      IntelligenceBrief.findByIdAndDelete(briefId),
      // Preserve read history but mark the brief as deleted and reset completion
      IntelligenceBriefRead.updateMany({ intelBriefId: briefId }, { $set: {
        briefDeletedNote: 'Brief deleted or re-created',
        completed:        false,
        coinsAwarded:     false,
      } }),
      GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }),
      GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
      AircoinLog.deleteMany({ briefId }),
      // BOO cascade
      GameSessionOrderOfBattleResult.deleteMany({ gameId: { $in: booGameIds } }),
      GameOrderOfBattle.deleteMany({ anchorBriefId: briefId }),
      // Flashcard cascade
      GameSessionFlashcardRecallResult.deleteMany({ gameId: { $in: flashGameIds } }),
      GameFlashcardRecall.deleteMany({ 'cards.intelBriefId': briefId }),
      // Where's That Aircraft cascade
      GameSessionWheresThatAircraftResult.deleteMany({ gameId: { $in: waaGameIds } }),
      GameWheresThatAircraft.deleteMany({ intelBriefId: briefId }),
      // Where's That Aircraft cascade
      GameSessionWhereAircraftResult.deleteMany({ aircraftBriefId: briefId }),
      // Remove deleted brief from all relationship arrays across the collection
      IntelligenceBrief.updateMany({}, { $pull: {
        associatedBaseBriefIds:     new mongoose.Types.ObjectId(briefId),
        associatedSquadronBriefIds: new mongoose.Types.ObjectId(briefId),
        associatedAircraftBriefIds: new mongoose.Types.ObjectId(briefId),
        relatedBriefIds:            new mongoose.Types.ObjectId(briefId),
        relatedHistoric:            new mongoose.Types.ObjectId(briefId),
      } }),
    ]);

    // Media cleanup — runs after the brief itself is gone so the share-guard
    // checks see the updated reference count. Cutouts apply an Aircraft-only
    // share-check; originals apply a category-agnostic one. Both helpers are
    // idempotent and safe to run sequentially.
    for (const mediaId of mediaIds) {
      await cleanupOrphanedCutout(mediaId);
      await cleanupOrphanedMedia(mediaId);
    }

    await AdminAction.create({ userId: req.user._id, actionType: 'delete_brief', reason: req.body.reason });

    let leadResult = { matched: false, error: null };
    if (brief?.title) {
      // Only unmark the lead if no other brief with this title still exists
      const sibling = await IntelligenceBrief.findOne({ title: brief.title, _id: { $ne: briefId } });
      if (!sibling) leadResult = await unmarkLeadInDb(brief.title);
    }
    res.json({ status: 'success', leadUnmarked: leadResult.matched, leadError: leadResult.error });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/confirm-regeneration
// Cascade-deletes all user game data and awarded coins tied to this brief,
// then returns deletion counts. The admin has already confirmed a warning modal.
// Must be called before POSTing to /ai/regenerate-brief/:id.
// ── Shared cascade: wipe all user data tied to a brief ───────────────────
async function cascadeDeleteBriefData(briefId) {
  // Step 1: collect IDs before any deletion
  const [questionIds, booGameIds, flashGameIds, waaGameIds] = await Promise.all([
    GameQuizQuestion.distinct('_id', { intelBriefId: briefId }),
    GameOrderOfBattle.distinct('_id', { anchorBriefId: briefId }),
    GameFlashcardRecall.distinct('_id', { 'cards.intelBriefId': briefId }),
    GameWheresThatAircraft.distinct('_id', { intelBriefId: briefId }),
  ]);

  // Step 2: reverse Aircoins per user
  const coinGroups = await AircoinLog.aggregate([
    { $match: { briefId: new mongoose.Types.ObjectId(briefId) } },
    { $group: { _id: '$userId', total: { $sum: '$amount' } } },
  ]);
  await Promise.all(coinGroups.map(async ({ _id: userId, total }) => {
    const user = await User.findById(userId).select('totalAircoins cycleAircoins');
    if (!user) return;
    user.totalAircoins = Math.max(0, (user.totalAircoins ?? 0) - total);
    user.cycleAircoins = Math.max(0, (user.cycleAircoins ?? 0) - total);
    await user.save();
  }));

  // Step 3: delete everything
  const [
    briefReadResult,
    quizQResult,
    quizAttemptResult,
    quizResultResult,
    aircoinResult,
    booResultResult,
    booGameResult,
    flashResultResult,
    flashGameResult,
    waaResultResult,
    waaGameResult,
    whereAircraftResult,
  ] = await Promise.all([
    // Preserve read history but mark the brief as deleted and reset completion
    IntelligenceBriefRead.updateMany({ intelBriefId: briefId }, { $set: {
      briefDeletedNote: 'Brief deleted or re-created',
      completed:        false,
      coinsAwarded:     false,
    } }),
    GameQuizQuestion.deleteMany({ intelBriefId: briefId }),
    GameSessionQuizAttempt.deleteMany({ intelBriefId: briefId }),
    GameSessionQuizResult.deleteMany({ questionId: { $in: questionIds } }),
    AircoinLog.deleteMany({ briefId: new mongoose.Types.ObjectId(briefId) }),
    GameSessionOrderOfBattleResult.deleteMany({ gameId: { $in: booGameIds } }),
    GameOrderOfBattle.deleteMany({ anchorBriefId: briefId }),
    GameSessionFlashcardRecallResult.deleteMany({ gameId: { $in: flashGameIds } }),
    GameFlashcardRecall.deleteMany({ 'cards.intelBriefId': briefId }),
    GameSessionWheresThatAircraftResult.deleteMany({ gameId: { $in: waaGameIds } }),
    GameWheresThatAircraft.deleteMany({ intelBriefId: briefId }),
    GameSessionWhereAircraftResult.deleteMany({ aircraftBriefId: briefId }),
    IntelligenceBrief.findByIdAndUpdate(briefId, { $set: {
      quizQuestionsEasy:          [],
      quizQuestionsMedium:        [],
      associatedBaseBriefIds:     [],
      associatedSquadronBriefIds: [],
      associatedAircraftBriefIds: [],
      relatedBriefIds:            [],
    } }),
  ]);

  // Remove from all other briefs' relationship arrays
  await IntelligenceBrief.updateMany({}, { $pull: {
    associatedBaseBriefIds:     new mongoose.Types.ObjectId(briefId),
    associatedSquadronBriefIds: new mongoose.Types.ObjectId(briefId),
    associatedAircraftBriefIds: new mongoose.Types.ObjectId(briefId),
    relatedBriefIds:            new mongoose.Types.ObjectId(briefId),
  } });

  return {
    coinsReversed:          coinGroups.reduce((s, g) => s + g.total, 0),
    usersAffected:          coinGroups.length,
    briefReadsMarked:       briefReadResult.modifiedCount,
    quizQuestionsDeleted:   quizQResult.deletedCount,
    quizAttemptsDeleted:    quizAttemptResult.deletedCount,
    quizResultsDeleted:     quizResultResult.deletedCount,
    aircoinLogsDeleted:     aircoinResult.deletedCount,
    booResultsDeleted:      booResultResult.deletedCount,
    booGamesDeleted:        booGameResult.deletedCount,
    flashResultsDeleted:    flashResultResult.deletedCount,
    flashGamesDeleted:      flashGameResult.deletedCount,
    waaResultsDeleted:          waaResultResult.deletedCount,
    waaGamesDeleted:            waaGameResult.deletedCount,
    whereAircraftResultsDeleted: whereAircraftResult.deletedCount,
  };
}

router.post('/briefs/:id/confirm-regeneration', requireReason, async (req, res) => {
  try {
    const briefId = req.params.id;
    if (!await IntelligenceBrief.exists({ _id: briefId })) {
      return res.status(404).json({ message: 'Brief not found' });
    }

    const cascadeStats = await cascadeDeleteBriefData(briefId);

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'regenerate_brief_cascade',
      reason:     req.body.reason,
    });

    res.json({ status: 'success', data: cascadeStats });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/questions — save quiz questions for a brief (no reason required)
router.post('/briefs/:id/questions', async (req, res) => {
  try {
    const { easyQuestions = [], mediumQuestions = [] } = req.body;
    const brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const gameType = await GameType.findOne({ gameTitle: 'quiz' });
    if (!gameType) return res.status(500).json({ message: 'Quiz game type not seeded — restart the server' });

    // Cascade: regenerating quiz questions invalidates all past quiz sessions
    // for this brief, so delete session history and reverse any quiz coins
    // that were awarded from those sessions. Brief-read coins are left intact
    // because the brief itself is not being regenerated.
    const briefObjectId = new mongoose.Types.ObjectId(req.params.id);
    const oldQuestionIds = await GameQuizQuestion.distinct('_id', { intelBriefId: briefObjectId });

    const quizCoinGroups = await AircoinLog.aggregate([
      { $match: { briefId: briefObjectId, reason: 'quiz' } },
      { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);
    await Promise.all(quizCoinGroups.map(async ({ _id: userId, total }) => {
      const user = await User.findById(userId).select('totalAircoins cycleAircoins');
      if (!user) return;
      user.totalAircoins = Math.max(0, (user.totalAircoins ?? 0) - total);
      user.cycleAircoins = Math.max(0, (user.cycleAircoins ?? 0) - total);
      await user.save();
    }));

    await Promise.all([
      GameSessionQuizResult.deleteMany({ questionId: { $in: oldQuestionIds } }),
      GameSessionQuizAttempt.deleteMany({ intelBriefId: briefObjectId }),
      AircoinLog.deleteMany({ briefId: briefObjectId, reason: 'quiz' }),
      GameQuizQuestion.deleteMany({ intelBriefId: briefObjectId }),
    ]);

    const createQuestions = async (questions, difficulty) => {
      const ids = [];
      for (const q of questions) {
        const answers = q.answers.map(a => ({
          _id: new mongoose.Types.ObjectId(),
          title: typeof a === 'string' ? a : a.title,
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

    await AdminAction.create({ userId: req.user._id, actionType: 'change_quiz_questions', reason: 'Generation save' });

    const updatedBrief = await IntelligenceBrief.findById(req.params.id)
      .populate('media')
      .populate('quizQuestionsEasy')
      .populate('quizQuestionsMedium');

    res.json({ status: 'success', data: { brief: updatedBrief } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/media — attach a media item to a brief.
// If `mediaId` is provided, attaches the existing Media doc (reuse path for
// dedup). Otherwise creates a new Media doc from the supplied fields.
router.post('/briefs/:id/media', async (req, res) => {
  try {
    const { mediaId, mediaType, mediaUrl, cloudinaryPublicId, contentHash, name, showOnSummary } = req.body;

    let media;
    if (mediaId) {
      media = await Media.findById(mediaId);
      if (!media) return res.status(404).json({ message: 'Media not found' });
    } else {
      if (!mediaUrl || !mediaType) return res.status(400).json({ message: 'mediaType and mediaUrl required' });

      // Dedupe: if an existing Media doc already points at this Cloudinary
      // asset (by publicId or contentHash), reuse it instead of creating a
      // second doc against the same file.
      if (contentHash) {
        media = await Media.findOne({ contentHash });
      }
      if (!media && cloudinaryPublicId) {
        media = await Media.findOne({ cloudinaryPublicId });
      }
      if (!media) {
        media = await Media.create({
          mediaType,
          mediaUrl: mediaUrl.trim(),
          ...(cloudinaryPublicId ? { cloudinaryPublicId } : {}),
          ...(contentHash ? { contentHash } : {}),
          ...(name ? { name } : {}),
          showOnSummary: showOnSummary !== false,
        });
      }
    }

    const brief = await IntelligenceBrief.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { media: media._id } },
      { returnDocument: 'after' }
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
    const media = await Media.findByIdAndUpdate(req.params.mediaId, update, { returnDocument: 'after', runValidators: true });
    if (!media) return res.status(404).json({ message: 'Media not found' });
    res.json({ status: 'success', data: { media } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/briefs/:id/media/:mediaId/extract-subject
// Runs the source image through OpenRouter's Gemini Flash Image model with a
// background-removal instruction, chroma-keys the result to a transparent PNG
// via sharp, uploads the cutout to Cloudinary, and stores cutoutUrl +
// cutoutPublicId on the Media doc. The endpoint is safe to re-run — any
// previous cutout for this Media is destroyed and replaced.
router.post('/briefs/:id/media/:mediaId/extract-subject', async (req, res) => {
  try {
    const { id: briefId, mediaId } = req.params;

    // Guard: the cutout-display flow is only surfaced for Aircraft briefs, so
    // there's no reason to let the extraction run on other categories.
    const brief = await IntelligenceBrief.findById(briefId).select('category media').lean();
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.category !== 'Aircrafts') {
      return res.status(400).json({ message: 'Subject extraction is only available for Aircraft briefs' });
    }
    if (!(brief.media ?? []).some(m => String(m) === String(mediaId))) {
      return res.status(404).json({ message: 'Media is not attached to this brief' });
    }

    const media = await Media.findById(mediaId);
    if (!media) return res.status(404).json({ message: 'Media not found' });
    if (media.mediaType !== 'picture') {
      return res.status(400).json({ message: 'Only picture media can be extracted' });
    }
    if (!media.mediaUrl) return res.status(400).json({ message: 'Media has no source URL' });

    // Destroy any previous cutout before overwriting so we don't leak assets
    // on re-runs. Ignore failures — stale asset cleanup is best-effort.
    const previousPublicId = media.cutoutPublicId;
    if (previousPublicId) {
      await destroyAsset(previousPublicId).catch(() => {});
    }

    const uploaded = await extractSubjectToCloudinary(media.mediaUrl, media.cloudinaryPublicId);

    media.cutoutUrl      = uploaded.secure_url;
    media.cutoutPublicId = uploaded.public_id;
    await media.save();

    res.json({
      status: 'success',
      data: {
        media: {
          _id:            media._id,
          mediaUrl:       media.mediaUrl,
          cutoutUrl:      media.cutoutUrl,
          cutoutPublicId: media.cutoutPublicId,
          name:           media.name,
        },
      },
    });
  } catch (err) {
    console.error('[extract-subject] failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id/media/:mediaId/cutout — clear only the cutout
// on a media item while leaving the original image and brief attachment
// intact. Idempotent: calling it on a media with no cutout returns success.
router.delete('/briefs/:id/media/:mediaId/cutout', async (req, res) => {
  try {
    const { id: briefId, mediaId } = req.params;

    const brief = await IntelligenceBrief.findById(briefId).select('media').lean();
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (!(brief.media ?? []).some(m => String(m) === String(mediaId))) {
      return res.status(404).json({ message: 'Media is not attached to this brief' });
    }

    const media = await Media.findById(mediaId);
    if (!media) return res.status(404).json({ message: 'Media not found' });

    if (media.cutoutPublicId) {
      await destroyAsset(media.cutoutPublicId).catch(() => {});
    }
    media.cutoutUrl      = null;
    media.cutoutPublicId = null;
    await media.save();

    res.json({
      status: 'success',
      data: {
        media: {
          _id:            media._id,
          cutoutUrl:      null,
          cutoutPublicId: null,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/briefs/:id/media/:mediaId — detach a media item from a
// brief. Because the same Media doc may now be shared by multiple briefs (via
// dedup during image generation), we only delete the Media doc and destroy
// the Cloudinary asset when no other brief still references it. The
// Aircraft-only cutout (if any) follows its own share-check: it's destroyed
// when no other Aircraft brief still references this Media.
router.delete('/briefs/:id/media/:mediaId', async (req, res) => {
  try {
    const { id: briefId, mediaId } = req.params;

    await IntelligenceBrief.findByIdAndUpdate(briefId, { $pull: { media: mediaId } });

    // Cutout share-check: the cutout is only displayed on Aircrafts-category
    // briefs today, so ask "does any OTHER Aircraft brief still use this
    // Media?" — if not, the cutout is dead weight and should be destroyed
    // regardless of whether the underlying Media doc itself survives.
    await cleanupOrphanedCutout(mediaId);

    const stillReferenced = await IntelligenceBrief.exists({ media: mediaId });
    if (stillReferenced) {
      return res.json({ status: 'success', shared: true });
    }

    const mediaDoc = await Media.findByIdAndDelete(mediaId);
    if (mediaDoc?.cloudinaryPublicId) {
      await destroyAsset(mediaDoc.cloudinaryPublicId).catch(() => {});
    }
    res.json({ status: 'success', shared: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Shared helper — used by both the single-media detach endpoint and the full
// brief-delete cascade. Checks whether any Aircraft brief still references
// this Media doc; if not, destroys the Cloudinary cutout asset and nulls the
// cutout fields on the Media so it's never served again. Safe to call when
// there is no cutout.
async function cleanupOrphanedCutout(mediaId) {
  const media = await Media.findById(mediaId).select('cutoutPublicId').lean();
  if (!media?.cutoutPublicId) return;

  const stillUsedByAircraft = await IntelligenceBrief.exists({
    media:    mediaId,
    category: 'Aircrafts',
  });
  if (stillUsedByAircraft) return;

  await destroyAsset(media.cutoutPublicId).catch(() => {});
  await Media.findByIdAndUpdate(mediaId, {
    $set: { cutoutUrl: null, cutoutPublicId: null },
  });
}

// Shared helper — used by the full brief-delete cascade. Applies the same
// share-guard as the single-media detach endpoint: if no other brief
// references this Media at all, destroy the Media doc + its Cloudinary
// asset(s) (original + any cutout).
async function cleanupOrphanedMedia(mediaId) {
  const stillReferenced = await IntelligenceBrief.exists({ media: mediaId });
  if (stillReferenced) return;

  const mediaDoc = await Media.findByIdAndDelete(mediaId);
  if (!mediaDoc) return;

  if (mediaDoc.cloudinaryPublicId) {
    await destroyAsset(mediaDoc.cloudinaryPublicId).catch(() => {});
  }
  if (mediaDoc.cutoutPublicId) {
    await destroyAsset(mediaDoc.cutoutPublicId).catch(() => {});
  }
}

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
          title: typeof a === 'string' ? a : a.title,
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

async function openRouterChat(messages, model, maxTokens = 2048) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title': 'SkyWatch',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function extractBalanced(str, open, close) {
  const start = str.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === open) depth++;
    else if (str[i] === close) { depth--; if (depth === 0) return str.slice(start, i + 1); }
  }
  return null; // unbalanced / truncated
}

function cleanJson(raw) {
  // Strip markdown fences and inline citation markers like [1]
  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').replace(/\[\d+\]/g, '').trim();
  // Use balanced-bracket extraction so trailing prose/citations after the JSON don't get included.
  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  // Prefer whichever token comes first
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const obj = extractBalanced(cleaned, '{', '}');
    if (obj) return obj;
  }
  if (arrStart !== -1) {
    const arr = extractBalanced(cleaned, '[', ']');
    if (arr) return arr;
  }
  // If no closing bracket/brace found (truncated output), extract from first { to end for repair attempt.
  const openMatch = cleaned.match(/\{[\s\S]*/);
  return openMatch ? openMatch[0] : cleaned;
}

// Attempt to close truncated JSON produced when the AI hits its output token limit.
function repairJson(str) {
  let s = str.trimEnd();
  // Close any unclosed string
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') inString = !inString;
  }
  if (inString) s += '"';
  // Track open brackets/braces
  const stack = [];
  inString = false; escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  // Strip trailing comma before closing
  s = s.replace(/,\s*$/, '');
  // Close in reverse order
  while (stack.length) {
    s += stack.pop() === '{' ? '}' : ']';
  }
  return s;
}

// Normalize quiz question answers: models sometimes collapse [{title:a},{title:b},...] into
// one object with duplicate keys, yielding a 1-element array. Prompting for flat string arrays
// avoids this, and this helper converts them back to {title} objects.
function normalizeQuizAnswers(questions) {
  return (questions ?? []).map(q => ({
    ...q,
    answers: Array.isArray(q.answers)
      ? q.answers.map(a => (typeof a === 'string' ? { title: a } : a))
      : q.answers,
  }));
}

// ── Quiz quality helpers ─────────────────────────────────────────────────────

// Asks the AI for additional wrong answers to fill a question up to 7.
// existingAnswers may be strings or {title} objects. Returns a string[] of all answers.
async function topUpAnswers(question, description, existingAnswers, systemPrompt) {
  const needed = 7 - existingAnswers.length;
  if (needed <= 0) return existingAnswers;
  const existingTitles = existingAnswers.map(a => (typeof a === 'string' ? a : a.title));
  const data = await openRouterChat([{
    role: 'system',
    content: systemPrompt,
  }, {
    role: 'user',
    content: `Question: "${question}"\n\nIntel Brief Description:\n"""\n${description}\n"""\n\nExisting answer options (do NOT repeat these):\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nProvide exactly ${needed} more WRONG answer options so the total reaches 7. Each must be a plausible but clearly incorrect complete sentence or meaningful phrase (minimum 5 words), answerable from the description context.\n\nANSWER FORMAT RULES: ${QUIZ_ANSWER_FORMAT_RULES} All options must follow the same plain format as the existing answers above.\n\nReturn ONLY a JSON array of strings, e.g. ["wrong answer 1", "wrong answer 2"]`,
  }], 'perplexity/sonar', 1024);
  const raw = data.choices?.[0]?.message?.content ?? '[]';
  let newAnswers;
  try {
    newAnswers = JSON.parse(cleanJson(raw));
  } catch {
    return existingTitles;
  }
  if (!Array.isArray(newAnswers)) return existingTitles;
  return [...existingTitles, ...newAnswers.filter(a => typeof a === 'string').slice(0, needed)];
}

// Asks the AI for additional quiz questions of a given difficulty, avoiding repeats.
// Returns an array of raw question objects (not yet normalized).
async function topUpQuestions(difficulty, description, briefTitle, existingQuestions, needed, systemPrompt) {
  if (needed <= 0) return [];
  const existingList = existingQuestions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
  const data = await openRouterChat([{
    role: 'system',
    content: systemPrompt,
  }, {
    role: 'user',
    content: `Intel Brief Title: ${briefTitle}\n\nIntel Brief Description:\n"""\n${description}\n"""\n\nExisting questions already written (do NOT repeat or closely paraphrase any):\n${existingList || '(none yet)'}\n\nWrite exactly ${needed} more ${getDifficultyLabel(difficulty)} questions using ONLY the facts in the description above.\n\n${QUIZ_QUESTION_RULES}\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"questions":[{"question":"...","answers":["answer option 1","answer option 2","answer option 3","answer option 4","answer option 5","answer option 6","answer option 7"],"correctAnswerIndex":0}]}`,
  }], 'perplexity/sonar', 4096);
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let generated;
  try {
    const cleaned = cleanJson(raw);
    try { generated = JSON.parse(cleaned); } catch { generated = JSON.parse(repairJson(cleaned)); }
  } catch {
    return [];
  }
  return Array.isArray(generated.questions) ? generated.questions : [];
}

// Retries topUpAnswers until a question has 7 answers or MAX_RETRIES is hit.
// Returns the question with answers normalized to {title} objects.
// Appends a warning to the provided array if the target cannot be reached.
async function fixAnswersWithRetry(q, description, systemPrompt, warnings) {
  const TARGET_A   = 7;
  const MAX_RETRIES = 3;
  let answers  = Array.isArray(q.answers) ? q.answers : [];
  let attempts = 0;
  while (answers.length < TARGET_A && attempts < MAX_RETRIES) {
    attempts++;
    const topped = await topUpAnswers(q.question, description, answers, systemPrompt);
    answers = topped.map(a => (typeof a === 'string' ? { title: a } : a));
  }
  if (answers.length < TARGET_A) {
    warnings.push(`Could not reach 7 answers for question after ${MAX_RETRIES} retries: "${q.question?.slice(0, 60)}"`);
  }
  return { ...q, answers };
}

// Ensures both tiers have `targetQ` questions each with 7 answers each.
// Mutates nothing — returns new arrays. Appends warnings to the provided array.
async function ensureQuizQuality(easyQuestions, mediumQuestions, description, briefTitle, quizSystemPrompt, warnings, targetQ = 7) {
  const TARGET_Q   = targetQ;
  const MAX_RETRIES = 3;

  async function fixAllAnswers(questions) {
    const result = [];
    for (const q of questions) result.push(await fixAnswersWithRetry(q, description, quizSystemPrompt, warnings));
    return result;
  }

  async function fixQuestionCount(questions, difficulty) {
    let attempts = 0;
    while (questions.length < TARGET_Q && attempts < MAX_RETRIES) {
      attempts++;
      const needed = TARGET_Q - questions.length;
      const newRaw = await topUpQuestions(difficulty, description, briefTitle, questions, needed, quizSystemPrompt);
      if (!newRaw.length) break;
      const fixed = await fixAllAnswers(normalizeQuizAnswers(newRaw));
      questions = [...questions, ...fixed];
    }
    if (questions.length < TARGET_Q) {
      warnings.push(`Could only generate ${questions.length}/${TARGET_Q} ${difficulty} questions after ${MAX_RETRIES} retries`);
    }
    return questions;
  }

  // Step 1: fix answers on initial batch
  easyQuestions   = await fixAllAnswers(easyQuestions);
  mediumQuestions = await fixAllAnswers(mediumQuestions);

  // Step 2: top up question counts (new questions also go through fixAllAnswers)
  easyQuestions   = await fixQuestionCount(easyQuestions,   'easy');
  mediumQuestions = await fixQuestionCount(mediumQuestions, 'medium');

  return { easyQuestions, mediumQuestions };
}

// ── BOO gameData helpers ────────────────────────────────────────────────────

const BOO_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'];

// Ranks are looked up deterministically — never generated by AI to avoid errors/duplicates
const RANK_HIERARCHY = {
  'Marshal of the Royal Air Force': 1,
  'Air Chief Marshal':              2,
  'Air Marshal':                    3,
  'Air Vice-Marshal':               4,
  'Air Commodore':                  5,
  'Group Captain':                  6,
  'Wing Commander':                 7,
  'Squadron Leader':                8,
  'Flight Lieutenant':              9,
  'Flying Officer':                 10,
  'Pilot Officer':                  11,
  'Warrant Officer':                12,
  'Master Aircrew':                 13,
  'Flight Sergeant':                14,
  'Chief Technician':               15,
  'Sergeant':                       16,
  'Corporal':                       17,
  'Junior Technician':              18,
  'Senior Aircraftman':             19,
  'Leading Aircraftman':            20,
  'Aircraftman':                    21,
};

// Fuzzy lookup: longest-key-first substring match (case-insensitive).
// Handles titles like "Sergeant (RAF)", "Warrant Officer (RAF)",
// "Senior Aircraftman / Senior Aircraftwoman", etc.
function lookupRankHierarchy(title) {
  const t = (title || '').toLowerCase();
  const entries = Object.entries(RANK_HIERARCHY).sort((a, b) => b[0].length - a[0].length);
  for (const [name, order] of entries) {
    if (t.includes(name.toLowerCase())) return order;
  }
  return null;
}

// ── Mnemonic helpers ───────────────────────────────────────────────────────

// Returns stat objects { key, label, value } for whichever gameData fields are populated.
// Mirrors the frontend buildStats() so the AI prompt always reflects what the user sees.
function buildMnemonicStats(category, gameData) {
  const gd = gameData ?? {};
  const stats = [];
  if (category === 'Aircrafts') {
    if (gd.topSpeedKph != null)
      stats.push({ key: 'topSpeedKph', label: 'Top Speed', value: `${gd.topSpeedKph.toLocaleString()} km/h · ${Math.round(gd.topSpeedKph * 0.621).toLocaleString()} mph` });
    if (gd.yearIntroduced != null)
      stats.push({ key: 'yearIntroduced', label: 'Introduced', value: String(gd.yearIntroduced) });
    if (gd.yearRetired != null)
      stats.push({ key: 'status', label: 'Status', value: `Retired ${gd.yearRetired}` });
  } else if (category === 'Ranks') {
    if (gd.rankHierarchyOrder != null)
      stats.push({ key: 'rankHierarchyOrder', label: 'Seniority', value: `#${gd.rankHierarchyOrder}` });
  } else if (category === 'Training') {
    if (gd.trainingWeekStart != null && gd.trainingWeekEnd != null)
      stats.push({ key: 'pipelinePosition', label: 'Pipeline Position', value: `Week ${gd.trainingWeekStart} – Week ${gd.trainingWeekEnd}` });
    if (gd.weeksOfTraining != null)
      stats.push({ key: 'trainingDuration', label: 'Duration', value: `${gd.weeksOfTraining} week${gd.weeksOfTraining === 1 ? '' : 's'}` });
  } else if (['Missions', 'Tech', 'Treaties'].includes(category)) {
    if (gd.startYear != null) {
      // Only generate a start-year mnemonic; skip end if still ongoing (no memorable fact to anchor)
      stats.push({ key: 'startYear', label: 'Started', value: String(gd.startYear) });
      if (gd.endYear != null)
        stats.push({ key: 'endYear', label: 'Ended', value: String(gd.endYear) });
    }
  } else if (['Bases', 'Squadrons', 'Threats'].includes(category)) {
    const L = {
      Bases:     { start: 'Opened',     active: 'Active',     closed: 'Closed'    },
      Squadrons: { start: 'Formed',     active: 'Active',     closed: 'Disbanded' },
      Threats:   { start: 'Introduced', active: 'In Service', closed: 'Retired'   },
    }[category];
    if (gd.startYear != null)
      stats.push({ key: 'startYear', label: L.start, value: String(gd.startYear) });
    if (gd.endYear != null)
      stats.push({ key: 'status', label: 'Status', value: `${L.closed} ${gd.endYear}` });
  }
  return stats;
}

// Generates mnemonics for all populated stats of a brief. Returns a plain object
// keyed by stat key, or null if the brief has no stats or the AI call fails.
async function generateMnemonicsForBrief(title, category, gameData, systemPrompt) {
  const stats = buildMnemonicStats(category, gameData);
  if (!stats.length) return null;

  const statLines = stats.map(s => `- ${s.label}: ${s.value}`).join('\n');
  const shape = `{${stats.map(s => `"${s.key}": "mnemonic sentence"`).join(', ')}}`;

  const data = await openRouterChat([{
    role: 'system',
    content: systemPrompt ?? AI_PROMPT_DEFAULTS['mnemonic.batch'],
  }, {
    role: 'user',
    content: `Brief: "${title}" (${category})\n\nStats to remember:\n${statLines}\n\nFor each stat, write one memorable sentence that helps an RAF applicant remember the exact value and connect it to this subject.\n\nReturn ONLY valid JSON — no markdown:\n${shape}`,
  }], 'perplexity/sonar', 512);

  const raw = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(cleanJson(raw));
    // Strip any markdown formatting the model may have snuck in
    for (const k of Object.keys(parsed)) {
      if (typeof parsed[k] === 'string') parsed[k] = parsed[k].replace(/[*_`#]/g, '');
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasStaleSource(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return sources.some(s => {
    if (!s.articleDate) return true;
    return new Date(s.articleDate).getTime() < cutoff;
  });
}

// Returns an additional prompt note for categories where null gameData fields
// need explicit justification — prevents AI incorrectly populating fields that
// should be left null for non-pipeline content (e.g. cadet-facing activities).
function booGameDataNote(category) {
  if (category === 'Training') {
    return `GAME DATA NOTE: trainingWeekStart and trainingWeekEnd represent position within the regular RAF career training pipeline (IOT → EFT → AFT → OCU and similar progressions). If this brief covers cadet-facing activities — such as Air Experience Flights (AEF), ATC/CCF flying, gliding scholarships, or any programme primarily intended for Air Cadets rather than regular RAF personnel undergoing career training — set trainingWeekStart and trainingWeekEnd to null. Reason: cadet activities run on a separate schedule that cannot be meaningfully compared with regular RAF career pipeline phases in a chronological ordering game. weeksOfTraining may still be populated if a clear course duration exists.`;
  }
  return null;
}

function booGameDataShape(category) {
  if (category === 'Aircrafts')
    return '"gameData": {"topSpeedKph": 2400, "yearIntroduced": 1976, "yearRetired": null}';
  // Ranks are NOT generated by AI — use lookupRankHierarchy() after generation instead
  if (category === 'Training')
    return '"gameData": {"trainingWeekStart": 3, "trainingWeekEnd": 5, "weeksOfTraining": 2}';
  if (['Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'].includes(category))
    return '"gameData": {"startYear": 1976, "endYear": null}';
  return null;
}

// POST /api/admin/ai/news-headlines
router.post('/ai/news-headlines', async (req, res) => {
  try {
    const { date } = req.body; // YYYY-MM-DD string
    const todayStr = new Date().toISOString().slice(0, 10);
    const targetDate = (!date || date === todayStr) ? todayStr : date;
    const isToday    = targetDate === todayStr;
    const aiSettings = await AppSettings.getSettings();
    const userContent = isToday
      ? `The current date is ${todayStr}. Search the web right now for real UK Royal Air Force (RAF) news stories published in the last 24 hours only. Return ONLY a JSON array of up to 6 objects, each with "headline" (string, verbatim or closely paraphrased from the actual published source) and "eventDate" (YYYY-MM-DD, the date the story was published — must be ${todayStr} or yesterday). Only include a story if you can confirm its publication date from the source. If you cannot verify the exact date, omit the story. No fabricated headlines, no citation markers like [1], no markdown, no code blocks, no extra text. If no real RAF stories exist from the last 24 hours, return an empty array []. Format: [{"headline": "Headline one", "eventDate": "YYYY-MM-DD"}]`
      : `The target date is ${targetDate}. Search the web for real UK Royal Air Force (RAF) news stories published on ${targetDate} (acceptable range: up to 3 days either side). Return ONLY a JSON array of up to 6 objects, each with "headline" (string, verbatim or closely paraphrased from the actual published source) and "eventDate" (YYYY-MM-DD, the actual confirmed publication date of the story). Only include a story if you can verify its publication date from the source. If you cannot verify the date, omit the story entirely — do not guess. No fabricated headlines, no citation markers like [1], no markdown, no code blocks, no extra text. If no real RAF stories exist from around that date, return an empty array []. Format: [{"headline": "Headline one", "eventDate": "YYYY-MM-DD"}]`;
    const data = await openRouterChat([{
      role: 'system',
      content: getPrompt(aiSettings, 'newsHeadlines'),
    }, {
      role: 'user',
      content: userContent,
    }], 'perplexity/sonar');
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    let parsed;
    try {
      parsed = JSON.parse(cleanJson(raw));
    } catch {
      parsed = [];
    }
    // Normalise: accept plain strings (legacy fallback) and {headline, eventDate} objects.
    // Then filter out any item whose eventDate falls more than 3 days outside the target date.
    const targetMs = new Date(targetDate).getTime();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const headlines = (Array.isArray(parsed) ? parsed : [])
      .map(h => typeof h === 'string' ? { headline: h, eventDate: targetDate } : h)
      .filter(h => {
        if (!h.headline) return false;
        const d = new Date(h.eventDate);
        if (isNaN(d.getTime())) return false; // drop unparseable dates
        return Math.abs(d.getTime() - targetMs) <= THREE_DAYS_MS;
      });
    res.json({ status: 'success', data: { headlines } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/news-headlines-month
// Fetches up to 10 real RAF news headlines for a given calendar month (YYYY-MM).
// Duplicate detection is done on the frontend using existing isSimilarTitle logic.
router.post('/ai/news-headlines-month', async (req, res) => {
  try {
    const { month } = req.body; // "YYYY-MM"
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: 'month required in YYYY-MM format' });
    }
    const [year, mon] = month.split('-').map(Number);
    const monthName = new Date(year, mon - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    const aiSettings = await AppSettings.getSettings();
    const data = await openRouterChat([{
      role: 'system',
      content: getPrompt(aiSettings, 'newsHeadlines'),
    }, {
      role: 'user',
      content: `Search the web for the top 10 most significant real UK Royal Air Force (RAF) news stories published during ${monthName}. Return ONLY a JSON array of up to 10 objects, each with "headline" (string, verbatim or closely paraphrased from the actual published source) and "eventDate" (YYYY-MM-DD, the confirmed publication date of the story — must fall within ${monthName}). Only include a story if you can verify its publication date from the source. If you cannot confirm the date falls within ${monthName}, omit the story entirely — do not guess. No fabricated headlines, no citation markers like [1], no markdown, no code blocks, no extra text. If fewer than 10 real RAF stories exist for that month, return what you find. Format: [{"headline": "Headline one", "eventDate": "YYYY-MM-DD"}]`,
    }], 'perplexity/sonar');
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    let parsed;
    try { parsed = JSON.parse(cleanJson(raw)); } catch { parsed = []; }
    // Normalise then filter: only keep items whose eventDate falls within the requested month.
    const fallbackDate = `${month}-15`;
    const headlines = (Array.isArray(parsed) ? parsed : [])
      .map(h => typeof h === 'string' ? { headline: h, eventDate: fallbackDate } : h)
      .filter(h => {
        if (!h.headline) return false;
        if (!h.eventDate || typeof h.eventDate !== 'string') return false;
        return h.eventDate.startsWith(month); // ensures YYYY-MM prefix matches
      });
    res.json({ status: 'success', data: { headlines } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/bulk-generate-news-item
// Full server-side pipeline for a single news headline: generates content, keywords,
// and image, then saves a new published News IntelligenceBrief to DB.
router.post('/ai/bulk-generate-news-item', async (req, res) => {
  try {
    const { headline, eventDate } = req.body;
    if (!headline) return res.status(400).json({ message: 'headline required' });

    const aiSettings = await AppSettings.getSettings();
    const warnings = [];

    // ── Step 1: Generate content ───────────────────────────────────────────────
    const { array: dsArray, countRule: dsCountRule, sharedRuleTail: dsRuleTail } = buildDescriptionSectionsSpec({ strict: true });
    const SHARED_SECTIONS = `"subtitle": "one factual sentence summarising the subject",\n  "descriptionSections": [\n    ${dsArray}\n  ]`;
    const SHARED_RULES = `\nCRITICAL RULES:\n1. ${dsCountRule} ${dsRuleTail}\n${LIST_FORMAT_RULE}`;
    const JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "title": "concise factual title, max 70 characters",\n  ${SHARED_SECTIONS},\n  "sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}${SHARED_RULES}`;

    const contentData = await openRouterChat([{
      role: 'system',
      content: getPrompt(aiSettings, 'brief.news'),
    }, {
      role: 'user',
      content: `Search the web for this specific RAF news story: "${headline}"\n\nUsing only verified facts from published sources, return a JSON object for an RAF news intelligence brief. Be as informative as possible about the current RAF affairs covered by this story.\n\n${JSON_SHAPE}`,
    }], 'perplexity/sonar', 2048);

    const contentRaw = contentData.choices?.[0]?.message?.content ?? '{}';
    let briefContent;
    try {
      briefContent = JSON.parse(cleanJson(contentRaw));
    } catch (parseErr) {
      throw new Error(`Content generation failed: ${parseErr.message}`);
    }

    // ── Step 1b: Scrape real source publication dates ──────────────────────────
    if (briefContent.sources?.length) {
      briefContent.sources = await enrichSourceDates(briefContent.sources);
    }

    // ── Step 2: Event date clamping ────────────────────────────────────────────
    let resolvedEventDate = eventDate || null;
    if (resolvedEventDate && briefContent.sources?.length) {
      const sourceDates = briefContent.sources.map(s => s.articleDate).filter(Boolean).sort();
      const oldestSource = sourceDates[0];
      if (oldestSource && resolvedEventDate > oldestSource) {
        warnings.push(`eventDate clamped: ${resolvedEventDate} → ${oldestSource} (oldest source)`);
        resolvedEventDate = oldestSource;
      }
    }

    // ── Step 3: Keywords ───────────────────────────────────────────────────────
    const descriptionText = (briefContent.descriptionSections ?? []).join('\n\n');
    let keywords = [];
    if (descriptionText) {
      const descLower = descriptionText.toLowerCase();
      const isTitleLike = buildTitleRejectCheck({
        title:    briefContent.title,
        subtitle: briefContent.subtitle,
      });

      // Validates keyword objects against description text and deduplicates
      const seen3 = new Set();
      const validateKws3 = (kwArray) => (Array.isArray(kwArray) ? kwArray : []).filter(k => {
        if (!k.keyword) return false;
        const kl = k.keyword.toLowerCase();
        if (!descLower.includes(kl)) return false;
        if (seen3.has(kl)) return false;
        if (isTitleLike(k.keyword)) return false;
        seen3.add(kl);
        return true;
      });

      // Build brief pool once for auto-linking
      const allBriefs = await IntelligenceBrief.find({}, { _id: 1, title: 1 }).lean();
      const briefPool = allBriefs.map(b => ({ id: String(b._id), norm: normTitle(b.title) }));
      const exactMap  = new Map(briefPool.map(b => [b.norm, b.id]));
      const autoLink3 = (kwArray) => kwArray.map(k => {
        const normKw = normTitle(k.keyword);
        let linkedBriefId = exactMap.get(normKw) ?? null;
        if (!linkedBriefId && normKw.length >= 6) {
          const cands = briefPool.filter(b => b.norm.includes(normKw));
          if (cands.length) { cands.sort((a, b) => a.norm.length - b.norm.length); linkedBriefId = cands[0].id; }
        }
        return linkedBriefId ? { ...k, linkedBriefId } : k;
      });

      const kwSys  = [{ role: 'system', content: getPrompt(aiSettings, 'keywords') }];
      const kwMdl  = 'perplexity/sonar';
      const KW_JSON = '{"keywords":[{"keyword":"exact phrase from description","generatedDescription":"general RAF-specific definition"},...]}';

      // Pass 1 — technical terms, aircraft, operations, systems, roles (10 keywords)
      let pass1 = [];
      try {
        const r1 = await openRouterChat([...kwSys, {
          role: 'user',
          content: `Description:\n"""${descriptionText}"""\n\nExtract exactly 10 keywords from the description above. Every keyword MUST appear verbatim in the description. Choose technical terms, acronyms, aircraft designations, system names, operation names, training programmes, and roles — but never the subject/title of the brief itself, including its expanded form, abbreviation, subtitle, or nickname (e.g. if the brief is titled "JTAC", do not extract "Joint Terminal Attack Controllers").\n\nFor "generatedDescription": write a general RAF-specific definition. Do NOT reference this intel brief.\n\nReturn ONLY valid JSON:\n${KW_JSON}`,
        }], kwMdl);
        pass1 = validateKws3(JSON.parse(cleanJson(r1.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, 10);
      } catch (e) { warnings.push(`Keywords pass 1: ${e.message}`); }

      // Pass 2 — proper nouns: squadron names, base names, unit designations (up to 10)
      let pass2 = [];
      try {
        const alreadyList = pass1.length ? `Already extracted (do NOT repeat): ${pass1.map(k => k.keyword).join(', ')}\n\n` : '';
        const r2 = await openRouterChat([...kwSys, {
          role: 'user',
          content: `Description:\n"""${descriptionText}"""\n\n${alreadyList}Extract up to 10 proper noun keywords from the description above. Focus SPECIFICALLY on: RAF squadron names and numbers (e.g. "No. 617 Squadron", "XI Squadron"), RAF base and airfield names (e.g. "RAF Lossiemouth"), named military units, formations, and commands. Every keyword MUST appear verbatim in the description.\n\nFor "generatedDescription": write a general RAF-specific definition. Do NOT reference this intel brief.\n\nReturn ONLY valid JSON:\n${KW_JSON}`,
        }], kwMdl);
        pass2 = validateKws3(JSON.parse(cleanJson(r2.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, 10);
      } catch (e) { warnings.push(`Keywords pass 2: ${e.message}`); }

      // Pass 3 — coverage check: find up to 5 important terms missed by passes 1 & 2
      const combined12 = [...pass1, ...pass2];
      let pass3 = [];
      if (combined12.length > 0) {
        try {
          const r3 = await openRouterChat([...kwSys, {
            role: 'user',
            content: `Description:\n"""${descriptionText}"""\n\nAlready extracted: ${combined12.map(k => k.keyword).join(', ')}\n\nIdentify up to 5 important terms from this description that were NOT already extracted. Look for aircraft designations, operation names, training programme names, squadron names, base names, technical systems, or role titles appearing verbatim in the description but absent from the list above. If nothing important is missing, return {"keywords":[]}.\n\nReturn ONLY valid JSON:\n${KW_JSON}`,
          }], kwMdl);
          pass3 = validateKws3(JSON.parse(cleanJson(r3.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, 5);
        } catch (e) { warnings.push(`Keywords pass 3: ${e.message}`); }
      }

      keywords = autoLink3([...combined12, ...pass3]);
    }

    // ── Step 4: Image ──────────────────────────────────────────────────────────
    const { mediaDocs: newsMediaDocs, searchTerms: imageSearchTerms, warnings: imgWarnings } =
      await generateBriefImages({
        title: briefContent.title,
        imagePromptBase: getPrompt(aiSettings, 'imageExtraction'),
        publicIdPrefix: 'brief-news-bulk',
      });
    for (const w of imgWarnings) warnings.push(`Image: ${w}`);
    if (!newsMediaDocs.length) {
      SystemLog.create({
        type:          'image_fetch_failure',
        briefTitle:    briefContent.title ?? headline,
        briefCategory: 'News',
        searchTerms:   imageSearchTerms,
        failureReason: 'All Wikipedia search terms failed to produce an image',
      }).catch(() => {});
      warnings.push('Image: no image found — see System Logs');
    }

    // ── Step 5: Save to DB ─────────────────────────────────────────────────────
    const todayStr = new Date().toISOString().slice(0, 10);
    const isHistoric = !!(resolvedEventDate && resolvedEventDate < todayStr);

    const brief = new IntelligenceBrief({
      category:            'News',
      title:               briefContent.title,
      subtitle:            briefContent.subtitle,
      descriptionSections: (briefContent.descriptionSections ?? []).map(s => typeof s === 'string' ? s.replace(/[*_`#]/g, '') : s),
      sources:             briefContent.sources ?? [],
      keywords,
      status:              'published',
      publishedAt:         new Date(),
      historic:            isHistoric,
      ...(resolvedEventDate ? { eventDate: resolvedEventDate } : {}),
    });

    if (newsMediaDocs.length) {
      brief.media = newsMediaDocs.map(m => m._id);
    }

    try {
      brief.mentionedBriefIds = await scanMentionedBriefIds(brief, openRouterChat);
    } catch (scanErr) {
      console.error('[bulk-generate-news-item] mentionedBriefIds scan failed (non-fatal):', scanErr.message);
    }

    await brief.save();
    await AdminAction.create({ userId: req.user._id, actionType: 'create_brief', reason: 'Bulk news auto-generate' });

    res.json({ status: 'success', data: { _id: brief._id, title: brief.title, eventDate: resolvedEventDate }, warnings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Universal rule enforcing bullet-list format whenever multiple items are enumerated
const LIST_FORMAT_RULE = 'LIST FORMAT RULE: Whenever you name 3 or more items of the same type (squadrons, aircraft, bases, roles, weapons, capabilities, or any other nouns), you MUST format them as a bullet list — NEVER as inline prose. This applies regardless of whether you would otherwise separate them with commas, semicolons, em-dashes (—), or parenthetical asides. BAD: "supports No. 1, No. 6 and No. 9 Squadron". BAD: "four squadrons—No. 1, No. 6, No. 9". GOOD: "supports four Typhoon squadrons:\\n- No. 1 Squadron\\n- No. 6 Squadron\\n- No. 9 Squadron". Each "- Item" MUST be on its own line using \\n escape sequences inside the JSON string. Introduce the list with a short lead sentence ending in a colon, then list every item on its own line.';

// Shared builder for descriptionSections prompt text used by both generate-brief and
// generateBriefContent. Single source of truth — keeps section 4 blind-identity rule
// consistent across both paths.
//   strict=true  → generate-brief:      EXACTLY 4 sections, 220-word cap, "Section N" labels
//   strict=false → generateBriefContent: 2–4 sections,       240-word cap, "Paragraph N" labels
function buildDescriptionSectionsSpec({ strict = true } = {}) {
  const label = strict ? 'Section' : 'Paragraph';
  const s4Omit = strict ? '' : ' (only include if genuinely needed — omit if not)';
  const s4BlindRule = 'CRITICAL: do NOT mention the subject\'s name, title, designation, or any unique identifier that would immediately reveal what this brief is about. The summary must be specific enough that a reader given a short list of 4–5 candidates could identify the correct one, but it must not name the subject directly.';

  const array = [
    `"${label} 1 — 50–80 words. Use clear, well-structured text. Introduce the subject clearly for someone building foundational knowledge of the modern RAF."`,
    `"${label} 2 — 50–80 words. Cover a different angle: training phases, roles, or bases associated with this subject."`,
    `"${label} 3 — 50–80 words. Operational context, key capabilities, or RAF significance."`,
    `"${label} 4 — 1–2 sentences only${s4Omit}. A concise summary of this subject's role and significance within the modern RAF. ${s4BlindRule}"`,
  ].join(',\n    ');

  const countRule = strict
    ? 'descriptionSections must be a JSON array of EXACTLY 4 strings — no more, no fewer. Total word count across sections 1–3 must not exceed 220 words.'
    : 'descriptionSections must be a JSON array of 2–4 strings. Total word count across all sections must not exceed 240 words.';

  const sharedRuleTail = 'Section 4 must be 1–2 sentences and must not contain the subject\'s name or any unique identifier. Write each section as readable prose or formatted text. IMPORTANT: when listing multiple items (features, roles, bases, capabilities, etc.) put each item on its own line using \\n escape sequences inside the JSON string, with each item prefixed by "- " (e.g. "Intro sentence:\\n- Item one\\n- Item two\\n- Item three"). Use "1." prefixes for ordered steps. Never use markdown bold/italic or headers. Plain prose is fine for flowing narrative — only use the list format when genuinely listing discrete items. DATE FORMAT: any dates written in prose must use UK format — day before month — e.g. "3rd March 2026" or "14 January 2025", never "March 3rd 2026" or "January 14, 2025".';

  return { array, countRule, sharedRuleTail };
}

// POST /api/admin/ai/generate-brief
router.post('/ai/generate-brief', async (req, res) => {
  try {
    const { headline, topic, category, eventDate, isHistoric } = req.body;
    if (!headline && !topic) return res.status(400).json({ message: 'headline or topic required' });

    const { array: dsArray, countRule: dsCountRule, sharedRuleTail: dsRuleTail } = buildDescriptionSectionsSpec({ strict: true });
    const SHARED_SECTIONS = `"subtitle": "one factual sentence summarising the subject",\n  "descriptionSections": [\n    ${dsArray}\n  ]`;
    const SHARED_RULES = `\nCRITICAL RULES:\n1. ${dsCountRule} ${dsRuleTail}\n${LIST_FORMAT_RULE}`;

    // News shape — AI must generate the title
    const JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "title": "concise factual title, max 70 characters",\n  ${SHARED_SECTIONS},\n  "sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}${SHARED_RULES}`;

    // Topic (lead) shape — title is provided externally, omit it from the response
    let TOPIC_JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  ${SHARED_SECTIONS},\n  "historic": <true if this subject is outdated/retired/no longer operationally relevant to the modern RAF — e.g. retired aircraft, concluded operations, obsolete systems, pre-2000 history with no current relevance; false if it has modern-day relevance, is currently in service, or ongoing>,\n  "sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]\n}${SHARED_RULES}`;

    // For BOO-eligible topic briefs, inject a gameData field into the JSON shape
    const gdShape = (!headline && BOO_CATEGORIES.includes(category)) ? booGameDataShape(category) : null;
    if (gdShape) {
      TOPIC_JSON_SHAPE = TOPIC_JSON_SHAPE.replace(
        '\n}\nCRITICAL RULES:',
        `,\n  ${gdShape}\n}\nCRITICAL RULES:`
      );
      const gdNote = booGameDataNote(category);
      if (gdNote) TOPIC_JSON_SHAPE += `\n${gdNote}`;
    }

    const userContent = topic
      ? `Write a comprehensive intelligence brief about this RAF topic: "${topic}"\n\nUsing verified facts from published sources, produce a reference-style brief suitable for someone building foundational knowledge of the modern RAF — not a news story, but an in-depth informative overview. Where relevant, cover: training pathways and which training blocks/phases apply to this subject; RAF bases associated with this subject and which aircraft or squadrons are stationed there and what operations occur there; roles that interact with or are defined by this subject and how those roles relate to specific training pipelines; and the broader operational and modern-day RAF significance.\n\n${TOPIC_JSON_SHAPE}`
      : `Search the web for this specific RAF news story: "${headline}"\n\nUsing only verified facts from published sources, return a JSON object for an RAF news intelligence brief. Be as informative as possible about the current RAF affairs covered by this story.\n\n${JSON_SHAPE}`;

    const isNews = !!headline;
    const briefAiSettings = await AppSettings.getSettings();
    const systemPrompt = isNews
      ? getPrompt(briefAiSettings, 'brief.news')
      : getPrompt(briefAiSettings, 'brief.topic');

    const data = await openRouterChat([{
      role: 'system',
      content: systemPrompt,
    }, {
      role: 'user',
      content: userContent,
    }], 'perplexity/sonar', 2048);
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let brief;
    try {
      brief = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[generate-brief] JSON parse failed. Raw response:', raw);
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }
    // Lock title to the lead topic — AI must not rename the subject
    if (topic) brief.title = topic;

    // Scrape real source publication dates — AI-supplied dates are often inaccurate
    if (brief.sources?.length) {
      brief.sources = await enrichSourceDates(brief.sources);
    }

    // For Ranks briefs, apply deterministic hierarchy lookup instead of relying on AI
    if (!headline && category === 'Ranks' && brief.title) {
      const rankOrder = lookupRankHierarchy(brief.title);
      if (rankOrder !== null) brief.gameData = { rankHierarchyOrder: rankOrder };
    }
    const staleSourceWarning = isNews && hasStaleSource(brief.sources);
    if (isNews) {
      if (isHistoric) brief.historic = true;
      if (eventDate)  brief.eventDate = eventDate;
      // Clamp eventDate so it's never newer than the oldest source articleDate —
      // a source can't exist before the event it describes, so the event must have
      // happened on or before the earliest source publication date.
      if (brief.eventDate && brief.sources?.length) {
        const sourceDates = brief.sources.map(s => s.articleDate).filter(Boolean).sort();
        const oldestSource = sourceDates[0];
        if (oldestSource && brief.eventDate > oldestSource) {
          brief.eventDate = oldestSource;
        }
      }
    }
    res.json({ status: 'success', data: { brief: { ...brief, staleSourceWarning } } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/intel-leads — return all leads from DB.
// Each lead includes a `hasBrief` flag (true if any brief exists for that
// title+category, whether stub or published) so the admin UI can offer a
// stub-only create action when no brief exists yet.
router.get('/intel-leads', async (req, res) => {
  try {
    const [leads, briefs] = await Promise.all([
      IntelLead.find()
        .select('title nickname subtitle category subcategory section subsection isPublished priorityNumber')
        .sort({ section: 1, subsection: 1, title: 1 })
        .lean(),
      IntelligenceBrief.find().select('title category').lean(),
    ]);

    const briefKey = (t, c) => `${normaliseLeadTitle(t)}::${c}`;
    const briefSet = new Set(briefs.map(b => briefKey(b.title, b.category)));

    const enriched = leads.map(l => ({
      ...l,
      hasBrief: briefSet.has(briefKey(l.title, l.category)),
    }));

    res.json({ status: 'success', data: { leads: enriched } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/intel-leads/priority?title=... — look up a lead's priorityNumber by title
router.get('/intel-leads/priority', async (req, res) => {
  try {
    const { title } = req.query;
    if (!title) return res.status(400).json({ message: 'title required' });
    const norm = normaliseLeadTitle(title);
    const leads = await IntelLead.find().select('title priorityNumber').lean();
    const match = leads.find(l => normaliseLeadTitle(l.title) === norm);
    if (!match) return res.status(404).json({ message: 'No matching lead found' });
    res.json({ status: 'success', data: { priorityNumber: match.priorityNumber ?? null } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/intel-leads/mark-complete — mark a lead as published in DB
router.post('/intel-leads/mark-complete', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });

    const norm  = normaliseLeadTitle(title);
    const leads = await IntelLead.find({ isPublished: false }).select('title');
    const match = leads.find(l => normaliseLeadTitle(l.title) === norm);
    if (!match) return res.status(404).json({ message: 'Lead not found or already marked' });

    await IntelLead.updateOne({ _id: match._id }, { isPublished: true });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/intel-leads/:id/create-stub — create a minimal status='stub'
// brief for a lead that doesn't yet have one. Lets the admin pre-seed an empty
// stub (so it shows up in lists and can be enriched later) without running the
// full AI generation flow. Rejects if any brief (stub or published) already
// exists for this lead's title+category.
router.post('/intel-leads/:id/create-stub', async (req, res) => {
  try {
    const lead = await IntelLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const existing = await IntelligenceBrief.findOne({
      title:    { $regex: new RegExp(`^${lead.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      category: lead.category,
    });
    if (existing) {
      return res.status(409).json({ message: `A brief already exists for "${lead.title}"` });
    }

    const stub = await IntelligenceBrief.create({
      title:               lead.title,
      subtitle:            lead.subtitle || '',
      category:            lead.category,
      subcategory:         lead.subcategory || '',
      status:              'stub',
      historic:            lead.isHistoric ?? false,
      priorityNumber:      lead.priorityNumber ?? null,
      descriptionSections: [],
      keywords:            [],
      sources:             [],
    });

    res.status(201).json({ status: 'success', data: { brief: stub } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/intel-leads/backfill-published — mark leads that have a matching published brief (stubs excluded).
// Mark-only: never unmarks. mark-complete is the authority for permanent state.
router.post('/intel-leads/backfill-published', async (req, res) => {
  try {
    const briefTitles = await IntelligenceBrief.distinct('title', { status: 'published' });
    const normPublished = new Set(briefTitles.map(normaliseLeadTitle));

    const leads = await IntelLead.find({ isPublished: false }).select('_id title');
    const toMark = leads.filter(l => normPublished.has(normaliseLeadTitle(l.title)));

    if (toMark.length) {
      await IntelLead.updateMany({ _id: { $in: toMark.map(l => l._id) } }, { isPublished: true });
    }

    res.json({ status: 'success', marked: toMark.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/leads/reset — wipe all leads + briefs, re-seed leads, create stub briefs
router.post('/leads/reset', requireReason, async (req, res) => {
  try {
    await seedLeads(openRouterChat);

    const [leadCount, briefCount] = await Promise.all([
      IntelLead.countDocuments(),
      IntelligenceBrief.countDocuments({ status: 'stub' }),
    ]);

    await AdminAction.create({ userId: req.user._id, actionType: 'reset_leads', reason: req.body.reason });
    res.json({ status: 'success', data: { leadsInserted: leadCount, stubsCreated: briefCount } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-keywords
// Generates up to `needed` additional keywords sourced from the description.
// Existing keyword strings are passed in so the AI doesn't repeat them.
function normTitle(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

router.post('/ai/generate-keywords', async (req, res) => {
  try {
    const { description, existingKeywords = [], needed: bodyNeeded, title = '', briefId = null } = req.body;
    if (!description) return res.status(400).json({ message: 'description required' });

    const kwAiSettings = await AppSettings.getSettings();
    const needed = bodyNeeded ?? kwAiSettings.aiKeywordsPerBrief ?? 20;
    if (needed <= 0)  return res.json({ status: 'success', data: { keywords: [] } });
    const desc = description.toLowerCase();

    // Pull subtitle/nickname from the brief so acronym-expansion rejection works
    // for existing briefs (e.g. a "JTAC" brief with subtitle "Joint Terminal
    // Attack Controllers" should never emit either form as a keyword).
    let subtitle = '';
    let nickname = '';
    if (briefId) {
      const briefDoc = await IntelligenceBrief.findById(briefId, 'subtitle nickname').lean();
      if (briefDoc) {
        subtitle = briefDoc.subtitle || '';
        nickname = briefDoc.nickname || '';
      }
    }
    const isTitleLike = buildTitleRejectCheck({ title, subtitle, nickname });

    const exclusionBits = [title, nickname, subtitle].filter(Boolean).map(s => `"${s}"`).join(', ');
    const titleExclusion = title
      ? `Do NOT use the topic title or name itself as a keyword — ${exclusionBits} and any shortened form, abbreviation, or expanded/acronym form must not appear as a keyword (e.g. if the title is "JTAC", do not extract "Joint Terminal Attack Controllers").\n\n`
      : '';

    // Shared seen-set seeded from caller's existingKeywords; mutated by each pass
    const seen = new Set(existingKeywords.map(k => k.toLowerCase()));
    const validateKws = (kwArray) => (Array.isArray(kwArray) ? kwArray : []).filter(k => {
      if (!k.keyword) return false;
      const kl = k.keyword.toLowerCase();
      if (!desc.includes(kl)) return false;
      if (seen.has(kl)) return false;
      if (isTitleLike(k.keyword)) return false;
      seen.add(kl);
      return true;
    });

    const kwSys  = [{ role: 'system', content: getPrompt(kwAiSettings, 'keywords') }];
    const kwMdl  = 'perplexity/sonar';
    const KW_JSON = '{"keywords":[{"keyword":"exact phrase from description","generatedDescription":"general RAF-specific definition of this term"},{"keyword":"...","generatedDescription":"..."}]}';
    const existingList = existingKeywords.length
      ? `Already used (do NOT repeat these): ${existingKeywords.join(', ')}\n\n`
      : '';

    // Pass 1 — technical terms, aircraft, operations, systems, training programmes (up to 10)
    let pass1 = [];
    const pass1Target = Math.min(10, needed);
    try {
      const r1 = await openRouterChat([...kwSys, {
        role: 'user',
        content: `Description:\n"""${description}"""\n\n${existingList}${titleExclusion}Extract exactly ${pass1Target} keywords from the description above. Every keyword MUST appear verbatim in the description. Choose technical terms, acronyms, aircraft designations, system names, operation names, training programmes, and roles — but never the subject/title of the brief itself.\n\nFor "generatedDescription": write a general RAF-specific definition. Do NOT reference or summarise the intel brief.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n${KW_JSON}`,
      }], kwMdl);
      pass1 = validateKws(JSON.parse(cleanJson(r1.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, pass1Target);
    } catch (e) { /* pass1 stays empty — caller gets whatever passes succeed */ }

    // Pass 2 — proper nouns: squadron names, base names, unit designations (up to 10)
    let pass2 = [];
    const pass2Target = Math.min(10, needed - pass1.length);
    if (pass2Target > 0) {
      try {
        const alreadyAll  = [...existingKeywords, ...pass1.map(k => k.keyword)];
        const alreadyList2 = alreadyAll.length ? `Already extracted (do NOT repeat): ${alreadyAll.join(', ')}\n\n` : '';
        const r2 = await openRouterChat([...kwSys, {
          role: 'user',
          content: `Description:\n"""${description}"""\n\n${alreadyList2}${titleExclusion}Extract up to ${pass2Target} proper noun keywords from the description above. Focus SPECIFICALLY on: RAF squadron names and numbers (e.g. "No. 617 Squadron", "XI Squadron"), RAF base and airfield names (e.g. "RAF Lossiemouth"), named military units, formations, and commands. Every keyword MUST appear verbatim in the description.\n\nFor "generatedDescription": write a general RAF-specific definition. Do NOT reference this intel brief.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n${KW_JSON}`,
        }], kwMdl);
        pass2 = validateKws(JSON.parse(cleanJson(r2.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, pass2Target);
      } catch (e) { /* pass2 stays empty */ }
    }

    // Pass 3 — coverage check: fills the gap left by passes 1 & 2, capped at 10
    const combined12 = [...pass1, ...pass2];
    const pass3Target = Math.min(10, needed - combined12.length);
    let pass3 = [];
    if (pass3Target > 0 && combined12.length > 0 && combined12.length + existingKeywords.length < needed) {
      try {
        const alreadyAll = [...existingKeywords, ...combined12.map(k => k.keyword)];
        const r3 = await openRouterChat([...kwSys, {
          role: 'user',
          content: `Description:\n"""${description}"""\n\nAlready extracted: ${alreadyAll.join(', ')}\n\nIdentify up to ${pass3Target} important terms from this description that were NOT already extracted. Look for aircraft designations, operation names, training programme names, squadron names, base names, technical systems, or role titles appearing verbatim in the description but absent from the list above. If nothing important is missing, return {"keywords":[]}.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n${KW_JSON}`,
        }], kwMdl);
        pass3 = validateKws(JSON.parse(cleanJson(r3.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, pass3Target);
      } catch (e) { /* pass3 stays empty */ }
    }

    // Auto-link keywords using the full 3-stage pipeline (word index → AI disambiguation → stub seeding)
    const linked = await autoLinkKeywords(
      [...combined12, ...pass3],
      [description],
      openRouterChat,
      briefId || null,
      title || null,
    );

    // Attach linkedBriefTitle so the admin UI can show it on hover without a reload
    const linkedIds = [...new Set(linked.map(k => k.linkedBriefId).filter(Boolean).map(String))];
    const titleMap = new Map();
    if (linkedIds.length) {
      const docs = await IntelligenceBrief.find({ _id: { $in: linkedIds } }).select('title').lean();
      docs.forEach(d => titleMap.set(String(d._id), d.title));
    }
    const keywords = linked.map(k => k.linkedBriefId
      ? { ...k, linkedBriefTitle: titleMap.get(String(k.linkedBriefId)) ?? null }
      : k);

    res.json({ status: 'success', data: { keywords } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-links
// Generic linked-brief suggester. sourceCategory + linkType determine the prompt.
// linkType: 'bases' | 'squadrons' | 'aircraft'
router.post('/ai/generate-links', async (req, res) => {
  try {
    const { sourceTitle, sourceDescription, sourceCategory, linkType, pool, isHistoric } = req.body;
    if (!sourceTitle) return res.status(400).json({ message: 'sourceTitle required' });
    if (!Array.isArray(pool) || pool.length === 0)
      return res.status(400).json({ message: 'pool required' });

    const linksAiSettings = await AppSettings.getSettings();
    const key = `${sourceCategory}:${linkType}`;
    const historicKey = `links.historic.${key}`;
    const currentKey  = `links.${key}`;
    const systemPrompt = isHistoric
      ? (getPrompt(linksAiSettings, historicKey) ?? getPrompt(linksAiSettings, currentKey))
      : getPrompt(linksAiSettings, currentKey);
    if (!systemPrompt) return res.status(400).json({ message: `Unsupported combination: ${key}` });

    const poolList = pool.map(b => `- "${b.title}"`).join('\n');
    const data = await openRouterChat([{
      role: 'system',
      content: systemPrompt + ' Return ONLY valid JSON — no markdown, no code blocks.',
    }, {
      role: 'user',
      content: `Brief: "${sourceTitle}"\n\nDescription:\n"""\n${sourceDescription ?? ''}\n"""\n\nAvailable ${linkType} briefs:\n${poolList}\n\nReturn the titles of all matching ${linkType} from the list above, copied exactly as written. Always use Arabic numerals for squadron numbers (e.g. "No. 4 Squadron RAF", never "No. IV Squadron RAF"). If none match, return an empty array.\n\nReturn ONLY valid JSON: {"titles":["Exact Title One","Exact Title Two"]}`,
    }], 'perplexity/sonar', 1024);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    // Match returned titles back to IDs using normalised string comparison
    const poolByNorm = new Map(pool.map(b => [normTitle(b.title), String(b._id)]));
    const ids = (Array.isArray(parsed.titles) ? parsed.titles : [])
      .map(t => poolByNorm.get(normTitle(t)))
      .filter(Boolean);

    res.json({ status: 'success', data: { ids } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-bases
// Given an aircraft brief title + body and a list of available base briefs,
// asks the AI which bases are home bases for this aircraft.
router.post('/ai/generate-bases', async (req, res) => {
  try {
    const { title, body, basesBriefs, isHistoric } = req.body;
    if (!title) return res.status(400).json({ message: 'title required' });
    if (!Array.isArray(basesBriefs) || basesBriefs.length === 0)
      return res.status(400).json({ message: 'basesBriefs required' });

    const baseList = basesBriefs.map(b => `- "${b.title}" (id: ${b._id})`).join('\n');

    const basesAiSettings = await AppSettings.getSettings();
    const sysPrompt = isHistoric
      ? getPrompt(basesAiSettings, 'bases.historic')
      : getPrompt(basesAiSettings, 'bases.current');

    const userPrompt = isHistoric
      ? `Aircraft: "${title}"\n\nBrief body:\n"""\n${body ?? ''}\n"""\n\nAvailable base briefs:\n${baseList}\n\nReturn the IDs of bases that were historically home bases for this aircraft during its RAF service. If none match, return an empty array.\n\nReturn ONLY valid JSON: {"baseIds":["id1","id2"]}`
      : `Aircraft: "${title}"\n\nBrief body:\n"""\n${body ?? ''}\n"""\n\nAvailable base briefs:\n${baseList}\n\nReturn the IDs of bases that are home bases for this aircraft. Only include bases where this aircraft type is stationed. If none match, return an empty array.\n\nReturn ONLY valid JSON: {"baseIds":["id1","id2"]}`;

    const data = await openRouterChat([{
      role: 'system',
      content: sysPrompt,
    }, {
      role: 'user',
      content: userPrompt,
    }], 'perplexity/sonar', 512);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(cleanJson(raw));
    const validIds = new Set(basesBriefs.map(b => String(b._id)));
    const baseIds = (Array.isArray(parsed.baseIds) ? parsed.baseIds : [])
      .map(String)
      .filter(id => validIds.has(id));

    res.json({ status: 'success', data: { baseIds } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-quiz
router.post('/ai/generate-quiz', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title && !description) return res.status(400).json({ message: 'title or description required' });
    const quizAiSettings = await AppSettings.getSettings();
    const targetQ = quizAiSettings.aiQuestionsPerDifficulty ?? 7;
    const data = await openRouterChat([{
      role: 'system',
      content: getPrompt(quizAiSettings, 'quiz'),
    }, {
      role: 'user',
      content: `Intel Brief Title: ${title}\n\nIntel Brief Description:\n"""\n${description ?? ''}\n"""\n\nUsing ONLY the facts stated in the description above, generate exactly ${targetQ} easy and ${targetQ} medium quiz questions.\n\nCRITICAL RULES:\n1. Every question must be directly answerable from the description text — if the answer cannot be found in the description, do not include the question.\n2. Prioritise the most important, high-value facts: operational roles, training phases, aircraft designations, base locations, unit names, and key distinguishing details.\n3. Easy questions test direct recall of the most important specific facts stated in the description (names, dates, locations, aircraft types, unit designations, etc.).\n4. Medium questions require understanding of context or relationships between facts stated in the description.\n5. The correct answer must be explicitly supported by the description.\n6. Wrong answers must be plausible but clearly incorrect based on the description.\n7. Exactly 7 answer options per question. correctAnswerIndex is the 0-based index of the correct answer.\n8. ${QUIZ_ANSWER_FORMAT_RULES}\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"easyQuestions":[{"question":"...","answers":["answer option 1","answer option 2","answer option 3","answer option 4","answer option 5","answer option 6","answer option 7"],"correctAnswerIndex":0}],"mediumQuestions":[...]}`,
    }], 'openai/gpt-4o', 4096);
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let generated;
    try {
      generated = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[generate-quiz] JSON parse failed. Raw response:', raw.slice(0, 500));
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }
    const warnings = [];
    const { easyQuestions, mediumQuestions } = await ensureQuizQuality(
      normalizeQuizAnswers(generated.easyQuestions),
      normalizeQuizAnswers(generated.mediumQuestions),
      description ?? '',
      title ?? '',
      getPrompt(quizAiSettings, 'quiz'),
      warnings,
      targetQ,
    );
    res.json({ status: 'success', data: { easyQuestions, mediumQuestions, warnings } });
  } catch (err) {
    console.error('[generate-quiz] error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-quiz-missing
// Generates `needed` new questions for a single difficulty tier, avoiding repeats of existing questions.
router.post('/ai/generate-quiz-missing', async (req, res) => {
  try {
    const { title, description, difficulty = 'easy', existingQuestions = [], needed = 1 } = req.body;
    if (!title && !description) return res.status(400).json({ message: 'title or description required' });
    if (needed <= 0) return res.json({ status: 'success', data: { questions: [] } });

    const existingList = existingQuestions.length
      ? `\n\nExisting questions (do NOT repeat or closely paraphrase any of these):\n${existingQuestions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}`
      : '';

    const aiSettings = await AppSettings.getSettings();
    const quizMissingPrompt = getPrompt(aiSettings, 'quizMissing');
    const data = await openRouterChat([{
      role: 'system',
      content: quizMissingPrompt,
    }, {
      role: 'user',
      content: `Intel Brief Title: ${title}\n\nIntel Brief Description:\n"""\n${description ?? ''}\n"""${existingList}\n\nUsing ONLY the facts stated in the description above, generate exactly ${needed} NEW ${getDifficultyLabel(difficulty)} quiz question${needed > 1 ? 's' : ''}.\n\n${QUIZ_QUESTION_RULES}\n8. Do NOT repeat or closely paraphrase any of the existing questions listed above.\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"questions":[{"question":"...","answers":["answer option 1","answer option 2","answer option 3","answer option 4","answer option 5","answer option 6","answer option 7"],"correctAnswerIndex":0}]}`,
    }], 'openai/gpt-4o', 4096);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let generated;
    try {
      generated = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[generate-quiz-missing] JSON parse failed. Raw response:', raw.slice(0, 500));
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }
    // Fix answer counts on returned questions (question count is caller-controlled)
    const warnings = [];
    let questions = normalizeQuizAnswers(generated.questions ?? []).slice(0, needed);
    for (let i = 0; i < questions.length; i++) {
      questions[i] = await fixAnswersWithRetry(questions[i], description ?? '', quizMissingPrompt, warnings);
    }
    res.json({ status: 'success', data: { questions } });
  } catch (err) {
    console.error('[generate-quiz-missing] error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/regenerate-brief/:id
// Regenerates description sections, keywords, and quiz questions for an existing brief.
// ── Shared helper: generate description, keywords, quiz, gameData, mnemonics ─
async function generateBriefContent(brief, aiSettings) {
  const { array: dsArray, countRule: dsCountRule, sharedRuleTail: dsRuleTail } = buildDescriptionSectionsSpec({ strict: false });
  // Keywords are generated separately via multi-pass extraction after we have the description,
  // so they are NOT included in this combined call — that was the cause of the 8-keyword cap.
  let TOPIC_JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text, no citation markers like [1]:\n{\n  "descriptionSections": [\n    ${dsArray}\n  ]\n}\nCRITICAL RULES:\n1. ${dsCountRule} ${dsRuleTail}`;
  TOPIC_JSON_SHAPE += `\n${LIST_FORMAT_RULE}`;

  // Inject subtitle before descriptionSections
  TOPIC_JSON_SHAPE = TOPIC_JSON_SHAPE.replace(
    '"descriptionSections"',
    '"subtitle": "one factual sentence summarising the subject",\n  "descriptionSections"'
  );
  // Inject sources array before the closing } of the JSON schema
  const SOURCES_SHAPE = `"sources": [\n    {"url": "https://full-url-of-actual-source.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"},\n    {"url": "https://second-source-url.com", "siteName": "Publication Name", "articleDate": "YYYY-MM-DD"}\n  ]`;
  TOPIC_JSON_SHAPE = TOPIC_JSON_SHAPE.replace(
    '\n}\nCRITICAL RULES:',
    `,\n  ${SOURCES_SHAPE}\n}\nCRITICAL RULES:`
  );
  TOPIC_JSON_SHAPE += `\nFor "sources": list 1–3 real published URLs about this specific RAF topic (e.g. its Wikipedia page, raf.mod.uk, gov.uk). Set "articleDate" to the article's real publish date in YYYY-MM-DD format, or the Wikipedia page's last-modified date.`;

  const gdShape = booGameDataShape(brief.category);
  if (gdShape) {
    TOPIC_JSON_SHAPE = TOPIC_JSON_SHAPE.replace(
      '\n}\nCRITICAL RULES:',
      `,\n  ${gdShape}\n}\nCRITICAL RULES:`
    );
    const gdNote = booGameDataNote(brief.category);
    if (gdNote) TOPIC_JSON_SHAPE += `\n${gdNote}`;
  }

  const systemPromptKey = TOPIC_PROMPT_BY_CATEGORY[brief.category] || 'regenerateBrief';
  const briefData = await openRouterChat([{
    role: 'system',
    content: getPrompt(aiSettings, systemPromptKey),
  }, {
    role: 'user',
    content: `Rewrite a comprehensive intelligence brief about this RAF topic: "${brief.title}"\n\nUsing verified facts from published sources, produce a reference-style brief suitable for someone building foundational knowledge of the modern RAF. Where relevant, cover: training pathways and which training blocks/phases apply to this subject; RAF bases associated with this subject and which aircraft or squadrons are stationed there and what operations occur there; roles that interact with or are defined by this subject and how those roles relate to specific training pipelines; and the broader operational and modern-day RAF significance.\n\n${TOPIC_JSON_SHAPE}`,
  }], 'perplexity/sonar', 8192);

  const briefRaw = briefData.choices?.[0]?.message?.content ?? '{}';
  let briefGenerated;
  try {
    const cleaned = cleanJson(briefRaw);
    try {
      briefGenerated = JSON.parse(cleaned);
    } catch {
      briefGenerated = JSON.parse(repairJson(cleaned));
    }
  } catch (parseErr) {
    console.error('[generateBriefContent] brief JSON parse failed. Raw:', briefRaw);
    throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
  }

  const descriptionSections = (Array.isArray(briefGenerated.descriptionSections) ? briefGenerated.descriptionSections : [])
    .map(s => typeof s === 'string' ? s.replace(/[*_`#]/g, '') : s);
  const subtitle = typeof briefGenerated.subtitle === 'string' ? briefGenerated.subtitle.trim() : null;
  const sources  = Array.isArray(briefGenerated.sources) ? briefGenerated.sources : [];

  // ── Multi-pass keyword extraction (same 3-pass pipeline as single-brief generation) ──
  // Runs on the generated description so Sonar can focus each call on keywords only,
  // removing the token-limit bottleneck that previously forced a hard cap of 8.
  let keywords = [];
  if (descriptionSections.length) {
    const descriptionText = descriptionSections.join('\n\n');
    const descLower = descriptionText.toLowerCase();
    const isTitleLike = buildTitleRejectCheck({
      title:    brief.title,
      subtitle: subtitle || brief.subtitle,
      nickname: brief.nickname,
    });
    const seen = new Set();
    const validateKws = (kwArray) => (Array.isArray(kwArray) ? kwArray : []).filter(k => {
      if (!k.keyword) return false;
      const kl = k.keyword.toLowerCase();
      if (!descLower.includes(kl)) return false;
      if (seen.has(kl)) return false;
      if (isTitleLike(k.keyword)) return false;
      seen.add(kl);
      return true;
    });

    const kwSys = [{ role: 'system', content: getPrompt(aiSettings, 'keywords') }];
    const kwMdl = 'perplexity/sonar';
    const KW_JSON = '{"keywords":[{"keyword":"exact phrase from description","generatedDescription":"general RAF-specific definition"},...]}';

    // Pass 1 — technical terms, aircraft, operations, systems, roles (10 keywords)
    let pass1 = [];
    try {
      const r1 = await openRouterChat([...kwSys, {
        role: 'user',
        content: `Description:\n"""${descriptionText}"""\n\nExtract exactly 10 keywords from the description above. Every keyword MUST appear verbatim in the description. Choose technical terms, acronyms, aircraft designations, system names, operation names, training programmes, and roles — but never the subject/title of the brief itself, including its expanded form, abbreviation, subtitle, or nickname (e.g. if the brief is titled "JTAC", do not extract "Joint Terminal Attack Controllers").\n\nFor "generatedDescription": write a general RAF-specific definition. Do NOT reference this intel brief.\n\nReturn ONLY valid JSON:\n${KW_JSON}`,
      }], kwMdl);
      pass1 = validateKws(JSON.parse(cleanJson(r1.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, 10);
    } catch (e) { console.warn('[generateBriefContent] Keywords pass 1:', e.message); }

    // Pass 2 — proper nouns: squadron names, base names, unit designations (up to 10)
    let pass2 = [];
    try {
      const alreadyList = pass1.length ? `Already extracted (do NOT repeat): ${pass1.map(k => k.keyword).join(', ')}\n\n` : '';
      const r2 = await openRouterChat([...kwSys, {
        role: 'user',
        content: `Description:\n"""${descriptionText}"""\n\n${alreadyList}Extract up to 10 proper noun keywords from the description above. Focus SPECIFICALLY on: RAF squadron names and numbers (e.g. "No. 617 Squadron", "XI Squadron"), RAF base and airfield names (e.g. "RAF Lossiemouth"), named military units, formations, and commands. Every keyword MUST appear verbatim in the description.\n\nFor "generatedDescription": write a general RAF-specific definition. Do NOT reference this intel brief.\n\nReturn ONLY valid JSON:\n${KW_JSON}`,
      }], kwMdl);
      pass2 = validateKws(JSON.parse(cleanJson(r2.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, 10);
    } catch (e) { console.warn('[generateBriefContent] Keywords pass 2:', e.message); }

    // Pass 3 — coverage check: up to 5 important terms missed by passes 1 & 2
    const combined12 = [...pass1, ...pass2];
    let pass3 = [];
    if (combined12.length > 0) {
      try {
        const r3 = await openRouterChat([...kwSys, {
          role: 'user',
          content: `Description:\n"""${descriptionText}"""\n\nAlready extracted: ${combined12.map(k => k.keyword).join(', ')}\n\nIdentify up to 5 important terms from this description that were NOT already extracted. Look for aircraft designations, operation names, training programme names, squadron names, base names, technical systems, or role titles appearing verbatim in the description but absent from the list above. If nothing important is missing, return {"keywords":[]}.\n\nReturn ONLY valid JSON:\n${KW_JSON}`,
        }], kwMdl);
        pass3 = validateKws(JSON.parse(cleanJson(r3.choices?.[0]?.message?.content ?? '{}')).keywords ?? []).slice(0, 5);
      } catch (e) { console.warn('[generateBriefContent] Keywords pass 3:', e.message); }
    }

    keywords = [...combined12, ...pass3];
  }

  // Terms too generic to ever be useful as keywords — the whole app is about the RAF,
  // so highlighting these adds noise rather than value. Units with their own brief
  // (e.g. RAF Regiment) are surfaced via mentionedBriefIds/associatedBriefIds instead.
  const GENERIC_KEYWORD_EXCLUSIONS = new Set([
    'royal air force',
    'raf',
    'raf regiment',
  ]);

  if (descriptionSections.length) {
    const descText = descriptionSections.join(' ').toLowerCase();
    const titleLower = brief.title.toLowerCase();
    keywords = keywords.filter(k => {
      if (!k.keyword) return false;
      const kl = k.keyword.toLowerCase();
      if (!descText.includes(kl)) return false;
      // Exclude if keyword is the title itself or either contains the other
      if (titleLower && (kl === titleLower || titleLower.includes(kl) || kl.includes(titleLower))) return false;
      // Exclude globally generic terms that add no value as standalone keywords
      if (GENERIC_KEYWORD_EXCLUSIONS.has(kl)) return false;
      return true;
    });
  }
  // Auto-link keywords to their corresponding Intel Brief stubs/published briefs
  // using a two-stage pipeline: word-level pre-filter → AI disambiguation.
  try {
    keywords = await autoLinkKeywords(keywords, descriptionSections, openRouterChat, brief._id, brief.title);
  } catch (linkErr) {
    console.error('[generateBriefContent] keyword auto-linking failed (non-fatal):', linkErr.message);
    SystemLog.create({
      type:          'brief_generation_failure',
      briefId:       brief._id,
      briefTitle:    brief.title,
      briefCategory: brief.category,
      stage:         'keyword_linking',
      failureReason: linkErr.message,
    }).catch(() => {});
  }

  let gameData = (gdShape && briefGenerated.gameData && typeof briefGenerated.gameData === 'object')
    ? briefGenerated.gameData
    : null;

  if (brief.category === 'Ranks') {
    const rankOrder = lookupRankHierarchy(brief.title);
    if (rankOrder !== null) gameData = { rankHierarchyOrder: rankOrder };
  }

  const freshDescription = descriptionSections.join('\n\n');
  const targetQ = aiSettings.aiQuestionsPerDifficulty ?? 7;
  const quizData = await openRouterChat([{
    role: 'system',
    content: getPrompt(aiSettings, 'quiz'),
  }, {
    role: 'user',
    content: `Intel Brief Title: ${brief.title}\n\nIntel Brief Description:\n"""\n${freshDescription}\n"""\n\nUsing ONLY the facts stated in the description above, generate exactly ${targetQ} easy and ${targetQ} medium quiz questions.\n\nCRITICAL RULES:\n1. Every question must be directly answerable from the description text — if the answer cannot be found in the description, do not include the question.\n2. Prioritise the most important, high-value facts: operational roles, training phases, aircraft designations, base locations, unit names, and key distinguishing details.\n3. Easy questions test direct recall of the most important specific facts stated in the description (names, dates, locations, aircraft types, unit designations, etc.).\n4. Medium questions require understanding of context or relationships between facts stated in the description.\n5. The correct answer must be explicitly supported by the description.\n6. Wrong answers must be plausible but clearly incorrect based on the description.\n7. Exactly 7 answer options per question. correctAnswerIndex is the 0-based index of the correct answer.\n8. Wrong answers must be complete sentences or meaningful phrases (minimum 5 words each) — never single words, never just a number or acronym alone.\n9. The correct answer must also be a complete sentence or meaningful phrase drawn directly from the description — never a single word or bare number.\n10. ${QUIZ_ANSWER_FORMAT_RULES}\n\nReturn ONLY valid JSON — no markdown, no code blocks:\n{"easyQuestions":[{"question":"...","answers":["answer option 1","answer option 2","answer option 3","answer option 4","answer option 5","answer option 6","answer option 7"],"correctAnswerIndex":0}],"mediumQuestions":[...]}`,
  }], 'openai/gpt-4o', 8192);

  const quizRaw = quizData.choices?.[0]?.message?.content ?? '{}';
  let quizGenerated;
  try {
    const cleaned = cleanJson(quizRaw);
    try {
      quizGenerated = JSON.parse(cleaned);
    } catch {
      quizGenerated = JSON.parse(repairJson(cleaned));
    }
  } catch (parseErr) {
    console.error('[generateBriefContent] quiz JSON parse failed. Raw:', quizRaw.slice(0, 500));
    throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
  }

  const resolvedGameData = gameData ?? brief.gameData?.toObject?.() ?? brief.gameData ?? {};
  let mnemonics = null;
  try {
    mnemonics = await generateMnemonicsForBrief(brief.title, brief.category, resolvedGameData, getPrompt(aiSettings, 'mnemonic.batch'));
  } catch (mnemonicErr) {
    console.error('[generateBriefContent] mnemonic generation failed (non-fatal):', mnemonicErr.message);
    SystemLog.create({
      type:          'brief_generation_failure',
      briefId:       brief._id,
      briefTitle:    brief.title,
      briefCategory: brief.category,
      stage:         'mnemonic',
      failureReason: mnemonicErr.message,
    }).catch(() => {});
  }

  const quizWarnings = [];
  let { easyQuestions, mediumQuestions } = await ensureQuizQuality(
    normalizeQuizAnswers(quizGenerated.easyQuestions),
    normalizeQuizAnswers(quizGenerated.mediumQuestions),
    freshDescription,
    brief.title,
    getPrompt(aiSettings, 'quiz'),
    quizWarnings,
    targetQ,
  );

  return {
    descriptionSections,
    keywords,
    subtitle,
    sources,
    easyQuestions,
    mediumQuestions,
    gameData,
    mnemonics,
    _quizWarnings: quizWarnings,
  };
}

// POST /api/admin/ai/regenerate-brief/:id
// Regenerates description sections, keywords, and quiz questions for an existing brief.
router.post('/ai/regenerate-brief/:id', async (req, res) => {
  let brief;
  try {
    brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    const aiSettings = await AppSettings.getSettings();
    const { descriptionSections, keywords, subtitle, sources, easyQuestions, mediumQuestions, gameData, mnemonics, _quizWarnings } = await generateBriefContent(brief, aiSettings);
    let enrichedSources = sources;
    if (sources.length) {
      try {
        enrichedSources = await enrichSourceDates(sources);
      } catch (srcErr) {
        console.error('[regenerate-brief] source date enrichment failed (non-fatal):', srcErr.message);
      }
    }
    res.json({
      status: 'success',
      data: {
        descriptionSections,
        keywords,
        ...(subtitle          ? { subtitle }                  : {}),
        ...(enrichedSources.length ? { sources: enrichedSources } : {}),
        easyQuestions,
        mediumQuestions,
        ...(gameData  ? { gameData }  : {}),
        ...(mnemonics ? { mnemonics } : {}),
      },
      warnings: _quizWarnings ?? [],
    });
  } catch (err) {
    SystemLog.create({
      type:          'brief_generation_failure',
      briefId:       brief?._id ?? null,
      briefTitle:    brief?.title ?? '',
      briefCategory: brief?.category ?? '',
      stage:         err.message?.includes('quiz') ? 'quiz' : 'description',
      failureReason: err.message,
    }).catch(logErr => console.error('[regenerate-brief] SystemLog write failed:', logErr.message));
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/bulk-generate-stub/:id
// Full server-side pipeline for a single stub: generates content, image, and links,
// then saves everything to DB and promotes the stub to published.
const BULK_LINK_CONFIG = {
  Aircrafts: [
    { linkType: 'bases',     field: 'associatedBaseBriefIds',     poolCategory: 'Bases' },
    { linkType: 'squadrons', field: 'associatedSquadronBriefIds', poolCategory: 'Squadrons' },
    { linkType: 'missions',  field: 'associatedMissionBriefIds',  poolCategory: 'Missions' },
  ],
  Squadrons: [
    { linkType: 'bases',    field: 'associatedBaseBriefIds',     poolCategory: 'Bases' },
    { linkType: 'aircraft', field: 'associatedAircraftBriefIds', poolCategory: 'Aircrafts' },
    { linkType: 'missions', field: 'associatedMissionBriefIds',  poolCategory: 'Missions' },
  ],
  Bases: [
    { linkType: 'squadrons', field: 'associatedSquadronBriefIds', poolCategory: 'Squadrons' },
    { linkType: 'aircraft',  field: 'associatedAircraftBriefIds', poolCategory: 'Aircrafts' },
  ],
  Roles: [
    { linkType: 'training', field: 'associatedTrainingBriefIds', poolCategory: 'Training' },
  ],
  Tech: [
    { linkType: 'aircraft', field: 'associatedAircraftBriefIds', poolCategory: 'Aircrafts' },
  ],
};

router.post('/ai/bulk-generate-stub/:id', async (req, res) => {
  let brief;
  try {
    brief = await IntelligenceBrief.findById(req.params.id);
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.status !== 'stub') return res.status(400).json({ message: 'Brief is not a stub' });

    const aiSettings = await AppSettings.getSettings();
    const generationWarnings = [];

    // ── Part A: description + keywords + subtitle + sources + quiz + gameData + mnemonics ──
    const { descriptionSections, keywords, subtitle, sources, easyQuestions, mediumQuestions, gameData, mnemonics, _quizWarnings } =
      await generateBriefContent(brief, aiSettings);
    if (_quizWarnings?.length) {
      for (const w of _quizWarnings) generationWarnings.push(`Quiz: ${w}`);
    }

    // ── Part A2: Scrape real source publication dates ──────────────────────────
    let enrichedSources = sources;
    if (sources.length) {
      try {
        enrichedSources = await enrichSourceDates(sources);
      } catch (srcErr) {
        console.error('[bulk-generate-stub] source date enrichment failed (non-fatal):', srcErr.message);
      }
    }

    // ── Part B: images ────────────────────────────────────────────────────────
    const { mediaDocs: stubMediaDocs, searchTerms: imageSearchTerms, warnings: stubImgWarnings } =
      await generateBriefImages({
        title: brief.title,
        subtitle: brief.subtitle,
        imagePromptBase: getPrompt(aiSettings, 'imageExtraction'),
        publicIdPrefix: 'brief-bulk',
      });
    for (const w of stubImgWarnings) generationWarnings.push(`Image: ${w}`);
    if (!stubMediaDocs.length) {
      SystemLog.create({
        type:          'image_fetch_failure',
        briefId:       brief._id,
        briefTitle:    brief.title,
        briefCategory: brief.category,
        searchTerms:   imageSearchTerms,
        failureReason: 'All Wikipedia search terms failed to produce an image',
      }).catch(() => {});
      generationWarnings.push('Image: no image found — see System Logs');
    }

    // ── Part C: linked brief IDs ──────────────────────────────────────────────
    const linkUpdates = {};
    const linkConfig = BULK_LINK_CONFIG[brief.category] ?? [];
    if (linkConfig.length > 0) {
      const descriptionText = descriptionSections.join('\n\n');
      // Fetch all needed pools in parallel
      const poolCategories = [...new Set(linkConfig.map(l => l.poolCategory))];
      const pools = {};
      await Promise.all(poolCategories.map(async (cat) => {
        // When the brief being generated is not itself historic, exclude historic
        // aircraft from the pool so retired/retired types are never linked to
        // current bases, squadrons, or tech briefs.
        const query = { category: cat };
        if (cat === 'Aircrafts' && !brief.historic) query.historic = { $ne: true };
        const items = await IntelligenceBrief
          .find(query, '_id title')
          .lean();
        pools[cat] = items;
      }));

      // Generate links for each type (sequentially to avoid rate limits)
      for (const { linkType, field, poolCategory } of linkConfig) {
        const pool = pools[poolCategory] ?? [];
        if (!pool.length) {
          generationWarnings.push(`[${linkType}] Skipped — no published ${poolCategory} briefs in pool`);
          continue;
        }
        try {
          const linkKey = `${brief.category}:${linkType}`;
          const systemPrompt = brief.historic
            ? (getPrompt(aiSettings, `links.historic.${linkKey}`) ?? getPrompt(aiSettings, `links.${linkKey}`))
            : getPrompt(aiSettings, `links.${linkKey}`);
          if (!systemPrompt) {
            generationWarnings.push(`[${linkType}] Skipped — no prompt found for key links.${linkKey}`);
            continue;
          }

          const poolList = pool.map(b => `- "${b.title}"`).join('\n');
          const linkData = await openRouterChat([{
            role: 'system',
            content: systemPrompt + ' Return ONLY valid JSON — no markdown, no code blocks.',
          }, {
            role: 'user',
            content: `Brief: "${brief.title}"\n\nDescription:\n"""\n${descriptionText}\n"""\n\nAvailable ${linkType} briefs:\n${poolList}\n\nReturn the titles of all matching ${linkType} from the list above, copied exactly as written. Always use Arabic numerals for squadron numbers (e.g. "No. 4 Squadron RAF", never "No. IV Squadron RAF"). If none match, return an empty array.\n\nReturn ONLY valid JSON: {"titles":["Exact Title One","Exact Title Two"]}`,
          }], 'perplexity/sonar', 1024);

          const linkRaw = linkData.choices?.[0]?.message?.content ?? '{}';
          const parsed = JSON.parse(cleanJson(linkRaw));
          const poolByNorm = new Map(pool.map(b => [normTitle(b.title), String(b._id)]));
          const ids = (Array.isArray(parsed.titles) ? parsed.titles : [])
            .map(t => poolByNorm.get(normTitle(t)))
            .filter(Boolean);
          if (ids.length) {
            linkUpdates[field] = ids;
            generationWarnings.push(`[${linkType}] Linked ${ids.length} brief(s)`);
          } else {
            generationWarnings.push(`[${linkType}] AI matched 0 of ${pool.length} pool briefs`);
          }
        } catch (linkErr) {
          console.error(`[bulk-generate-stub] link generation for ${linkType} failed (non-fatal):`, linkErr.message);
          generationWarnings.push(`[${linkType}] Error: ${linkErr.message}`);
        }
      }
    }

    // ── Part D: save to DB ────────────────────────────────────────────────────
    // 1. Save quiz questions
    const gameType = await GameType.findOne({ gameTitle: 'quiz' });
    if (gameType) {
      await GameQuizQuestion.deleteMany({ intelBriefId: brief._id });
      const createQs = async (questions, difficulty) => {
        const ids = [];
        for (const q of questions) {
          if (!Array.isArray(q.answers) || q.answers.length !== 7) {
            const got = Array.isArray(q.answers) ? q.answers.length : 0;
            const msg = `Skipped ${difficulty} question (got ${got} answers, expected 7): "${q.question?.slice(0, 60)}"`;
            generationWarnings.push(msg);
            console.warn(`[bulk-generate-stub] ${msg}`);
            continue;
          }
          const answers = q.answers.map(a => ({ _id: new mongoose.Types.ObjectId(), title: typeof a === 'string' ? a : a.title }));
          const doc = await GameQuizQuestion.create({
            gameTypeId:      gameType._id,
            intelBriefId:    brief._id,
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
        createQs(easyQuestions, 'easy'),
        createQs(mediumQuestions, 'medium'),
      ]);
      brief.quizQuestionsEasy   = easyIds;
      brief.quizQuestionsMedium = mediumIds;
    }

    // 2. Save image
    if (stubMediaDocs.length) {
      brief.media = stubMediaDocs.map(m => m._id);
    }

    // 3. Update brief fields
    brief.descriptionSections = descriptionSections;
    brief.keywords = keywords;
    if (subtitle) brief.subtitle = subtitle;
    if (enrichedSources.length) brief.sources = enrichedSources;
    brief.status = 'published';
    if (!brief.publishedAt) brief.publishedAt = new Date();
    if (gameData) brief.gameData = gameData;
    if (mnemonics) brief.mnemonics = mnemonics;
    for (const [field, ids] of Object.entries(linkUpdates)) {
      brief[field] = ids;
    }

    // Scan description for text mentions of other briefs — stored so page load
    // can populate them directly instead of running a live 850+ brief scan.
    try {
      brief.mentionedBriefIds = await scanMentionedBriefIds(brief, openRouterChat);
    } catch (scanErr) {
      console.error('[bulk-generate-stub] mentionedBriefIds scan failed (non-fatal):', scanErr.message);
    }

    await brief.save();

    await AdminAction.create({ userId: req.user._id, actionType: 'create_brief', reason: 'Bulk auto-generate' });

    // Persist any non-trivial warnings so they survive beyond this HTTP response
    const seriousWarnings = generationWarnings.filter(w =>
      w.includes('Error:') || w.includes('Skipped') || w.includes('System Logs') ||
      w.includes('quiz') || w.includes('Quiz')
    );
    if (seriousWarnings.length) {
      SystemLog.create({
        type:          'bulk_generation_warnings',
        briefId:       brief._id,
        briefTitle:    brief.title,
        briefCategory: brief.category,
        warnings:      seriousWarnings,
      }).catch(() => {});
    }

    res.json({ status: 'success', data: { _id: brief._id, title: brief.title, category: brief.category }, warnings: generationWarnings });
  } catch (err) {
    SystemLog.create({
      type:          'brief_generation_failure',
      briefId:       brief?._id ?? null,
      briefTitle:    brief?.title ?? '',
      briefCategory: brief?.category ?? '',
      stage:         err.message?.includes('quiz') ? 'quiz' : 'description',
      failureReason: err.message,
    }).catch(logErr => console.error('[bulk-generate-stub] SystemLog write failed:', logErr.message));
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/regenerate-description/:id
// Regenerates the description sections for an existing brief.
// Cascade-deletes all user data first (reads, games, questions, aircoins) because
// questions/answers derived from the old description become stale.
router.post('/ai/regenerate-description/:id', requireReason, async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id).select('title category');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });

    const cascadeStats = await cascadeDeleteBriefData(req.params.id);

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'regenerate_description_cascade',
      reason:     req.body.reason,
    });

    const { array: dsArray, countRule: dsCountRule, sharedRuleTail: dsRuleTail } = buildDescriptionSectionsSpec({ strict: false });
    const DESC_JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks, no extra text:\n{\n  "descriptionSections": [\n    ${dsArray}\n  ]\n}\nCRITICAL RULES:\n1. ${dsCountRule} ${dsRuleTail}\n${LIST_FORMAT_RULE}`;

    const descAiSettings = await AppSettings.getSettings();
    const data = await openRouterChat([{
      role: 'system',
      content: getPrompt(descAiSettings, 'regenerateBrief'),
    }, {
      role: 'user',
      content: `Write fresh description sections for this RAF intel brief: "${brief.title}"\n\nUsing verified facts from published sources, produce clear, informative paragraphs suitable for someone building foundational knowledge of the modern RAF.\n\n${DESC_JSON_SHAPE}`,
    }], 'perplexity/sonar', 4096);

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    let generated;
    try {
      generated = JSON.parse(cleanJson(raw));
    } catch (parseErr) {
      console.error('[regenerate-description] JSON parse failed. Raw:', raw);
      throw new Error(`AI response was not valid JSON: ${parseErr.message}`);
    }

    const descriptionSections = (Array.isArray(generated.descriptionSections) ? generated.descriptionSections : [])
      .map(s => typeof s === 'string' ? s.replace(/[*_`#]/g, '') : s);
    res.json({ status: 'success', data: { descriptionSections, cascade: cascadeStats } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/media/brief-image — remove a pending brief image from Cloudinary
router.delete('/media/brief-image', async (req, res) => {
  try {
    const { publicId } = req.body;
    if (!publicId) return res.status(400).json({ message: 'publicId required' });
    await destroyAsset(publicId).catch(() => {});
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-battle-order-data
// Accepts { title, description, category } and returns the relevant gameData fields for that category.
const BOO_ELIGIBLE = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'];
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
      fieldSpec = 'trainingWeekStart (integer, the week number in the RAF career training pipeline when this phase begins — use 0 if unknown; set to null if this brief covers cadet-facing activities such as AEF, ATC/CCF flying, or gliding scholarships, because those run on a separate cadet schedule that cannot be compared with the regular RAF career pipeline), trainingWeekEnd (integer, the week number in the pipeline when this phase ends — same null rule as trainingWeekStart), weeksOfTraining (integer, total duration of this training phase in weeks — may still be populated for cadet-facing activities if a clear duration exists; use 0 if unknown)';
      jsonShape = '{"trainingWeekStart":3,"trainingWeekEnd":5,"weeksOfTraining":2}';
    } else if (category === 'Bases') {
      fieldSpec = 'startYear (integer, year this RAF base was established/opened), endYear (integer or null if still active)';
      jsonShape = '{"startYear":1936,"endYear":null}';
    } else if (category === 'Squadrons') {
      fieldSpec = 'startYear (integer, year this squadron was formed/reformed), endYear (integer or null if still active)';
      jsonShape = '{"startYear":1915,"endYear":null}';
    } else if (category === 'Threats') {
      fieldSpec = 'startYear (integer, year this weapon/threat system entered service), endYear (integer or null if still in service)';
      jsonShape = '{"startYear":2007,"endYear":null}';
    } else {
      // Missions, Tech, Treaties
      fieldSpec = 'startYear (integer, year this began/was introduced/enacted), endYear (integer or null if still ongoing/in service)';
      jsonShape = '{"startYear":1939,"endYear":1945}';
    }

    const booAiSettings = await AppSettings.getSettings();
    const data = await openRouterChat([{
      role: 'system',
      content: getPrompt(booAiSettings, 'battleOrderData'),
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

// POST /api/admin/ai/generate-rank-data/:id
// For Ranks category briefs: looks up rankHierarchyOrder deterministically from the title.
// No AI call — uses the canonical RANK_HIERARCHY table to guarantee uniqueness and accuracy.
router.post('/ai/generate-rank-data/:id', async (req, res) => {
  try {
    const brief = await IntelligenceBrief.findById(req.params.id).select('title category');
    if (!brief) return res.status(404).json({ message: 'Brief not found' });
    if (brief.category !== 'Ranks')
      return res.status(400).json({ message: 'Brief is not a Ranks category' });

    const rankHierarchyOrder = lookupRankHierarchy(brief.title);
    if (rankHierarchyOrder === null)
      return res.status(422).json({ message: `Could not determine rank order from title: "${brief.title}"` });

    res.json({ status: 'success', data: { rankHierarchyOrder } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-image
// Uses the shared generateBriefImages helper which deduplicates against the
// existing Media collection: any term (or its resolved Wikipedia page title)
// that matches an existing Media doc is reused instead of re-uploaded.
router.post('/ai/generate-image', async (req, res) => {
  try {
    const { title, subtitle } = req.body;
    if (!title) return res.status(400).json({ message: 'title is required' });

    const imgAiSettings = await AppSettings.getSettings();
    const { mediaDocs, warnings } = await generateBriefImages({
      title,
      subtitle,
      imagePromptBase: getPrompt(imgAiSettings, 'imageExtraction'),
      publicIdPrefix: 'brief',
    });

    if (mediaDocs.length === 0) {
      throw new Error(warnings.join('; ') || 'Could not find Wikipedia images for any of the extracted subjects');
    }

    const images = mediaDocs.map(m => ({
      mediaId:  m._id,
      url:      m.mediaUrl,
      publicId: m.cloudinaryPublicId,
      term:     m.searchTerm || m.name,
      wikiPage: m.wikiPageTitle || m.name,
    }));

    res.json({ status: 'success', data: { images, warnings } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Economy routes
// GET  /api/admin/economy-viability — read DB state for simulation
// PATCH /api/admin/economy/levels   — sync level thresholds only
// POST  /api/admin/economy/apply    — write all rates + level thresholds live
const BOO_CATS = new Set(['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']);
// Number of questions shown to the user in a single quiz session (out of the AI-generated pool).
const QUIZ_QUESTIONS_PER_SESSION = 5;

// Whitelist of AppSettings fields the economy apply endpoint may write.
const ECONOMY_RATE_FIELDS = new Set([
  'aircoinsPerBriefRead',
  'aircoinsPerWinEasy', 'aircoinsPerWinMedium', 'aircoins100Percent',
  'aircoinsOrderOfBattleEasy', 'aircoinsOrderOfBattleMedium',
  'aircoinsWhereAircraftRound1', 'aircoinsWhereAircraftRound2', 'aircoinsWhereAircraftBonus',
  'aircoinsFlashcardPerCard', 'aircoinsFlashcardPerfectBonus',
  'aircoinsFirstLogin', 'aircoinsStreakBonus',
]);

router.get('/economy-viability', async (req, res) => {
  try {
    const [settings, briefs, ranks, levels] = await Promise.all([
      AppSettings.getSettings(),
      IntelligenceBrief.find({}).select('category').lean(),
      Rank.find().sort({ rankNumber: 1 }).lean(),
      Level.find().sort({ levelNumber: 1 }).lean(),
    ]);

    const totalBriefs       = briefs.length;
    // WTA-enabled: only Aircrafts-category briefs (all assumed WTA-capable)
    const wtaBriefs         = briefs.filter(b => b.category === 'Aircrafts').length;
    // BOO-eligible: all briefs in BOO categories (assume stats will be present)
    const booEligibleBriefs = briefs.filter(b => BOO_CATS.has(b.category)).length;

    const wtaPerBrief = (settings.aircoinsWhereAircraftRound1 ?? 5)
                      + (settings.aircoinsWhereAircraftRound2 ?? 10)
                      + (settings.aircoinsWhereAircraftBonus  ?? 5);

    // Compute live cycle threshold from Level docs (same logic as getCycleThreshold)
    let liveCycleThreshold = 0;
    for (const lv of levels) {
      if (lv.aircoinsToNextLevel != null) liveCycleThreshold += lv.aircoinsToNextLevel;
    }
    if (!liveCycleThreshold) liveCycleThreshold = CYCLE_THRESHOLD;

    function calcProgression(totalCoins) {
      const rankCount       = ranks.length;
      const fullCycles      = rankCount > 0 ? Math.floor(totalCoins / liveCycleThreshold) : 0;
      const completedCycles = Math.min(fullCycles, rankCount);
      const atMaxRank       = rankCount > 0 && completedCycles >= rankCount;
      const cycleCoins      = atMaxRank
        ? totalCoins - rankCount * liveCycleThreshold
        : totalCoins % liveCycleThreshold;

      let finalLevel = 1, cumulative = 0;
      for (const lv of levels) {
        if (lv.aircoinsToNextLevel === null) { finalLevel = lv.levelNumber; break; }
        cumulative += lv.aircoinsToNextLevel;
        if (cycleCoins < cumulative) { finalLevel = lv.levelNumber; break; }
        finalLevel = lv.levelNumber + 1;
      }

      const finalRank     = completedCycles > 0 ? ranks[completedCycles - 1] : null;
      const coinsToMaxOut = rankCount * liveCycleThreshold;
      const shortfall     = Math.max(0, coinsToMaxOut - totalCoins);
      return { completedCycles, atMaxRank, cycleCoins, finalLevel, finalRank, coinsToMaxOut, shortfall };
    }

    // Initial scenario totals (frontend recalculates live as rates are edited)
    function scenarioCoins(difficulty) {
      const isNormal = difficulty === 'normal';
      const n        = totalBriefs;
      const reads    = n * (settings.aircoinsPerBriefRead ?? 5);
      const quiz     = isNormal
        ? n * QUIZ_QUESTIONS_PER_SESSION * (settings.aircoinsPerWinEasy   ?? 10) + n * (settings.aircoins100Percent ?? 15)
        : n * QUIZ_QUESTIONS_PER_SESSION * (settings.aircoinsPerWinMedium ?? 20) + n * (settings.aircoins100Percent ?? 15);
      const boo = booEligibleBriefs * (isNormal
        ? (settings.aircoinsOrderOfBattleEasy   ?? 8)
        : (settings.aircoinsOrderOfBattleMedium ?? 18));
      const wta = wtaBriefs * wtaPerBrief;
      return { reads, quiz, boo, wta, total: reads + quiz + boo + wta };
    }

    const normalCoins   = scenarioCoins('normal');
    const advancedCoins = scenarioCoins('advanced');

    res.json({
      status: 'success',
      data: {
        content: { totalBriefs, wtaBriefs, booEligibleBriefs, wtaPerBrief },
        aiQuestionsPerDifficulty: settings.aiQuestionsPerDifficulty ?? 7,
        quizQuestionsPerSession:  QUIZ_QUESTIONS_PER_SESSION,
        rates: {
          aircoinsPerBriefRead:          settings.aircoinsPerBriefRead          ?? 5,
          aircoinsPerWinEasy:            settings.aircoinsPerWinEasy            ?? 10,
          aircoinsPerWinMedium:          settings.aircoinsPerWinMedium          ?? 20,
          aircoins100Percent:            settings.aircoins100Percent            ?? 15,
          aircoinsOrderOfBattleEasy:     settings.aircoinsOrderOfBattleEasy     ?? 8,
          aircoinsOrderOfBattleMedium:   settings.aircoinsOrderOfBattleMedium   ?? 18,
          aircoinsWhereAircraftRound1:   settings.aircoinsWhereAircraftRound1   ?? 5,
          aircoinsWhereAircraftRound2:   settings.aircoinsWhereAircraftRound2   ?? 10,
          aircoinsWhereAircraftBonus:    settings.aircoinsWhereAircraftBonus    ?? 5,
          aircoinsFlashcardPerCard:      settings.aircoinsFlashcardPerCard      ?? 2,
          aircoinsFlashcardPerfectBonus: settings.aircoinsFlashcardPerfectBonus ?? 5,
          aircoinsFirstLogin:            settings.aircoinsFirstLogin            ?? 5,
          aircoinsStreakBonus:           settings.aircoinsStreakBonus           ?? 2,
        },
        cycleThreshold: liveCycleThreshold,
        totalRanks:     ranks.length,
        ranks:  ranks.map(r => ({ rankNumber: r.rankNumber, rankName: r.rankName })),
        levels: levels.map(l => ({ levelNumber: l.levelNumber, aircoinsToNextLevel: l.aircoinsToNextLevel })),
        normal:   { ...normalCoins,   ...calcProgression(normalCoins.total)   },
        advanced: { ...advancedCoins, ...calcProgression(advancedCoins.total) },
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/economy/levels — sync level thresholds only
router.patch('/economy/levels', async (req, res) => {
  try {
    const { levels, reason } = req.body;
    if (!Array.isArray(levels) || levels.length === 0) {
      return res.status(400).json({ message: 'levels array required' });
    }
    for (const lv of levels) {
      if (typeof lv.levelNumber !== 'number' || lv.levelNumber < 1 || lv.levelNumber > 10) {
        return res.status(400).json({ message: `Invalid levelNumber: ${lv.levelNumber}` });
      }
      if (lv.aircoinsToNextLevel !== null &&
          (typeof lv.aircoinsToNextLevel !== 'number' || lv.aircoinsToNextLevel < 1)) {
        return res.status(400).json({ message: `Invalid aircoinsToNextLevel for level ${lv.levelNumber}` });
      }
    }
    await Promise.all(
      levels.map(lv =>
        Level.findOneAndUpdate(
          { levelNumber: lv.levelNumber },
          { aircoinsToNextLevel: lv.aircoinsToNextLevel },
          { returnDocument: 'after' }
        )
      )
    );
    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'update_economy_levels',
      reason:     reason || 'Level thresholds synced',
    });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/economy/apply — write all award rates + level thresholds live
router.post('/economy/apply', async (req, res) => {
  try {
    const { rates, levels, reason } = req.body;
    if (!rates || typeof rates !== 'object') {
      return res.status(400).json({ message: 'rates object required' });
    }
    if (!Array.isArray(levels) || levels.length === 0) {
      return res.status(400).json({ message: 'levels array required' });
    }

    // Validate + build safe rates update (whitelist only)
    const rateUpdates = {};
    for (const [key, val] of Object.entries(rates)) {
      if (!ECONOMY_RATE_FIELDS.has(key)) {
        return res.status(400).json({ message: `Unknown rate field: ${key}` });
      }
      if (typeof val !== 'number' || val < 0) {
        return res.status(400).json({ message: `Invalid value for ${key}: ${val}` });
      }
      rateUpdates[key] = val;
    }

    // Validate levels
    for (const lv of levels) {
      if (typeof lv.levelNumber !== 'number' || lv.levelNumber < 1 || lv.levelNumber > 10) {
        return res.status(400).json({ message: `Invalid levelNumber: ${lv.levelNumber}` });
      }
      if (lv.aircoinsToNextLevel !== null &&
          (typeof lv.aircoinsToNextLevel !== 'number' || lv.aircoinsToNextLevel < 1)) {
        return res.status(400).json({ message: `Invalid aircoinsToNextLevel for level ${lv.levelNumber}` });
      }
    }

    const settings = await AppSettings.getSettings();
    Object.assign(settings, rateUpdates);
    await settings.save();

    await Promise.all(
      levels.map(lv =>
        Level.findOneAndUpdate(
          { levelNumber: lv.levelNumber },
          { aircoinsToNextLevel: lv.aircoinsToNextLevel },
          { returnDocument: 'after' }
        )
      )
    );

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'update_economy_apply',
      reason:     reason || 'Economy settings applied',
    });

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-mnemonic
// Generates mnemonics for one stat (statKey provided) or all stats (statKey omitted).
// Always returns { mnemonics: { key: sentence, ... } }.
router.post('/ai/generate-mnemonic', async (req, res) => {
  try {
    const { title, category, gameData, statKey } = req.body;
    if (!title || !category) return res.status(400).json({ message: 'title and category required' });

    const mnemonicSettings = await AppSettings.getSettings();

    if (statKey) {
      // Single stat — generate one mnemonic and wrap it in an object
      const stats = buildMnemonicStats(category, gameData ?? {});
      const stat  = stats.find(s => s.key === statKey);
      if (!stat) return res.status(400).json({ message: `No stat found for key "${statKey}" in category "${category}"` });

      const data = await openRouterChat([{
        role: 'system',
        content: getPrompt(mnemonicSettings, 'mnemonic.single'),
      }, {
        role: 'user',
        content: `Brief: "${title}" (${category})\nStat: ${stat.label} — ${stat.value}\n\nWrite one memorable sentence that helps an RAF applicant remember this exact value and connect it to this subject.`,
      }], 'perplexity/sonar', 128);

      const sentence = (data.choices?.[0]?.message?.content ?? '').trim().replace(/[*_`#]/g, '');
      res.json({ status: 'success', data: { mnemonics: { [statKey]: sentence } } });
    } else {
      // All stats at once
      const mnemonics = await generateMnemonicsForBrief(title, category, gameData ?? {}, getPrompt(mnemonicSettings, 'mnemonic.batch'));
      if (!mnemonics) return res.status(400).json({ message: 'No stats found for this category' });
      res.json({ status: 'success', data: { mnemonics } });
    }
  } catch (err) {
    console.error('[generate-mnemonic] error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ai/generate-mnemonics-missing
// Finds all published BOO-category briefs that have populated stats but no mnemonics,
// generates and saves them. Returns a summary of what was processed.
router.post('/ai/generate-mnemonics-missing', async (req, res) => {
  try {
    const [briefs, missingSettings] = await Promise.all([
      IntelligenceBrief.find({
        status:   'published',
        category: { $in: BOO_CATEGORIES },
      }).select('title category gameData mnemonics').lean(),
      AppSettings.getSettings(),
    ]);

    const toProcess = briefs.filter(b => {
      const stats = buildMnemonicStats(b.category, b.gameData ?? {});
      if (!stats.length) return false;
      const m = b.mnemonics ?? {};
      return !stats.some(s => m[s.key]); // skip if all stats already have mnemonics
    });

    let processed = 0;
    const errors  = [];
    const batchPrompt = getPrompt(missingSettings, 'mnemonic.batch');

    for (const brief of toProcess) {
      try {
        const mnemonics = await generateMnemonicsForBrief(brief.title, brief.category, brief.gameData ?? {}, batchPrompt);
        if (mnemonics) {
          await IntelligenceBrief.findByIdAndUpdate(brief._id, { mnemonics });
          processed++;
        }
      } catch (err) {
        errors.push({ id: String(brief._id), title: brief.title, error: err.message });
      }
    }

    res.json({ status: 'success', data: { processed, total: toProcess.length, errors } });
  } catch (err) {
    console.error('[generate-mnemonics-missing] error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/save-generated-image — receive base64 image from browser and upload to Cloudinary
router.post('/save-generated-image', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ message: 'imageBase64 required' });

    const buffer = Buffer.from(imageBase64, 'base64');
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');

    // Hash check before upload — if the same bytes already exist in Cloudinary
    // via another Media doc, reuse that asset and return an existing mediaId so
    // the admin frontend can attach without creating a new Media doc.
    const existing = await Media.findOne({ contentHash });
    if (existing) {
      return res.json({
        status: 'success',
        data: {
          url: existing.mediaUrl,
          publicId: existing.cloudinaryPublicId,
          mediaId: existing._id,
          reused: true,
        },
      });
    }

    const result = await uploadBuffer(buffer, { public_id: `brief-${Date.now()}`, format: 'png' });

    res.json({
      status: 'success',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        contentHash,
        reused: false,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/email-logs?page=1&limit=50&type=welcome&status=failed&search=user@example.com
router.get('/email-logs', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = {};
    if (req.query.type)   filter.type   = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) filter.recipientEmail = { $regex: req.query.search.trim(), $options: 'i' };

    const [logs, total] = await Promise.all([
      EmailLog.find(filter)
        .sort({ sentAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      EmailLog.countDocuments(filter),
    ]);

    res.json({ status: 'success', data: { logs, total, page, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
