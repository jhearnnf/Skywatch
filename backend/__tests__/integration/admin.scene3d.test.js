/**
 * admin.scene3d.test.js
 *
 * Tests for the admin-only AI 3D scene preview endpoints:
 *   POST   /api/admin/briefs/:id/scene3d   — generate + persist
 *   DELETE /api/admin/briefs/:id/scene3d   — clear + destroy Cloudinary asset
 *
 * OpenRouter is mocked at the global fetch level; Cloudinary upload/destroy
 * are mocked at the module level. No real network calls.
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

jest.mock('../../utils/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/image/upload/brief-scene3d/test.png',
    public_id:  'brief-scene3d/test',
  }),
  destroyAsset: jest.fn().mockResolvedValue({ result: 'ok' }),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createAdminUser, createSettings, authCookie, createBrief } = require('../helpers/factories');
const { uploadBuffer, destroyAsset } = require('../../utils/cloudinary');
const IntelligenceBrief = require('../../models/IntelligenceBrief');

// 1x1 transparent PNG, base64 encoded — small payload sufficient to prove the
// decode → Buffer → uploadBuffer pipeline works end-to-end.
const ONE_PX_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const ONE_PX_PNG_DATA_URL = `data:image/png;base64,${ONE_PX_PNG_B64}`;

function mockFetchResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(Buffer.from('binary-image-bytes').buffer),
  });
}

function mockOpenRouterImage(dataUrl = ONE_PX_PNG_DATA_URL) {
  return mockFetchResponse({
    choices: [{
      message: {
        content: '',
        images:  [{ type: 'image_url', image_url: { url: dataUrl } }],
      },
    }],
    usage: {},
    model: 'google/gemini-2.5-flash-image',
  });
}

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  uploadBuffer.mockClear();
  destroyAsset.mockClear();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
afterAll(() => {});

describe('POST /api/admin/briefs/:id/scene3d', () => {
  it('generates a 3D scene, uploads to Cloudinary, and saves URL on the brief', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('openrouter.ai')) return mockOpenRouterImage();
      return mockFetchResponse({});
    });

    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Eurofighter Typhoon', subtitle: 'RAF multirole fighter' });

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.scene3dImage.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(res.body.data.scene3dImage.cloudinaryPublicId).toBe('brief-scene3d/test');
    expect(res.body.data.scene3dImage.generatedAt).toBeTruthy();

    expect(uploadBuffer).toHaveBeenCalledTimes(1);
    const [bufferArg, optsArg] = uploadBuffer.mock.calls[0];
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(bufferArg.length).toBeGreaterThan(0);
    expect(optsArg).toMatchObject({ folder: 'brief-scene3d' });

    const reloaded = await IntelligenceBrief.findById(brief._id).lean();
    expect(reloaded.scene3dImage.url).toBe(res.body.data.scene3dImage.url);
  });

  it('regenerating destroys the previous Cloudinary asset before saving the new one', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('openrouter.ai')) return mockOpenRouterImage();
      return mockFetchResponse({});
    });

    const admin = await createAdminUser();
    const brief = await createBrief({
      title: 'Eurofighter Typhoon',
      scene3dImage: {
        url:                'https://res.cloudinary.com/test/image/upload/brief-scene3d/old.png',
        cloudinaryPublicId: 'brief-scene3d/old',
        generatedAt:        new Date('2026-01-01T00:00:00Z'),
      },
    });

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(destroyAsset).toHaveBeenCalledWith('brief-scene3d/old');
  });

  it('returns 502 when the image model returns no image', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('openrouter.ai')) {
        return mockFetchResponse({ choices: [{ message: { content: 'no image here' } }], usage: {} });
      }
      return mockFetchResponse({});
    });

    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .post(`/api/admin/briefs/${brief._id}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/no image/i);
    expect(uploadBuffer).not.toHaveBeenCalled();

    const reloaded = await IntelligenceBrief.findById(brief._id).lean();
    expect(reloaded.scene3dImage?.url ?? null).toBeNull();
  });

  it('returns 404 when the brief does not exist', async () => {
    const admin   = await createAdminUser();
    const missing = '507f1f77bcf86cd799439011';
    const res = await request(app)
      .post(`/api/admin/briefs/${missing}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/briefs/:id/scene3d', () => {
  it('clears the field and destroys the Cloudinary asset', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({
      scene3dImage: {
        url:                'https://res.cloudinary.com/test/image/upload/brief-scene3d/old.png',
        cloudinaryPublicId: 'brief-scene3d/old',
        generatedAt:        new Date('2026-01-01T00:00:00Z'),
      },
    });

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.scene3dImage.url).toBeNull();
    expect(destroyAsset).toHaveBeenCalledWith('brief-scene3d/old');

    const reloaded = await IntelligenceBrief.findById(brief._id).lean();
    expect(reloaded.scene3dImage?.url ?? null).toBeNull();
  });

  it('is a no-op (still 200) when no scene image exists', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .delete(`/api/admin/briefs/${brief._id}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it('returns 404 when the brief does not exist', async () => {
    const admin   = await createAdminUser();
    const missing = '507f1f77bcf86cd799439011';
    const res = await request(app)
      .delete(`/api/admin/briefs/${missing}/scene3d`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
  });
});
