// Submit / leaderboard / personal-best wiring for the five tests added to
// complete the RAF roster: SIT, SLT, VLT, MATF and Vigilance.
//
// One file rather than five because the wiring is identical and the interesting
// assertions are the cross-cutting ones — that each difficulty lands in its OWN
// collection (a run leaking into the sibling board is the failure that would be
// hardest to notice in production), and that Vigilance has no Easier key at all.

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const { CBAT_GAMES } = require('../../constants/cbatGames');

const QUESTION_GAMES = ['sit', 'slt', 'vlt'];
const DIFFICULTY_PAIRS = [
  ['sit', 'sit-easier'], ['slt', 'slt-easier'],
  ['vlt', 'vlt-easier'], ['matf', 'matf-easier'],
];
const ALL_KEYS = [...DIFFICULTY_PAIRS.flat(), 'vigilance'];

function bodyFor(gameKey) {
  if (gameKey.startsWith('matf')) {
    return { correctCount: 24, attempted: 30, gridCorrect: 13, tableCorrect: 11, totalTime: 180 };
  }
  if (gameKey === 'vigilance') {
    return { totalScore: 620, starsCleared: 48, prioritiesCleared: 5, misKeyed: 3, totalTime: 180 };
  }
  return { correctCount: 6, totalQuestions: 8, totalTime: 140, avgTimePerQuestionMs: 17500 };
}

let user, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT roster completion — SIT / SLT / VLT / MATF / Vigilance', () => {

  it('registers every new key in the shared registry, all higher-is-better', () => {
    for (const key of ALL_KEYS) {
      expect([key, !!CBAT_GAMES[key]]).toEqual([key, true]);
      expect([key, CBAT_GAMES[key].sortDir]).toEqual([key, -1]);
    }
  });

  it('ships Vigilance with no Easier sibling, on purpose', () => {
    // The test measures sustained attention over a fixed stretch; a shorter or
    // lighter variant would not be measuring it. See the model for the full note.
    expect(CBAT_GAMES['vigilance-easier']).toBeUndefined();
  });

  it.each(ALL_KEYS)('accepts a result on %s and reads it back as a personal best', async (gameKey) => {
    const body = bodyFor(gameKey);
    const post = await request(app)
      .post(`/api/games/cbat/${gameKey}/result`)
      .set('Cookie', cookie)
      .send(body);
    expect([gameKey, post.status]).toEqual([gameKey, 201]);

    const field = CBAT_GAMES[gameKey].primaryField;
    expect([gameKey, post.body.data[field]]).toEqual([gameKey, body[field]]);

    const best = await request(app)
      .get(`/api/games/cbat/${gameKey}/personal-best`)
      .set('Cookie', cookie);
    expect([gameKey, best.status]).toEqual([gameKey, 200]);
    expect([gameKey, best.body.data.bestScore]).toEqual([gameKey, body[field]]);
    expect([gameKey, best.body.data.attempts]).toEqual([gameKey, 1]);
  });

  it.each(ALL_KEYS)('serves a demo-padded leaderboard for %s', async (gameKey) => {
    await request(app)
      .post(`/api/games/cbat/${gameKey}/result`)
      .set('Cookie', cookie)
      .send(bodyFor(gameKey));

    const res = await request(app)
      .get(`/api/games/cbat/${gameKey}/leaderboard`)
      .set('Cookie', cookie);
    expect([gameKey, res.status]).toEqual([gameKey, 200]);
    const board = res.body.data.leaderboard;
    expect([gameKey, board.length]).toEqual([gameKey, 20]);
    // The real run is in there among the demos, and myBest tracks the caller.
    expect([gameKey, board.some(e => e.agentNumber === '1000001')]).toEqual([gameKey, true]);
    expect([gameKey, res.body.data.myBest.bestScore])
      .toEqual([gameKey, bodyFor(gameKey)[CBAT_GAMES[gameKey].primaryField]]);
  });

  it.each(DIFFICULTY_PAIRS)('keeps %s and %s in separate collections', async (hard, easier) => {
    await request(app).post(`/api/games/cbat/${hard}/result`).set('Cookie', cookie).send(bodyFor(hard));

    const hardCount   = await CBAT_GAMES[hard].Model.countDocuments({});
    const easierCount = await CBAT_GAMES[easier].Model.countDocuments({});
    expect([hard, hardCount, easierCount]).toEqual([hard, 1, 0]);

    // And the Easier board must not see the Hard run.
    const easierBest = await request(app)
      .get(`/api/games/cbat/${easier}/personal-best`)
      .set('Cookie', cookie);
    expect([easier, easierBest.body.data]).toEqual([easier, null]);
  });

  it('stores both MATF parts separately so accuracy stays readable', async () => {
    // A bare correctCount cannot distinguish an accurate player from a fast one,
    // which on a speeded test is the whole distinction worth having.
    const res = await request(app)
      .post('/api/games/cbat/matf/result')
      .set('Cookie', cookie)
      .send(bodyFor('matf'));
    expect(res.body.data.gridCorrect).toBe(13);
    expect(res.body.data.tableCorrect).toBe(11);
    expect(res.body.data.attempted).toBe(30);
  });

  it('stores the Vigilance breakdown alongside the score', async () => {
    const res = await request(app)
      .post('/api/games/cbat/vigilance/result')
      .set('Cookie', cookie)
      .send(bodyFor('vigilance'));
    expect(res.body.data.starsCleared).toBe(48);
    expect(res.body.data.prioritiesCleared).toBe(5);
    expect(res.body.data.misKeyed).toBe(3);
  });

  it.each(QUESTION_GAMES)('records the question count %s was scored out of', async (gameKey) => {
    // SIT, SLT and VLT keep the same length on both difficulties today, but the
    // count rides in the payload rather than being pinned server-side, so a
    // later change to one difficulty cannot silently mislabel old rows.
    const res = await request(app)
      .post(`/api/games/cbat/${gameKey}/result`)
      .set('Cookie', cookie)
      .send(bodyFor(gameKey));
    expect(res.body.data.totalQuestions).toBe(8);
  });

  it.each(ALL_KEYS)('rejects an unauthenticated submission to %s', async (gameKey) => {
    const res = await request(app).post(`/api/games/cbat/${gameKey}/result`).send(bodyFor(gameKey));
    expect([gameKey, res.status]).toEqual([gameKey, 401]);
  });
});
