/**
 * users.badge.test.js
 *
 * Integration tests for the profile badge endpoints:
 *   GET   /api/users/me/badge-options  — read-gated Aircraft briefs with cutout status
 *   PATCH /api/users/me/badge          — set/clear the user's selected badge
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createBrief, createReadRecord, createSettings, createGameType, authCookie,
} = require('../helpers/factories');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const Media             = require('../../models/Media');
const User              = require('../../models/User');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await createGameType();
});
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => db.closeDatabase());

async function briefWithCutout({ title = 'Typhoon', hasCutout = true } = {}) {
  const brief = await createBrief({ title, category: 'Aircrafts', status: 'published' });
  const media = await Media.create({
    mediaType: 'picture',
    mediaUrl:  `https://example.com/${title}.jpg`,
    cutoutUrl: hasCutout ? `https://res.cloudinary.com/test/cutouts/${title}.png` : null,
  });
  await IntelligenceBrief.findByIdAndUpdate(brief._id, { $push: { media: media._id } });
  return { brief, media };
}

// ── GET /api/users/me/badge-options ─────────────────────────────────────────

describe('GET /api/users/me/badge-options', () => {
  it('marks read Aircraft briefs with cutouts as available, unread ones as locked', async () => {
    const user = await createUser();
    const { brief: read }   = await briefWithCutout({ title: 'Typhoon' });
    const { brief: unread } = await briefWithCutout({ title: 'Lightning' });
    const nonAircraft       = await createBrief({ title: 'Waddington', category: 'Bases', status: 'published' });
    await createReadRecord(user._id, read._id);
    await createReadRecord(user._id, nonAircraft._id);

    const res = await request(app)
      .get('/api/users/me/badge-options')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const byTitle = Object.fromEntries(res.body.data.map(o => [o.title, o]));
    expect(byTitle.Typhoon.status).toBe('available');
    expect(byTitle.Lightning.status).toBe('locked');
    expect(byTitle.Lightning.cutoutUrl).toMatch(/Lightning\.png$/);
    expect(byTitle.Waddington).toBeUndefined();
  });

  it('treats incomplete reads as not-yet-unlocked (locked)', async () => {
    const user = await createUser();
    const { brief } = await briefWithCutout({ title: 'Typhoon' });
    await createReadRecord(user._id, brief._id, { completed: false });

    const res = await request(app)
      .get('/api/users/me/badge-options')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('locked');
  });

  it('flags read aircraft without cutouts as pending; hides unread cutoutless ones', async () => {
    const user = await createUser();
    const { brief: pending } = await briefWithCutout({ title: 'Chinook',  hasCutout: false });
    await briefWithCutout({ title: 'Hercules', hasCutout: false });
    await createReadRecord(user._id, pending._id);

    const res = await request(app)
      .get('/api/users/me/badge-options')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Chinook');
    expect(res.body.data[0].status).toBe('pending');
    expect(res.body.data[0].cutoutUrl).toBeNull();
  });

  it('sorts available → locked → pending', async () => {
    const user = await createUser();
    const { brief: pending }  = await briefWithCutout({ title: 'Chinook', hasCutout: false });
    const { brief: ready }    = await briefWithCutout({ title: 'Typhoon' });
    await briefWithCutout({ title: 'Lightning' });
    await createReadRecord(user._id, pending._id);
    await createReadRecord(user._id, ready._id);

    const res = await request(app)
      .get('/api/users/me/badge-options')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.map(o => o.status)).toEqual(['available', 'locked', 'pending']);
  });

  it('returns locked cutouts even when user has read nothing', async () => {
    const user = await createUser();
    await briefWithCutout({ title: 'Typhoon' });
    await briefWithCutout({ title: 'Chinook', hasCutout: false });

    const res = await request(app)
      .get('/api/users/me/badge-options')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Typhoon');
    expect(res.body.data[0].status).toBe('locked');
  });

  it('returns empty array when no Aircraft briefs exist', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/users/me/badge-options')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/users/me/badge-options');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/users/me/badge ───────────────────────────────────────────────

describe('PATCH /api/users/me/badge', () => {
  it('sets selectedBadgeBriefId and returns hydrated selectedBadge', async () => {
    const user = await createUser();
    const { brief, media } = await briefWithCutout({ title: 'Typhoon' });
    await createReadRecord(user._id, brief._id);

    const res = await request(app)
      .patch('/api/users/me/badge')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(200);
    expect(res.body.data.user.selectedBadge).toEqual({
      briefId: String(brief._id),
      title:   'Typhoon',
      cutoutUrl: media.cutoutUrl,
    });
    const reloaded = await User.findById(user._id);
    expect(String(reloaded.selectedBadgeBriefId)).toBe(String(brief._id));
  });

  it('clears selection when briefId is null', async () => {
    const { brief } = await briefWithCutout({ title: 'Typhoon' });
    const user = await createUser({ selectedBadgeBriefId: brief._id });

    const res = await request(app)
      .patch('/api/users/me/badge')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.user.selectedBadge).toBeNull();
    const reloaded = await User.findById(user._id);
    expect(reloaded.selectedBadgeBriefId).toBeNull();
  });

  it('rejects a brief the user has not read with 403', async () => {
    const user = await createUser();
    const { brief } = await briefWithCutout({ title: 'Typhoon' });

    const res = await request(app)
      .patch('/api/users/me/badge')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
  });

  it('rejects a brief without a cutout with 403', async () => {
    const user = await createUser();
    const { brief } = await briefWithCutout({ title: 'Chinook', hasCutout: false });
    await createReadRecord(user._id, brief._id);

    const res = await request(app)
      .patch('/api/users/me/badge')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(brief._id) });

    expect(res.status).toBe(403);
  });

  it('rejects a non-Aircraft brief with 403', async () => {
    const user = await createUser();
    const base = await createBrief({ title: 'Waddington', category: 'Bases', status: 'published' });
    await createReadRecord(user._id, base._id);

    const res = await request(app)
      .patch('/api/users/me/badge')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: String(base._id) });

    expect(res.status).toBe(403);
  });

  it('rejects malformed briefId with 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .patch('/api/users/me/badge')
      .set('Cookie', authCookie(user._id))
      .send({ briefId: 'not-an-objectid' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).patch('/api/users/me/badge').send({ briefId: null });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/auth/me populates selectedBadge ────────────────────────────────

describe('GET /api/auth/me with selectedBadge', () => {
  it('hydrates selectedBadge when the user has a selection', async () => {
    const { brief, media } = await briefWithCutout({ title: 'Typhoon' });
    const user = await createUser({ selectedBadgeBriefId: brief._id });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.user.selectedBadge).toEqual({
      briefId: String(brief._id),
      title:   'Typhoon',
      cutoutUrl: media.cutoutUrl,
    });
  });

  it('returns null selectedBadge when the brief cutout was removed since selection', async () => {
    const { brief, media } = await briefWithCutout({ title: 'Typhoon', hasCutout: false });
    const user = await createUser({ selectedBadgeBriefId: brief._id });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.user.selectedBadge).toBeNull();
  });

  it('returns null selectedBadge when user has no selection', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', authCookie(user._id));
    expect(res.body.data.user.selectedBadge).toBeNull();
  });
});
