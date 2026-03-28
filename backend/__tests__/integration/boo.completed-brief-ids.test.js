/**
 * GET /api/games/battle-of-order/completed-brief-ids
 *
 * Returns deduplicated brief IDs where the requesting user has won
 * at least one Battle of Order game.
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

describe('GET /api/games/battle-of-order/completed-brief-ids', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/games/battle-of-order/completed-brief-ids');
    expect(res.status).toBe(401);
  });

  it('returns empty ids array when user has no BOO wins', async () => {
    const user = await createUser();

    const res = await request(app)
      .get('/api/games/battle-of-order/completed-brief-ids')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.ids).toEqual([]);
  });

  it('returns the brief ID when user has a won result', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(user._id, brief._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/completed-brief-ids')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.ids).toHaveLength(1);
    expect(res.body.data.ids[0]).toBe(brief._id.toString());
  });

  it('deduplicates — multiple wins for the same brief appear once', async () => {
    const user  = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(user._id, brief._id, { orderType: 'speed' });
    await createWonBooResult(user._id, brief._id, { orderType: 'year_introduced' });

    const res = await request(app)
      .get('/api/games/battle-of-order/completed-brief-ids')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.ids).toHaveLength(1);
    expect(res.body.data.ids[0]).toBe(brief._id.toString());
  });

  it('returns ids for all briefs the user has won, across multiple briefs', async () => {
    const user   = await createUser();
    const briefA = await createBrief({ category: 'Aircrafts' });
    const briefB = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(user._id, briefA._id);
    await createWonBooResult(user._id, briefB._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/completed-brief-ids')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.ids).toHaveLength(2);
    expect(res.body.data.ids).toContain(briefA._id.toString());
    expect(res.body.data.ids).toContain(briefB._id.toString());
  });

  it('does not include results belonging to another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const brief = await createBrief({ category: 'Aircrafts' });
    await createWonBooResult(userA._id, brief._id);

    const res = await request(app)
      .get('/api/games/battle-of-order/completed-brief-ids')
      .set('Cookie', authCookie(userB._id));

    expect(res.status).toBe(200);
    expect(res.body.data.ids).toEqual([]);
  });

  it('does not include lost results', async () => {
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
      .get('/api/games/battle-of-order/completed-brief-ids')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.ids).toEqual([]);
  });
});
