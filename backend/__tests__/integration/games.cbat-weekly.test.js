process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const { startOfWeekUTC } = require('../../utils/weekWindow');

let user, cookie;

// A timestamp safely inside the current week, and one safely before it.
const weekStart = startOfWeekUTC();
const inWeek  = new Date(weekStart.getTime() + 24 * 60 * 60 * 1000).toISOString();      // Tue-ish
const lastWeek = new Date(weekStart.getTime() - 24 * 60 * 60 * 1000).toISOString();     // prev Sun

const post = (gameKey, body) =>
  request(app).post(`/api/games/cbat/${gameKey}/result`).set('Cookie', cookie).send(body);

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT weekly leaderboard', () => {
  it('sums every run this week on the weekly board', async () => {
    await post('target', { totalScore: 100, totalTime: 120, grade: 'Good', playedAt: inWeek });
    await post('target', { totalScore: 200, totalTime: 120, grade: 'Good', playedAt: inWeek });

    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.period).toBe('weekly');
    const me = res.body.data.myBest;
    expect(me.weekTotal).toBe(300); // 100 + 200, not best-of
    expect(me.plays).toBe(2);
    expect(res.body.data.resetsAt).toBeTruthy();
  });

  it('excludes runs from before the week start', async () => {
    await post('target', { totalScore: 500, totalTime: 120, grade: 'Outstanding', playedAt: lastWeek });
    await post('target', { totalScore: 50,  totalTime: 120, grade: 'Good', playedAt: inWeek });

    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    expect(res.body.data.myBest.weekTotal).toBe(50); // last week's 500 ignored
    expect(res.body.data.myBest.plays).toBe(1);
  });

  it('does not inflate the weekly total on a retried (deduped) submission', async () => {
    const dup = { totalScore: 80, totalTime: 120, grade: 'Good', clientResultId: 'cri-week-1', playedAt: inWeek };
    await post('target', dup);
    await post('target', dup); // retry — same clientResultId

    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    expect(res.body.data.myBest.weekTotal).toBe(80);
    expect(res.body.data.myBest.plays).toBe(1);
  });

  it('?period=all-time still returns the best-score board', async () => {
    await post('target', { totalScore: 100, totalTime: 120, grade: 'Good', playedAt: inWeek });
    await post('target', { totalScore: 200, totalTime: 120, grade: 'Good', playedAt: inWeek });

    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=all-time').set('Cookie', cookie);
    expect(res.body.data.period).toBe('all-time');
    expect(res.body.data.myBest.bestScore).toBe(200); // best single run, not the sum
  });

  it('pads a quiet week with believable low-play demo rows', async () => {
    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    expect(res.body.data.leaderboard.length).toBeGreaterThan(0);
    // Demo rows look like a few players who each played only a couple of games.
    for (const row of res.body.data.leaderboard) {
      expect(row.plays).toBeLessThanOrEqual(3);
      expect(row.weekTotal).toBeGreaterThan(0);
    }
  });
});

describe('CBAT weekly — Trace Practise derived points', () => {
  it('ranks fewer rotations higher and grows with more runs', async () => {
    // Two runs accumulate; fewer rotations => more derived points.
    await post('plane-turn-2d', { totalRotations: 50, totalTime: 90, mode: '2d', playedAt: inWeek });
    const after1 = await request(app).get('/api/games/cbat/plane-turn-2d/leaderboard?period=weekly').set('Cookie', cookie);
    const total1 = after1.body.data.myBest.weekTotal;
    expect(total1).toBeGreaterThan(0);

    await post('plane-turn-2d', { totalRotations: 60, totalTime: 100, mode: '2d', playedAt: inWeek });
    const after2 = await request(app).get('/api/games/cbat/plane-turn-2d/leaderboard?period=weekly').set('Cookie', cookie);
    expect(after2.body.data.myBest.weekTotal).toBeGreaterThan(total1); // sum grew
    expect(after2.body.data.myBest.plays).toBe(2);
  });
});

describe('CBAT weekly — admin email exposure (parity with all-time)', () => {
  it('includes user emails on the weekly board and reveal for admins', async () => {
    const admin = await createAdminUser({ email: 'boss@skywatch.test', agentNumber: '9000001' });
    const adminCookie = authCookie(admin._id);
    const pilot = await createUser({ email: 'pilot@example.com', agentNumber: '9000002' });
    const pilotCookie = authCookie(pilot._id);

    await request(app).post('/api/games/cbat/target/result').set('Cookie', pilotCookie)
      .send({ totalScore: 120, totalTime: 120, grade: 'Good', playedAt: inWeek });
    await request(app).post('/api/games/cbat/target/result').set('Cookie', adminCookie)
      .send({ totalScore: 90, totalTime: 120, grade: 'Good', playedAt: inWeek });

    const board = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', adminCookie);
    const realEmails = board.body.data.leaderboard.filter(e => !e.isFake).map(e => e.email).sort();
    expect(realEmails).toEqual(['boss@skywatch.test', 'pilot@example.com']);

    // Reveal chase window surfaces emails as the row name for admins.
    const me = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', adminCookie);
    expect(me.body.data.neighbors.some(n => n.name === 'pilot@example.com')).toBe(true);
  });

  it('hides emails from non-admin requesters on the weekly board', async () => {
    await post('target', { totalScore: 70, totalTime: 120, grade: 'Good', playedAt: inWeek });
    const board = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    expect(board.body.data.leaderboard.every(e => e.email === undefined || e.email === 'demo')).toBe(true);
  });
});

describe('CBAT weekly/me reveal endpoint', () => {
  it('reports played:false before any run this week', async () => {
    const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.played).toBe(false);
    expect(res.body.data.resetsAt).toBeTruthy();
  });

  it('returns the user rank, total and a chase window flagged isMe', async () => {
    await post('target', { totalScore: 150, totalTime: 120, grade: 'Good', playedAt: inWeek });
    const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
    expect(res.body.data.played).toBe(true);
    expect(res.body.data.weekTotal).toBe(150);
    expect(res.body.data.rank).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data.neighbors)).toBe(true);
    expect(res.body.data.neighbors.some(n => n.isMe)).toBe(true);
  });
});
