'use strict';

/**
 * Admin — Case Files usage stats (GET /api/admin/case-files/stats)
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const GameCaseFileChapter       = require('../../models/GameCaseFileChapter');
const GameSessionCaseFileResult = require('../../models/GameSessionCaseFileResult');
const CaseFileInterest          = require('../../models/CaseFileInterest');

const URL = '/api/admin/case-files/stats';
const MIN = 60 * 1000;

async function chapter() {
  return GameCaseFileChapter.create({
    caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', chapterNumber: 1,
    title: 'Road to Invasion', dateRangeLabel: 'x', summary: 'x', estimatedMinutes: 35, status: 'published',
    stages: [
      { id: 's0', type: 'cold_open', payload: {} },
      { id: 's1', type: 'evidence_wall', payload: {} },
      { id: 's2', type: 'debrief', payload: {} },
    ],
  });
}

function run(userId, { minutes = 30, score = null, stage = 0, abandoned = false, startedAgo = 60 * MIN } = {}) {
  const startedAt = new Date(Date.now() - startedAgo);
  const done = score !== null;
  return GameSessionCaseFileResult.create({
    userId, caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion',
    startedAt,
    completedAt: done ? new Date(startedAt.getTime() + minutes * MIN) : null,
    currentStageIndex: done ? 3 : stage,
    abandoned,
    scoring: done ? { totalScore: score, breakdown: [
      { stageIndex: 1, stageType: 'evidence_wall', score: score, maxScore: 500 },
    ] } : null,
  });
}

let admin, adminCookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  admin = await createAdminUser();
  adminCookie = authCookie(admin._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/admin/case-files/stats', () => {
  it('is admin only', async () => {
    const u = await createUser();
    expect((await request(app).get(URL).set('Cookie', authCookie(u._id))).status).toBe(403);
    expect((await request(app).get(URL)).status).toBe(401);
  });

  it('adds up runs, players, completion and playtime', async () => {
    await chapter();
    const a = await createUser(); const b = await createUser(); const c = await createUser();
    await run(a._id, { score: 400, minutes: 20 });
    await run(a._id, { score: 450, minutes: 30 });
    await run(b._id, { score: 300, minutes: 40 });
    await run(b._id, { score: 350, minutes: 60 * 20 });   // left open overnight
    await run(c._id, { stage: 1, abandoned: true });
    await run(c._id, { stage: 2 });

    const { body, status } = await request(app).get(URL).set('Cookie', adminCookie);
    expect(status).toBe(200);
    const t = body.data.totals;
    expect(t.runsStarted).toBe(6);
    expect(t.runsCompleted).toBe(4);
    expect(t.runsAbandoned).toBe(1);
    expect(t.runsInProgress).toBe(1);
    expect(t.players).toBe(3);
    expect(t.finishers).toBe(2);
    expect(t.repeatPlayers).toBe(2);
    expect(t.medianMinutes).toBe(30);   // 20, 30, 40; the overnight run is set aside
    expect(t.longRuns).toBe(1);
  });

  it('builds the per-stage funnel and scores for each chapter', async () => {
    await chapter();
    const a = await createUser(); const c = await createUser();
    await run(a._id, { score: 400 });
    await run(c._id, { stage: 1, abandoned: true });
    await run(c._id, { stage: 0 });

    const { body } = await request(app).get(URL).set('Cookie', adminCookie);
    const ch = body.data.chapters[0];
    expect(ch.title).toBe('Road to Invasion');
    expect(ch.funnel.map((f) => f.reached)).toEqual([3, 2, 1]);
    expect(ch.bestScore).toBe(400);
    expect(ch.maxScore).toBe(500);
    expect(ch.stageScores).toEqual([{ stageType: 'evidence_wall', avgPct: 0.8 }]);
  });

  it('lists each player\'s best run once, highest first, with their agent number', async () => {
    await chapter();
    const a = await createUser(); const b = await createUser();
    await run(a._id, { score: 200 });
    await run(a._id, { score: 480 });
    await run(b._id, { score: 300 });

    const { body } = await request(app).get(URL).set('Cookie', adminCookie);
    expect(body.data.topScores.map((r) => r.score)).toEqual([480, 300]);
    expect(body.data.topScores[0]).toHaveProperty('agentNumber');
  });

  it('counts today in the daily series', async () => {
    await chapter();
    const a = await createUser();
    await run(a._id, { score: 400, startedAgo: MIN, minutes: 0 });
    const { body } = await request(app).get(URL).set('Cookie', adminCookie);
    expect(body.data.daily).toHaveLength(body.data.days);
    const today = body.data.daily[body.data.daily.length - 1];
    expect(today.starts).toBe(1);
    expect(today.completions).toBe(1);
    expect(today.players).toBe(1);
  });

  it('includes the interest tally', async () => {
    await chapter();
    const a = await createUser(); const b = await createUser();
    await CaseFileInterest.create({ userId: a._id, caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', teaserTitle: 'Battle of Kyiv', interested: true });
    await CaseFileInterest.create({ userId: b._id, caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', teaserTitle: 'Battle of Kyiv', interested: false });
    const { body } = await request(app).get(URL).set('Cookie', adminCookie);
    expect(body.data.totals.interested).toBe(1);
    expect(body.data.interest[0]).toMatchObject({ teaserTitle: 'Battle of Kyiv', interested: 1, withdrawn: 1 });
  });

  it("leaves admins' own runs and interest out of every figure", async () => {
    await chapter();
    const a = await createUser();
    await run(a._id, { score: 300 });
    await run(admin._id, { score: 490, startedAgo: MIN, minutes: 0 });
    await run(admin._id, { stage: 1 });
    await CaseFileInterest.create({ userId: admin._id, caseSlug: 'russia-ukraine', chapterSlug: 'road-to-invasion', teaserTitle: 'Battle of Kyiv', interested: true });

    const { body } = await request(app).get(URL).set('Cookie', adminCookie);
    const d = body.data;
    expect(d.totals.runsStarted).toBe(1);
    expect(d.totals.players).toBe(1);
    expect(d.totals.interested).toBe(0);
    expect(d.interest).toEqual([]);
    expect(d.chapters[0].starts).toBe(1);
    expect(d.chapters[0].bestScore).toBe(300);
    expect(d.topScores.map((r) => r.userId)).toEqual([String(a._id)]);
    expect(d.daily.reduce((n, x) => n + x.starts, 0)).toBe(1);
  });
});
