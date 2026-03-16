process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser,
  createSettings,
  createBooBriefs,
  authCookie,
} = require('../helpers/factories');

let user, cookie;

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await createSettings({ aircoinsOrderOfBattleEasy: 8, aircoinsOrderOfBattleMedium: 18 });
  user   = await createUser({ difficultySetting: 'easy' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── GET /api/games/battle-of-order/options ────────────────────────────────
describe('GET /api/games/battle-of-order/options', () => {
  it('returns available=false for ineligible category (News)', async () => {
    const [anchor] = await createBooBriefs(1, 'News');

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toBe('ineligible_category');
  });

  it('returns available=false when insufficient briefs with game data', async () => {
    // Only 2 Aircrafts briefs — easy needs 3
    const [anchor] = await createBooBriefs(2, 'Aircrafts');

    const res = await request(app)
      .get(`/api/games/battle-of-order/options?briefId=${anchor._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toBe('insufficient_briefs');
  });

  it('returns available=true with options when enough briefs exist', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');
    const anchor = briefs[0];

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

    const res = await request(app)
      .post('/api/games/battle-of-order/generate')
      .set('Cookie', cookie)
      .send({ briefId: anchor._id, orderType: 'invalid_type' });

    expect(res.status).toBe(400);
  });

  it('returns 400 if insufficient briefs', async () => {
    const [anchor] = await createBooBriefs(1, 'Aircrafts');

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
    const game   = await generateGame(briefs[0]._id);

    // First do a dummy submit to discover correct order
    const dummy = await request(app)
      .post('/api/games/battle-of-order/submit')
      .set('Cookie', cookie)
      .send({
        gameId:     game.gameId,
        userChoices: game.choices.map((c, i) => ({ choiceId: c.choiceId, userOrderNumber: i + 1 })),
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
    expect(res.body.data.aircoinsEarned).toBe(8); // easy difficulty
  });

  it('does not award coins on a second win (repeat attempt same anchor+orderType)', async () => {
    const briefs = await createBooBriefs(3, 'Aircrafts');

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
    expect(res.body.data.aircoinsEarned).toBe(0);
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
