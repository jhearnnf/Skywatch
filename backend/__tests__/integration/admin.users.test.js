/**
 * Admin — Users list tests
 *
 * Covers GET /api/admin/users and GET /api/admin/users/search:
 *   auth guards
 *   profileStats.brifsRead — counts only completed: true reads, isolated per user
 */
process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createSettings, authCookie,
} = require('../helpers/factories');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
const mongoose = require('mongoose');

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── auth guards ───────────────────────────────────────────────────────────────

describe('GET /api/admin/users — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── profileStats.brifsRead ────────────────────────────────────────────────────

describe('GET /api/admin/users — profileStats.brifsRead', () => {
  it('returns 0 when the user has no brief reads', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const u = res.body.data.users.find(x => x._id.toString() === user._id.toString());
    expect(u.profileStats.brifsRead).toBe(0);
  });

  it('counts only completed: true reads, not opened-only records', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await IntelligenceBriefRead.create([
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false }, // opened only
    ]);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const u = res.body.data.users.find(x => x._id.toString() === user._id.toString());
    expect(u.profileStats.brifsRead).toBe(2);
  });

  it('isolates brief read counts per user', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();

    await IntelligenceBriefRead.create([
      { userId: userA._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
      { userId: userA._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
      { userId: userB._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
    ]);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const aRow = res.body.data.users.find(x => x._id.toString() === userA._id.toString());
    const bRow = res.body.data.users.find(x => x._id.toString() === userB._id.toString());

    expect(aRow.profileStats.brifsRead).toBe(2);
    expect(bRow.profileStats.brifsRead).toBe(1);
  });
});

// ── search endpoint ───────────────────────────────────────────────────────────

describe('GET /api/admin/users/search — profileStats.brifsRead', () => {
  it('includes correct brifsRead in search results', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ email: 'search-target@test.com' });

    await IntelligenceBriefRead.create([
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/users/search?q=search-target')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.users[0].profileStats.brifsRead).toBe(1);
  });
});

// ── unban endpoint ────────────────────────────────────────────────────────────

describe('POST /api/admin/users/:id/unban', () => {
  it('returns 401 for unauthenticated request', async () => {
    const user = await createUser({ isBanned: true });
    const res  = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .send({ reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const actor = await createUser();
    const user  = await createUser({ isBanned: true });
    const res   = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .set('Cookie', authCookie(actor._id))
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('sets isBanned to false on the target user', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isBanned: true });

    const res = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'appealed successfully' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await (require('../../models/User')).findById(user._id);
    expect(updated.isBanned).toBe(false);
  });

  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isBanned: true });

    const res = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent user id', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/users/${new mongoose.Types.ObjectId()}/unban`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test' });
    expect(res.status).toBe(404);
  });
});
