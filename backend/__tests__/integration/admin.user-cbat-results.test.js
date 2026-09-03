/**
 * admin.user-cbat-results.test.js
 *
 * Tests for the CBAT score-sheet screenshots an admin attaches to an account
 * from the Admin › Users expanded row:
 *   POST   /api/admin/users/:id/cbat-results
 *   DELETE /api/admin/users/:id/cbat-results/:imageId
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Uploads a data URL and appends it to the user's list
 *   - Rejects a non-image / empty payload
 *   - Deletes an entry and its Cloudinary asset
 *   - A Cloudinary delete failure still removes the entry
 *   - 404s for unknown user / unknown image
 */

process.env.JWT_SECRET = 'test_secret';

// Mocked at the utility layer — the routes only care that uploadBuffer returns
// a {secure_url, public_id} and that destroyAsset is called with the public id.
jest.mock('../../utils/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/cbat-results/sheet.png',
    public_id:  'cbat-results/sheet',
  }),
  destroyAsset: jest.fn().mockResolvedValue({ result: 'ok' }),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createAdminUser,
  createUser,
  createRank,
  authCookie,
} = require('../helpers/factories');

const User = require('../../models/User');
const { uploadBuffer, destroyAsset } = require('../../utils/cloudinary');

// 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); jest.clearAllMocks(); });
afterAll(async () => { await db.closeDatabase(); });

function upload(cookie, id, body) {
  const req = request(app).post(`/api/admin/users/${id}/cbat-results`);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
}

describe('POST /api/admin/users/:id/cbat-results', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await upload(null, user._id, { dataUrl: PNG });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const caller = await createUser();
    const target = await createUser();
    const res    = await upload(authCookie(caller._id), target._id, { dataUrl: PNG });
    expect(res.status).toBe(403);
  });

  it('uploads the image and appends it to the user', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await upload(authCookie(admin._id), target._id, { dataUrl: PNG, caption: 'sheet.png' });

    expect(res.status).toBe(200);
    expect(uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), { folder: 'cbat-results' });
    expect(res.body.data.image.url).toMatch(/cloudinary/);
    expect(res.body.data.image.caption).toBe('sheet.png');
    expect(res.body.data.images).toHaveLength(1);

    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatResultImages).toHaveLength(1);
    expect(dbUser.cbatResultImages[0].publicId).toBe('cbat-results/sheet');
    expect(dbUser.cbatResultImages[0].uploadedAt).toBeInstanceOf(Date);
  });

  it('appends rather than replacing on a second upload', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();
    const cookie = authCookie(admin._id);

    await upload(cookie, target._id, { dataUrl: PNG });
    const res = await upload(cookie, target._id, { dataUrl: PNG });

    expect(res.body.data.images).toHaveLength(2);
  });

  it('rejects a payload that is not an image data URL', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await upload(authCookie(admin._id), target._id, { dataUrl: 'https://example.com/x.png' });

    expect(res.status).toBe(400);
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('rejects an empty image payload', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await upload(authCookie(admin._id), target._id, { dataUrl: 'data:image/png;base64,' });

    expect(res.status).toBe(400);
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res   = await upload(authCookie(admin._id), '507f1f77bcf86cd799439011', { dataUrl: PNG });
    expect(res.status).toBe(404);
  });

  it('defaults a new account to no result images', async () => {
    const target = await createUser();
    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatResultImages).toHaveLength(0);
  });
});

describe('DELETE /api/admin/users/:id/cbat-results/:imageId', () => {
  beforeEach(async () => { await createRank(); });

  async function seedImage(adminCookie, targetId) {
    const res = await upload(adminCookie, targetId, { dataUrl: PNG });
    return res.body.data.image._id;
  }

  it('returns 403 for a non-admin user', async () => {
    const admin  = await createAdminUser();
    const caller = await createUser();
    const target = await createUser();
    const imageId = await seedImage(authCookie(admin._id), target._id);

    const res = await request(app)
      .delete(`/api/admin/users/${target._id}/cbat-results/${imageId}`)
      .set('Cookie', authCookie(caller._id));

    expect(res.status).toBe(403);
  });

  it('removes the entry and destroys the Cloudinary asset', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser();
    const cookie  = authCookie(admin._id);
    const imageId = await seedImage(cookie, target._id);

    const res = await request(app)
      .delete(`/api/admin/users/${target._id}/cbat-results/${imageId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.images).toHaveLength(0);
    expect(destroyAsset).toHaveBeenCalledWith('cbat-results/sheet');

    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatResultImages).toHaveLength(0);
  });

  // An asset that is already gone must not strand the entry in the user's list.
  it('still removes the entry when Cloudinary rejects the delete', async () => {
    const admin   = await createAdminUser();
    const target  = await createUser();
    const cookie  = authCookie(admin._id);
    const imageId = await seedImage(cookie, target._id);

    destroyAsset.mockRejectedValueOnce(new Error('not found'));

    const res = await request(app)
      .delete(`/api/admin/users/${target._id}/cbat-results/${imageId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const dbUser = await User.findById(target._id);
    expect(dbUser.cbatResultImages).toHaveLength(0);
  });

  it('returns 404 for an image the user does not have', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await request(app)
      .delete(`/api/admin/users/${target._id}/cbat-results/507f1f77bcf86cd799439011`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .delete('/api/admin/users/507f1f77bcf86cd799439011/cbat-results/507f1f77bcf86cd799439012')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
  });
});
