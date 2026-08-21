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

  it('never lets a negative single-game score lower the weekly total', async () => {
    // A good run then a bad (negative) run. The bad run contributes 0, not -50,
    // so the weekly total holds at 100 and play count still grows — "more play
    // never drops you down the board".
    await post('target', { totalScore: 100, totalTime: 120, grade: 'Good', playedAt: inWeek });
    await post('target', { totalScore: -50, totalTime: 120, grade: 'Failed', playedAt: inWeek });

    const res = await request(app).get('/api/games/cbat/target/leaderboard?period=weekly').set('Cookie', cookie);
    expect(res.body.data.myBest.weekTotal).toBe(100); // -50 floored to 0, not subtracted
    expect(res.body.data.myBest.plays).toBe(2);
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
    await post('plane-turn-2d', { totalRotations: 18, totalTime: 30, mode: '2d', playedAt: inWeek });
    const after1 = await request(app).get('/api/games/cbat/plane-turn-2d/leaderboard?period=weekly').set('Cookie', cookie);
    const total1 = after1.body.data.myBest.weekTotal;
    expect(total1).toBeGreaterThan(0);

    await post('plane-turn-2d', { totalRotations: 22, totalTime: 36, mode: '2d', playedAt: inWeek });
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

  // The post-game screen replays the increment the run just caused, which means it needs the
  // run's own contribution — and it cannot work that out from the score it displayed (a negative
  // run floors to 0; lower-is-better games derive points from rotations and time).
  describe('lastRunPoints — the newest run\'s contribution', () => {
    it('reports what the latest run added, not the whole week', async () => {
      await post('target', { totalScore: 100, totalTime: 120, grade: 'Good', playedAt: inWeek });
      await post('target', { totalScore: 200, totalTime: 120, grade: 'Good', playedAt: inWeek });

      const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
      expect(res.body.data.weekTotal).toBe(300);
      expect(res.body.data.lastRunPoints).toBe(200);
      // The screen counts from here, so it has to land exactly on the total.
      expect(res.body.data.weekTotal - res.body.data.lastRunPoints).toBe(100);
    });

    it('reports 0 for a negative run, matching the total that did not move', async () => {
      await post('target', { totalScore: 100, totalTime: 120, grade: 'Good', playedAt: inWeek });
      await post('target', { totalScore: -50, totalTime: 120, grade: 'Failed', playedAt: inWeek });

      const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
      expect(res.body.data.weekTotal).toBe(100);   // floored, as the board does
      expect(res.body.data.lastRunPoints).toBe(0); // so the reveal must not animate a gain
      expect(res.body.data.plays).toBe(2);         // the play count still ticked
    });

    it('reports derived points for a lower-is-better game, not the rotations score', async () => {
      await post('plane-turn-2d', { totalRotations: 18, totalTime: 30, mode: '2d', playedAt: inWeek });
      await post('plane-turn-2d', { totalRotations: 22, totalTime: 36, mode: '2d', playedAt: inWeek });

      const res = await request(app).get('/api/games/cbat/plane-turn-2d/weekly/me').set('Cookie', cookie);
      const { weekTotal, lastRunPoints } = res.body.data;
      expect(lastRunPoints).toBeGreaterThan(0);
      expect(lastRunPoints).not.toBe(22);              // not the raw score on screen
      expect(weekTotal - lastRunPoints).toBeGreaterThan(0); // and the earlier run is still in there
    });

    it('is 0 on the first run of the week, when there is nothing to add to', async () => {
      await post('target', { totalScore: 150, totalTime: 120, grade: 'Good', playedAt: inWeek });
      const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
      expect(res.body.data.weekTotal).toBe(150);
      expect(res.body.data.lastRunPoints).toBe(150);   // the whole total came from this run
    });

    it('ignores runs from last week when picking the latest', async () => {
      await post('target', { totalScore: 900, totalTime: 120, grade: 'Outstanding', playedAt: lastWeek });
      await post('target', { totalScore: 120, totalTime: 120, grade: 'Good', playedAt: inWeek });

      const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
      expect(res.body.data.weekTotal).toBe(120);
      expect(res.body.data.lastRunPoints).toBe(120);
    });
  });

  // prevRank drives the ▲N badge. It's computed against the whole board rather than the
  // five-row chase window, because a run that jumps a long way leaves everyone it overtook
  // outside that window.
  describe('prevRank — where the run moved the user from', () => {
    it('is null on the first play of the week (no previous position)', async () => {
      await post('target', { totalScore: 150, totalTime: 120, grade: 'Good', playedAt: inWeek });
      const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
      expect(res.body.data.prevRank).toBeNull();
    });

    it('reports the climb when a run overtakes another player', async () => {
      const rival = await createUser({ agentNumber: '1000002' });
      const rivalCookie = authCookie(rival._id);
      await request(app).post('/api/games/cbat/target/result').set('Cookie', rivalCookie)
        .send({ totalScore: 500, totalTime: 120, grade: 'Outstanding', playedAt: inWeek });

      await post('target', { totalScore: 200, totalTime: 120, grade: 'Good', playedAt: inWeek });
      const before = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);

      // 200 + 400 = 600 clears the rival's 500.
      await post('target', { totalScore: 400, totalTime: 120, grade: 'Outstanding', playedAt: inWeek });
      const after = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);

      expect(after.body.data.weekTotal).toBe(600);
      expect(after.body.data.prevRank).toBe(before.body.data.rank);   // exactly where it started
      expect(after.body.data.prevRank).toBeGreaterThan(after.body.data.rank); // and it climbed
    });

    it('equals the current rank when the run changed nothing (a negative run)', async () => {
      await post('target', { totalScore: 300, totalTime: 120, grade: 'Outstanding', playedAt: inWeek });
      await post('target', { totalScore: -50, totalTime: 120, grade: 'Failed', playedAt: inWeek });

      const res = await request(app).get('/api/games/cbat/target/weekly/me').set('Cookie', cookie);
      // The badge is suppressed on a zero delta rather than showing "▲0".
      expect(res.body.data.prevRank).toBe(res.body.data.rank);
    });
  });
});
