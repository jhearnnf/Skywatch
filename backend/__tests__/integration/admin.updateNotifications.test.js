/**
 * admin.updateNotifications.test.js
 *
 * Admin CRUD + reset variants + AI summarize for /api/admin/update-notifications/*.
 * Mirrors the auth/audit pattern used in admin.tutorials.test.js and the
 * fetch-mock pattern used in admin.ai.test.js for the AI summarize endpoint.
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

// Cloudinary upload is mocked at the utility layer — the upload-image route
// only cares that uploadBuffer returns a {secure_url, public_id}.
jest.mock('../../utils/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/update-notifications/abc.png',
    public_id:  'update-notifications/abc',
  }),
  destroyAsset: jest.fn().mockResolvedValue({ result: 'ok' }),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createRank,
  createSettings,
  createUser,
  createAdminUser,
  authCookie,
} = require('../helpers/factories');

const UpdateNotification = require('../../models/UpdateNotification');
const AdminAction        = require('../../models/AdminAction');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createRank();
  await createSettings();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
afterAll(() => {});

function mockOpenRouter(content) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    text: () => Promise.resolve(''),
  });
}
function mockGithubCommits(commits) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(commits),
    text: () => Promise.resolve(''),
  });
}

describe('Admin Update Notifications — auth', () => {
  it('rejects non-admins with 403 on list', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/update-notifications')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('rejects non-admins with 403 on create', async () => {
    const user = await createUser();
    const res  = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(user._id))
      .send({ title: 'x', body: 'y', reason: 'r' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/update-notifications', () => {
  it('rejects without a reason', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Hello', body: 'World' });
    expect(res.status).toBe(400);
  });

  it('requires title and body', async () => {
    const admin = await createAdminUser();
    const r1 = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ body: 'World', reason: 'r' });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Hello', reason: 'r' });
    expect(r2.status).toBe(400);
  });

  it('creates a notification and writes an AdminAction', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({
        title: 'New release',
        body: 'Check out the latest update!',
        imageMode: 'placeholder',
        targetPath: '/home',
        enabled: true,
        reason: 'announce v2',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.notification.title).toBe('New release');
    expect(res.body.data.notification.imageMode).toBe('placeholder');
    expect(res.body.data.notification.targetPath).toBe('/home');
    expect(String(res.body.data.notification.createdBy)).toBe(String(admin._id));
    expect(res.body.data.notification.responsesEnabled).toBe(false);

    const action = await AdminAction.findOne({ actionType: 'create_update_notification' });
    expect(action).toBeTruthy();
    expect(action.reason).toBe('announce v2');
  });

  it('persists responsesEnabled when toggled on', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', responsesEnabled: true, reason: 'r' });
    expect(res.status).toBe(201);
    expect(res.body.data.notification.responsesEnabled).toBe(true);

    const fresh = await UpdateNotification.findById(res.body.data.notification._id);
    expect(fresh.responsesEnabled).toBe(true);
  });

  it('persists applyToExistingOnly when toggled on', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', applyToExistingOnly: true, reason: 'r' });
    expect(res.status).toBe(201);
    expect(res.body.data.notification.applyToExistingOnly).toBe(true);

    const fresh = await UpdateNotification.findById(res.body.data.notification._id);
    expect(fresh.applyToExistingOnly).toBe(true);
  });

  it('clears imageUrl when imageMode is not custom', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({
        title: 't', body: 'b',
        imageMode: 'placeholder',
        imageUrl: 'https://evil.example.com/should-be-ignored.png',
        reason: 'r',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.notification.imageUrl).toBe('');
  });

  it('rejects custom imageMode with no imageUrl', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', imageMode: 'custom', imageUrl: '', reason: 'r' });
    expect(res.status).toBe(400);
  });

  it('accepts upload imageMode when imageUrl is supplied', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({
        title: 't', body: 'b',
        imageMode: 'upload',
        imageUrl: 'https://res.cloudinary.com/test/update-notifications/abc.png',
        reason: 'r',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.notification.imageMode).toBe('upload');
    expect(res.body.data.notification.imageUrl).toMatch(/cloudinary/);
  });

  it('rejects upload imageMode with no imageUrl', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', imageMode: 'upload', imageUrl: '', reason: 'r' });
    expect(res.status).toBe(400);
  });

  it('rejects expiresAt <= validFrom', async () => {
    const admin = await createAdminUser();
    const t1 = new Date('2027-01-01T00:00:00Z').toISOString();
    const t0 = new Date('2026-12-01T00:00:00Z').toISOString();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', validFrom: t1, expiresAt: t0, reason: 'r' });
    expect(res.status).toBe(400);
  });

  it('coerces empty date strings to null', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', validFrom: '', expiresAt: '', reason: 'r' });
    expect(res.status).toBe(201);
    expect(res.body.data.notification.validFrom).toBeNull();
    expect(res.body.data.notification.expiresAt).toBeNull();
  });
});

describe('PUT /api/admin/update-notifications/:id', () => {
  it('updates fields and writes an AdminAction', async () => {
    const admin = await createAdminUser();
    const doc = await UpdateNotification.create({ title: 'old', body: 'old body' });

    const res = await request(app)
      .put(`/api/admin/update-notifications/${doc._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'new', body: 'new body', enabled: false, reason: 'fix typo' });
    expect(res.status).toBe(200);
    expect(res.body.data.notification.title).toBe('new');
    expect(res.body.data.notification.enabled).toBe(false);

    const action = await AdminAction.findOne({ actionType: 'edit_update_notification' });
    expect(action).toBeTruthy();
    expect(action.reason).toBe('fix typo');
  });

  it('returns 404 for unknown id', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .put('/api/admin/update-notifications/64b000000000000000000000')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 't', body: 'b', reason: 'r' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/update-notifications/:id', () => {
  it('deletes and writes an AdminAction', async () => {
    const admin = await createAdminUser();
    const doc = await UpdateNotification.create({ title: 't', body: 'b' });

    const res = await request(app)
      .delete(`/api/admin/update-notifications/${doc._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'no longer needed' });
    expect(res.status).toBe(200);
    expect(await UpdateNotification.findById(doc._id)).toBeNull();

    const action = await AdminAction.findOne({ actionType: 'delete_update_notification' });
    expect(action).toBeTruthy();
  });

  it('rejects without reason', async () => {
    const admin = await createAdminUser();
    const doc = await UpdateNotification.create({ title: 't', body: 'b' });
    const res = await request(app)
      .delete(`/api/admin/update-notifications/${doc._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('reset variants', () => {
  it('POST /:id/reset clears viewedBy for everyone', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();
    const doc = await UpdateNotification.create({
      title: 't', body: 'b',
      viewedBy: [
        { userId: userA._id, viewedAt: new Date() },
        { userId: userB._id, viewedAt: new Date() },
      ],
    });

    const res = await request(app)
      .post(`/api/admin/update-notifications/${doc._id}/reset`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'bring it back' });
    expect(res.status).toBe(200);

    const fresh = await UpdateNotification.findById(doc._id);
    expect(fresh.viewedBy).toHaveLength(0);

    const action = await AdminAction.findOne({ actionType: 'reset_update_notification' });
    expect(action).toBeTruthy();
  });

  it('POST /:id/reset-user removes only that user', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();
    const doc = await UpdateNotification.create({
      title: 't', body: 'b',
      viewedBy: [
        { userId: userA._id, viewedAt: new Date() },
        { userId: userB._id, viewedAt: new Date() },
      ],
    });

    const res = await request(app)
      .post(`/api/admin/update-notifications/${doc._id}/reset-user`)
      .set('Cookie', authCookie(admin._id))
      .send({ userId: String(userA._id), reason: 'they asked' });
    expect(res.status).toBe(200);

    const fresh = await UpdateNotification.findById(doc._id);
    expect(fresh.viewedBy).toHaveLength(1);
    expect(String(fresh.viewedBy[0].userId)).toBe(String(userB._id));

    const action = await AdminAction.findOne({ actionType: 'reset_update_notification_for_user' });
    expect(action).toBeTruthy();
    expect(String(action.targetUserId)).toBe(String(userA._id));
  });

  it('reset-user rejects bad ObjectId', async () => {
    const admin = await createAdminUser();
    const doc = await UpdateNotification.create({ title: 't', body: 'b' });
    const res = await request(app)
      .post(`/api/admin/update-notifications/${doc._id}/reset-user`)
      .set('Cookie', authCookie(admin._id))
      .send({ userId: 'not-an-id', reason: 'r' });
    expect(res.status).toBe(400);
  });
});

describe('GET /:id/viewers', () => {
  it('returns viewers with their email/agentNumber', async () => {
    const admin = await createAdminUser();
    const userA = await createUser({ email: 'a@example.com' });
    const doc = await UpdateNotification.create({
      title: 't', body: 'b',
      viewedBy: [{ userId: userA._id, viewedAt: new Date() }],
    });

    const res = await request(app)
      .get(`/api/admin/update-notifications/${doc._id}/viewers`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.viewers).toHaveLength(1);
    expect(res.body.data.viewers[0].user.email).toBe('a@example.com');
  });

  it('includes each viewer\'s response text', async () => {
    const admin = await createAdminUser();
    const userA = await createUser({ email: 'a@example.com' });
    const userB = await createUser({ email: 'b@example.com' });
    const doc = await UpdateNotification.create({
      title: 't', body: 'b',
      responsesEnabled: true,
      viewedBy: [
        { userId: userA._id, viewedAt: new Date(), response: 'great update!' },
        { userId: userB._id, viewedAt: new Date(), response: '' },
      ],
    });

    const res = await request(app)
      .get(`/api/admin/update-notifications/${doc._id}/viewers`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.data.viewers.map(v => [v.user.email, v.response]));
    expect(byEmail['a@example.com']).toBe('great update!');
    expect(byEmail['b@example.com']).toBe('');
  });
});

describe('GET /api/admin/update-notifications (list)', () => {
  it('returns notifications newest first with viewersCount', async () => {
    const admin = await createAdminUser();
    const user = await createUser();
    await UpdateNotification.create({ title: 'a', body: 'b' });
    await UpdateNotification.create({
      title: 'b', body: 'b',
      viewedBy: [{ userId: user._id, viewedAt: new Date() }],
    });

    const res = await request(app)
      .get('/api/admin/update-notifications')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    const titles = res.body.data.notifications.map(n => n.title);
    expect(titles).toEqual(['b', 'a']);
    const b = res.body.data.notifications.find(n => n.title === 'b');
    expect(b.viewersCount).toBe(1);
    expect(b.viewedBy).toBeUndefined();
  });
});

describe('POST /api/admin/update-notifications/upload-image', () => {
  it('rejects non-admins with 403', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/admin/update-notifications/upload-image')
      .set('Cookie', authCookie(user._id))
      .send({ dataUrl: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(403);
  });

  it('rejects non-image data URLs', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications/upload-image')
      .set('Cookie', authCookie(admin._id))
      .send({ dataUrl: 'data:text/plain;base64,aGVsbG8=' });
    expect(res.status).toBe(400);
  });

  it('rejects empty payloads', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/update-notifications/upload-image')
      .set('Cookie', authCookie(admin._id))
      .send({ dataUrl: 'data:image/png;base64,' });
    expect(res.status).toBe(400);
  });

  it('uploads a valid image and returns the Cloudinary URL', async () => {
    const admin = await createAdminUser();
    // 1×1 transparent PNG
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const res = await request(app)
      .post('/api/admin/update-notifications/upload-image')
      .set('Cookie', authCookie(admin._id))
      .send({ dataUrl: `data:image/png;base64,${tinyPng}` });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/cloudinary/);
    expect(res.body.data.publicId).toBeTruthy();
  });
});

describe('POST /api/admin/update-notifications/ai-summarize', () => {
  it('returns 403 for non-admins', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/admin/update-notifications/ai-summarize')
      .set('Cookie', authCookie(user._id))
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns a summary when commits exist', async () => {
    const admin = await createAdminUser();

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('api.github.com')) {
        return mockGithubCommits([
          { sha: 'aaa1111', commit: { message: 'Add dark mode toggle\n\nlong body', author: { date: '2026-05-20T00:00:00Z', name: 'Alice' } } },
          { sha: 'bbb2222', commit: { message: 'Merge pull request #1', author: { date: '2026-05-19T00:00:00Z', name: 'Bob' } } },
          { sha: 'ccc3333', commit: { message: 'Fix login redirect bug', author: { date: '2026-05-18T00:00:00Z', name: 'Carol' } } },
          { sha: 'ddd4444', commit: { message: 'chore: bump deps', author: { date: '2026-05-17T00:00:00Z', name: 'Dan' } } },
        ]);
      }
      if (s.includes('openrouter.ai')) {
        return mockOpenRouter('We added a dark mode toggle and fixed a login redirect bug.');
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    });

    const res = await request(app)
      .post('/api/admin/update-notifications/ai-summarize')
      .set('Cookie', authCookie(admin._id))
      .send({ sinceDays: 30 });
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBe('We added a dark mode toggle and fixed a login redirect bug.');
    // 4 commits in -> 2 should be filtered (merge + chore) -> 2 remain.
    expect(res.body.data.commitsUsed).toBe(2);

    // Verify the OpenRouter call body only contained the 2 non-noise messages.
    const openRouterCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('openrouter.ai'));
    expect(openRouterCall).toBeTruthy();
    const sentBody = JSON.parse(openRouterCall[1].body);
    expect(sentBody.model).toBe('anthropic/claude-haiku-4-5');
    const userMsg = sentBody.messages.find(m => m.role === 'user').content;
    expect(userMsg).toContain('Add dark mode toggle');
    expect(userMsg).toContain('Fix login redirect bug');
    expect(userMsg).not.toContain('Merge pull request');
    expect(userMsg).not.toContain('chore: bump deps');
  });

  it('returns empty summary when no usable commits', async () => {
    const admin = await createAdminUser();
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('api.github.com')) return mockGithubCommits([]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    });

    const res = await request(app)
      .post('/api/admin/update-notifications/ai-summarize')
      .set('Cookie', authCookie(admin._id))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBe('');
    expect(res.body.data.commitsUsed).toBe(0);
  });
});
