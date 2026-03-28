/**
 * GET /api/games/battle-of-order/status/:briefId
 *
 * Verifies that the endpoint correctly reports whether the requesting user
 * has won a Battle of Order game for a given brief.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser,
  createBrief,
  createSettings,
  createWonBooResult,
  authCookie,
} = require('../helpers/factories');
const GameOrderOfBattle              = require('../../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult = require('../../models/GameSessionOrderOfBattleResult');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/games/battle-of-order/status/:briefId', () => {
  it('returns 401 when not authenticated', async () => {
    const brief = await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get(`/api/games/battle-of-order/status/${brief._id}`);
    expect(res.status).toBe(401);
  });

  it('returns hasCompleted: false when user has no BOO results at all', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${brief._id}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
    expect(res.body.data.completedOrderTypes).toHaveLength(0);
  });

  it('returns hasCompleted: true when user has a won result for the brief', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(user._id, brief._id);

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${brief._id}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(true);
    expect(res.body.data.completedOrderTypes).toHaveLength(1);
    expect(res.body.data.completedOrderTypes[0].orderType).toBe('speed');
  });

  it('returns hasCompleted: false when user has only a lost result', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });

    const game = await GameOrderOfBattle.create({
      anchorBriefId: brief._id,
      category:      'Aircrafts',
      difficulty:    'easy',
      orderType:     'speed',
      choices:       [],
    });
    await GameSessionOrderOfBattleResult.create({
      userId:      user._id,
      gameId:      game._id,
      won:         false,
      userChoices: [],
    });

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${brief._id}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
    expect(res.body.data.completedOrderTypes).toHaveLength(0);
  });

  it('returns hasCompleted: false when a different user won but requesting user has not', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(userA._id, brief._id);

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${brief._id}`)
      .set('Cookie', authCookie(userB._id));

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
    expect(res.body.data.completedOrderTypes).toHaveLength(0);
  });

  it('only counts wins for the requested brief, not other briefs', async () => {
    const user   = await createUser();
    const briefA = await createBrief({ category: 'Aircrafts' });
    const briefB = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(user._id, briefA._id);

    const res = await request(app)
      .get(`/api/games/battle-of-order/status/${briefB._id}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
    expect(res.body.data.completedOrderTypes).toHaveLength(0);
  });
});
