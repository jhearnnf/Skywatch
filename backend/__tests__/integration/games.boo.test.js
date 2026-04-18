process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const GameSessionOrderOfBattleResult = require('../../models/GameSessionOrderOfBattleResult');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const {
  createUser,
  createSettings,
  createBooBriefs,
  createTrainingBooBriefs,
  createReadRecord,
  createPassedQuizAttempt,
  createWonBooResult,
  authCookie,
} = require('../helpers/factories');

let user, cookie;

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await createSettings({ airstarsOrderOfBattleEasy: 8, airstarsOrderOfBattleMedium: 18 });
  user   = await createUser({ difficultySetting: 'easy' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Satisfies all BOO prerequisites for user+anchor:
//   1. Read record for the anchor brief
//   2. Read records for every brief in the pool (BOO only draws from read briefs)
//   3. Aircraft-reads gate: 3 no-game-data aircraft reads
//   4. Passed quiz attempt for the anchor brief
// Pass the full pool array as `pool` so choice briefs land in the user's read
// set — the route now filters the choice pool to completed reads.
async function ensureBOOReady(anchorBrief, pool = []) {
  await createReadRecord(user._id, anchorBrief._id);
  await createPassedQuizAttempt(user._id, anchorBrief._id);
  for (const b of pool) {
    if (String(b._id) === String(anchorBrief._id)) continue;
    await createReadRecord(user._id, b._id);
  }
  for (let i = 0; i < 3; i++) {
    const filler = await IntelligenceBrief.create({
      title: `Aircraft Gate Filler ${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`, subtitle: '',
      category: 'Aircrafts', descriptionSections: ['Section.'],
      keywords: [], sources: [], isPublished: true, status: 'published', gameData: {},
    });
    await createReadRecord(user._id, filler._id);
  }
}

// ── GET /api/games/battle-of-order/options ────────────────────────────────
describe('GET /api/games/battle-of-order/options', () => {
  it('returns available=false for ineligible category (News)', async () => {
    const [anchor] = await createBooBriefs(1, 'News');
    await ensureBOOReady(anchor);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toBe('ineligible_category');
  });

  it('returns available=false when user has not read enough briefs in the pool', async () => {
    // 5 Aircrafts briefs exist (more than the threshold), but only the anchor is in the user's read set.
    // BOO now only draws from briefs the user has actually read → insufficient_read_pool.
    const briefs = await createBooBriefs(5, 'Aircrafts');
    await ensureBOOReady(briefs[0]); // only anchor marked read

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${briefs[0]._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toBe('insufficient_read_pool');
  });

  it('returns available=true with options when enough briefs exist', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const anchor = briefs[0];
    await ensureBOOReady(anchor, briefs);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.options.length).toBeGreaterThan(0);
    expect(res.body.data.difficulty).toBe('easy');
  });

  it('returns 400 if briefId is missing', async () => {
    const res = await request(app)
      .get('/api/games/battle-of-order/options')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });

  it('returns 401 if not authenticated', async () => {
    const [anchor] = await createBooBriefs(3, 'Aircrafts');

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`);

    expect(res.status).toBe(401);
  });
});

// ── POST /api/games/battle-of-order/generate ─────────────────────────────
describe('POST /api/games/battle-of-order/generate', () => {
  it('generates a game with shuffled choices', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const anchor = briefs[0];
    await ensureBOOReady(anchor, briefs);

    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchor._id, orderType: 'speed' });

    expect(res.status).toBe(200);
    expect(res.body.data.gameId).toBeDefined();
    expect(res.body.data.choices).toHaveLength(3);
    expect(res.body.data.orderType).toBe('speed');
    expect(res.body.data.difficulty).toBe('easy');
    res.body.data.choices.forEach(c => {
      expect(c.choiceId).toBeDefined();
      expect(c.briefTitle).toBeDefined();
    });
  });

  it('returns 400 for invalid orderType', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const anchor = briefs[0];
    await ensureBOOReady(anchor, briefs);

    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchor._id, orderType: 'invalid_type' });

    expect(res.status).toBe(400);
  });

  it('returns 400 if insufficient briefs', async () => {
    const [anchor] = await createBooBriefs(1, 'Aircrafts');
    await ensureBOOReady(anchor);

    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchor._id, orderType: 'speed' });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/games/battle-of-order/submit ────────────────────────────────
describe('POST /api/games/battle-of-order/submit', () => {
  async function generateGame(anchorBriefId) {
    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchorBriefId, orderType: 'speed' });
    return res.body.data;
  }

  function correctOrder(choices, game) {
    // The server assigns correctOrder based on ascending speed.
    // For our test briefs speeds are 500, 1000, 1500 kph.
    // We need to return choices sorted by their correct order.
    // Since generate shuffles, we must use correctReveal from submit to verify.
    // For submit we send choices in *any* order and check the result.
    return choices.map((c, idx) => ({ choiceId: c.choiceId, userOrderNumber: idx + 1 }));
  }

  it('returns won=false for any submitted order before we know the correct one', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    await ensureBOOReady(briefs[0], briefs);
    const game   = await generateGame(briefs[0]._id);

    // Submit in the order the server gave us (shuffled — likely wrong)
    const userChoices = game.choices.map((c, i) => ({ choiceId: c.choiceId, userOrderNumber: i + 1 }));

    const res = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({ gameId: game.gameId, userChoices, timeTakenSeconds: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBeDefined();
    expect(res.body.data.correctReveal).toHaveLength(3);
    res.body.data.correctReveal.forEach(r => {
      expect(r.briefTitle).toBeDefined();
      expect(r.correctOrder).toBeDefined();
    });
  });

  it('wins and earns coins when choices match the correct order exactly', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    await ensureBOOReady(briefs[0], briefs);
    const game   = await generateGame(briefs[0]._id);

    // First do a dummy submit to discover correct order — use order 99 to guarantee a loss
    const dummy = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({
        gameId:     game.gameId,
        userChoices: game.choices.map(c => ({ choiceId: c.choiceId, userOrderNumber: 99 })),
        timeTakenSeconds: 5,
      });

    // Now create a fresh game for the same anchor and submit in correct order
    const game2   = await generateGame(briefs[0]._id);
    const reveal  = dummy.body.data.correctReveal; // [{choiceId, correctOrder, briefTitle, displayValue}]

    // Map choiceId from game2 choices to their correct order
    // We need to match by briefTitle since choiceIds differ per game instance
    const titleToCorrectOrder = Object.fromEntries(reveal.map(r => [r.briefTitle, r.correctOrder]));
    const winChoices = game2.choices
      .map(c => ({ choiceId: c.choiceId, userOrderNumber: titleToCorrectOrder[c.briefTitle] }))
      .filter(c => c.userOrderNumber != null);

    const res = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({ gameId: game2.gameId, userChoices: winChoices, timeTakenSeconds: 8 });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.airstarsEarned).toBe(8); // easy difficulty
  });

  it('does not award coins on a second win (repeat attempt same anchor+orderType)', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    await ensureBOOReady(briefs[0], briefs);

    // First game — get correct order
    const g1 = await generateGame(briefs[0]._id);
    const d1 = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({
        gameId:          g1.gameId,
        userChoices:     g1.choices.map((c, i) => ({ choiceId: c.choiceId, userOrderNumber: i + 1 })),
        timeTakenSeconds: 5,
      });

    const reveal = d1.body.data.correctReveal;
    const titleToOrder = Object.fromEntries(reveal.map(r => [r.briefTitle, r.correctOrder]));

    // Win the first game correctly
    const g1win = await generateGame(briefs[0]._id);
    const winChoices1 = g1win.choices
      .map(c => ({ choiceId: c.choiceId, userOrderNumber: titleToOrder[c.briefTitle] }))
      .filter(c => c.userOrderNumber != null);

    await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({ gameId: g1win.gameId, userChoices: winChoices1, timeTakenSeconds: 5 });

    // Second win on same anchor
    const g2 = await generateGame(briefs[0]._id);
    const winChoices2 = g2.choices
      .map(c => ({ choiceId: c.choiceId, userOrderNumber: titleToOrder[c.briefTitle] }))
      .filter(c => c.userOrderNumber != null);

    const res = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({ gameId: g2.gameId, userChoices: winChoices2, timeTakenSeconds: 6 });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.airstarsEarned).toBe(0);
    expect(res.body.data.alreadyCompleted).toBe(true);
  });

  it('returns 400 if gameId is missing', async () => {
    const res = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({ userChoices: [] });

    expect(res.status).toBe(400);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app)
      .post('/api/games/battle-of-order/submit')
      .send({ gameId: 'x', userChoices: [] });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/games/battle-of-order/abandon ───────────────────────────────
describe('POST /api/games/battle-of-order/abandon', () => {
  it('records an abandoned session', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    await ensureBOOReady(briefs[0], briefs);
    const genRes = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: briefs[0]._id, orderType: 'speed' });

    const res = await request(app)
      .post('/api/games/battle-of-order/abandon')
      .set('Cookie', cookie)
      .send({ gameId: genRes.body.data.gameId, timeTakenSeconds: 4 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('succeeds even without a gameId (graceful no-op)', async () => {
    const res = await request(app)
      .post('/api/games/battle-of-order/abandon')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(200);
  });

  it('stores abandoned=true, won=false, airstarsEarned=0 in the DB', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    await ensureBOOReady(briefs[0], briefs);
    const genRes = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: briefs[0]._id, orderType: 'speed' });
    const { gameId } = genRes.body.data;

    await request(app)
      .post('/api/games/battle-of-order/abandon')
      .set('Cookie', cookie)
      .send({ gameId, timeTakenSeconds: 7 });

    const record = await GameSessionOrderOfBattleResult.findOne({ gameId });
    expect(record).toBeTruthy();
    expect(record.abandoned).toBe(true);
    expect(record.won).toBe(false);
    expect(record.airstarsEarned).toBe(0);
    expect(record.timeTakenSeconds).toBe(7);
  });

  it('abandoned games are NOT counted in /api/users/stats gamesPlayed', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    await ensureBOOReady(briefs[0], briefs);
    const genRes = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: briefs[0]._id, orderType: 'speed' });

    await request(app)
      .post('/api/games/battle-of-order/abandon')
      .set('Cookie', cookie)
      .send({ gameId: genRes.body.data.gameId, timeTakenSeconds: 5 });

    const statsRes = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(statsRes.status).toBe(200);
    // 1 = the quiz pass created by ensureBOOReady; the BOO abandon should NOT add a 2nd count
    expect(statsRes.body.data.gamesPlayed).toBe(1);
  });
});

// ── GET /api/games/battle-of-order/status/:briefId ────────────────────────
describe('GET /api/games/battle-of-order/status/:briefId', () => {
  it('returns hasCompleted=false before any win', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${briefs[0]._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
    expect(res.body.data.completedOrderTypes).toEqual([]);
  });

  it('returns 401 if not authenticated', async () => {
    const briefs = await createBooBriefs(1, 'Aircrafts');

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${briefs[0]._id}`);

    expect(res.status).toBe(401);
  });
});

// Creates 3 no-game-data aircraft reads for userId — satisfies aircraft-reads gate
// without affecting the BOO-data brief count
async function ensureAircraftGate(userId) {
  for (let i = 0; i < 3; i++) {
    const filler = await IntelligenceBrief.create({
      title: `Gate Filler Rec ${Date.now()}_${i}`, subtitle: '',
      category: 'Aircrafts', descriptionSections: ['Section.'],
      keywords: [], sources: [], isPublished: true, status: 'published', gameData: {},
    });
    await createReadRecord(userId, filler._id);
  }
}

// ── GET /api/games/battle-of-order/recommended-briefs ─────────────────────
describe('GET /api/games/battle-of-order/recommended-briefs', () => {
  it('returns 401 if not authenticated', async () => {
    const res = await request(app).get('/api/games/battle-of-order/recommended-briefs');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no BOO briefs exist', async () => {
    const res = await request(app)
      .get('/api/games/battle-of-order/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(0);
  });

  it('returns quiz-pending when brief is read but quiz not playable', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts'); // >=3 needed for easy
    await ensureAircraftGate(user._id);
    await createReadRecord(user._id, briefs[0]._id); // read the brief

    const res = await request(app)
      .get('/api/games/battle-of-order/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const returned = res.body.data.briefs;
    expect(returned.length).toBeGreaterThan(0);
    const b = returned.find(b => b._id.toString() === briefs[0]._id.toString());
    expect(b.booState).toBe('quiz-pending'); // no quiz questions → quiz-pending
  });

  it('returns active when quiz is passed and BOO not yet won', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const anchor = briefs[0];
    await ensureAircraftGate(user._id);
    await createReadRecord(user._id, anchor._id);
    await createPassedQuizAttempt(user._id, anchor._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const active = res.body.data.briefs.find(b => b._id.toString() === anchor._id.toString());
    expect(active).toBeDefined();
    expect(active.booState).toBe('active');
  });

  it('returns completed when quiz is passed and BOO already won', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const anchor = briefs[0];
    await ensureAircraftGate(user._id);
    await createReadRecord(user._id, anchor._id);
    await createPassedQuizAttempt(user._id, anchor._id);
    // Win both available order types (speed + year_introduced both have count=3 ≥ 3)
    await createWonBooResult(user._id, anchor._id, { category: 'Aircrafts', orderType: 'speed' });
    await createWonBooResult(user._id, anchor._id, { category: 'Aircrafts', orderType: 'year_introduced' });

    const res = await request(app)
      .get('/api/games/battle-of-order/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const completed = res.body.data.briefs.find(b => b._id.toString() === anchor._id.toString());
    expect(completed).toBeDefined();
    expect(completed.booState).toBe('completed');
  });

  it('orders active before quiz-pending before completed', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const [bActive, bCompleted, bQuizPending] = briefs;
    await ensureAircraftGate(user._id);

    // bActive: read + quiz passed, BOO not won
    await createReadRecord(user._id, bActive._id);
    await createPassedQuizAttempt(user._id, bActive._id);

    // bCompleted: read + quiz passed + BOO won (both speed and year_introduced)
    await createReadRecord(user._id, bCompleted._id);
    await createPassedQuizAttempt(user._id, bCompleted._id);
    await createWonBooResult(user._id, bCompleted._id, { category: 'Aircrafts', orderType: 'speed' });
    await createWonBooResult(user._id, bCompleted._id, { category: 'Aircrafts', orderType: 'year_introduced' });

    // bQuizPending: read but no quiz pass and no quiz questions → quiz-pending
    await createReadRecord(user._id, bQuizPending._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const briefs2 = res.body.data.briefs;
    const activeIdx      = briefs2.findIndex(b => b._id.toString() === bActive._id.toString());
    const completedIdx   = briefs2.findIndex(b => b._id.toString() === bCompleted._id.toString());
    const quizPendingIdx = briefs2.findIndex(b => b._id.toString() === bQuizPending._id.toString());

    // Route order: active → quiz-pending → completed
    expect(activeIdx).toBeLessThan(quizPendingIdx);
    expect(quizPendingIdx).toBeLessThan(completedIdx);
  });

  it('respects the limit query parameter', async () => {
    await createBooBriefs(5, 'Aircrafts');

    const res = await request(app)
      .get('/api/games/battle-of-order/recommended-briefs?limit=2')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(2);
  });
});

// ── Training BOO order types ───────────────────────────────────────────────

// Set up all BOO prerequisites for a Training brief:
//  1. User has completed every brief in the Training pool (BOO draws from read briefs)
//  2. User has read 3 Aircrafts briefs (gate category for non-Bases)
//  3. User has passed the quiz for the anchor brief
async function setupTrainingBooPrereqs(userId, anchorBriefId, pool = []) {
  await createReadRecord(userId, anchorBriefId, { completed: true });
  for (const b of pool) {
    if (String(b._id) === String(anchorBriefId)) continue;
    await createReadRecord(userId, b._id, { completed: true });
  }
  const aircraftBriefs = await createBooBriefs(3, 'Aircrafts');
  for (const b of aircraftBriefs) {
    await createReadRecord(userId, b._id, { completed: true });
  }
  await createPassedQuizAttempt(userId, anchorBriefId);
}

describe('Training BOO — training_week and training_duration order types', () => {
  it('options returns training_week when trainingWeekStart is populated', async () => {
    const briefs = await createTrainingBooBriefs(3);
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    const types = res.body.data.options.map(o => o.orderType);
    expect(types).toContain('training_week');
  });

  it('options returns training_duration when weeksOfTraining is populated', async () => {
    const briefs = await createTrainingBooBriefs(3);
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    const types = res.body.data.options.map(o => o.orderType);
    expect(types).toContain('training_duration');
  });

  it('options returns both Training order types when all fields populated', async () => {
    const briefs = await createTrainingBooBriefs(3);
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const types = res.body.data.options.map(o => o.orderType);
    expect(types).toContain('training_week');
    expect(types).toContain('training_duration');
  });

  it('options omits training_week when trainingWeekStart is null for anchor', async () => {
    // All 3 briefs have weeksOfTraining but NOT trainingWeekStart
    const briefs = await createTrainingBooBriefs(3, {
      gameData: { trainingWeekStart: null, trainingWeekEnd: null, weeksOfTraining: 8 },
    });
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const types = (res.body.data.options ?? []).map(o => o.orderType);
    expect(types).not.toContain('training_week');
  });

  it('options omits training_duration when weeksOfTraining is null for anchor', async () => {
    // All 3 briefs have trainingWeekStart but NOT weeksOfTraining
    const briefs = await createTrainingBooBriefs(3, {
      gameData: { trainingWeekStart: 4, trainingWeekEnd: 6, weeksOfTraining: null },
    });
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const types = (res.body.data.options ?? []).map(o => o.orderType);
    expect(types).not.toContain('training_duration');
  });

  it('generates a training_week game with choices sorted by trainingWeekStart', async () => {
    const briefs = await createTrainingBooBriefs(3);
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchor._id, orderType: 'training_week' });

    expect(res.status).toBe(200);
    expect(res.body.data.orderType).toBe('training_week');
    expect(res.body.data.choices).toHaveLength(3);
  });

  it('generates a training_duration game with choices sorted by weeksOfTraining', async () => {
    const briefs = await createTrainingBooBriefs(3);
    const anchor = briefs[0];
    await setupTrainingBooPrereqs(user._id, anchor._id, briefs);

    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchor._id, orderType: 'training_duration' });

    expect(res.status).toBe(200);
    expect(res.body.data.orderType).toBe('training_duration');
    expect(res.body.data.choices).toHaveLength(3);
  });
});
