'use strict';

process.env.JWT_SECRET    = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser,
  createSettings,
  authCookie,
} = require('../helpers/factories');

const GameCaseFile = require('../../models/GameCaseFile');
const GameCaseFileChapter = require('../../models/GameCaseFileChapter');
const GameSessionCaseFileResult = require('../../models/GameSessionCaseFileResult');

// ── Shared test fixtures ──────────────────────────────────────────────────────

/**
 * Minimal stage factory.
 * cold_open and decision_point have no scoring requirements for completion flow.
 * We build 3 stages so we can test "all submitted" vs "partial" without overhead.
 */
function makeStages(count = 3) {
  const types = ['cold_open', 'evidence_wall', 'decision_point'];
  return types.slice(0, count).map((type, i) => ({
    id:   `stage_${i}`,
    type,
    payload: { description: `Stage ${i} payload` },
    // Include minimal scoring config so scoreChapter doesn't throw
    scoring: type === 'evidence_wall'
      ? { validConnectionPairs: [], signalWeights: {} }
      : type === 'decision_point'
      ? { optionRealityScores: { opt_a: 80 }, optionSupportingEvidenceIds: {} }
      : undefined,
  }));
}

async function createCase(overrides = {}) {
  return GameCaseFile.create({
    slug:        overrides.slug        ?? `case-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title:       overrides.title       ?? 'Test Case',
    affairLabel: overrides.affairLabel ?? 'Test Affair',
    summary:     overrides.summary     ?? 'Test summary',
    status:      overrides.status      ?? 'published',
    tags:        overrides.tags        ?? [],
    // Default to permissive tier list so non-admin users pass the per-case gate
    // in tests that don't explicitly test tier gating. Tests that need to gate
    // should pass tiers: ['gold'] (or another restricted set) explicitly.
    tiers:       overrides.tiers       ?? ['admin', 'gold', 'silver', 'free'],
    ...overrides,
  });
}

async function createChapter(caseSlug, overrides = {}) {
  return GameCaseFileChapter.create({
    caseSlug,
    chapterSlug:      overrides.chapterSlug      ?? `ch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chapterNumber:    overrides.chapterNumber     ?? 1,
    title:            overrides.title             ?? 'Test Chapter',
    dateRangeLabel:   overrides.dateRangeLabel    ?? 'Jan 2022 – Dec 2022',
    summary:          overrides.summary           ?? 'Chapter summary',
    estimatedMinutes: overrides.estimatedMinutes  ?? 35,
    status:           overrides.status            ?? 'published',
    stages:           overrides.stages            ?? makeStages(3),
    ...overrides,
  });
}

// ── Test lifecycle ─────────────────────────────────────────────────────────────

let user, otherUser, cookie, otherCookie;

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await createSettings();
  user      = await createUser();
  otherUser = await createUser();
  cookie      = authCookie(user._id);
  otherCookie = authCookie(otherUser._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── GET / ──────────────────────────────────────────────────────────────────────
describe('GET /api/case-files', () => {
  it('returns published and locked cases, hides drafts', async () => {
    await createCase({ slug: 'pub-case',    status: 'published' });
    await createCase({ slug: 'locked-case', status: 'locked'    });
    await createCase({ slug: 'draft-case',  status: 'draft'     });

    const res = await request(app).get('/api/case-files');

    expect(res.status).toBe(200);
    const slugs = res.body.map(c => c.slug);
    expect(slugs).toContain('pub-case');
    expect(slugs).toContain('locked-case');
    expect(slugs).not.toContain('draft-case');
  });

  it('returns chapterCount for published chapters only', async () => {
    const caseDoc = await createCase({ slug: 'count-case', status: 'published' });
    await createChapter(caseDoc.slug, { chapterSlug: 'ch-pub-1', status: 'published' });
    await createChapter(caseDoc.slug, { chapterSlug: 'ch-pub-2', chapterNumber: 2, status: 'published' });
    await createChapter(caseDoc.slug, { chapterSlug: 'ch-draft', chapterNumber: 3, status: 'draft' });

    const res = await request(app).get('/api/case-files');

    expect(res.status).toBe(200);
    const found = res.body.find(c => c.slug === 'count-case');
    expect(found).toBeDefined();
    expect(found.chapterCount).toBe(2); // draft chapter excluded
  });

  it('returns empty array when no cases exist', async () => {
    const res = await request(app).get('/api/case-files');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not require auth', async () => {
    await createCase({ slug: 'pub-noauth', status: 'published' });
    const res = await request(app).get('/api/case-files'); // no cookie
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

// ── GET /:caseSlug ─────────────────────────────────────────────────────────────
describe('GET /api/case-files/:caseSlug', () => {
  it('returns 404 for a non-existent case', async () => {
    const res = await request(app).get('/api/case-files/no-such-case');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a draft case', async () => {
    const caseDoc = await createCase({ slug: 'draft-case', status: 'draft' });
    const res = await request(app).get(`/api/case-files/${caseDoc.slug}`);
    expect(res.status).toBe(404);
  });

  it('returns case with published chapters for a published case', async () => {
    const caseDoc = await createCase({ slug: 'pub-detail', status: 'published' });
    await createChapter(caseDoc.slug, { chapterSlug: 'ch-1', status: 'published' });
    await createChapter(caseDoc.slug, { chapterSlug: 'ch-2', chapterNumber: 2, status: 'draft' });

    const res = await request(app).get(`/api/case-files/${caseDoc.slug}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Only published chapter included
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].chapterSlug).toBe('ch-1');
    // stages are not included in list shape (sanitizeChapterForList returns stageCount, not stages)
    expect(res.body.chapters[0].stageCount).toBeDefined();
    expect(res.body.chapters[0].stages).toBeUndefined();
  });

  it('returns locked case with empty chapters array', async () => {
    const caseDoc = await createCase({ slug: 'locked-detail', status: 'locked' });
    await createChapter(caseDoc.slug, { chapterSlug: 'ch-x', status: 'published' });

    const res = await request(app).get(`/api/case-files/${caseDoc.slug}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.chapters).toEqual([]);
  });

  it('returns 403 reason=tier for an unauthenticated guest (free is a tier, guest is not)', async () => {
    const caseDoc = await createCase({ slug: 'guest-detail', status: 'published', tiers: ['free', 'silver', 'gold'] });
    const res = await request(app).get(`/api/case-files/${caseDoc.slug}`); // no cookie
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('tier');
  });
});

// ── GET /:caseSlug/chapters/:chapterSlug ──────────────────────────────────────
describe('GET /api/case-files/:caseSlug/chapters/:chapterSlug', () => {
  it('returns 401 without auth', async () => {
    const caseDoc = await createCase({ slug: 'auth-case', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'ch-auth' });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}`);

    expect(res.status).toBe(401);
  });

  it('returns chapter without scoring keys', async () => {
    const caseDoc = await createCase({ slug: 'sanitize-case', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'ch-sanitize' });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stages)).toBe(true);
    // scoring must be stripped from every stage
    res.body.stages.forEach(stage => {
      expect(stage.scoring).toBeUndefined();
    });
  });

  it('returns 404 for locked case chapter', async () => {
    const caseDoc = await createCase({ slug: 'locked-ch', status: 'locked' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'ch-locked' });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('returns 404 for draft chapter', async () => {
    const caseDoc = await createCase({ slug: 'draft-ch', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'ch-draftch', status: 'draft' });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });
});

// ── POST /:caseSlug/chapters/:chapterSlug/sessions ────────────────────────────
describe('POST /api/case-files/:caseSlug/chapters/:chapterSlug/sessions', () => {
  it('creates a session and returns sessionId + currentStageIndex 0', async () => {
    const caseDoc = await createCase({ slug: 'sess-case', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'sess-ch' });

    const res = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
      .set('Cookie', cookie);

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.currentStageIndex).toBe(0);
  });

  it('allows multiple sessions per user per chapter (replays)', async () => {
    const caseDoc = await createCase({ slug: 'replay-case', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'replay-ch' });

    const url = `/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`;
    const r1 = await request(app).post(url).set('Cookie', cookie);
    const r2 = await request(app).post(url).set('Cookie', cookie);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.sessionId).not.toBe(r2.body.sessionId);
  });

  it('returns 401 without auth', async () => {
    const caseDoc = await createCase({ slug: 'noauth-sess', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'noauth-ch' });

    const res = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`);

    expect(res.status).toBe(401);
  });

  it('returns 404 if case is not published', async () => {
    const caseDoc = await createCase({ slug: 'draft-sess', status: 'draft' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'draft-sess-ch' });

    const res = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });
});

// ── PATCH /sessions/:sessionId/stages/:stageIndex ─────────────────────────────
describe('PATCH /api/case-files/sessions/:sessionId/stages/:stageIndex', () => {
  let caseDoc, chapter, sessionId;

  beforeEach(async () => {
    caseDoc = await createCase({ slug: 'stage-case', status: 'published' });
    chapter = await createChapter(caseDoc.slug, { chapterSlug: 'stage-ch', stages: makeStages(3) });

    const startRes = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
      .set('Cookie', cookie);
    sessionId = startRes.body.sessionId;
  });

  function stagePayload(stageIndex) {
    const type = chapter.stages[stageIndex].type;
    // Provide a structurally valid payload for each stage type used in makeStages
    if (type === 'cold_open')     return { stageType: 'cold_open',     payload: { acknowledged: true } };
    if (type === 'evidence_wall') return { stageType: 'evidence_wall', payload: { connections: [] } };
    if (type === 'decision_point') return { stageType: 'decision_point', payload: { selectedOptionId: 'opt_a' } };
    return { stageType: type, payload: {} };
  }

  it('in-order submission works and increments currentStageIndex', async () => {
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', cookie)
      .send(stagePayload(0));

    expect(res.status).toBe(200);
    expect(res.body.currentStageIndex).toBe(1);
    expect(res.body.totalStages).toBe(3);
    expect(res.body.isLastStage).toBe(false);
  });

  it('submitting the last stage marks isLastStage=true', async () => {
    // Submit stages 0 and 1 first
    for (let i = 0; i < 2; i++) {
      await request(app)
        .patch(`/api/case-files/sessions/${sessionId}/stages/${i}`)
        .set('Cookie', cookie)
        .send(stagePayload(i));
    }
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/2`)
      .set('Cookie', cookie)
      .send(stagePayload(2));

    expect(res.status).toBe(200);
    expect(res.body.isLastStage).toBe(true);
    expect(res.body.currentStageIndex).toBe(3);
  });

  it('rejects out-of-order submission (stage 1 before stage 0)', async () => {
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/1`)
      .set('Cookie', cookie)
      .send(stagePayload(1));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('stage_out_of_order');
  });

  it('rejects stage_type_mismatch', async () => {
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', cookie)
      .send({ stageType: 'debrief', payload: { notes: 'wrong type' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('stage_type_mismatch');
  });

  it('rejects stage already submitted', async () => {
    // Submit stage 0 once
    await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', cookie)
      .send(stagePayload(0));

    // Try to resubmit stage 0
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', cookie)
      .send(stagePayload(0));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('stage_already_submitted');
  });

  it('rejects another user submitting to this session (403)', async () => {
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', otherCookie)
      .send(stagePayload(0));

    expect(res.status).toBe(403);
  });

  it('rejects invalid payload (array)', async () => {
    const res = await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', cookie)
      .send({ stageType: chapter.stages[0].type, payload: ['not', 'an', 'object'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ── POST /sessions/:sessionId/complete ────────────────────────────────────────
describe('POST /api/case-files/sessions/:sessionId/complete', () => {
  let caseDoc, chapter, sessionId;

  beforeEach(async () => {
    caseDoc = await createCase({ slug: 'complete-case', status: 'published' });
    chapter = await createChapter(caseDoc.slug, { chapterSlug: 'complete-ch', stages: makeStages(3) });

    const startRes = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
      .set('Cookie', cookie);
    sessionId = startRes.body.sessionId;
  });

  async function submitAllStages() {
    const stageDefs = chapter.stages;
    for (let i = 0; i < stageDefs.length; i++) {
      const type = stageDefs[i].type;
      let payload = {};
      if (type === 'evidence_wall')  payload = { connections: [] };
      if (type === 'decision_point') payload = { selectedOptionId: 'opt_a' };
      await request(app)
        .patch(`/api/case-files/sessions/${sessionId}/stages/${i}`)
        .set('Cookie', cookie)
        .send({ stageType: type, payload });
    }
  }

  it('rejects completion when stages are incomplete', async () => {
    // Submit only stage 0
    const type = chapter.stages[0].type;
    await request(app)
      .patch(`/api/case-files/sessions/${sessionId}/stages/0`)
      .set('Cookie', cookie)
      .send({ stageType: type, payload: {} });

    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/complete`)
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('incomplete');
  });

  it('scores correctly and returns scoring object without airstar/XP fields', async () => {
    await submitAllStages();

    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/complete`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.totalScore).toBe('number');
    expect(Array.isArray(res.body.breakdown)).toBe(true);
    expect(res.body.breakdown).toHaveLength(chapter.stages.length);
    expect(res.body.completedAt).toBeDefined();
    // Case Files do NOT award airstars or level XP.
    expect(res.body).not.toHaveProperty('airstarsAwarded');
    expect(res.body).not.toHaveProperty('levelXpAwarded');
  });

  it('does not award airstars to user on completion', async () => {
    await submitAllStages();

    const before = await require('../../models/User').findById(user._id).lean();

    await request(app)
      .post(`/api/case-files/sessions/${sessionId}/complete`)
      .set('Cookie', cookie);

    const after = await require('../../models/User').findById(user._id).lean();

    expect(after.totalAirstars).toBe(before.totalAirstars);
    expect(after.cycleAirstars).toBe(before.cycleAirstars);
  });

  it('is idempotent — second complete call returns the same scoring', async () => {
    await submitAllStages();

    const r1 = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/complete`)
      .set('Cookie', cookie);

    const r2 = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/complete`)
      .set('Cookie', cookie);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.totalScore).toBe(r1.body.totalScore);
    // completedAt should be the same timestamp
    expect(r2.body.completedAt).toBe(r1.body.completedAt);
  });

  it('returns 403 for a different user', async () => {
    await submitAllStages();

    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/complete`)
      .set('Cookie', otherCookie);

    expect(res.status).toBe(403);
  });
});

// ── GET /sessions/:sessionId ───────────────────────────────────────────────────
describe('GET /api/case-files/sessions/:sessionId', () => {
  let caseDoc, chapter, sessionId;

  beforeEach(async () => {
    caseDoc = await createCase({ slug: 'get-sess-case', status: 'published' });
    chapter = await createChapter(caseDoc.slug, { chapterSlug: 'get-sess-ch', stages: makeStages(3) });

    const startRes = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
      .set('Cookie', cookie);
    sessionId = startRes.body.sessionId;
  });

  it('returns own session state', async () => {
    const res = await request(app)
      .get(`/api/case-files/sessions/${sessionId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.caseSlug).toBe(caseDoc.slug);
    expect(res.body.chapterSlug).toBe(chapter.chapterSlug);
    expect(res.body.currentStageIndex).toBe(0);
    expect(res.body.totalStages).toBe(3);
    expect(res.body.completedAt).toBeNull();
    expect(res.body.scoring).toBeNull();
  });

  it('returns 403 when another user reads this session', async () => {
    const res = await request(app)
      .get(`/api/case-files/sessions/${sessionId}`)
      .set('Cookie', otherCookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .get(`/api/case-files/sessions/${sessionId}`);

    expect(res.status).toBe(401);
  });
});

// ── GET /:caseSlug/chapters/:chapterSlug/best ─────────────────────────────────
describe('GET /api/case-files/:caseSlug/chapters/:chapterSlug/best', () => {
  it('returns bestScore: null and completedCount: 0 when no completions exist', async () => {
    const caseDoc = await createCase({ slug: 'best-case', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'best-ch' });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/best`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.bestScore).toBeNull();
    expect(res.body.completedCount).toBe(0);
  });

  it('returns the highest scoring completed session', async () => {
    const caseDoc = await createCase({ slug: 'best-score-case', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'best-score-ch' });

    // Manually create two completed sessions with different scores
    await GameSessionCaseFileResult.create({
      userId:      user._id,
      caseSlug:    caseDoc.slug,
      chapterSlug: chapter.chapterSlug,
      completedAt: new Date(),
      scoring:     { totalScore: 400, breakdown: [], airstarsAwarded: 120, levelXpAwarded: 120 },
    });
    await GameSessionCaseFileResult.create({
      userId:      user._id,
      caseSlug:    caseDoc.slug,
      chapterSlug: chapter.chapterSlug,
      completedAt: new Date(),
      scoring:     { totalScore: 720, breakdown: [], airstarsAwarded: 216, levelXpAwarded: 216 },
    });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/best`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.bestScore).toBe(720);
    expect(res.body.completedCount).toBe(2);
  });

  it('returns 401 without auth', async () => {
    const caseDoc = await createCase({ slug: 'best-noauth', status: 'published' });
    const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'best-noauth-ch' });

    const res = await request(app)
      .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/best`);

    expect(res.status).toBe(401);
  });
});

// ── POST /sessions/:sessionId/interrogate ─────────────────────────────────────

// ── fetch mock helpers (mirrored from admin.ai.test.js pattern) ───────────────

function mockFetchResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockOpenRouterAnswer(content) {
  return mockFetchResponse({
    choices: [{ message: { content } }],
  });
}

// ── Chapter fixture with an actor_interrogations stage ────────────────────────

const ACTOR_ID      = 'actor_lavrov';
const ACTOR_KEY     = 'lavrov';
const MAX_QUESTIONS = 3;

function makeInterrogationStages() {
  return [
    {
      id:      'stage_ai_1',
      type:    'actor_interrogations',
      payload: {
        actors: [
          {
            id:              ACTOR_ID,
            name:            'Sergei Lavrov',
            role:            'Foreign Minister',
            faction:         'Russia',
            systemPromptKey: ACTOR_KEY,
          },
          {
            id:              'actor_putin',
            name:            'Vladimir Putin',
            role:            'President',
            faction:         'Russia',
            systemPromptKey: 'putin',
          },
        ],
        relationships:       [],
        maxQuestionsPerActor: MAX_QUESTIONS,
        contextDateLabel:    'Nov 2021',
      },
      scoring: { baseEngagementScore: 10, signalKeywords: [], maxScore: 50 },
    },
  ];
}

describe('POST /api/case-files/sessions/:sessionId/interrogate', () => {
  let caseDoc, chapter, sessionId;

  beforeEach(async () => {
    // Restore any jest spies between tests
    jest.restoreAllMocks();

    caseDoc = await createCase({ slug: `interrogate-case-${Date.now()}`, status: 'published' });
    chapter = await createChapter(caseDoc.slug, {
      chapterSlug: `interrogate-ch-${Date.now()}`,
      stages:      makeInterrogationStages(),
    });

    const startRes = await request(app)
      .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
      .set('Cookie', cookie);
    sessionId = startRes.body.sessionId;
  });

  function interrogateBody(overrides = {}) {
    return {
      stageIndex: 0,
      actorId:    ACTOR_ID,
      question:   'What are Russia\'s red lines regarding NATO expansion?',
      ...overrides,
    };
  }

  // ── Auth guards ─────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .send(interrogateBody());

    expect(res.status).toBe(401);
  });

  it('returns 403 when a different user tries to interrogate', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', otherCookie)
      .send(interrogateBody());

    expect(res.status).toBe(403);
  });

  // ── Question validation ──────────────────────────────────────────────────────

  it('returns 400 invalid_question for an empty question', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ question: '' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_question');
  });

  it('returns 400 invalid_question for a question longer than 280 chars', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ question: 'x'.repeat(281) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_question');
  });

  it('returns 400 invalid_question when question is not a string', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ question: 12345 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_question');
  });

  // ── Stage validation ─────────────────────────────────────────────────────────

  it('returns 400 session_not_at_stage when stageIndex does not match currentStageIndex', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ stageIndex: 99 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('session_not_at_stage');
  });

  it('returns 400 session_not_at_stage when stage type is not actor_interrogations', async () => {
    // Build a chapter whose stage 0 is cold_open (not actor_interrogations)
    const caseDoc2  = await createCase({ slug: `wrong-type-case-${Date.now()}`, status: 'published' });
    const chapter2  = await createChapter(caseDoc2.slug, {
      chapterSlug: `wrong-type-ch-${Date.now()}`,
      stages:      makeStages(1), // cold_open
    });
    const r = await request(app)
      .post(`/api/case-files/${caseDoc2.slug}/chapters/${chapter2.chapterSlug}/sessions`)
      .set('Cookie', cookie);
    const badSessionId = r.body.sessionId;

    const res = await request(app)
      .post(`/api/case-files/sessions/${badSessionId}/interrogate`)
      .set('Cookie', cookie)
      .send({ stageIndex: 0, actorId: ACTOR_ID, question: 'A valid question?' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('session_not_at_stage');
  });

  // ── Actor validation ─────────────────────────────────────────────────────────

  it('returns 400 invalid_actor for an actorId not in the stage', async () => {
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ actorId: 'actor_does_not_exist' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_actor');
  });

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('happy path: returns {answer, questionsRemaining: 2} after first question', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouterAnswer('Mocked answer')
    );

    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody());

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Mocked answer');
    expect(res.body.questionsRemaining).toBe(2);
  });

  it('transcript is persisted on session after a successful interrogation', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouterAnswer('Mocked answer')
    );

    await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody());

    const saved = await GameSessionCaseFileResult.findById(sessionId).lean();
    expect(saved.interrogationTranscripts).toHaveLength(1);
    expect(saved.interrogationTranscripts[0].stageIndex).toBe(0);
    expect(saved.interrogationTranscripts[0].actorId).toBe(ACTOR_ID);
    expect(saved.interrogationTranscripts[0].q).toContain('red lines');
    expect(saved.interrogationTranscripts[0].a).toBe('Mocked answer');
    expect(saved.interrogationTranscripts[0].askedAt).toBeDefined();
  });

  it('questionsRemaining decrements correctly across multiple questions', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => mockOpenRouterAnswer('Mocked answer'));

    const r1 = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ question: 'Question one?' }));

    const r2 = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ question: 'Question two?' }));

    expect(r1.body.questionsRemaining).toBe(2);
    expect(r2.body.questionsRemaining).toBe(1);
  });

  // ── Rate limit ────────────────────────────────────────────────────────────────

  it('returns 429 rate_limited with questionsRemaining: 0 after 3 questions to same actor', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => mockOpenRouterAnswer('Mocked answer'));

    for (let i = 0; i < MAX_QUESTIONS; i++) {
      await request(app)
        .post(`/api/case-files/sessions/${sessionId}/interrogate`)
        .set('Cookie', cookie)
        .send(interrogateBody({ question: `Question ${i + 1}?` }));
    }

    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ question: 'One more question?' }));

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.body.questionsRemaining).toBe(0);
  });

  // ── Independent rate limits per actor ────────────────────────────────────────

  it('different actors are independently rate-limited', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => mockOpenRouterAnswer('Mocked answer'));

    // Exhaust lavrov's quota
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      await request(app)
        .post(`/api/case-files/sessions/${sessionId}/interrogate`)
        .set('Cookie', cookie)
        .send(interrogateBody({ question: `Lavrov Q${i + 1}?` }));
    }

    // Putin still has questions remaining
    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody({ actorId: 'actor_putin', question: 'Putin question?' }));

    expect(res.status).toBe(200);
    expect(res.body.questionsRemaining).toBe(2);
  });

  // ── Completed session guard ───────────────────────────────────────────────────

  it('returns 400 session_already_completed for a completed session', async () => {
    // Mark session completed directly
    await GameSessionCaseFileResult.findByIdAndUpdate(sessionId, {
      completedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/case-files/sessions/${sessionId}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('session_already_completed');
  });

  // ── 404 ───────────────────────────────────────────────────────────────────────

  it('returns 404 for a non-existent sessionId', async () => {
    const { Types } = require('mongoose');
    const res = await request(app)
      .post(`/api/case-files/sessions/${new Types.ObjectId()}/interrogate`)
      .set('Cookie', cookie)
      .send(interrogateBody());

    expect(res.status).toBe(404);
  });
});

// ── Access gating: enabled / tier / daily limit ───────────────────────────────
describe('Access gating', () => {
  describe('caseFilesEnabled = false', () => {
    beforeEach(async () => {
      await createSettings({ caseFilesEnabled: false });
    });

    it('GET /api/case-files returns 403 disabled for a regular user', async () => {
      await createCase({ slug: 'gate-list', status: 'published' });
      const res = await request(app).get('/api/case-files').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('disabled');
    });

    it('GET /api/case-files returns 403 disabled for a guest', async () => {
      await createCase({ slug: 'gate-guest-list', status: 'published' });
      const res = await request(app).get('/api/case-files');
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('disabled');
    });

    it('GET /api/case-files/:caseSlug returns 403 disabled', async () => {
      const caseDoc = await createCase({ slug: 'gate-detail', status: 'published' });
      const res = await request(app).get(`/api/case-files/${caseDoc.slug}`).set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('disabled');
    });

    it('GET chapter returns 403 disabled', async () => {
      const caseDoc = await createCase({ slug: 'gate-ch', status: 'published' });
      const ch = await createChapter(caseDoc.slug, { chapterSlug: 'gate-ch-1' });
      const res = await request(app)
        .get(`/api/case-files/${caseDoc.slug}/chapters/${ch.chapterSlug}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('disabled');
    });

    it('POST sessions returns 403 disabled', async () => {
      const caseDoc = await createCase({ slug: 'gate-sess', status: 'published' });
      const ch = await createChapter(caseDoc.slug, { chapterSlug: 'gate-sess-1' });
      const res = await request(app)
        .post(`/api/case-files/${caseDoc.slug}/chapters/${ch.chapterSlug}/sessions`)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('disabled');
    });

    it('admin bypasses the disabled gate', async () => {
      const admin       = await createUser({ isAdmin: true });
      const adminCookie = authCookie(admin._id);
      await createCase({ slug: 'gate-admin', status: 'published' });

      const res = await request(app).get('/api/case-files').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
    });

    it('GET /status reports reason=disabled with canPlay=false', async () => {
      const res = await request(app).get('/api/case-files/status').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.canPlay).toBe(false);
      expect(res.body.data.reason).toBe('disabled');
    });
  });

  describe('per-case tier gating', () => {
    it('list endpoint returns each case with its tiers array', async () => {
      await createCase({ slug: 'tier-list', status: 'published', tiers: ['gold'] });
      const res = await request(app).get('/api/case-files').set('Cookie', cookie);
      expect(res.status).toBe(200);
      const found = res.body.find(c => c.slug === 'tier-list');
      expect(found.tiers).toEqual(['gold']);
    });

    it('detail endpoint returns 403 reason=tier when user tier is blocked', async () => {
      // Gold-only case; default test user is free
      const caseDoc = await createCase({ slug: 'tier-detail-blocked', status: 'published', tiers: ['gold'] });
      const res = await request(app).get(`/api/case-files/${caseDoc.slug}`).set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('tier');
      expect(res.body.minTier).toBe('gold');
    });

    it('detail endpoint passes when user tier is in the case allowlist', async () => {
      const silverUser   = await createUser({ subscriptionTier: 'silver' });
      const silverCookie = authCookie(silverUser._id);
      const caseDoc = await createCase({ slug: 'tier-detail-allowed', status: 'published', tiers: ['silver'] });
      const res = await request(app).get(`/api/case-files/${caseDoc.slug}`).set('Cookie', silverCookie);
      expect(res.status).toBe(200);
    });

    it('admin bypasses per-case tier restriction on detail endpoint', async () => {
      const admin       = await createUser({ isAdmin: true, subscriptionTier: 'free' });
      const adminCookie = authCookie(admin._id);
      const caseDoc = await createCase({ slug: 'tier-admin-bypass', status: 'published', tiers: ['gold'] });
      const res = await request(app).get(`/api/case-files/${caseDoc.slug}`).set('Cookie', adminCookie);
      expect(res.status).toBe(200);
    });

    it('chapter detail and POST sessions return 403 reason=tier for a blocked user', async () => {
      const caseDoc = await createCase({ slug: 'tier-chapter-blocked', status: 'published', tiers: ['gold'] });
      const chapter = await createChapter(caseDoc.slug, { chapterSlug: 'tier-ch-blocked' });

      const chRes = await request(app)
        .get(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}`)
        .set('Cookie', cookie);
      expect(chRes.status).toBe(403);
      expect(chRes.body.reason).toBe('tier');

      const sessRes = await request(app)
        .post(`/api/case-files/${caseDoc.slug}/chapters/${chapter.chapterSlug}/sessions`)
        .set('Cookie', cookie);
      expect(sessRes.status).toBe(403);
      expect(sessRes.body.reason).toBe('tier');
    });
  });

  describe('Daily play limit', () => {
    it('returns 429 limit on the (N+1)th session of the day', async () => {
      await createSettings({
        caseFilesEnabled:          true,
        caseFilesDailyLimitFree:   2,
      });
      // Explicitly allow free users through the per-case tier gate
      const caseDoc = await createCase({ slug: 'limit-case', status: 'published', tiers: ['free'] });
      const ch      = await createChapter(caseDoc.slug, { chapterSlug: 'limit-ch' });
      const url     = `/api/case-files/${caseDoc.slug}/chapters/${ch.chapterSlug}/sessions`;

      const r1 = await request(app).post(url).set('Cookie', cookie);
      const r2 = await request(app).post(url).set('Cookie', cookie);
      const r3 = await request(app).post(url).set('Cookie', cookie);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r3.status).toBe(429);
      expect(r3.body.reason).toBe('limit');
      expect(r3.body.usedToday).toBe(2);
      expect(r3.body.limitToday).toBe(2);
    });

    it('admin is not subject to daily limit', async () => {
      await createSettings({
        caseFilesEnabled:          true,
        caseFilesDailyLimitFree:   1,
      });
      const admin       = await createUser({ isAdmin: true });
      const adminCookie = authCookie(admin._id);
      // Admin bypasses the per-case tier gate regardless of tiers value
      const caseDoc = await createCase({ slug: 'limit-admin', status: 'published', tiers: ['free'] });
      const ch      = await createChapter(caseDoc.slug, { chapterSlug: 'limit-admin-ch' });
      const url     = `/api/case-files/${caseDoc.slug}/chapters/${ch.chapterSlug}/sessions`;

      const r1 = await request(app).post(url).set('Cookie', adminCookie);
      const r2 = await request(app).post(url).set('Cookie', adminCookie);
      const r3 = await request(app).post(url).set('Cookie', adminCookie);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r3.status).toBe(201);
    });

    it('GET /status reports reason=limit with usedToday/limitToday', async () => {
      await createSettings({
        caseFilesEnabled:          true,
        caseFilesDailyLimitFree:   1,
      });
      // Explicitly allow free users through the per-case tier gate
      const caseDoc = await createCase({ slug: 'limit-status', status: 'published', tiers: ['free'] });
      const ch      = await createChapter(caseDoc.slug, { chapterSlug: 'limit-status-ch' });
      // Burn the slot
      await request(app)
        .post(`/api/case-files/${caseDoc.slug}/chapters/${ch.chapterSlug}/sessions`)
        .set('Cookie', cookie);

      const res = await request(app).get('/api/case-files/status').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe('limit');
      expect(res.body.data.canPlay).toBe(false);
      expect(res.body.data.usedToday).toBe(1);
      expect(res.body.data.limitToday).toBe(1);
    });
  });
});
