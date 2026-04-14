/**
 * admin.briefs.extract-subject.test.js
 *
 * Integration tests for the aircraft-subject extraction flow and the
 * cutout-aware deletion cascades.
 *
 * Routes covered:
 *   POST   /api/admin/briefs/:id/media/:mediaId/extract-subject
 *   DELETE /api/admin/briefs/:id/media/:mediaId  (cutout cleanup)
 *   DELETE /api/admin/briefs/:id                 (media + cutout cascade)
 *
 * The extractCutout util is mocked at the module level so we never touch
 * OpenRouter or sharp — we only verify the route orchestrates the pipeline
 * and persists the returned URLs onto the Media doc. Cloudinary is also
 * mocked so destroyAsset calls can be asserted.
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

// Mock the cutout pipeline — return a fixed fake Cloudinary response every
// time. Defined inside the factory so jest's mock hoisting doesn't trip over
// temporal-dead-zone ordering.
jest.mock('../../utils/extractCutout', () => ({
  extractSubjectToCloudinary: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/image/upload/cutouts/cutout-fake-123.png',
    public_id:  'brief-images/cutouts/cutout-fake-123',
  }),
}));

// Mock Cloudinary so destroyAsset calls can be observed without real network.
jest.mock('../../utils/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/image/upload/test.jpg',
    public_id:  'brief-images/test',
  }),
  destroyAsset: jest.fn().mockResolvedValue({ result: 'ok' }),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createAdminUser, createBrief, createSettings, createGameType, authCookie,
} = require('../helpers/factories');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const Media             = require('../../models/Media');
const { extractSubjectToCloudinary } = require('../../utils/extractCutout');
const { destroyAsset }               = require('../../utils/cloudinary');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await createGameType();
});
afterEach(async () => {
  jest.clearAllMocks();
  await db.clearDatabase();
});
afterAll(async () => db.closeDatabase());

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createBriefWithMedia(category = 'Aircrafts', mediaOverrides = {}) {
  const brief = await createBrief({ category });
  const media = await Media.create({
    mediaType:          'picture',
    mediaUrl:           'https://example.com/typhoon.jpg',
    cloudinaryPublicId: 'brief-images/typhoon',
    name:               'Typhoon',
    ...mediaOverrides,
  });
  await IntelligenceBrief.findByIdAndUpdate(brief._id, { $push: { media: media._id } });
  return { brief, media };
}

// ── POST /api/admin/briefs/:id/media/:mediaId/extract-subject ────────────────

describe('POST /api/admin/briefs/:id/media/:mediaId/extract-subject', () => {
  it('writes cutoutUrl + cutoutPublicId onto the Media doc for Aircraft briefs', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts');

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/media/${media._id}/extract-subject`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.media.cutoutUrl).toContain('cutouts/cutout-fake-123');
    expect(extractSubjectToCloudinary).toHaveBeenCalledTimes(1);

    const reloaded = await Media.findById(media._id);
    expect(reloaded.cutoutUrl).toBeTruthy();
    expect(reloaded.cutoutPublicId).toBe('brief-images/cutouts/cutout-fake-123');
  });

  it('rejects non-Aircraft briefs with 400', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Bases');

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/media/${media._id}/extract-subject`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/aircraft/i);
    expect(extractSubjectToCloudinary).not.toHaveBeenCalled();
  });

  it('rejects media not attached to the brief', async () => {
    const admin = await createAdminUser();
    const { brief } = await createBriefWithMedia('Aircrafts');
    const orphanMedia = await Media.create({
      mediaType: 'picture',
      mediaUrl:  'https://example.com/other.jpg',
    });

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/media/${orphanMedia._id}/extract-subject`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
  });

  it('destroys the previous cutout when re-running extraction', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/old-cutout.png',
      cutoutPublicId: 'brief-images/cutouts/old-cutout',
    });

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/media/${media._id}/extract-subject`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/cutouts/old-cutout');
  });

  it('requires admin auth', async () => {
    const { brief, media } = await createBriefWithMedia('Aircrafts');
    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/media/${media._id}/extract-subject`);
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/admin/briefs/:id/media/:mediaId/cutout — clear cutout only ──

describe('DELETE /api/admin/briefs/:id/media/:mediaId/cutout', () => {
  it('clears the cutout fields and destroys the Cloudinary asset', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-remove-me',
    });

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${media._id}/cutout`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.media.cutoutUrl).toBeNull();
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/cutouts/cut-remove-me');

    const reloaded = await Media.findById(media._id);
    expect(reloaded.cutoutUrl).toBeNull();
    expect(reloaded.cutoutPublicId).toBeNull();
    // Original image survives
    expect(reloaded.mediaUrl).toBe('https://example.com/typhoon.jpg');
    expect(reloaded.cloudinaryPublicId).toBe('brief-images/typhoon');
  });

  it('is idempotent when the media has no cutout', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts');

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${media._id}/cutout`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it('keeps the media attached to the brief', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-attached',
    });

    await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${media._id}/cutout`)
      .set('Cookie', authCookie(admin._id));

    const reloadedBrief = await IntelligenceBrief.findById(brief._id).lean();
    expect(reloadedBrief.media.map(String)).toContain(String(media._id));
  });

  it('rejects media not attached to the brief with 404', async () => {
    const admin = await createAdminUser();
    const { brief } = await createBriefWithMedia('Aircrafts');
    const orphanMedia = await Media.create({
      mediaType:      'picture',
      mediaUrl:       'https://example.com/other.jpg',
      cutoutUrl:      'https://res.cloudinary.com/test/orphan.png',
      cutoutPublicId: 'brief-images/cutouts/orphan',
    });

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${orphanMedia._id}/cutout`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it('requires admin auth', async () => {
    const { brief, media } = await createBriefWithMedia('Aircrafts');
    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${media._id}/cutout`);
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/admin/briefs/:id/media/:mediaId — cutout cleanup ─────────────

describe('DELETE /api/admin/briefs/:id/media/:mediaId — cutout cleanup', () => {
  it('destroys the cutout asset when no other Aircraft brief references the media', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-1',
    });

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/media/${media._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/cutouts/cut-1');
    // Original was also destroyed (no other brief references it)
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/typhoon');
  });

  it('preserves the cutout when another Aircraft brief still uses the same Media', async () => {
    const admin = await createAdminUser();
    const { brief: briefA, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-shared',
    });
    // Second Aircraft brief sharing the same Media
    const briefB = await createBrief({ category: 'Aircrafts', title: 'Second Aircraft' });
    await IntelligenceBrief.findByIdAndUpdate(briefB._id, { $push: { media: media._id } });

    const res = await request(app)
      .delete(`/api/admin/briefs/${briefA._id}/media/${media._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.shared).toBe(true);
    expect(destroyAsset).not.toHaveBeenCalled();

    const reloaded = await Media.findById(media._id);
    expect(reloaded.cutoutPublicId).toBe('brief-images/cutouts/cut-shared');
  });

  it('destroys the cutout when the only remaining references are non-Aircraft briefs', async () => {
    const admin = await createAdminUser();
    const { brief: aircraftBrief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-partial',
    });
    // A Bases brief also shares the Media doc (via dedup)
    const basesBrief = await createBrief({ category: 'Bases', title: 'RAF Lossiemouth' });
    await IntelligenceBrief.findByIdAndUpdate(basesBrief._id, { $push: { media: media._id } });

    const res = await request(app)
      .delete(`/api/admin/briefs/${aircraftBrief._id}/media/${media._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.shared).toBe(true); // Media doc survives for the Bases brief
    // But the cutout is dead weight — no Aircraft brief uses it anymore
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/cutouts/cut-partial');

    const reloaded = await Media.findById(media._id);
    expect(reloaded).toBeTruthy();
    expect(reloaded.cutoutUrl).toBeNull();
    expect(reloaded.cutoutPublicId).toBeNull();
  });
});

// ── DELETE /api/admin/briefs/:id — full cascade with media cleanup ───────────

describe('DELETE /api/admin/briefs/:id — media + cutout cascade', () => {
  it('destroys the Media doc + cutout asset when the deleted brief was the only referrer', async () => {
    const admin = await createAdminUser();
    const { brief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-solo',
    });

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test cleanup' });

    expect(res.status).toBe(200);
    const reloaded = await Media.findById(media._id);
    expect(reloaded).toBeNull();
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/typhoon');
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/cutouts/cut-solo');
  });

  it('keeps the Media doc when another brief references it, but still destroys the orphaned cutout', async () => {
    const admin = await createAdminUser();
    const { brief: aircraftBrief, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-orphan',
    });
    const basesBrief = await createBrief({ category: 'Bases', title: 'RAF Marham' });
    await IntelligenceBrief.findByIdAndUpdate(basesBrief._id, { $push: { media: media._id } });

    const res = await request(app)
      .delete(`/api/admin/briefs/${aircraftBrief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test cleanup' });

    expect(res.status).toBe(200);
    const reloaded = await Media.findById(media._id);
    expect(reloaded).toBeTruthy();                  // Media survives for the Bases brief
    expect(reloaded.cutoutPublicId).toBeNull();     // but the cutout is gone
    expect(destroyAsset).toHaveBeenCalledWith('brief-images/cutouts/cut-orphan');
    expect(destroyAsset).not.toHaveBeenCalledWith('brief-images/typhoon');
  });

  it('preserves both Media and cutout when another Aircraft brief still references them', async () => {
    const admin = await createAdminUser();
    const { brief: briefA, media } = await createBriefWithMedia('Aircrafts', {
      cutoutUrl:      'https://res.cloudinary.com/test/cutout.png',
      cutoutPublicId: 'brief-images/cutouts/cut-dualaircraft',
    });
    const briefB = await createBrief({ category: 'Aircrafts', title: 'Aircraft B' });
    await IntelligenceBrief.findByIdAndUpdate(briefB._id, { $push: { media: media._id } });

    const res = await request(app)
      .delete(`/api/admin/briefs/${briefA._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test cleanup' });

    expect(res.status).toBe(200);
    const reloaded = await Media.findById(media._id);
    expect(reloaded).toBeTruthy();
    expect(reloaded.cutoutPublicId).toBe('brief-images/cutouts/cut-dualaircraft');
    expect(destroyAsset).not.toHaveBeenCalled();
  });
});
