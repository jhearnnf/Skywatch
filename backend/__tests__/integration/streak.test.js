/**
 * Streak & daily-brief-reward tests.
 *
 * Rules under test:
 *  - Login never awards airstars.
 *  - Coins are awarded via POST /api/briefs/:id/complete, NOT on GET (open).
 *  - The first completion of each calendar day awards daily coins
 *    (base + streak bonus if streak >= 2) and increments loginStreak.
 *  - Subsequent completions on the same day give no daily coins.
 *  - Re-completing an already-completed brief still counts for the daily reward.
 *  - A gap of more than one day resets the streak to 1.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const User    = require('../../models/User');
const { createUser, createBrief, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); }); // airstarsFirstLogin=5, airstarsStreakBonus=2
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── Helpers ────────────────────────────────────────────────────────────────

async function openBrief(briefId, cookie) {
  return request(app).get(`/api/briefs/${briefId}`).set('Cookie', cookie);
}

async function completeBrief(briefId, cookie) {
  return request(app)
    .post(`/api/briefs/${briefId}/complete`)
    .set('Cookie', cookie);
}

/** Set lastStreakDate on a user to simulate a previous read n days ago. */
async function setLastStreakDate(userId, daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  await User.findByIdAndUpdate(userId, { lastStreakDate: d });
}

// ── Login awards no coins ──────────────────────────────────────────────────

describe('POST /api/auth/login — no airstars on login', () => {
  it('returns loginAirstarsEarned = 0 on email login', async () => {
    await createUser({ email: 'streak@test.com', password: 'Password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'streak@test.com', password: 'Password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.loginAirstarsEarned).toBe(0);
  });

  it('returns loginAirstarsEarned = 0 on register', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'newstreak@test.com', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.loginAirstarsEarned).toBe(0);
  });
});

// ── GET /api/briefs/:id awards NO coins ────────────────────────────────────

describe('GET /api/briefs/:id — no coins on open', () => {
  it('does not award brief-read coins when brief is opened', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    const res = await openBrief(brief._id, cookie);

    expect(res.status).toBe(200);
    // GET no longer returns coin fields
    expect(res.body.data.airstarsEarned).toBeUndefined();
    expect(res.body.data.dailyCoinsEarned).toBeUndefined();
  });

  it('does not award daily coins when brief is opened', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);

    const updated = await User.findById(user._id);
    expect(updated.loginStreak).toBe(0);     // streak unchanged by open
    expect(updated.lastStreakDate).toBeNull(); // not updated by open
  });
});

// ── POST /api/briefs/:id/complete — daily streak reward ───────────────────

describe('POST /api/briefs/:id/complete — daily streak reward', () => {
  it('awards daily coins on first brief completion (streak day 1, no bonus)', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    const res = await completeBrief(brief._id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.dailyCoinsEarned).toBe(5);  // base=5, no bonus on day 1
    expect(res.body.data.loginStreak).toBe(1);
  });

  it('does NOT award daily coins on a second completion the same day', async () => {
    const user   = await createUser();
    const brief1 = await createBrief({ category: 'News', title: 'Brief A' });
    const brief2 = await createBrief({ category: 'News', title: 'Brief B' });
    const cookie = authCookie(user._id);

    await openBrief(brief1._id, cookie);
    await completeBrief(brief1._id, cookie); // first completion — daily coins given

    await openBrief(brief2._id, cookie);
    const res = await completeBrief(brief2._id, cookie); // second completion same day

    expect(res.status).toBe(200);
    expect(res.body.data.dailyCoinsEarned).toBe(0);
    expect(res.body.data.loginStreak).toBe(1); // streak unchanged
  });

  it('awards base + bonus coins on a consecutive-day completion (streak day 2)', async () => {
    const user   = await createUser({ loginStreak: 1 });
    await setLastStreakDate(user._id, 1); // yesterday
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    const res = await completeBrief(brief._id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.dailyCoinsEarned).toBe(7); // base 5 + bonus 2
    expect(res.body.data.loginStreak).toBe(2);
  });

  it('resets streak to 1 when a day has been missed', async () => {
    const user   = await createUser({ loginStreak: 5 });
    await setLastStreakDate(user._id, 2); // two days ago — gap
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    const res = await completeBrief(brief._id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.dailyCoinsEarned).toBe(5); // base only — streak reset
    expect(res.body.data.loginStreak).toBe(1);
  });

  it('counts re-completing an already-read brief as a valid first-completion-of-day', async () => {
    const user   = await createUser({ loginStreak: 1 });
    await setLastStreakDate(user._id, 1); // yesterday
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // First complete ever
    await openBrief(brief._id, cookie);
    await completeBrief(brief._id, cookie);

    // Simulate a new day by resetting lastStreakDate back to yesterday
    await setLastStreakDate(user._id, 1);
    // Also reset coinsAwarded so the brief can be re-completed for daily coins
    const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: user._id, intelBriefId: brief._id },
      { coinsAwarded: false }
    );

    // Re-complete same brief next day
    const res = await completeBrief(brief._id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.dailyCoinsEarned).toBe(7); // daily coins: base+bonus (streak day 3)
    expect(res.body.data.loginStreak).toBe(3);      // was 2 after day 1; day 2 increments to 3
  });

  it('persists loginStreak and lastStreakDate on the user document', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    await completeBrief(brief._id, cookie);

    const updated = await User.findById(user._id);
    expect(updated.loginStreak).toBe(1);
    expect(updated.lastStreakDate).not.toBeNull();
    expect(new Date(updated.lastStreakDate).toDateString()).toBe(new Date().toDateString());
  });

  it('awards brief-read coins AND daily coins together on first ever completion', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    const res = await completeBrief(brief._id, cookie);

    expect(res.body.data.airstarsEarned).toBeGreaterThan(0);   // first-time brief coins
    expect(res.body.data.dailyCoinsEarned).toBeGreaterThan(0); // daily coins
  });

  it('is idempotent — completing the same brief twice gives coins only once', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    await openBrief(brief._id, cookie);
    await completeBrief(brief._id, cookie); // first — coins awarded

    const res = await completeBrief(brief._id, cookie); // second — should give nothing

    expect(res.status).toBe(200);
    expect(res.body.data.airstarsEarned).toBe(0);
    expect(res.body.data.dailyCoinsEarned).toBe(0);
  });

  it('requires authentication — returns 401 for guests', async () => {
    const brief = await createBrief({ category: 'News' });

    const res = await request(app)
      .post(`/api/briefs/${brief._id}/complete`);

    expect(res.status).toBe(401);
  });

  it('builds a multi-day streak correctly across consecutive completions', async () => {
    const user   = await createUser();
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // Day 1
    await openBrief(brief._id, cookie);
    await completeBrief(brief._id, cookie);
    expect((await User.findById(user._id)).loginStreak).toBe(1);

    // Day 2 — reset coinsAwarded so re-completion is fresh
    await setLastStreakDate(user._id, 1);
    const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: user._id, intelBriefId: brief._id },
      { coinsAwarded: false }
    );
    await completeBrief(brief._id, cookie);
    expect((await User.findById(user._id)).loginStreak).toBe(2);

    // Day 3
    await setLastStreakDate(user._id, 1);
    await IntelligenceBriefRead.findOneAndUpdate(
      { userId: user._id, intelBriefId: brief._id },
      { coinsAwarded: false }
    );
    await completeBrief(brief._id, cookie);
    expect((await User.findById(user._id)).loginStreak).toBe(3);
  });
});

// ── Stale streak decay via authenticated requests ─────────────────────────

describe('Authenticated requests decay stale streaks', () => {
  it('zeros out loginStreak on GET /api/auth/me when last read was >1 day ago', async () => {
    const user = await createUser({ loginStreak: 5 });
    await setLastStreakDate(user._id, 2); // two days ago — lapsed
    const cookie = authCookie(user._id);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.loginStreak).toBe(0);
    const persisted = await User.findById(user._id);
    expect(persisted.loginStreak).toBe(0);
  });

  it('does NOT decay streak when last read was yesterday', async () => {
    const user = await createUser({ loginStreak: 5 });
    await setLastStreakDate(user._id, 1); // yesterday — still alive
    const cookie = authCookie(user._id);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.loginStreak).toBe(5);
    const persisted = await User.findById(user._id);
    expect(persisted.loginStreak).toBe(5);
  });

  it('does NOT decay streak when last read was today', async () => {
    const user = await createUser({ loginStreak: 3 });
    await setLastStreakDate(user._id, 0); // today
    const cookie = authCookie(user._id);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.loginStreak).toBe(3);
  });

  it('does nothing when user has never started a streak', async () => {
    const user = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.loginStreak).toBe(0);
    expect(res.body.data.user.lastStreakDate).toBeNull();
  });

  it('after decay, the next brief completion starts a fresh streak at 1', async () => {
    const user   = await createUser({ loginStreak: 5 });
    await setLastStreakDate(user._id, 3); // gap
    const brief  = await createBrief({ category: 'News' });
    const cookie = authCookie(user._id);

    // This request alone triggers decay via protect middleware
    await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect((await User.findById(user._id)).loginStreak).toBe(0);

    // Next completion should start at 1
    await openBrief(brief._id, cookie);
    const res = await completeBrief(brief._id, cookie);
    expect(res.body.data.loginStreak).toBe(1);
    expect(res.body.data.dailyCoinsEarned).toBe(5); // base only
  });
});
