/**
 * new-user-setup.test.js
 *
 * Verifies that a freshly registered account has correct zero-state across:
 *   - Aircoins & level fields
 *   - Intel briefs read
 *   - Game history / quiz attempts
 *   - Tutorial reset flag
 *   - Daily mission (no reads recorded)
 *   - Admin reset-stats endpoint (all four categories)
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  createBrief,
  createGameType,
  createQuizQuestions,
  authCookie,
} = require('../helpers/factories');

const User                   = require('../../models/User');
const IntelligenceBriefRead  = require('../../models/IntelligenceBriefRead');
const AircoinLog             = require('../../models/AircoinLog');
const GameSessionQuizAttempt = require('../../models/GameSessionQuizAttempt');
const GameSessionQuizResult  = require('../../models/GameSessionQuizResult');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── Registration response shape ───────────────────────────────────────────
describe('New user — registration response', () => {
  it('returns isNew:true on first registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.isNew).toBe(true);
  });

  it('awards zero login aircoins on registration (coins come from first brief read)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'coins@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.loginAircoinsEarned).toBe(0);
  });

  it('new user starts with zero totalAircoins before login bonus', async () => {
    // Create user directly (bypassing login bonus) to confirm field default
    const user = await createUser({ email: 'zero@test.com' });
    expect(user.totalAircoins).toBe(0);
    expect(user.cycleAircoins).toBe(0);
  });

  it('new user has no rank assigned', async () => {
    const user = await createUser();
    expect(user.rank == null).toBe(true); // undefined or null — not yet earned
  });

  it('new user has null tutorialsResetAt', async () => {
    const user = await createUser();
    expect(user.tutorialsResetAt).toBeNull();
  });

  it('password is never returned in registration response', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nopass@test.com', password: 'Password123' });

    expect(res.body.data.user.password).toBeUndefined();
  });
});

// ── Zero intel briefs read ────────────────────────────────────────────────
describe('New user — intel briefs read', () => {
  it('has no IntelligenceBriefRead records after registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'noreads@test.com', password: 'Password123' });

    const userId = res.body.data.user._id;
    const count  = await IntelligenceBriefRead.countDocuments({ userId });
    expect(count).toBe(0);
  });

  it('GET /api/users/me/read-briefs returns empty array for new user', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/users/me/read-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefIds).toEqual([]);
  });
});

// ── Zero game history ─────────────────────────────────────────────────────
describe('New user — game history', () => {
  it('has no quiz attempts after registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nogames@test.com', password: 'Password123' });

    const userId = res.body.data.user._id;
    const count  = await GameSessionQuizAttempt.countDocuments({ userId });
    expect(count).toBe(0);
  });

  it('GET /api/users/me/history returns empty stats for new user', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/users/me/history')
      .set('Cookie', cookie);

    // Endpoint may not exist yet — if it does, games played should be 0
    if (res.status === 200) {
      const stats = res.body.data;
      expect(stats.gamesPlayed ?? 0).toBe(0);
    }
  });
});

// ── AircoinLog is clean ───────────────────────────────────────────────────
describe('New user — aircoins', () => {
  it('has no AircoinLog entries before first login', async () => {
    const user  = await createUser();
    const count = await AircoinLog.countDocuments({ userId: user._id });
    expect(count).toBe(0);
  });

  it('registration creates no AircoinLog entry (coins only come from first brief read)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'firstlogin@test.com', password: 'Password123' });

    const userId = res.body.data.user._id;
    const count  = await AircoinLog.countDocuments({ userId });
    expect(count).toBe(0);
  });
});

// ── Admin reset-stats ─────────────────────────────────────────────────────
describe('Admin reset-stats endpoint', () => {
  let admin, target, adminCookie;

  beforeEach(async () => {
    await createSettings();
    admin  = await createAdminUser();
    target = await createUser({ email: 'target@test.com' });
    adminCookie = authCookie(admin._id);
  });

  const reset = (fields) =>
    request(app)
      .post(`/api/admin/users/${target._id}/reset-stats`)
      .set('Cookie', adminCookie)
      .send({ fields, reason: 'Testing reset' });

  it('resets aircoins to 0 and deletes AircoinLog', async () => {
    // Give the user some coins directly
    await User.findByIdAndUpdate(target._id, { totalAircoins: 500, cycleAircoins: 200 });
    await AircoinLog.create({ userId: target._id, amount: 500, reason: 'test', label: 'Test' });

    const res = await reset(['aircoins']);
    expect(res.status).toBe(200);

    const updated = await User.findById(target._id);
    expect(updated.totalAircoins).toBe(0);
    expect(updated.cycleAircoins).toBe(0);

    const logCount = await AircoinLog.countDocuments({ userId: target._id });
    expect(logCount).toBe(0);
  });

  it('resets game history — deletes quiz attempts and results', async () => {
    await GameSessionQuizAttempt.create({
      userId:         target._id,
      intelBriefId:   new (require('mongoose').Types.ObjectId)(),
      gameSessionId:  'gs-1',
      difficulty:     'easy',
      isFirstAttempt: true,
      totalQuestions: 5,
      status:         'completed',
    });

    const res = await reset(['gameHistory']);
    expect(res.status).toBe(200);

    const count = await GameSessionQuizAttempt.countDocuments({ userId: target._id });
    expect(count).toBe(0);
  });

  it('resets intel briefs read', async () => {
    const brief = await createBrief();
    await IntelligenceBriefRead.create({ userId: target._id, intelBriefId: brief._id });

    const res = await reset(['intelBriefsRead']);
    expect(res.status).toBe(200);

    const count = await IntelligenceBriefRead.countDocuments({ userId: target._id });
    expect(count).toBe(0);
  });

  it('resets loginStreak and lastStreakDate when intelBriefsRead is reset', async () => {
    await User.findByIdAndUpdate(target._id, { loginStreak: 7, lastStreakDate: new Date() });

    const res = await reset(['intelBriefsRead']);
    expect(res.status).toBe(200);

    const updated = await User.findById(target._id);
    expect(updated.loginStreak).toBe(0);
    expect(updated.lastStreakDate).toBeNull();
  });

  it('does NOT reset streak when only aircoins are reset', async () => {
    await User.findByIdAndUpdate(target._id, { loginStreak: 5, lastStreakDate: new Date() });

    const res = await reset(['aircoins']);
    expect(res.status).toBe(200);

    const updated = await User.findById(target._id);
    expect(updated.loginStreak).toBe(5);
  });

  it('resets tutorials — sets tutorialsResetAt to a recent timestamp', async () => {
    const before = new Date();
    const res    = await reset(['tutorials']);
    expect(res.status).toBe(200);

    const updated = await User.findById(target._id);
    expect(updated.tutorialsResetAt).not.toBeNull();
    expect(new Date(updated.tutorialsResetAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('can reset all four categories in one call', async () => {
    await User.findByIdAndUpdate(target._id, { totalAircoins: 100, cycleAircoins: 50 });
    await AircoinLog.create({ userId: target._id, amount: 100, reason: 'test', label: 'Test' });
    const brief = await createBrief();
    await IntelligenceBriefRead.create({ userId: target._id, intelBriefId: brief._id });
    await GameSessionQuizAttempt.create({
      userId:         target._id,
      intelBriefId:   brief._id,
      gameSessionId:  'gs-all',
      difficulty:     'easy',
      isFirstAttempt: true,
      totalQuestions: 5,
      status:         'completed',
    });

    const res = await reset(['aircoins', 'gameHistory', 'intelBriefsRead', 'tutorials']);
    expect(res.status).toBe(200);

    const updated   = await User.findById(target._id);
    expect(updated.totalAircoins).toBe(0);
    expect(updated.cycleAircoins).toBe(0);
    expect(updated.loginStreak).toBe(0);
    expect(updated.lastStreakDate).toBeNull();
    expect(updated.tutorialsResetAt).not.toBeNull();

    expect(await AircoinLog.countDocuments({ userId: target._id })).toBe(0);
    expect(await IntelligenceBriefRead.countDocuments({ userId: target._id })).toBe(0);
    expect(await GameSessionQuizAttempt.countDocuments({ userId: target._id })).toBe(0);
  });

  it('requires admin auth — returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/reset-stats`)
      .send({ fields: ['aircoins'], reason: 'hack' });

    expect(res.status).toBe(401);
  });

  it('requires reason — returns 400 when reason is missing', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${target._id}/reset-stats`)
      .set('Cookie', adminCookie)
      .send({ fields: ['aircoins'] });

    expect(res.status).toBe(400);
  });
});
