'use strict';

/**
 * Case Files — "register your interest" in the next chapter
 *
 * Covers GET/PUT /api/case-files/:caseSlug/chapters/:chapterSlug/interest and
 * the admin tally at GET /api/admin/case-files/interest.
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const GameCaseFileChapter = require('../../models/GameCaseFileChapter');
const CaseFileInterest    = require('../../models/CaseFileInterest');

const CASE = 'russia-ukraine'
const CH   = 'road-to-invasion'
const URL  = `/api/case-files/${CASE}/chapters/${CH}/interest`

async function createChapter({ teaser = { title: 'Battle of Kyiv', blurb: 'Will Kyiv hold?' }, chapterSlug = CH } = {}) {
  return GameCaseFileChapter.create({
    caseSlug:         CASE,
    chapterSlug,
    chapterNumber:    1,
    title:            'Road to Invasion',
    dateRangeLabel:   'Sep 2021 – Feb 2022',
    summary:          'Chapter summary',
    estimatedMinutes: 35,
    status:           'published',
    stages: [
      { id: 's0', type: 'cold_open', payload: {} },
      { id: 's1', type: 'debrief', payload: { annotatedReplayBeats: [], teaserNextChapter: teaser } },
    ],
  });
}

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser();
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('Case Files interest — player', () => {
  it('needs a signed-in player', async () => {
    await createChapter();
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await request(app).put(URL).send({ interested: true })).status).toBe(401);
  });

  it('starts as not interested', async () => {
    await createChapter();
    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.interested).toBe(false);
  });

  it('registers interest, then takes it back, keeping one record', async () => {
    await createChapter();
    const on = await request(app).put(URL).set('Cookie', cookie).send({ interested: true });
    expect(on.status).toBe(200);
    expect(on.body.interested).toBe(true);
    expect((await request(app).get(URL).set('Cookie', cookie)).body.interested).toBe(true);

    const off = await request(app).put(URL).set('Cookie', cookie).send({ interested: false });
    expect(off.body.interested).toBe(false);

    const docs = await CaseFileInterest.find({ userId: user._id }).lean();
    expect(docs).toHaveLength(1)
    expect(docs[0].interested).toBe(false)
  });

  it('takes the teaser title from the chapter, not the request', async () => {
    await createChapter();
    await request(app).put(URL).set('Cookie', cookie).send({ interested: true, teaserTitle: 'spoofed' });
    const doc = await CaseFileInterest.findOne({ userId: user._id }).lean();
    expect(doc.teaserTitle).toBe('Battle of Kyiv');
  });

  it('rejects anything but a boolean', async () => {
    await createChapter();
    const res = await request(app).put(URL).set('Cookie', cookie).send({ interested: 'yes' });
    expect(res.status).toBe(400);
  });

  it('404s for a chapter with no teaser, or no chapter at all', async () => {
    await createChapter({ teaser: null });
    expect((await request(app).put(URL).set('Cookie', cookie).send({ interested: true })).status).toBe(404);
    const missing = `/api/case-files/${CASE}/chapters/nope/interest`;
    expect((await request(app).put(missing).set('Cookie', cookie).send({ interested: true })).status).toBe(404);
  });
});

describe('Case Files interest — admin tally', () => {
  it('is admin only', async () => {
    const res = await request(app).get('/api/admin/case-files/interest').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('counts current interest and withdrawals per teaser', async () => {
    await createChapter();
    const a = await createUser(); const b = await createUser(); const c = await createUser();
    await request(app).put(URL).set('Cookie', authCookie(a._id)).send({ interested: true });
    await request(app).put(URL).set('Cookie', authCookie(b._id)).send({ interested: true });
    await request(app).put(URL).set('Cookie', authCookie(c._id)).send({ interested: true });
    await request(app).put(URL).set('Cookie', authCookie(c._id)).send({ interested: false });

    const admin = await createAdminUser();
    const res = await request(app).get('/api/admin/case-files/interest').set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ caseSlug: CASE, chapterSlug: CH, teaserTitle: 'Battle of Kyiv', interested: 2, withdrawn: 1 }),
    ]);
  });
});
