'use strict';

const router = require('express').Router();
const { protect, optionalAuth } = require('../middleware/auth');
const AppSettings = require('../models/AppSettings');
const GameCaseFile = require('../models/GameCaseFile');
const GameCaseFileChapter = require('../models/GameCaseFileChapter');
const GameSessionCaseFileResult = require('../models/GameSessionCaseFileResult');
const { scoreChapter } = require('../utils/caseFileScoring');
const { sanitizeChapter, sanitizeChapterForList } = require('../utils/caseFileSanitize');
const { callOpenRouter } = require('../utils/openRouter');
const { assembleInterrogationPrompt } = require('../utils/caseFilePromptAssembly');
const { effectiveTier } = require('../utils/subscription');

// Model used for all actor interrogation calls.
// Low-cost but capable; temperature and token budget set per the editorial spec.
const INTERROGATION_MODEL      = 'openai/gpt-4o-mini';
const INTERROGATION_MAX_TOKENS = 200;
const INTERROGATION_TEMPERATURE = 0.3;

// ── Access + daily-limit helpers ─────────────────────────────────────────────
// Mirror the APTITUDE_SYNC pattern: trial maps to silver for tier checks; admin
// always bypasses both gates. Unauthenticated callers (optionalAuth) only need
// the enabled gate — tier restrictions don't apply until they sign in.
function canAccessCaseFiles(user, settings) {
  if (user?.isAdmin) return true;             // admin bypasses both flags
  if (!settings.caseFilesEnabled) return false;
  if (!user) return true; // public list still browsable when feature is on
  const tier = effectiveTier(user);
  const checkTier = tier === 'trial' ? 'silver' : tier;
  const allowed = settings.caseFilesTiers ?? [];
  return allowed.includes(checkTier) || allowed.includes('admin');
}

function getDailyLimit(user, settings) {
  if (user?.isAdmin) return Infinity;
  const tier = effectiveTier(user);
  if (tier === 'gold') return settings.caseFilesDailyLimitGold ?? 0;
  if (tier === 'silver' || tier === 'trial') return settings.caseFilesDailyLimitSilver ?? 0;
  return settings.caseFilesDailyLimitFree ?? 0;
}

function startOfTodayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ── Status endpoint — drives the frontend gate decision ──────────────────────
// reason: 'ok' | 'disabled' | 'tier' | 'limit'
// Returned even for unauthenticated callers so the menu can render the right
// state without leaking user-specific limit numbers.
router.get('/status', optionalAuth, async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();

    if (!settings.caseFilesEnabled && !req.user?.isAdmin) {
      return res.json({ data: { canPlay: false, reason: 'disabled', usedToday: 0, limitToday: 0 } });
    }
    if (req.user && !canAccessCaseFiles(req.user, settings)) {
      return res.json({ data: { canPlay: false, reason: 'tier', usedToday: 0, limitToday: 0 } });
    }

    if (!req.user) {
      // Guest browsing — no per-user limit to surface
      return res.json({ data: { canPlay: true, reason: 'ok', usedToday: 0, limitToday: null } });
    }

    const limit     = getDailyLimit(req.user, settings);
    const usedToday = await GameSessionCaseFileResult.countDocuments({
      userId:    req.user._id,
      startedAt: { $gte: startOfTodayUTC() },
    });
    const canPlay = limit === Infinity || usedToday < limit;

    return res.json({
      data: {
        canPlay,
        reason:     canPlay ? 'ok' : 'limit',
        usedToday,
        limitToday: limit === Infinity ? null : limit,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET / — list cases for menu (optionalAuth) ────────────────────────────────
// Returns published + locked cases; hides drafts.
// chapterCount = count of published chapters per case.
router.get('/', optionalAuth, async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    if (!settings.caseFilesEnabled && !req.user?.isAdmin) {
      return res.status(403).json({ reason: 'disabled' });
    }
    if (req.user && !canAccessCaseFiles(req.user, settings)) {
      return res.status(403).json({ reason: 'tier' });
    }

    const cases = await GameCaseFile.find({ status: { $in: ['published', 'locked'] } })
      .sort({ slug: 1 })
      .lean();

    if (!cases.length) return res.json([]);

    // Pull published chapters per caseSlug, ordered by chapterNumber, in one query.
    // Exposing chapterSlugs lets the menu deep-link straight to the first chapter
    // without an extra roundtrip — V1 has one chapter per case, so this is the
    // common path.
    const slugs = cases.map(c => c.slug);
    const chapters = await GameCaseFileChapter.find(
      { caseSlug: { $in: slugs }, status: 'published' },
      { caseSlug: 1, chapterSlug: 1, chapterNumber: 1 }
    ).sort({ caseSlug: 1, chapterNumber: 1 }).lean();

    const slugsByCase = {};
    for (const ch of chapters) {
      (slugsByCase[ch.caseSlug] ||= []).push(ch.chapterSlug);
    }

    const result = cases.map(c => ({
      slug:          c.slug,
      title:         c.title,
      affairLabel:   c.affairLabel,
      summary:       c.summary,
      coverImageUrl: c.coverImageUrl,
      status:        c.status,
      tags:          c.tags,
      chapterCount:  (slugsByCase[c.slug] || []).length,
      chapterSlugs:  slugsByCase[c.slug] || [],
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /:caseSlug — case detail (optionalAuth) ───────────────────────────────
// 404 if not found or draft. Locked cases return the case with chapters: [].
router.get('/:caseSlug', optionalAuth, async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    if (!settings.caseFilesEnabled && !req.user?.isAdmin) {
      return res.status(403).json({ reason: 'disabled' });
    }
    if (req.user && !canAccessCaseFiles(req.user, settings)) {
      return res.status(403).json({ reason: 'tier' });
    }

    const caseDoc = await GameCaseFile.findOne({ slug: req.params.caseSlug }).lean();
    if (!caseDoc || caseDoc.status === 'draft') {
      return res.status(404).json({ message: 'Case not found' });
    }

    // For locked cases return no chapters
    if (caseDoc.status === 'locked') {
      return res.json({ ...caseDoc, chapters: [] });
    }

    const chapters = await GameCaseFileChapter.find({
      caseSlug: req.params.caseSlug,
      status:   'published',
    })
      .sort({ chapterNumber: 1 })
      .lean();

    const sanitizedChapters = chapters.map(sanitizeChapterForList);

    res.json({ ...caseDoc, chapters: sanitizedChapters });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /:caseSlug/chapters/:chapterSlug/best — best score for user (protect) ─
// Must be declared BEFORE /:caseSlug/chapters/:chapterSlug so Express matches it.
router.get('/:caseSlug/chapters/:chapterSlug/best', protect, async (req, res) => {
  try {
    const { caseSlug, chapterSlug } = req.params;

    const best = await GameSessionCaseFileResult.findOne({
      userId:      req.user._id,
      caseSlug,
      chapterSlug,
      completedAt: { $ne: null },
    })
      .sort({ 'scoring.totalScore': -1 })
      .lean();

    const completedCount = await GameSessionCaseFileResult.countDocuments({
      userId:      req.user._id,
      caseSlug,
      chapterSlug,
      completedAt: { $ne: null },
    });

    res.json({
      bestScore:      best ? best.scoring?.totalScore ?? null : null,
      completedCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /:caseSlug/chapters/:chapterSlug — chapter detail (protect) ───────────
// 404 if case is draft/locked or chapter is draft.
// SANITIZE: scoring keys stripped before sending to client.
router.get('/:caseSlug/chapters/:chapterSlug', protect, async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    if (!settings.caseFilesEnabled && !req.user.isAdmin) {
      return res.status(403).json({ reason: 'disabled' });
    }
    if (!canAccessCaseFiles(req.user, settings)) {
      return res.status(403).json({ reason: 'tier' });
    }

    const caseDoc = await GameCaseFile.findOne({ slug: req.params.caseSlug }).lean();
    if (!caseDoc || caseDoc.status === 'draft' || caseDoc.status === 'locked') {
      return res.status(404).json({ message: 'Case not found' });
    }

    const chapter = await GameCaseFileChapter.findOne({
      caseSlug:    req.params.caseSlug,
      chapterSlug: req.params.chapterSlug,
    }).lean();

    if (!chapter || chapter.status === 'draft') {
      return res.status(404).json({ message: 'Chapter not found' });
    }

    res.json(sanitizeChapter(chapter));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /:caseSlug/chapters/:chapterSlug/sessions — start session (protect) ─
router.post('/:caseSlug/chapters/:chapterSlug/sessions', protect, async (req, res) => {
  try {
    const { caseSlug, chapterSlug } = req.params;

    // ── Gate checks ──────────────────────────────────────────────────────────
    const settings = await AppSettings.getSettings();
    if (!settings.caseFilesEnabled && !req.user.isAdmin) {
      return res.status(403).json({ reason: 'disabled' });
    }
    if (!canAccessCaseFiles(req.user, settings)) {
      return res.status(403).json({ reason: 'tier' });
    }

    // ── Daily limit — counts new sessions started today (UTC) ────────────────
    // Each POST consumes one slot, so replays count separately. Mid-session
    // chapter navigation reuses the same record and doesn't double-count.
    const limit = getDailyLimit(req.user, settings);
    if (limit !== Infinity) {
      const usedToday = await GameSessionCaseFileResult.countDocuments({
        userId:    req.user._id,
        startedAt: { $gte: startOfTodayUTC() },
      });
      if (usedToday >= limit) {
        return res.status(429).json({ reason: 'limit', usedToday, limitToday: limit });
      }
    }

    const caseDoc = await GameCaseFile.findOne({ slug: caseSlug }).lean();
    if (!caseDoc || caseDoc.status !== 'published') {
      return res.status(404).json({ message: 'Case not found or not published' });
    }

    const chapter = await GameCaseFileChapter.findOne({ caseSlug, chapterSlug }).lean();
    if (!chapter || chapter.status !== 'published') {
      return res.status(404).json({ message: 'Chapter not found or not published' });
    }

    const session = await GameSessionCaseFileResult.create({
      userId:            req.user._id,
      caseSlug,
      chapterSlug,
      currentStageIndex: 0,
      stageResults:      [],
      scoring:           null,
      completedAt:       null,
    });

    res.status(201).json({ sessionId: session._id, currentStageIndex: 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /sessions/:sessionId/stages/:stageIndex — submit stage result (protect)
router.patch('/sessions/:sessionId/stages/:stageIndex', protect, async (req, res) => {
  try {
    const { sessionId, stageIndex: stageIndexStr } = req.params;
    const stageIndex = parseInt(stageIndexStr, 10);

    if (isNaN(stageIndex) || stageIndex < 0) {
      return res.status(400).json({ error: 'invalid_stage_index' });
    }

    const session = await GameSessionCaseFileResult.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    // Ownership check
    if (!session.userId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Reject if already completed
    if (session.completedAt) {
      return res.status(400).json({ error: 'session_already_completed' });
    }

    // Reject if this stage was already submitted
    if (stageIndex < session.currentStageIndex) {
      return res.status(400).json({ error: 'stage_already_submitted' });
    }

    // In-order enforcement
    if (stageIndex !== session.currentStageIndex) {
      return res.status(400).json({ error: 'stage_out_of_order' });
    }

    // Load the chapter to validate against
    const chapter = await GameCaseFileChapter.findOne({
      caseSlug:    session.caseSlug,
      chapterSlug: session.chapterSlug,
    }).lean();

    if (!chapter) return res.status(404).json({ message: 'Chapter not found' });

    if (stageIndex >= chapter.stages.length) {
      return res.status(400).json({ error: 'stage_index_out_of_range' });
    }

    const { stageType, payload } = req.body;

    // Validate stageType matches chapter definition
    const expectedType = chapter.stages[stageIndex].type;
    if (!stageType || stageType !== expectedType) {
      return res.status(400).json({ error: 'stage_type_mismatch', expected: expectedType });
    }

    // Validate payload is a plain object (not null, not array)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    // Append result and advance index
    session.stageResults.push({
      stageIndex,
      stageType,
      submittedAt: new Date(),
      payload,
    });
    session.currentStageIndex = stageIndex + 1;

    await session.save();

    const isLastStage = session.currentStageIndex >= chapter.stages.length;

    res.json({
      currentStageIndex: session.currentStageIndex,
      totalStages:       chapter.stages.length,
      isLastStage,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /sessions/:sessionId/complete — finalize and score (protect) ─────────
router.post('/sessions/:sessionId/complete', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await GameSessionCaseFileResult.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    // Ownership check
    if (!session.userId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Idempotent: if already completed, return existing scoring
    if (session.completedAt && session.scoring) {
      return res.json({
        totalScore:  session.scoring.totalScore,
        breakdown:   session.scoring.breakdown,
        completedAt: session.completedAt,
      });
    }

    // Load chapter for stage count and scoring config
    const chapter = await GameCaseFileChapter.findOne({
      caseSlug:    session.caseSlug,
      chapterSlug: session.chapterSlug,
    }).lean();

    if (!chapter) return res.status(404).json({ message: 'Chapter not found' });

    // Validate all stages submitted
    if (session.stageResults.length !== chapter.stages.length) {
      return res.status(400).json({ error: 'incomplete' });
    }

    // Score the chapter — Case Files do NOT award airstars or level XP.
    const scoring = scoreChapter(chapter, session.stageResults);

    session.scoring     = scoring;
    session.completedAt = new Date();
    await session.save();

    res.json({
      totalScore:  scoring.totalScore,
      breakdown:   scoring.breakdown,
      completedAt: session.completedAt,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /sessions/:sessionId/interrogate — live actor interrogation (protect) ─
//
// Called by the client during an actor_interrogations stage to ask a single
// question. The endpoint validates ownership, stage state, actor existence, and
// the per-actor rate limit before calling the AI. The Q+A is appended to
// session.interrogationTranscripts so the client can display a live transcript
// without waiting for the stage to be formally submitted.
//
// Rate-limit and validation order (cheap-first):
//   1. Auth (protect middleware)
//   2. Load + own session; reject completed sessions
//   3. Validate body (stageIndex, actorId, question)
//   4. Validate stage state against chapter
//   5. Rate-limit check (count existing transcripts for actor in stage)
//   6. AI call
router.post('/sessions/:sessionId/interrogate', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // ── 1. Load session ──────────────────────────────────────────────────────
    const session = await GameSessionCaseFileResult.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    // ── 2. Ownership + completion guard ─────────────────────────────────────
    if (!session.userId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (session.completedAt) {
      return res.status(400).json({ error: 'session_already_completed' });
    }

    // ── 3. Body validation ───────────────────────────────────────────────────
    const { stageIndex, actorId, question } = req.body;

    if (
      typeof question !== 'string' ||
      question.trim().length === 0 ||
      question.length > 280
    ) {
      return res.status(400).json({ error: 'invalid_question' });
    }

    // ── 4. Stage state validation ────────────────────────────────────────────
    const chapter = await GameCaseFileChapter.findOne({
      caseSlug:    session.caseSlug,
      chapterSlug: session.chapterSlug,
    }).lean();

    if (!chapter) return res.status(404).json({ message: 'Chapter not found' });

    if (
      session.currentStageIndex !== stageIndex ||
      !chapter.stages[stageIndex] ||
      chapter.stages[stageIndex].type !== 'actor_interrogations'
    ) {
      return res.status(400).json({ error: 'session_not_at_stage' });
    }

    const stagePayload = chapter.stages[stageIndex].payload;

    // ── 4b. Actor validation ─────────────────────────────────────────────────
    const actor = (stagePayload.actors || []).find(a => a.id === actorId);
    if (!actor) {
      return res.status(400).json({ error: 'invalid_actor' });
    }

    // ── 5. Rate-limit check ──────────────────────────────────────────────────
    const maxQuestionsPerActor = stagePayload.maxQuestionsPerActor ?? 3;
    const existingCount = session.interrogationTranscripts.filter(
      t => t.stageIndex === stageIndex && t.actorId === actorId
    ).length;

    if (existingCount >= maxQuestionsPerActor) {
      return res.status(429).json({ error: 'rate_limited', questionsRemaining: 0 });
    }

    // ── 6. AI call ───────────────────────────────────────────────────────────
    const contextDateLabel = stagePayload.contextDateLabel || chapter.dateRangeLabel;
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey: actor.systemPromptKey,
      contextDateLabel,
    });

    const aiResponse = await callOpenRouter({
      key:     'main',
      feature: 'case_file_interrogation',
      body:    {
        model:       INTERROGATION_MODEL,
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: question.trim() },
        ],
        max_tokens:  INTERROGATION_MAX_TOKENS,
        temperature: INTERROGATION_TEMPERATURE,
      },
    });

    const answer = aiResponse?.choices?.[0]?.message?.content ?? '';

    // ── 7. Persist transcript entry ──────────────────────────────────────────
    session.interrogationTranscripts.push({
      stageIndex,
      actorId,
      q: question.trim(),
      a: answer,
      askedAt: new Date(),
    });
    await session.save();

    // ── 8. Return answer + remaining quota ───────────────────────────────────
    const questionsRemaining = maxQuestionsPerActor - (existingCount + 1);
    return res.json({ answer, questionsRemaining });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /sessions/:sessionId — read own session state (protect) ───────────────
router.get('/sessions/:sessionId', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await GameSessionCaseFileResult.findById(sessionId).lean();
    if (!session) return res.status(404).json({ message: 'Session not found' });

    if (!session.userId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const chapter = await GameCaseFileChapter.findOne({
      caseSlug:    session.caseSlug,
      chapterSlug: session.chapterSlug,
    })
      .select('stages')
      .lean();

    res.json({
      sessionId:         session._id,
      caseSlug:          session.caseSlug,
      chapterSlug:       session.chapterSlug,
      currentStageIndex: session.currentStageIndex,
      totalStages:       chapter ? chapter.stages.length : null,
      completedAt:       session.completedAt,
      scoring:           session.scoring,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
