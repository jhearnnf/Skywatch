/**
 * briefReels.routes.test.js
 *
 * Covers the Brief Reel feature backend: feature-flag tri-state on
 * AppSettings, admin generate/publish/discard routes, body-hash cache
 * invalidation, and public-vs-admin visibility of pending reels.
 *
 * The AI service (services/briefReelAi.generateBriefReelTimeline) is mocked
 * so tests never call OpenRouter.
 */

process.env.JWT_SECRET = 'test_secret';

jest.mock('../../services/briefReelAi', () => {
  const real = jest.requireActual('../../services/briefReelAi');
  return {
    ...real,
    generateBriefReelTimeline: jest.fn(async ({ sectionBody }) => ({
      version: 1,
      totalDurationMs: 10000,
      actors: [{
        id: 'a1',
        name: 'Test Subject',
        shortLabel: 'Subject',
        faction: 'raf-primary',
        headgear: 'cap-officer',
      }],
      props: [],
      beats: [{
        id: 'b1',
        textSpan: { start: 0, end: Math.min(sectionBody.length, 40) },
        durationMs: 10000,
        actions: [
          { type: 'enter',     actorId: 'a1', params: { position: 'centre' } },
          { type: 'show-name', actorId: 'a1' },
        ],
      }],
    })),
  };
});

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  createRank,
  createBrief,
  authCookie,
} = require('../helpers/factories');

const AppSettings = require('../../models/AppSettings');
const BriefReel   = require('../../models/BriefReel');
const briefReelAi = require('../../services/briefReelAi');

const SECTION_BODY = 'Air Chief Marshal Harvey Smyth has stated that the Royal Air Force must accelerate its shift towards an AI-enabled air force.';

async function setFlag(value) {
  // Direct DB write so admin auth doesn't get in the way of test setup.
  const s = await AppSettings.findOne();
  s.featureFlags.set('briefReel', value);
  s.markModified('featureFlags');
  await s.save();
}

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); jest.clearAllMocks(); });
afterAll(async () => { await db.closeDatabase(); });

describe('AppSettings.featureFlags — tri-state migration', () => {
  it('defaults briefReel and rsvpReader to "off" on a fresh doc', async () => {
    const s = await AppSettings.getSettings();
    expect(s.featureFlags.get('briefReel')).toBe('off');
    expect(s.featureFlags.get('rsvpReader')).toBe('off');
  });

  it('exposes featureFlags on the public GET /api/settings', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.featureFlags).toMatchObject({ briefReel: 'off', rsvpReader: 'off' });
  });
});

describe('PATCH /api/admin/settings — featureFlags', () => {
  beforeEach(async () => { await createRank(); await createSettings(); });

  it('rejects unknown flag keys', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { notAFlag: 'off' }, reason: 'try unknown key' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid values', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { briefReel: 'maybe' }, reason: 'try bad value' });
    expect(res.status).toBe(400);
  });

  it('persists a valid tri-state update', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: { briefReel: 'admin', rsvpReader: 'everyone' }, reason: 'flip flags' });
    expect(res.status).toBe(200);
    const saved = await AppSettings.findOne();
    expect(saved.featureFlags.get('briefReel')).toBe('admin');
    expect(saved.featureFlags.get('rsvpReader')).toBe('everyone');
  });
});

describe('GET /api/brief-reels/:briefId/:sectionIndex — feature flag gate', () => {
  beforeEach(async () => { await createRank(); await createSettings(); });

  it('returns 403 when flag is off, even for admins', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    await setFlag('off');
    const res = await request(app)
      .get(`/api/brief-reels/${brief._id}/0`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(403);
  });

  it('returns 403 to non-admins when flag is admin-only', async () => {
    const user  = await createUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    await setFlag('admin');
    const res = await request(app)
      .get(`/api/brief-reels/${brief._id}/0`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('returns 204 (no reel cached) when flag is everyone but nothing generated', async () => {
    const user  = await createUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    await setFlag('everyone');
    const res = await request(app)
      .get(`/api/brief-reels/${brief._id}/0`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(204);
  });

  it('hides pending reels from non-admins; admins see them', async () => {
    const user  = await createUser();
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    await setFlag('everyone');

    // Generate a pending reel as admin.
    await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });

    const userRes = await request(app)
      .get(`/api/brief-reels/${brief._id}/0`)
      .set('Cookie', authCookie(user._id));
    expect(userRes.status).toBe(204);

    const adminRes = await request(app)
      .get(`/api/brief-reels/${brief._id}/0`)
      .set('Cookie', authCookie(admin._id));
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.status).toBe('pending');
  });
});

describe('Admin generate / publish / discard', () => {
  beforeEach(async () => { await createRank(); await createSettings(); });

  it('blocks non-admins from POST /admin/generate', async () => {
    const user  = await createUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    const res = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(res.status).toBe(403);
  });

  it('generates a pending reel for a valid section', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    const res = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.reel.status).toBe('pending');
    expect(res.body.data.regenerated).toBe(true);
    expect(briefReelAi.generateBriefReelTimeline).toHaveBeenCalledTimes(1);
  });

  it('returns the existing reel (no AI call) when one already exists for the same body', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });

    await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(briefReelAi.generateBriefReelTimeline).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(second.status).toBe(200);
    expect(second.body.data.regenerated).toBe(false);
    expect(briefReelAi.generateBriefReelTimeline).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('editing the section body invalidates the cached reel (new bodyHash → new generation)', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });

    await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(briefReelAi.generateBriefReelTimeline).toHaveBeenCalledTimes(1);

    // Mutate the section body directly.
    const IntelligenceBrief = require('../../models/IntelligenceBrief');
    await IntelligenceBrief.findByIdAndUpdate(brief._id, {
      descriptionSections: [{ heading: 'H', body: SECTION_BODY + ' New addendum.' }],
    });

    const after = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(after.status).toBe(200);
    expect(after.body.data.regenerated).toBe(true);
    expect(briefReelAi.generateBriefReelTimeline).toHaveBeenCalledTimes(2);
  });

  it('publish flips status to published and stamps publishedBy/publishedAt', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    const gen = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    const reelId = gen.body.data.reel._id;

    const pub = await request(app)
      .post(`/api/brief-reels/admin/${reelId}/publish`)
      .set('Cookie', authCookie(admin._id));
    expect(pub.status).toBe(200);

    const saved = await BriefReel.findById(reelId);
    expect(saved.status).toBe('published');
    expect(saved.publishedBy.toString()).toBe(admin._id.toString());
    expect(saved.publishedAt).toBeTruthy();
  });

  it('discard deletes the reel; next generate calls AI again', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ descriptionSections: [{ heading: 'H', body: SECTION_BODY }] });
    const gen = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    const reelId = gen.body.data.reel._id;

    await request(app)
      .delete(`/api/brief-reels/admin/${reelId}`)
      .set('Cookie', authCookie(admin._id));
    expect(await BriefReel.findById(reelId)).toBeNull();

    const regen = await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });
    expect(regen.body.data.regenerated).toBe(true);
    expect(briefReelAi.generateBriefReelTimeline).toHaveBeenCalledTimes(2);
  });

  it('GET /admin/pending lists pending reels with brief title', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({
      title: 'Pending Brief',
      descriptionSections: [{ heading: 'H', body: SECTION_BODY }],
    });
    await request(app)
      .post('/api/brief-reels/admin/generate')
      .set('Cookie', authCookie(admin._id))
      .send({ briefId: brief._id.toString(), sectionIndex: 0 });

    const res = await request(app)
      .get('/api/brief-reels/admin/pending')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].briefTitle).toBe('Pending Brief');
    expect(res.body.data.rows[0].sectionIndex).toBe(0);
  });
});

describe('briefReelAi.parseTimelineJson', () => {
  const { parseTimelineJson } = require('../../services/briefReelAi');

  it('parses pure JSON', () => {
    expect(parseTimelineJson('{"version":1}')).toEqual({ version: 1 });
  });

  it('strips markdown ```json fences', () => {
    const raw = '```json\n{"version":1, "actors":[]}\n```';
    expect(parseTimelineJson(raw)).toEqual({ version: 1, actors: [] });
  });

  it('strips plain ``` fences', () => {
    expect(parseTimelineJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts the outermost JSON object after a prose preamble', () => {
    const raw = `Here is the timeline you requested:\n\n{"version":1,"nested":{"x":2}}\n\nLet me know if you need adjustments.`;
    expect(parseTimelineJson(raw)).toEqual({ version: 1, nested: { x: 2 } });
  });

  it('returns null for non-JSON garbage', () => {
    expect(parseTimelineJson('no json here at all')).toBeNull();
    expect(parseTimelineJson('')).toBeNull();
    expect(parseTimelineJson(null)).toBeNull();
  });

  it('returns null when JSON object never closes', () => {
    expect(parseTimelineJson('{"a":1, "b": [1,2,3')).toBeNull();
  });
});

describe('briefReelAi.validateTimeline', () => {
  const { validateTimeline } = require('../../services/briefReelAi');
  const minimal = {
    version: 1,
    totalDurationMs: 10000,
    actors: [{ id: 'a1', name: 'Actor', shortLabel: 'A', faction: 'raf-primary', headgear: 'cap-officer' }],
    props:  [],
    beats:  [{
      id: 'b1',
      textSpan: { start: 0, end: 40 },
      durationMs: 10000,
      actions: [{ type: 'enter', actorId: 'a1' }],
    }],
  };

  it('accepts a well-formed timeline', () => {
    expect(validateTimeline(minimal, 100)).toBeNull();
  });

  it('rejects unknown action type', () => {
    const bad = { ...minimal, beats: [{ ...minimal.beats[0], actions: [{ type: 'breakdance', actorId: 'a1' }] }] };
    expect(validateTimeline(bad, 100)).toMatch(/bad action/);
  });

  it('rejects textSpan past body length', () => {
    expect(validateTimeline(minimal, 10)).toMatch(/bad textSpan/);
  });

  it('rejects unknown actor reference', () => {
    const bad = { ...minimal, beats: [{ ...minimal.beats[0], actions: [{ type: 'enter', actorId: 'ghost' }] }] };
    expect(validateTimeline(bad, 100)).toMatch(/unknown actor/);
  });
});
