process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const GameSessionCbatClanResult       = require('../../models/GameSessionCbatClanResult');
const GameSessionCbatClanEasierResult = require('../../models/GameSessionCbatClanEasierResult');
const GameSessionCbatFlagResult       = require('../../models/GameSessionCbatFlagResult');
const { cbatLabelWithDifficulty, cbatHardKeyFor, isCbatEasierKey } = require('../../constants/cbatGames');
const { cbatCardKey, locationLabel } = require('../../constants/presenceLocations');

let user, cookie, user2, cookie2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user    = await createUser({ agentNumber: '1000001' });
  cookie  = authCookie(user._id);
  user2   = await createUser({ agentNumber: '1000002', email: 'clan2@test.com' });
  cookie2 = authCookie(user2._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A believable Hard run: most diamonds caught, one code fluffed, sums mostly
// right. Every award is a multiple of 5, so the total is too.
const sample = (overrides = {}) => ({
  totalScore:    285,
  colourHits:    28,
  colourWrong:   3,
  colourMissed:  4,
  letterCorrect: 4,
  letterWrong:   1,
  letterTimeout: 0,
  mathCorrect:   7,
  mathWrong:     2,
  mathTimeout:   1,
  totalTime:     90,
  grade:         'Good',
  ...overrides,
});

describe.each([
  ['clan',        GameSessionCbatClanResult,       GameSessionCbatClanEasierResult],
  ['clan-easier', GameSessionCbatClanEasierResult, GameSessionCbatClanResult],
])('CBAT CLAN (%s)', (gameKey, Model, OtherModel) => {
  const RESULT_URL      = `/api/games/cbat/${gameKey}/result`;
  const LEADERBOARD_URL = `/api/games/cbat/${gameKey}/leaderboard`;
  const PB_URL          = `/api/games/cbat/${gameKey}/personal-best`;

  describe('POST /result', () => {
    it('saves a run and returns 201 with the submitted data', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalScore).toBe(285);
      expect(res.body.data.colourHits).toBe(28);
      expect(res.body.data.letterCorrect).toBe(4);
      expect(res.body.data.mathTimeout).toBe(1);
      expect(res.body.data.grade).toBe('Good');

      expect(await Model.countDocuments()).toBe(1);
    });

    // The difficulty comes from the route, never the body, so a run can only
    // land on the board it was played on.
    it('never touches the other difficulty\'s board or FLAG\'s', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample());

      expect(await Model.countDocuments()).toBe(1);
      expect(await OtherModel.countDocuments()).toBe(0);
      expect(await GameSessionCbatFlagResult.countDocuments()).toBe(0);
    });

    it('keeps a negative total — wrong presses cost points', async () => {
      const res = await request(app).post(RESULT_URL).set('Cookie', cookie)
        .send(sample({ totalScore: -35, colourHits: 1, colourWrong: 9, grade: 'Failed' }));
      expect(res.status).toBe(201);
      expect(res.body.data.totalScore).toBe(-35);
    });

    it('requires a signed-in user', async () => {
      const res = await request(app).post(RESULT_URL).send(sample());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /leaderboard', () => {
    it('ranks real runs highest score first on a demo-padded board', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 200 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie2).send(sample({ totalScore: 330 }));

      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);

      const board = res.body.data.leaderboard;
      expect(board).toHaveLength(20);
      const real = board.filter(e => !e.isFake);
      expect(real[0].bestScore).toBe(330);
      expect(real.find(e => e.bestScore === 200)).toBeTruthy();
      // Fixed 90-second runs: every row, demo included, shows the same time.
      board.forEach(e => expect(e.bestTime).toBe(90));
    });

    it('keeps the two CLAN boards apart', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 330 }));

      const otherKey = gameKey === 'clan' ? 'clan-easier' : 'clan';
      const other = await request(app).get(`/api/games/cbat/${otherKey}/leaderboard`).set('Cookie', cookie);
      expect(other.body.data.leaderboard.filter(e => !e.isFake)).toHaveLength(0);
    });
  });

  describe('GET /personal-best', () => {
    it('reports the best run on this board only', async () => {
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 150 }));
      await request(app).post(RESULT_URL).set('Cookie', cookie).send(sample({ totalScore: 310 }));
      await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie)
        .send({ totalScore: 999, totalTime: 60, grade: 'Outstanding' });

      const res = await request(app).get(PB_URL).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.bestScore).toBe(310);
      expect(res.body.data.attempts).toBe(2);
    });
  });

  it('can be started through the generic start route', async () => {
    const res = await request(app).post(`/api/games/cbat/${gameKey}/start`).set('Cookie', cookie).send({});
    expect(res.status).toBe(201);
  });
});

describe('CLAN names both of its halves', () => {
  it('is a FLAG-shaped split: plain key Hard, -easier Easier', () => {
    expect(isCbatEasierKey('clan')).toBe(false);
    expect(isCbatEasierKey('clan-easier')).toBe(true);
    expect(cbatHardKeyFor('clan-easier')).toBe('clan');
  });

  it('labels each half so a score is never ambiguous', () => {
    expect(cbatLabelWithDifficulty('clan')).toBe('CLAN (Hard)');
    expect(cbatLabelWithDifficulty('clan-easier')).toBe('CLAN (Easier)');
  });
});

describe('CLAN presence', () => {
  it('labels the page and files it on the FLAG card, both difficulties', () => {
    expect(locationLabel('/cbat/clan')).toBe('CBAT · CLAN');
    expect(cbatCardKey('/cbat/clan')).toBe('flag');
    expect(cbatCardKey('/cbat/clan-easier/leaderboard')).toBe('flag');
  });
});
