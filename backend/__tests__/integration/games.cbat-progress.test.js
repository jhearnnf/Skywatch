process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const { CBAT_GAMES } = require('../../constants/cbatGames');
const GameSessionCbatPlaneTurnResult = require('../../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatAnglesResult    = require('../../models/GameSessionCbatAnglesResult');
const GameSessionCbatTargetResult    = require('../../models/GameSessionCbatTargetResult');

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Builds a valid result row for any registry entry. Sets a superset of the fields the various
// models mark required (roundsPlayed for ANT/Instruments, score for Trace 1); mongoose's strict
// mode drops the ones a given schema doesn't declare, so one shape covers every game.
const makeDoc = (cfg, userId, score, createdAt, time = 30) => ({
  userId,
  [cfg.primaryField]: score,
  totalTime: time,
  roundsPlayed: 5,
  score,
  ...(cfg.modeFilter ?? {}),
  ...(createdAt ? { createdAt } : {}),
});

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('GET /api/games/cbat/:gameKey/progress', () => {
  // The endpoint resolves its config from CBAT_GAMES at call time, so a newly added game should
  // work with no extra wiring. This locks that in — if someone adds a registry entry whose model
  // can't serve the query, it fails here rather than 500ing for real users.
  it('responds for every game in the CBAT_GAMES registry', async () => {
    for (const [gameKey, cfg] of Object.entries(CBAT_GAMES)) {
      await cfg.Model.create(makeDoc(cfg, user._id, 5));

      const res = await request(app)
        .get(`/api/games/cbat/${gameKey}/progress`)
        .set('Cookie', cookie);

      expect([gameKey, res.status]).toEqual([gameKey, 200]);
      expect([gameKey, res.body.data.attempts]).toEqual([gameKey, 1]);
      expect([gameKey, res.body.data.series.length]).toEqual([gameKey, 1]);
      expect([gameKey, res.body.data.series[0].score]).toEqual([gameKey, 5]);
    }
  });

  it('returns the series oldest → newest regardless of insert order', async () => {
    const cfg = CBAT_GAMES['angles'];
    // Inserted newest-first on purpose — the route sorts descending to use the index, then flips.
    await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 3, daysAgo(1)));
    await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 1, daysAgo(9)));
    await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 2, daysAgo(5)));

    const res = await request(app).get('/api/games/cbat/angles/progress').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.series.map(p => p.score)).toEqual([1, 2, 3]);
    const times = res.body.data.series.map(p => new Date(p.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('caps the series at `limit` keeping the most recent runs, but reports lifetime attempts', async () => {
    const cfg = CBAT_GAMES['angles'];
    for (let i = 0; i < 8; i++) {
      await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, i, daysAgo(20 - i)));
    }

    const res = await request(app)
      .get('/api/games/cbat/angles/progress?limit=3')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    // The chart window is the newest 3 ...
    expect(res.body.data.series.map(p => p.score)).toEqual([5, 6, 7]);
    // ... but the headline count is still the user's whole history.
    expect(res.body.data.attempts).toBe(8);
  });

  it('returns an empty series rather than an error when the user has never played', async () => {
    const res = await request(app).get('/api/games/cbat/target/progress').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ attempts: 0, series: [], best: null, firstAvg: null, lastAvg: null });
  });

  // plane-turn-2d and plane-turn-3d share one collection and are separated only by cfg.modeFilter.
  // Forgetting to spread it is the classic bug in this codebase, so pin it.
  it('keeps plane-turn 2d and 3d separate via modeFilter', async () => {
    const cfg2d = CBAT_GAMES['plane-turn-2d'];
    const cfg3d = CBAT_GAMES['plane-turn-3d'];
    await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg2d, user._id, 11));
    await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg2d, user._id, 12));
    await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg3d, user._id, 30));

    const res2d = await request(app).get('/api/games/cbat/plane-turn-2d/progress').set('Cookie', cookie);
    const res3d = await request(app).get('/api/games/cbat/plane-turn-3d/progress').set('Cookie', cookie);

    expect(res2d.body.data.attempts).toBe(2);
    expect(res2d.body.data.series.map(p => p.score).sort()).toEqual([11, 12]);
    expect(res3d.body.data.attempts).toBe(1);
    expect(res3d.body.data.series.map(p => p.score)).toEqual([30]);
  });

  it('never leaks another user\'s runs', async () => {
    const cfg = CBAT_GAMES['angles'];
    const other = await createUser({ agentNumber: '1000002', email: 'other@test.com' });
    await GameSessionCbatAnglesResult.create(makeDoc(cfg, other._id, 20));
    await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 4));

    const res = await request(app).get('/api/games/cbat/angles/progress').set('Cookie', cookie);

    expect(res.body.data.attempts).toBe(1);
    expect(res.body.data.series.map(p => p.score)).toEqual([4]);
  });

  describe('trend averages', () => {
    it('omits firstAvg/lastAvg below 6 attempts, where the delta would be noise', async () => {
      const cfg = CBAT_GAMES['angles'];
      for (let i = 0; i < 5; i++) {
        await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, i, daysAgo(10 - i)));
      }

      const res = await request(app).get('/api/games/cbat/angles/progress').set('Cookie', cookie);

      expect(res.body.data.firstAvg).toBeNull();
      expect(res.body.data.lastAvg).toBeNull();
    });

    it('averages the first and last 5 attempts once there are 6+', async () => {
      const cfg = CBAT_GAMES['angles'];
      // Scores 0..9 oldest → newest: first 5 average 2, last 5 average 7.
      for (let i = 0; i < 10; i++) {
        await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, i, daysAgo(20 - i)));
      }

      const res = await request(app).get('/api/games/cbat/angles/progress').set('Cookie', cookie);

      expect(res.body.data.firstAvg).toBe(2);
      expect(res.body.data.lastAvg).toBe(7);
    });
  });

  describe('best', () => {
    it('is the highest score for a higher-is-better game', async () => {
      const cfg = CBAT_GAMES['target'];
      await GameSessionCbatTargetResult.create(makeDoc(cfg, user._id, 100));
      await GameSessionCbatTargetResult.create(makeDoc(cfg, user._id, 250));
      await GameSessionCbatTargetResult.create(makeDoc(cfg, user._id, 180));

      const res = await request(app).get('/api/games/cbat/target/progress').set('Cookie', cookie);

      expect(res.body.data.best).toBe(250);
    });

    it('is the lowest score for a lower-is-better game', async () => {
      const cfg = CBAT_GAMES['plane-turn-2d'];
      await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg, user._id, 40));
      await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg, user._id, 18));
      await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg, user._id, 27));

      const res = await request(app).get('/api/games/cbat/plane-turn-2d/progress').set('Cookie', cookie);

      expect(res.body.data.best).toBe(18);
    });
  });

  // Recent-form percentile: the user's last-5 mean against every other user's last-5 mean.
  describe('recent-form percentile (?percentile=1)', () => {
    // Gives `user` a form of `myForm` and creates `others.length` rivals with the given forms.
    // Every entrant gets 3 runs so they clear FORM_MIN_RUNS.
    const buildCohort = async (Model, cfg, myForm, others) => {
      for (let i = 0; i < 3; i++) await Model.create(makeDoc(cfg, user._id, myForm, daysAgo(9 - i)));
      for (const [n, form] of others.entries()) {
        const rival = await createUser({ agentNumber: `20000${n}`, email: `rival${n}@test.com` });
        for (let i = 0; i < 3; i++) await Model.create(makeDoc(cfg, rival._id, form, daysAgo(9 - i)));
      }
    };

    it('is omitted unless explicitly requested, keeping it off the post-game hot path', async () => {
      const cfg = CBAT_GAMES['angles'];
      await buildCohort(GameSessionCbatAnglesResult, cfg, 10, [1, 2, 3, 4, 5]);

      const res = await request(app).get('/api/games/cbat/angles/progress').set('Cookie', cookie);

      expect(res.body.data.form).toBeNull();
    });

    it('ranks the user against the field for a higher-is-better game', async () => {
      const cfg = CBAT_GAMES['angles'];
      await buildCohort(GameSessionCbatAnglesResult, cfg, 10, [1, 2, 3, 4, 5]);

      const res = await request(app)
        .get('/api/games/cbat/angles/progress?percentile=1')
        .set('Cookie', cookie);

      // Best of 6 → ahead of 5 of them.
      expect(res.body.data.form).toMatchObject({
        percentile: 83, cohort: 6, form: 10, window: 5,
        aheadOf: 5, tiedWith: 0, betterThanMe: 0,
      });
    });

    // The case that made a real perfect-scoring user report a bug: Symbols tops out at 15/15, so a
    // big share of the field sits on a flawless recent-form average. They're tied with you, not
    // behind you, so "ahead of" can't reach 99% — and the UI needs the tie counts to explain that
    // rather than quietly understating a perfect player.
    describe('ties at a game\'s scoring ceiling', () => {
      it('counts tied agents separately instead of lumping them in as beaten', async () => {
        const cfg = CBAT_GAMES['angles'];
        // Me + 3 others all maxed out on score AND matching on time; 6 others below.
        await buildCohort(GameSessionCbatAnglesResult, cfg, 15, [15, 15, 15, 9, 8, 7, 6, 5, 4]);

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        expect(res.body.data.form).toMatchObject({
          cohort: 10,
          aheadOf: 6,        // only the six genuinely below
          tiedWith: 3,       // the three other perfect agents, identical on time too
          betterThanMe: 0,   // nobody is above — the UI celebrates rather than showing 60%
          percentile: 60,
        });
      });

      // The point of the time leg: without it, everyone at a game's ceiling is one undifferentiated
      // lump and a flawless player reports "ahead of 65%".
      it('splits agents tied at the ceiling by speed, quickest first', async () => {
        const cfg = CBAT_GAMES['angles'];
        // Six agents all averaging a perfect 15. I'm the third-quickest at 20s.
        const times = [10, 15, 20, 25, 30, 35];
        const me = times[2];
        for (let i = 0; i < 3; i++) {
          await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 15, daysAgo(9 - i), me));
        }
        for (const [n, t] of times.entries()) {
          if (t === me) continue;
          const rival = await createUser({ agentNumber: `80000${n}`, email: `q${n}@test.com` });
          for (let i = 0; i < 3; i++) {
            await GameSessionCbatAnglesResult.create(makeDoc(cfg, rival._id, 15, daysAgo(9 - i), t));
          }
        }

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        // Identical scores, so the ordering is purely the clock: two quicker, three slower.
        expect(res.body.data.form).toMatchObject({
          cohort: 6, betterThanMe: 2, aheadOf: 3, tiedWith: 0, formTime: 20,
        });
      });

      it('breaks ties on time only — a better score still outranks a quicker one', async () => {
        const cfg = CBAT_GAMES['angles'];
        // I'm slow but perfect; the rivals are quick but score less. Score must win.
        for (let i = 0; i < 3; i++) {
          await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 15, daysAgo(9 - i), 90));
        }
        for (const n of [1, 2, 3, 4, 5]) {
          const rival = await createUser({ agentNumber: `81000${n}`, email: `f${n}@test.com` });
          for (let i = 0; i < 3; i++) {
            await GameSessionCbatAnglesResult.create(makeDoc(cfg, rival._id, 12, daysAgo(9 - i), 5));
          }
        }

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        expect(res.body.data.form).toMatchObject({ betterThanMe: 0, aheadOf: 5 });
      });

      // Time is lower-is-better even when the SCORE is lower-is-better, so the two legs point in
      // opposite directions on Trace Practise — easy to get backwards.
      it('still ranks the quicker agent higher on a lower-is-better game', async () => {
        const cfg = CBAT_GAMES['plane-turn-2d'];
        // Everyone needs 20 rotations; I take 50s, the rest are quicker.
        for (let i = 0; i < 3; i++) {
          await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg, user._id, 20, daysAgo(9 - i), 50));
        }
        for (const [n, t] of [10, 20, 30, 40].entries()) {
          const rival = await createUser({ agentNumber: `82000${n}`, email: `p${n}@test.com` });
          for (let i = 0; i < 3; i++) {
            await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg, rival._id, 20, daysAgo(9 - i), t));
          }
        }

        const res = await request(app)
          .get('/api/games/cbat/plane-turn-2d/progress?percentile=1')
          .set('Cookie', cookie);

        // Slowest of five equally-efficient agents.
        expect(res.body.data.form).toMatchObject({ cohort: 5, betterThanMe: 4, aheadOf: 0 });
      });

      // Trace 1/2 default totalTime to 0, so the clock can't separate anyone — fall back to a
      // genuine tie rather than inventing an order.
      it('treats agents as tied when no time distinguishes them', async () => {
        const cfg = CBAT_GAMES['angles'];
        await buildCohort(GameSessionCbatAnglesResult, cfg, 15, [15, 15, 9, 8, 7]);

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        // buildCohort gives every run the same time, so the ceiling agents stay level.
        expect(res.body.data.form).toMatchObject({ betterThanMe: 0, tiedWith: 2, aheadOf: 3 });
      });

      it('reports a lone perfect agent as beaten by nobody and tied with nobody', async () => {
        const cfg = CBAT_GAMES['angles'];
        await buildCohort(GameSessionCbatAnglesResult, cfg, 15, [9, 8, 7, 6, 5]);

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        expect(res.body.data.form).toMatchObject({ betterThanMe: 0, tiedWith: 0, aheadOf: 5 });
      });

      it('still reports agents above when the user is mid-table with ties', async () => {
        const cfg = CBAT_GAMES['angles'];
        await buildCohort(GameSessionCbatAnglesResult, cfg, 10, [15, 15, 10, 10, 4, 3]);

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        expect(res.body.data.form).toMatchObject({
          cohort: 7, betterThanMe: 2, tiedWith: 2, aheadOf: 2,
        });
      });

      // Forms are $avg floats: 12.4 and 12.400000000000002 are the same form, not a tie broken by
      // float noise.
      it('treats forms equal to 2dp as tied', async () => {
        const cfg = CBAT_GAMES['angles'];
        // Both average 12.4 — mine as 12+13+12+12+13, theirs as 13+12+13+12+12 over 5 runs.
        const mine = [12, 13, 12, 12, 13];
        const theirs = [13, 12, 13, 12, 12];
        for (const [i, s] of mine.entries()) {
          await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, s, daysAgo(9 - i)));
        }
        for (const n of [1, 2, 3, 4]) {
          const rival = await createUser({ agentNumber: `70000${n}`, email: `u${n}@test.com` });
          const scores = n === 1 ? theirs : [1, 1, 1, 1, 1];
          for (const [i, s] of scores.entries()) {
            await GameSessionCbatAnglesResult.create(makeDoc(cfg, rival._id, s, daysAgo(9 - i)));
          }
        }

        const res = await request(app)
          .get('/api/games/cbat/angles/progress?percentile=1')
          .set('Cookie', cookie);

        expect(res.body.data.form.tiedWith).toBe(1);
        expect(res.body.data.form.betterThanMe).toBe(0);
      });
    });

    // Trace Practise scores rotations: a LOWER form is better, so the ranking has to flip.
    it('flips the ranking direction for a lower-is-better game', async () => {
      const cfg = CBAT_GAMES['plane-turn-2d'];
      await buildCohort(GameSessionCbatPlaneTurnResult, cfg, 10, [20, 30, 40, 50, 60]);

      const res = await request(app)
        .get('/api/games/cbat/plane-turn-2d/progress?percentile=1')
        .set('Cookie', cookie);

      // Fewest rotations of the 6 → still ahead of 5, not behind them.
      expect(res.body.data.form.percentile).toBe(83);
    });

    it('averages only the most recent runs, so old bad form stops counting', async () => {
      const cfg = CBAT_GAMES['angles'];
      // Five terrible runs, then five good ones. Lifetime average is 50; current form is 100.
      for (let i = 0; i < 5; i++) await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 0, daysAgo(20 - i)));
      for (let i = 0; i < 5; i++) await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 100, daysAgo(10 - i)));
      for (const n of [1, 2, 3, 4]) {
        const rival = await createUser({ agentNumber: `30000${n}`, email: `r${n}@test.com` });
        for (let i = 0; i < 3; i++) await GameSessionCbatAnglesResult.create(makeDoc(cfg, rival._id, 50, daysAgo(9 - i)));
      }

      const res = await request(app)
        .get('/api/games/cbat/angles/progress?percentile=1')
        .set('Cookie', cookie);

      expect(res.body.data.form.form).toBe(100);
      expect(res.body.data.form.percentile).toBe(80);   // ahead of all 4 rivals, out of 5
    });

    it('leaves users with too few runs out of the cohort', async () => {
      const cfg = CBAT_GAMES['angles'];
      await buildCohort(GameSessionCbatAnglesResult, cfg, 10, [1, 2, 3, 4]);  // 5 ranked agents
      // Three more agents with a single run each — not enough form to be ranked.
      for (const n of [7, 8, 9]) {
        const casual = await createUser({ agentNumber: `40000${n}`, email: `c${n}@test.com` });
        await GameSessionCbatAnglesResult.create(makeDoc(cfg, casual._id, 99));
      }

      const res = await request(app)
        .get('/api/games/cbat/angles/progress?percentile=1')
        .set('Cookie', cookie);

      expect(res.body.data.form.cohort).toBe(5);
    });

    it('withholds a percentile when the cohort is too small to mean anything', async () => {
      const cfg = CBAT_GAMES['angles'];
      await buildCohort(GameSessionCbatAnglesResult, cfg, 10, [1, 2]);  // 3 agents, below the floor

      const res = await request(app)
        .get('/api/games/cbat/angles/progress?percentile=1')
        .set('Cookie', cookie);

      expect(res.body.data.form).toBeNull();
    });

    it('withholds a percentile when the user themselves has too few runs to rank', async () => {
      const cfg = CBAT_GAMES['angles'];
      for (const n of [1, 2, 3, 4, 5]) {
        const rival = await createUser({ agentNumber: `50000${n}`, email: `s${n}@test.com` });
        for (let i = 0; i < 3; i++) await GameSessionCbatAnglesResult.create(makeDoc(cfg, rival._id, 5, daysAgo(9 - i)));
      }
      await GameSessionCbatAnglesResult.create(makeDoc(cfg, user._id, 10));  // just one run

      const res = await request(app)
        .get('/api/games/cbat/angles/progress?percentile=1')
        .set('Cookie', cookie);

      expect(res.body.data.form).toBeNull();
    });

    it('keeps plane-turn 2d and 3d cohorts separate', async () => {
      const cfg2d = CBAT_GAMES['plane-turn-2d'];
      const cfg3d = CBAT_GAMES['plane-turn-3d'];
      await buildCohort(GameSessionCbatPlaneTurnResult, cfg2d, 10, [20, 30, 40, 50, 60]);
      // A crowd of 3D-only players must not dilute the 2D cohort.
      for (const n of [1, 2, 3, 4, 5, 6]) {
        const rival = await createUser({ agentNumber: `60000${n}`, email: `t${n}@test.com` });
        for (let i = 0; i < 3; i++) await GameSessionCbatPlaneTurnResult.create(makeDoc(cfg3d, rival._id, 5, daysAgo(9 - i)));
      }

      const res = await request(app)
        .get('/api/games/cbat/plane-turn-2d/progress?percentile=1')
        .set('Cookie', cookie);

      expect(res.body.data.form.cohort).toBe(6);
    });
  });

  it('rejects an unknown game key', async () => {
    const res = await request(app).get('/api/games/cbat/not-a-game/progress').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/games/cbat/angles/progress');
    expect(res.status).toBe(401);
  });
});
