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
const { CBAT_GAMES }        = require('../../constants/cbatGames');
const mongoose = require('mongoose');

// Minimal payload satisfying the union of required fields across every CBAT
// schema. If a new CBAT game adds a required field not listed here, tests that
// seed these docs will fail loudly — signalling the helper needs updating.
function seedCbatDoc(cfg, userId) {
  return cfg.Model.create({
    userId,
    [cfg.primaryField]: 1,
    totalTime: 1,
    roundsPlayed: 1,
  });
}

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

// ── profileStats.cbatPlayed ──────────────────────────────────────────────────

describe('GET /api/admin/users — profileStats.cbatPlayed', () => {
  it('returns 0 when the user has no CBAT submissions', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const u = res.body.data.users.find(x => x._id.toString() === user._id.toString());
    expect(u.profileStats.cbatPlayed).toBe(0);
  });

  // This is the key guard: iterating CBAT_GAMES means any new game added to
  // the shared registry is automatically covered by the admin stat — no edits
  // to admin.js or this test required for the count to stay correct.
  it('sums submissions across every game in the CBAT_GAMES registry', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await Promise.all(Object.values(CBAT_GAMES).map(cfg => seedCbatDoc(cfg, user._id)));

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const u = res.body.data.users.find(x => x._id.toString() === user._id.toString());
    expect(u.profileStats.cbatPlayed).toBe(Object.keys(CBAT_GAMES).length);
  });

  it('isolates CBAT counts per user', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();

    const firstGame = Object.values(CBAT_GAMES)[0];
    await seedCbatDoc(firstGame, userA._id);
    await seedCbatDoc(firstGame, userA._id);
    await seedCbatDoc(firstGame, userB._id);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const aRow = res.body.data.users.find(x => x._id.toString() === userA._id.toString());
    const bRow = res.body.data.users.find(x => x._id.toString() === userB._id.toString());

    expect(aRow.profileStats.cbatPlayed).toBe(2);
    expect(bRow.profileStats.cbatPlayed).toBe(1);
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

// ── subscription tier endpoint ─────────────────────────────────────────────

describe('PATCH /api/admin/users/:id/subscription — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .send({ tier: 'gold', reason: 'upgrade' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const actor = await createUser();
    const user  = await createUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(actor._id))
      .send({ tier: 'gold', reason: 'upgrade' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/users/:id/subscription — validation', () => {
  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid tier', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'platinum', reason: 'test' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent user id', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${new mongoose.Types.ObjectId()}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold', reason: 'test' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/users/:id/subscription — tier change', () => {
  const User = require('../../models/User');
  const AdminAction = require('../../models/AdminAction');

  it('updates subscriptionTier on the target user (free → gold)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });

    const res = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold', reason: 'manual upgrade' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('gold');
  });

  it('updates subscriptionTier (gold → free)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'gold' });

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'free', reason: 'downgrade' });

    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('free');
  });

  it('sets trialStartDate and trialDurationDays when tier is trial', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });

    const before = new Date();

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'trial', reason: 'free trial grant' });

    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('trial');
    expect(updated.trialStartDate).toBeDefined();
    expect(new Date(updated.trialStartDate).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.trialDurationDays).toBeGreaterThan(0);
  });

  it('resets ammunitionRemaining on all read records for the target user', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });
    const other = await createUser();

    // Create read records for both users
    await IntelligenceBriefRead.create([
      { userId: user._id,  intelBriefId: new mongoose.Types.ObjectId(), completed: true,  ammunitionRemaining: 0 },
      { userId: user._id,  intelBriefId: new mongoose.Types.ObjectId(), completed: false, ammunitionRemaining: 0 },
      { userId: other._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true,  ammunitionRemaining: 0 },
    ]);

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold', reason: 'upgrade to gold' });

    const userRecords  = await IntelligenceBriefRead.find({ userId: user._id });
    const otherRecords = await IntelligenceBriefRead.find({ userId: other._id });

    // Gold ammo = 9999
    expect(userRecords.every(r => r.ammunitionRemaining === 9999)).toBe(true);
    // Other user's records must not be touched
    expect(otherRecords[0].ammunitionRemaining).toBe(0);
  });

  it('logs an AdminAction with change_subscription type', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'silver', reason: 'gift subscription' });

    const action = await AdminAction.findOne({ actionType: 'change_subscription' });
    expect(action).not.toBeNull();
    expect(action.userId.toString()).toBe(admin._id.toString());
    expect(action.targetUserId.toString()).toBe(user._id.toString());
    expect(action.reason).toBe('gift subscription');
  });
});
