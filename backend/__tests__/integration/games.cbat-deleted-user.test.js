process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const User    = require('../../models/User');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const RESULT_URL      = '/api/games/cbat/symbols/result';
const LEADERBOARD_URL = '/api/games/cbat/symbols/leaderboard';

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// A result row whose user account has since been deleted is dropped by the
// leaderboard's users $lookup/$unwind. When the trim to 20 happened before that
// join, the board came back one row short and padLeaderboard filled the hole
// with a demo row — so deleting one account literally swapped a real player for
// a fake one (this is how a 13/15 demo landed at rank 20 on a board where 25+
// real users had scored a perfect 15/15).
describe('CBAT leaderboard with a deleted user in the top 20', () => {
  // 21 users, all 15/15, separated by totalTime so the ordering is deterministic.
  async function seedBoard(count) {
    const users = [];
    for (let i = 0; i < count; i++) {
      const user = await createUser({ agentNumber: `30000${String(i).padStart(2, '0')}` });
      await request(app).post(RESULT_URL).set('Cookie', authCookie(user._id))
        .send({ correctCount: 15, totalTime: 30 + i });
      users.push(user);
    }
    return users;
  }

  it('keeps 20 real rows and promotes the next player when a top-20 account is deleted', async () => {
    const users = await seedBoard(21);
    const deleted = users[4];          // 5th fastest — comfortably inside the top 20
    const promoted = users[20];        // 21st, previously off the board
    await User.deleteOne({ _id: deleted._id });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(users[1]._id));

    expect(res.status).toBe(200);
    const board = res.body.data.leaderboard;
    expect(board).toHaveLength(20);
    expect(board.some(e => e.isFake)).toBe(false);
    expect(board.some(e => e.agentNumber === deleted.agentNumber)).toBe(false);
    expect(board.some(e => e.agentNumber === promoted.agentNumber)).toBe(true);
    expect(board.map(e => e.rank)).toEqual([...Array(20)].map((_, i) => i + 1));
  });

  it('does not summon a demo row when the deleted account has no replacement', async () => {
    const users = await seedBoard(20);
    await User.deleteOne({ _id: users[0]._id });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(users[1]._id));

    const board = res.body.data.leaderboard;
    // Only 19 real players remain, so padding is legitimate here — but every
    // demo row must rank BELOW the perfect real scores, never above them.
    const fakes = board.filter(e => e.isFake);
    const reals = board.filter(e => !e.isFake);
    expect(reals).toHaveLength(19);
    fakes.forEach(f => {
      reals.forEach(r => expect(f.bestScore).toBeLessThan(r.bestScore));
    });
  });

  it('excludes deleted accounts from an out-of-board rank', async () => {
    const users = await seedBoard(21);
    await User.deleteOne({ _id: users[0]._id });

    // A 22nd player, slower than everyone, sits outside the top 20.
    const late = await createUser({ agentNumber: '3000099' });
    const cookie = authCookie(late._id);
    await request(app).post(RESULT_URL).set('Cookie', cookie)
      .send({ correctCount: 15, totalTime: 500 });

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', cookie);

    // 21 seeded users minus the deleted one = 20 real players ahead of them.
    expect(res.body.data.myBest.rank).toBe(21);
  });
});
