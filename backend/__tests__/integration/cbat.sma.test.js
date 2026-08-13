// Submit / leaderboard / personal-best wiring for the Sensory Motor Apparatus
// Test, and the one thing about it that is not shared with every other split
// game: SMA's two difficulties differ in the TOLERANCE RING as well as the
// clock, so their scores are not on one scale and a run must never reach the
// sibling board.

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const AppSettings = require('../../models/AppSettings');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const { CBAT_GAMES, cbatLabelWithDifficulty } = require('../../constants/cbatGames');
const { WEEKLY_PER_PLAY } = require('../../utils/cbatFakeLeaderboard');
const batteries = require('../../constants/cbatBatteries.json');
const { SCORED_GAME_KEYS } = require('../../constants/cbatBatteries');
const { FORM_MIN_RUNS } = require('../../utils/cbatAptitudeReport');

const KEYS = ['sma', 'sma-easier'];

// The three percentages ride alongside the score because they are what a real
// tracking apparatus is measured on — see the model.
const BODY = {
  sma:          { totalScore: 341, onTargetPct: 61, rmsErrorPct: 14, worstErrorPct: 58, totalTime: 62.5 },
  'sma-easier': { totalScore: 187, onTargetPct: 72, rmsErrorPct: 19, worstErrorPct: 47, totalTime: 32.5 },
};

let user, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CBAT Sensory Motor Apparatus Test', () => {

  it('registers both difficulties in the shared registry, higher-is-better', () => {
    for (const key of KEYS) {
      expect([key, !!CBAT_GAMES[key]]).toEqual([key, true]);
      expect([key, CBAT_GAMES[key].primaryField]).toEqual([key, 'totalScore']);
      expect([key, CBAT_GAMES[key].sortDir]).toEqual([key, -1]);
    }
  });

  it('names both halves, so a bare "SMA" is never ambiguous', () => {
    expect(cbatLabelWithDifficulty('sma')).toBe('Sensory Motor Apparatus Test (Hard)');
    expect(cbatLabelWithDifficulty('sma-easier')).toBe('Sensory Motor Apparatus Test (Easier)');
  });

  it.each(KEYS)('accepts a result on %s and reads it back as a personal best', async (gameKey) => {
    const post = await request(app)
      .post(`/api/games/cbat/${gameKey}/result`)
      .set('Cookie', cookie)
      .send(BODY[gameKey]);
    expect([gameKey, post.status]).toEqual([gameKey, 201]);
    expect([gameKey, post.body.data.totalScore]).toEqual([gameKey, BODY[gameKey].totalScore]);

    const best = await request(app)
      .get(`/api/games/cbat/${gameKey}/personal-best`)
      .set('Cookie', cookie);
    expect([gameKey, best.status]).toEqual([gameKey, 200]);
    expect([gameKey, best.body.data.bestScore]).toEqual([gameKey, BODY[gameKey].totalScore]);
    expect([gameKey, best.body.data.attempts]).toEqual([gameKey, 1]);
  });

  it.each(KEYS)('stores the tracking measurements alongside the score on %s', async (gameKey) => {
    // The score is a SkyWatch construction and could be retuned; these three are
    // the measurements that stay meaningful if it ever is.
    const res = await request(app)
      .post(`/api/games/cbat/${gameKey}/result`)
      .set('Cookie', cookie)
      .send(BODY[gameKey]);
    expect([gameKey, res.body.data.onTargetPct]).toEqual([gameKey, BODY[gameKey].onTargetPct]);
    expect([gameKey, res.body.data.rmsErrorPct]).toEqual([gameKey, BODY[gameKey].rmsErrorPct]);
    expect([gameKey, res.body.data.worstErrorPct]).toEqual([gameKey, BODY[gameKey].worstErrorPct]);
  });

  it('defaults a missing score to zero rather than rejecting the run', async () => {
    // A run really can end on nothing — the dot pinned outside the ring the
    // whole way scores exactly zero, and that is a result, not a bad request.
    const res = await request(app)
      .post('/api/games/cbat/sma/result')
      .set('Cookie', cookie)
      .send({ onTargetPct: 0, rmsErrorPct: 88, worstErrorPct: 100, totalTime: 62.5 });
    expect(res.status).toBe(201);
    expect(res.body.data.totalScore).toBe(0);
  });

  it('keeps the two difficulties in separate collections', async () => {
    // Easier's ring is 0.24 of the display radius against Hard's 0.16, so the
    // same physical tracking earns more points there. One shared board would
    // rank an Easier run above a better Hard one.
    await request(app).post('/api/games/cbat/sma/result').set('Cookie', cookie).send(BODY.sma);

    expect(await CBAT_GAMES['sma'].Model.countDocuments({})).toBe(1);
    expect(await CBAT_GAMES['sma-easier'].Model.countDocuments({})).toBe(0);

    const easierBest = await request(app)
      .get('/api/games/cbat/sma-easier/personal-best')
      .set('Cookie', cookie);
    expect(easierBest.body.data).toBeNull();
  });

  it.each(KEYS)('serves a demo-padded leaderboard for %s', async (gameKey) => {
    await request(app)
      .post(`/api/games/cbat/${gameKey}/result`)
      .set('Cookie', cookie)
      .send(BODY[gameKey]);

    const res = await request(app)
      .get(`/api/games/cbat/${gameKey}/leaderboard`)
      .set('Cookie', cookie);
    expect([gameKey, res.status]).toEqual([gameKey, 200]);
    expect([gameKey, res.body.data.leaderboard.length]).toEqual([gameKey, 20]);
    expect([gameKey, res.body.data.leaderboard.some(e => e.agentNumber === '1000001')]).toEqual([gameKey, true]);
    expect([gameKey, res.body.data.myBest.bestScore]).toEqual([gameKey, BODY[gameKey].totalScore]);
  });

  it.each(KEYS)('has weekly demo tuning for %s, so a quiet week is never bare', (gameKey) => {
    expect([gameKey, typeof WEEKLY_PER_PLAY[gameKey]]).toEqual([gameKey, 'number']);
  });

  it.each(KEYS)('rejects an unauthenticated submission to %s', async (gameKey) => {
    const res = await request(app).post(`/api/games/cbat/${gameKey}/result`).send(BODY[gameKey]);
    expect([gameKey, res.status]).toEqual([gameKey, 401]);
  });
});

describe('SMA has an admin enable/disable toggle that works end to end', () => {
  // Three pieces have to line up or the toggle flips on screen, saves with a
  // 200, and does nothing: the key must be in CBAT_KNOWN_KEYS (or the PATCH
  // drops it silently as legacy), in the AppSettings default map, and read back
  // by the game guard. The frontend half — that a row is rendered at all — is
  // covered by src/data/__tests__/cbatAdminGames.test.js.
  it('seeds both difficulties as enabled by default', async () => {
    const settings = await AppSettings.getSettings();
    expect(settings.cbatGameEnabled.get('sma')).toBe(true);
    expect(settings.cbatGameEnabled.get('sma-easier')).toBe(true);
  });

  it.each(KEYS)('persists an admin disabling %s', async (gameKey) => {
    const admin = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test', cbatGameEnabled: { [gameKey]: false } });
    expect([gameKey, res.status]).toEqual([gameKey, 200]);

    const settings = await AppSettings.findOne();
    // A key the validator did not recognise would be dropped rather than
    // stored, so `false` here is the whole assertion.
    expect([gameKey, settings.cbatGameEnabled.get(gameKey)]).toEqual([gameKey, false]);
  });

  it('surfaces the toggle state on the public settings the guard reads', async () => {
    const admin = await createAdminUser();
    await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test', cbatGameEnabled: { sma: false } });

    // AppSettingsContext uses the whole body as `settings`, and CbatGameGuard
    // reads settings.cbatGameEnabled off that — so this is the exact shape the
    // guard sees, not a convenient projection of it.
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.cbatGameEnabled.sma).toBe(false);
    expect(res.body.cbatGameEnabled['sma-easier']).toBe(true);
  });
});

describe('SMA closes the Psychomotor gap in the Aptitude Report', () => {
  it('maps the SMA test code at the Hard board', () => {
    // SMA was the largest single uncovered weight left on the report: 15% of the
    // Pilot battery and 12% of Pilot ISR (RPAS). Only the Hard key is mapped —
    // Easier's wider ring pays more per second, so feeding it in would inflate
    // the estimate.
    expect(batteries.tests.SMA.games).toEqual(['sma']);
    expect(batteries.tests.SMA.match).toBe('direct');
    expect(batteries.tests['SMA'].games.every(g => !g.endsWith('-easier'))).toBe(true);
  });

  it('anchors the SMA stanine scale', () => {
    const a = batteries.stanineAnchors.sma;
    expect(a).toBeDefined();
    expect(a.strong).toBeGreaterThan(a.median);
    // Both have to sit under a perfect Hard run (60 scored seconds × 10).
    expect(a.strong).toBeLessThan(600);
  });

  it('pulls sma into the set of games the report queries', () => {
    // SCORED_GAME_KEYS bounds the form load. A test mapped to a game that is not
    // in here would be reported as never played however much the user played it.
    expect(SCORED_GAME_KEYS).toContain('sma');
    expect(SCORED_GAME_KEYS).not.toContain('sma-easier');
  });

  it('leaves the Pilot battery with no uncovered test in its Psychomotor domain', () => {
    const pilot = batteries.batteries.find(b => b.key === 'pilot');
    const psych = pilot.domains.find(d => d.key === 'Psych');
    for (const t of psych.tests) {
      expect([t.code, batteries.tests[t.code].games.length > 0]).toEqual([t.code, true]);
    }
  });

  const playSma = async (gameKey, score, times = FORM_MIN_RUNS) => {
    for (let i = 0; i < times; i++) {
      await CBAT_GAMES[gameKey].Model.create({
        userId: user._id, totalScore: score, onTargetPct: 50,
        rmsErrorPct: 20, worstErrorPct: 60, totalTime: 62.5,
      });
    }
  };

  const psychOf = async () => {
    const res = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);
    return res.body.data.domains.find(d => d.key === 'Psych').tests.find(t => t.code === 'SMA');
  };

  it('asks for runs before it scores anyone', async () => {
    await playSma('sma', 280, FORM_MIN_RUNS - 1);
    const sma = await psychOf();
    expect(sma.state).toBe('needs-runs');
    expect(sma.stanine).toBeNull();
    expect(sma.needsRuns[0].gameKey).toBe('sma');
    expect(sma.needsRuns[0].runsNeeded).toBe(1);
  });

  it('scores the Psychomotor domain off real SMA runs, and a strong run higher', async () => {
    await playSma('sma', batteries.stanineAnchors.sma.median);
    const middling = await psychOf();
    expect(middling.state).toBe('scored');
    // The median anchor is stanine 5 by definition of the scale.
    expect(middling.stanine).toBeCloseTo(5, 1);

    await CBAT_GAMES['sma'].Model.deleteMany({});
    await playSma('sma', batteries.stanineAnchors.sma.strong);
    const strong = await psychOf();
    expect(strong.stanine).toBeGreaterThan(middling.stanine);
  });

  it('ignores Easier runs and says why', async () => {
    // Same rule every other split game follows: the real CBAT has one
    // difficulty, and SMA's Easier ring pays more per second, so folding those
    // runs in would inflate the estimate rather than merely widen it.
    await playSma('sma-easier', 220, FORM_MIN_RUNS + 2);
    const sma = await psychOf();
    expect(sma.state).toBe('easier-only');
    expect(sma.stanine).toBeNull();
  });

  it('lifts the Pilot coverage now that Psychomotor can be measured', async () => {
    const before = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);
    await playSma('sma', 280);
    const after = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);
    // Psychomotor is 15% of Pilot and SMA is half of it, so measuring SMA is
    // worth 7-8 points of coverage on its own.
    expect(after.body.data.coverage).toBeGreaterThan(before.body.data.coverage);
  });
});
