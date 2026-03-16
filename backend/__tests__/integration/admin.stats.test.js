/**
 * Admin — Stats tab tests
 *
 * Covers GET /api/admin/stats:
 *   users   section — totals, subscriptions, difficulty, logins, streaks
 *   games   section — played, completed, won (pass rate), perfect scores,
 *                     lost, abandoned, aircoins, quiz time, BOO sub-object
 *   briefs  section — totalBrifsRead, totalBrifsOpened, totalReadSeconds
 *   tutorials section — viewed / skipped counts
 *
 * Auth guard:
 *   403 for regular users, 401 for guests
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createSettings, authCookie,
} = require('../helpers/factories');
const GameSessionQuizAttempt         = require('../../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult = require('../../models/GameSessionOrderOfBattleResult');
const IntelligenceBriefRead          = require('../../models/IntelligenceBriefRead');
const mongoose = require('mongoose');

// ── helpers ─────────────────────────────────────────────────────────────────

function fakeAttempt(userId, overrides = {}) {
  return {
    userId,
    intelBriefId:  new mongoose.Types.ObjectId(),
    gameSessionId: new mongoose.Types.ObjectId().toString(),
    difficulty:    'easy',
    status:        'completed',
    won:           false,
    percentageCorrect: 0,
    ...overrides,
  };
}

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── auth guards ───────────────────────────────────────────────────────────────

describe('GET /api/admin/stats — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── response shape ────────────────────────────────────────────────────────────

describe('GET /api/admin/stats — response shape', () => {
  it('returns status success and the four top-level data sections', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('users');
    expect(res.body.data).toHaveProperty('games');
    expect(res.body.data).toHaveProperty('briefs');
    expect(res.body.data).toHaveProperty('tutorials');
  });

  it('games object contains totalGamesWon and totalPerfectScores as separate fields', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    const { games } = res.body.data;
    expect(games).toHaveProperty('totalGamesWon');
    expect(games).toHaveProperty('totalPerfectScores');
    expect(games).toHaveProperty('totalGamesCompleted');
    expect(games).toHaveProperty('totalGamesPlayed');
    expect(games).toHaveProperty('totalGamesLost');
    expect(games).toHaveProperty('totalGamesAbandoned');
    expect(games).toHaveProperty('boo');
  });
});

// ── users section ─────────────────────────────────────────────────────────────

describe('GET /api/admin/stats — users section', () => {
  it('counts total users correctly', async () => {
    const admin = await createAdminUser();
    await createUser();
    await createUser();

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    // admin + 2 regular = 3
    expect(res.body.data.users.totalUsers).toBe(3);
  });

  it('counts users by subscription tier', async () => {
    const admin = await createAdminUser();
    await createUser({ subscriptionTier: 'free' });
    await createUser({ subscriptionTier: 'silver' });
    await createUser({ subscriptionTier: 'gold' });

    const res  = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { users } = res.body.data;

    expect(users.freeUsers).toBeGreaterThanOrEqual(1);
    expect(users.subscribedUsers).toBeGreaterThanOrEqual(2); // silver + gold
  });

  it('returns 0 logins and streaks when DB is empty of game data', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { users } = res.body.data;

    expect(users.totalLogins).toBe(0);
    expect(users.combinedStreaks).toBe(0);
  });
});

// ── games section — quiz ──────────────────────────────────────────────────────

describe('GET /api/admin/stats — games.totalGamesWon (pass rate)', () => {
  it('is 0 when there are no attempts', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.games.totalGamesWon).toBe(0);
  });

  it('counts only won attempts', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionQuizAttempt.create([
      fakeAttempt(user._id, { won: true,  status: 'completed' }),
      fakeAttempt(user._id, { won: true,  status: 'completed' }),
      fakeAttempt(user._id, { won: false, status: 'completed' }),
      fakeAttempt(user._id, { won: false, status: 'abandoned' }),
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.games.totalGamesWon).toBe(2);
  });

  it('pass rate numerator (totalGamesWon) and denominator (totalGamesCompleted) are both present and non-NaN', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionQuizAttempt.create([
      fakeAttempt(user._id, { won: true,  status: 'completed' }),
      fakeAttempt(user._id, { won: false, status: 'completed' }),
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { games } = res.body.data;

    expect(typeof games.totalGamesWon).toBe('number');
    expect(typeof games.totalGamesCompleted).toBe('number');
    expect(isNaN(games.totalGamesWon)).toBe(false);
    expect(isNaN(games.totalGamesCompleted)).toBe(false);

    // frontend computes: totalGamesWon / totalGamesCompleted * 100
    const passRate = (games.totalGamesWon / games.totalGamesCompleted) * 100;
    expect(isNaN(passRate)).toBe(false);
    expect(passRate).toBeCloseTo(50);
  });
});

describe('GET /api/admin/stats — games.totalPerfectScores (separate from won)', () => {
  it('counts perfect-score (100%) attempts separately from won', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionQuizAttempt.create([
      fakeAttempt(user._id, { won: true,  status: 'completed', percentageCorrect: 100 }),
      fakeAttempt(user._id, { won: true,  status: 'completed', percentageCorrect: 75  }),
      fakeAttempt(user._id, { won: false, status: 'completed', percentageCorrect: 50  }),
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { games } = res.body.data;

    expect(games.totalGamesWon).toBe(2);        // won: true
    expect(games.totalPerfectScores).toBe(1);   // percentageCorrect === 100
  });
});

describe('GET /api/admin/stats — games totals', () => {
  it('counts totalGamesPlayed (completed + abandoned)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionQuizAttempt.create([
      fakeAttempt(user._id, { status: 'completed' }),
      fakeAttempt(user._id, { status: 'completed' }),
      fakeAttempt(user._id, { status: 'abandoned' }),
      fakeAttempt(user._id, { status: 'in_progress' }), // should NOT count
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { games } = res.body.data;

    expect(games.totalGamesPlayed).toBe(3);
    expect(games.totalGamesCompleted).toBe(2);
    expect(games.totalGamesAbandoned).toBe(1);
  });

  it('counts totalGamesLost (failed easy + failed medium below threshold)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    // settings have passThresholdEasy=60 and passThresholdMedium=60
    await GameSessionQuizAttempt.create([
      fakeAttempt(user._id, { difficulty: 'easy',   status: 'completed', percentageCorrect: 40 }),  // easy fail
      fakeAttempt(user._id, { difficulty: 'medium', status: 'completed', percentageCorrect: 50 }),  // medium fail
      fakeAttempt(user._id, { difficulty: 'easy',   status: 'completed', percentageCorrect: 80 }),  // easy pass — NOT lost
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.games.totalGamesLost).toBe(2);
  });
});

// ── briefs section ────────────────────────────────────────────────────────────

describe('GET /api/admin/stats — briefs section', () => {
  it('returns 0 for all brief stats when no brief reads exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { briefs } = res.body.data;

    expect(briefs.totalBrifsRead).toBe(0);
    expect(briefs.totalBrifsOpened).toBe(0);
    expect(briefs.totalReadSeconds).toBe(0);
  });

  it('counts only completed reads in totalBrifsRead', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await IntelligenceBriefRead.create([
      { userId: user._id,  intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id,  intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: admin._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false }, // opened, not completed
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.briefs.totalBrifsRead).toBe(2);
  });

  it('counts opened-but-not-completed briefs in totalBrifsOpened', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await IntelligenceBriefRead.create([
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { briefs } = res.body.data;

    expect(briefs.totalBrifsRead).toBe(1);
    expect(briefs.totalBrifsOpened).toBe(2);
  });

  it('sums timeSpentSeconds across all reads into totalReadSeconds', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await IntelligenceBriefRead.create([
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true,  timeSpentSeconds: 120 },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false, timeSpentSeconds: 45  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true,  timeSpentSeconds: 0   },
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.briefs.totalReadSeconds).toBe(165);
  });
});

// ── tutorials section ─────────────────────────────────────────────────────────

describe('GET /api/admin/stats — tutorials section', () => {
  it('returns 0 viewed and 0 skipped when users have no tutorial state', async () => {
    const admin = await createAdminUser();
    await createUser(); // no tutorial fields set

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { tutorials } = res.body.data;

    expect(tutorials.viewed).toBe(0);
    expect(tutorials.skipped).toBe(0);
  });

  it('counts viewed and skipped tutorials correctly', async () => {
    const admin = await createAdminUser();
    // User A: viewed welcome and intel_brief; skipped user
    await createUser({
      tutorials: {
        welcome:     'viewed',
        intel_brief: 'viewed',
        user:        'skipped',
        load_up:     'unseen',
      },
    });
    // User B: skipped welcome
    await createUser({
      tutorials: {
        welcome: 'skipped',
      },
    });

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { tutorials } = res.body.data;

    expect(tutorials.viewed).toBe(2);  // A's welcome + intel_brief
    expect(tutorials.skipped).toBe(2); // A's user + B's welcome
  });
});

// ── BOO section ───────────────────────────────────────────────────────────────

describe('GET /api/admin/stats — games.boo section', () => {
  it('returns 0 for all boo fields when no BOO games exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { boo } = res.body.data.games;

    expect(boo.total).toBe(0);
    expect(boo.won).toBe(0);
    expect(boo.defeated).toBe(0);
    expect(boo.abandoned).toBe(0);
    expect(boo.totalSeconds).toBe(0);
  });

  it('counts BOO results correctly', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const gameId = new mongoose.Types.ObjectId();

    await GameSessionOrderOfBattleResult.create([
      { userId: user._id, gameId, won: true,  abandoned: false, timeTakenSeconds: 30 },
      { userId: user._id, gameId, won: true,  abandoned: false, timeTakenSeconds: 20 },
      { userId: user._id, gameId, won: false, abandoned: false, timeTakenSeconds: 15 },
      { userId: user._id, gameId, won: false, abandoned: true,  timeTakenSeconds: 0  },
    ]);

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', authCookie(admin._id));
    const { boo } = res.body.data.games;

    expect(boo.total).toBe(4);
    expect(boo.won).toBe(2);
    expect(boo.defeated).toBe(1);
    expect(boo.abandoned).toBe(1);
    expect(boo.totalSeconds).toBe(65);
  });
});
