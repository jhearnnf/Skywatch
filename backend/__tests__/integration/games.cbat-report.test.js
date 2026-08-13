process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

const User = require('../../models/User');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const { BATTERIES, STANINE_ANCHORS, SCORED_GAME_KEYS, MAX_SCORE, MIN_COVERAGE_FOR_VERDICT } = require('../../constants/cbatBatteries');
const { FORM_MIN_RUNS } = require('../../utils/cbatAptitudeReport');

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Same superset-of-required-fields shape the progress tests use: mongoose strict mode drops what
// a given schema doesn't declare, so one doc covers every result model.
const makeDoc = (cfg, userId, score) => ({
  userId,
  [cfg.primaryField]: score,
  totalTime: 30,
  roundsPlayed: 5,
  score,
  ...(cfg.modeFilter ?? {}),
});

// Give the user `runs` results on `gameKey`, all at the score `pick` returns for that game's
// anchors — so the whole report can be driven to a known stanine.
async function play(gameKey, pick, runs = FORM_MIN_RUNS) {
  const cfg = CBAT_GAMES[gameKey];
  const score = pick(STANINE_ANCHORS[gameKey]);
  for (let i = 0; i < runs; i++) await cfg.Model.create(makeDoc(cfg, user._id, score));
}

const playAll = (pick, runs) => Promise.all(SCORED_GAME_KEYS.map(k => play(k, pick, runs)));

describe('GET /api/games/cbat/report', () => {
  it('requires a signed-in user', async () => {
    const res = await request(app).get('/api/games/cbat/report');
    expect(res.status).toBe(401);
  });

  it('scores every battery, with nulls before any play', async () => {
    const res = await request(app).get('/api/games/cbat/report').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.batteries).toHaveLength(BATTERIES.length);
    for (const b of res.body.data.batteries) {
      expect([b.key, b.score]).toEqual([b.key, null]);
      expect([b.key, b.status]).toEqual([b.key, 'unscored']);
      expect([b.key, b.coverage]).toEqual([b.key, 0]);
    }
  });

  it('reports the user\'s saved target role', async () => {
    await User.findByIdAndUpdate(user._id, { cbatTargetBattery: 'pilot' });
    const res = await request(app).get('/api/games/cbat/report').set('Cookie', cookie);
    expect(res.body.data.targetBattery).toBe('pilot');
  });
});

describe('GET /api/games/cbat/report/:batteryKey', () => {
  it('404s on a role that does not exist', async () => {
    const res = await request(app).get('/api/games/cbat/report/astronaut').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('responds for every battery in the roster', async () => {
    // The route resolves its battery from the shared JSON at call time, so a newly transcribed
    // role should work with no extra wiring. This catches one that references a broken game.
    for (const b of BATTERIES) {
      const res = await request(app).get(`/api/games/cbat/report/${b.key}`).set('Cookie', cookie);
      expect([b.key, res.status]).toEqual([b.key, 200]);
      expect([b.key, res.body.data.cutoff]).toEqual([b.key, b.cutoff]);
      expect([b.key, res.body.data.domains.length]).toEqual([b.key, b.domains.length]);
    }
  });

  it('scores median play at exactly 100 and strong play at 160', async () => {
    // 5/9 and 8/9 of 180. This is the whole scoring chain — anchors → test stanine → domain mean →
    // weighted battery score — pinned to two numbers that can be checked by hand.
    await playAll(a => a.median);
    let res = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);
    expect(res.body.data.score).toBe(100);
    expect(res.body.data.status).toBe('fail');           // Pilot's cutoff is 112
    expect(res.body.data.margin).toBe(100 - 112);

    await db.clearDatabase();
    await createSettings();
    user   = await createUser({ agentNumber: '1000002' });
    cookie = authCookie(user._id);

    await playAll(a => a.strong);
    res = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);
    expect(res.body.data.score).toBe(160);
    expect(res.body.data.status).toBe('pass');
    expect(res.body.data.margin).toBe(160 - 112);
  });

  it('passes the same play on a low cutoff and fails it on a high one', async () => {
    // The point of the role picker: identical practice clears NCO Control (ATC) at 80 and misses
    // Pilot at 112.
    await playAll(a => a.median);

    const nco = await request(app).get('/api/games/cbat/report/nco-control-atc').set('Cookie', cookie);
    const pilot = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);

    expect(nco.body.data.status).toBe('pass');
    expect(pilot.body.data.status).toBe('fail');
  });

  it('needs three runs before a test counts', async () => {
    // Control Officer (ATC) is 49% CUT+SAT. Two runs of each is below the floor, so nothing in
    // Strategic Task Management scores and the domain drops out entirely.
    await play('cut', a => a.median, FORM_MIN_RUNS - 1);
    await play('sat', a => a.median, FORM_MIN_RUNS - 1);

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const strgc = res.body.data.domains.find(d => d.key === 'StrgcTM');

    expect(strgc.stanine).toBeNull();
    expect(strgc.coverage).toBe(0);
    expect(strgc.tests.every(t => t.state === 'needs-runs')).toBe(true);
    expect(strgc.tests[0].needsRuns[0].runsNeeded).toBe(1);
  });

  it('refuses to call a pass or a fail on thin coverage', async () => {
    // CUT and SAT alone are 49% of Control Officer (ATC). Renormalised, that scores 100 against a
    // pass mark of 90 — a confident PASS off half the evidence. The floor is what stops the page
    // telling someone they are through on that.
    await play('cut', a => a.median);
    await play('sat', a => a.median);

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);

    expect(res.body.data.coverage).toBeLessThan(MIN_COVERAGE_FOR_VERDICT);
    expect(res.body.data.status).toBe('provisional');
    // The arithmetic is still returned; it just isn't a verdict.
    expect(res.body.data.score).toBe(100);
    expect(res.body.data.score).toBeGreaterThan(res.body.data.cutoff);
  });

  it('gives a verdict once coverage clears the floor', async () => {
    await playAll(a => a.median);
    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);

    expect(res.body.data.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE_FOR_VERDICT);
    expect(res.body.data.status).toBe('pass');
  });

  it('never counts a provisional battery as a role passed', async () => {
    // The admin picker's green pill counts 'pass' only, so a thin report must not inflate it.
    await play('cut', a => a.median);
    await play('sat', a => a.median);

    const res = await request(app).get('/api/games/cbat/report').set('Cookie', cookie);
    const provisional = res.body.data.batteries.filter(b => b.status === 'provisional');

    expect(provisional.length).toBeGreaterThan(0);
    for (const b of provisional) expect(b.status).not.toBe('pass');
  });

  it('renormalises the score over the weight it actually measured', async () => {
    // Only CUT and SAT played — that's all of Strategic Task Management and nothing else. The
    // score must report what that domain implies (median → 100), not a total dragged toward zero
    // by five unmeasured domains.
    await play('cut', a => a.median);
    await play('sat', a => a.median);

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);

    expect(res.body.data.score).toBe(100);
    // 49 of 100 weight measured — the caveat the UI leads the score with.
    expect(res.body.data.coverage).toBe(49);
  });

  it('scores a mixed Hard and Easier history on the Hard runs alone', async () => {
    // The case a real player is actually in: some runs on each difficulty. The Easier ones are set
    // to a score that would clamp the stanine to 9 if they leaked in, so a stanine of exactly 5
    // proves only the Hard runs were read.
    await play('cut', a => a.median);                    // 3 Hard runs at the median
    const easier = CBAT_GAMES['cut-easier'];
    for (let i = 0; i < 10; i++) {
      await easier.Model.create(makeDoc(easier, user._id, 100_000));
    }

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const cut = res.body.data.domains.find(d => d.key === 'StrgcTM').tests.find(t => t.code === 'CUT');

    expect(cut.state).toBe('scored');
    expect(cut.stanine).toBe(5);
    expect(cut.played[0].runs).toBe(3);                  // the 10 Easier runs are not in the window
    expect(cut.played[0].form).toBe(STANINE_ANCHORS.cut.median);
  });

  it('does not let Easier runs satisfy the three-run minimum', async () => {
    // Two Hard runs is below the floor. Ten Easier ones must not top it up.
    await play('cut', a => a.median, FORM_MIN_RUNS - 1);
    const easier = CBAT_GAMES['cut-easier'];
    for (let i = 0; i < 10; i++) await easier.Model.create(makeDoc(easier, user._id, 400));

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const cut = res.body.data.domains.find(d => d.key === 'StrgcTM').tests.find(t => t.code === 'CUT');

    expect(cut.state).toBe('needs-runs');
    expect(cut.stanine).toBeNull();
    expect(cut.needsRuns[0].runsNeeded).toBe(1);
  });

  it('ignores Easier runs and says why', async () => {
    const easier = CBAT_GAMES['cut-easier'];
    for (let i = 0; i < 5; i++) await easier.Model.create(makeDoc(easier, user._id, 400));

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const cut = res.body.data.domains.find(d => d.key === 'StrgcTM').tests.find(t => t.code === 'CUT');

    expect(cut.state).toBe('easier-only');
    expect(cut.stanine).toBeNull();
  });

  it('reports no gaps on a battery every test of which now has a game', async () => {
    // Control Officer (ATC) used to list MATF and SIT as gaps. Both now have games (the Table
    // Reading Test and the Spatial Integration Test), so this battery is fully covered and the
    // report has nothing to disclaim. TRT was never a gap — the Target game simulates it.
    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    expect(res.body.data.gaps).toEqual([]);
  });

  it('lists uncovered tests as gaps rather than scoring them', async () => {
    // Operations Officer is the battery still carrying a gap: RCOG (Recognition) has no game.
    // Kept as a live assertion so the gap mechanism stays covered now that most batteries have
    // none — Pilot lost its last one when SMA was built (see below).
    const res = await request(app).get('/api/games/cbat/report/operations-officer').set('Cookie', cookie);
    const codes = res.body.data.gaps.map(g => g.code).sort();

    expect(codes).toEqual(['RCOG']);
    // Never double-listed, even where a code appears in two domains.
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('reports no gaps on Pilot now that SMA has a game', async () => {
    // SMA was the last uncovered test in the Pilot battery and by some way the largest — it is
    // 15% of the score, sharing the Psychomotor domain with RTT. Until the game existed every
    // Pilot report renormalised over a missing seventh of its evidence.
    const res = await request(app).get('/api/games/cbat/report/pilot').set('Cookie', cookie);
    expect(res.body.data.gaps).toEqual([]);
  });

  it('ranks focus by what a stanine is worth, not by how far behind the user is', async () => {
    // On Control Officer (ATC), StrgcTM carries 49% and SymR 10%. A user level across the board
    // must still be pointed at CUT/SAT before NOP.
    await playAll(a => a.median);

    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const focus = res.body.data.focus;

    expect(focus.length).toBeGreaterThan(0);
    expect(focus.map(f => f.gain)).toEqual([...focus.map(f => f.gain)].sort((a, b) => b - a));
    expect(focus.slice(0, 2).map(f => f.code).sort()).toEqual(['CUT', 'SAT']);
    // Gains are in score points, so they must be a sane fraction of the 180-point scale.
    for (const f of focus) expect(f.gain).toBeLessThan(MAX_SCORE);
  });

  it('offers a concrete score to aim at for the next stanine', async () => {
    await play('cut', a => a.median);
    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const cut = res.body.data.domains.find(d => d.key === 'StrgcTM').tests.find(t => t.code === 'CUT');

    expect(cut.state).toBe('scored');
    expect(cut.stanine).toBe(5);
    expect(cut.nextTarget.stanine).toBe(6);
    // Strictly above the median they're currently averaging, or it isn't a target.
    expect(cut.nextTarget.score).toBeGreaterThan(STANINE_ANCHORS.cut.median);
  });

  it('tops out at 9 with nothing left to aim for', async () => {
    await play('cut', () => 100_000);
    const res = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', cookie);
    const cut = res.body.data.domains.find(d => d.key === 'StrgcTM').tests.find(t => t.code === 'CUT');

    expect(cut.stanine).toBe(9);
    expect(cut.nextTarget).toBeNull();
    // A maxed-out test is not something to work on, so it drops off the focus list.
    expect(res.body.data.focus.some(f => f.kind === 'improve' && f.code === 'CUT')).toBe(false);
  });

  it('scores a test on whichever of its games the user has played', async () => {
    // VISS is fed by Visualisation 2D and 3D. Playing only one must still score it.
    await play('visualisation-2d', a => a.median);

    const res = await request(app).get('/api/games/cbat/report/wsop-isr').set('Cookie', cookie);
    const viss = res.body.data.domains.find(d => d.key === 'Percpt').tests.find(t => t.code === 'VISS');

    expect(viss.state).toBe('scored');
    expect(viss.played).toHaveLength(1);
    expect(viss.played[0].gameKey).toBe('visualisation-2d');
  });

  it('never reports a score outside the scale', async () => {
    await playAll(() => 10_000_000);
    for (const b of BATTERIES) {
      const res = await request(app).get(`/api/games/cbat/report/${b.key}`).set('Cookie', cookie);
      // Every test clamps to stanine 9, so the weighted mean is 9 and the score is the full 180.
      expect([b.key, res.body.data.score]).toEqual([b.key, MAX_SCORE]);
    }
  });
});

describe('admin: reading another player\'s report', () => {
  let admin, adminCookie, player;

  beforeEach(async () => {
    admin       = await createUser({ agentNumber: '9000001', isAdmin: true });
    adminCookie = authCookie(admin._id);
    player      = await createUser({ agentNumber: '1000009' });
  });

  const playAs = async (userId, gameKey, score, runs = FORM_MIN_RUNS) => {
    const cfg = CBAT_GAMES[gameKey];
    for (let i = 0; i < runs; i++) await cfg.Model.create(makeDoc(cfg, userId, score));
  };

  it('serves the target user\'s numbers, not the admin\'s', async () => {
    // The player has form; the admin has none. Getting a score back at all proves whose rows were
    // read.
    await playAs(player._id, 'cut', STANINE_ANCHORS.cut.median);
    await playAs(player._id, 'sat', STANINE_ANCHORS.sat.median);

    const mine = await request(app).get('/api/games/cbat/report/control-officer-atc').set('Cookie', adminCookie);
    const theirs = await request(app)
      .get(`/api/games/cbat/report/control-officer-atc?userId=${player._id}`)
      .set('Cookie', adminCookie);

    expect(mine.body.data.score).toBeNull();
    expect(theirs.body.data.score).toBe(100);
    expect(theirs.body.data.viewingAs.agentNumber).toBe('1000009');
  });

  it('reports the subject\'s target role, not the admin\'s', async () => {
    await User.findByIdAndUpdate(admin._id, { cbatTargetBattery: 'pilot' });
    await User.findByIdAndUpdate(player._id, { cbatTargetBattery: 'intelligence' });

    const res = await request(app).get(`/api/games/cbat/report?userId=${player._id}`).set('Cookie', adminCookie);

    expect(res.body.data.targetBattery).toBe('intelligence');
    expect(res.body.data.viewingAs._id).toBe(String(player._id));
  });

  it('marks a self-view with a null viewingAs', async () => {
    const res = await request(app).get('/api/games/cbat/report').set('Cookie', adminCookie);
    expect(res.body.data.viewingAs).toBeNull();
  });

  it('404s on a user id that does not resolve', async () => {
    const res = await request(app)
      .get('/api/games/cbat/report/pilot?userId=64b7f9c2e1a2b3c4d5e6f7a8')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('IGNORES ?userId from a non-admin and serves them their own report', async () => {
    // The parameter is not part of a player's contract, so it must not leak another player's
    // numbers — and must not 403 either, which would only advertise that it exists.
    await playAs(player._id, 'cut', STANINE_ANCHORS.cut.median);
    await playAs(player._id, 'sat', STANINE_ANCHORS.sat.median);

    const res = await request(app)
      .get(`/api/games/cbat/report/control-officer-atc?userId=${player._id}`)
      .set('Cookie', cookie);          // `user`, a plain player with no runs

    expect(res.status).toBe(200);
    expect(res.body.data.score).toBeNull();
    expect(res.body.data.viewingAs).toBeNull();
  });
});

describe('GET /api/games/cbat/report-users', () => {
  let admin, adminCookie;

  beforeEach(async () => {
    admin       = await createUser({ agentNumber: '9000001', isAdmin: true });
    adminCookie = authCookie(admin._id);
  });

  const playAs = async (userId, gameKey, runs) => {
    const cfg = CBAT_GAMES[gameKey];
    for (let i = 0; i < runs; i++) await cfg.Model.create(makeDoc(cfg, userId, 5));
  };

  it('is closed to non-admins', async () => {
    const res = await request(app).get('/api/games/cbat/report-users').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('ranks players by finished runs, busiest first', async () => {
    const busy  = await createUser({ agentNumber: '2000001' });
    const quiet = await createUser({ agentNumber: '2000002' });

    await playAs(busy._id, 'cut', 4);
    await playAs(busy._id, 'sat', 3);   // 7 across two games — the union must add them up
    await playAs(quiet._id, 'cut', 2);

    const res = await request(app).get('/api/games/cbat/report-users').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const rows = res.body.data.users;
    expect(rows[0].agentNumber).toBe('2000001');
    expect(rows[0].plays).toBe(7);
    expect(rows[1].agentNumber).toBe('2000002');
    expect(rows[1].plays).toBe(2);
  });

  it('counts Easier runs toward the ranking', async () => {
    // The ranking measures engagement — who is worth looking at — which is a different question
    // from the Hard-only rule the score itself follows.
    const p = await createUser({ agentNumber: '2000003' });
    await playAs(p._id, 'cut-easier', 3);

    const res = await request(app).get('/api/games/cbat/report-users').set('Cookie', adminCookie);
    expect(res.body.data.users.find(u => u.agentNumber === '2000003').plays).toBe(3);
  });

  it('searches on agent number, display name and email', async () => {
    await createUser({ agentNumber: '3141592', displayName: 'Maverick', email: 'mav@example.com' });

    for (const q of ['3141', 'maver', 'mav@ex']) {
      const res = await request(app).get(`/api/games/cbat/report-users?q=${q}`).set('Cookie', adminCookie);
      expect([q, res.body.data.users.map(u => u.agentNumber)]).toEqual([q, expect.arrayContaining(['3141592'])]);
    }
  });

  it('finds a searched player who has never played', async () => {
    // An admin looking up one specific person must find them whether or not they have a report.
    await createUser({ agentNumber: '4444444', displayName: 'Ghost' });

    const res = await request(app).get('/api/games/cbat/report-users?q=Ghost').set('Cookie', adminCookie);
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].plays).toBe(0);
  });

  it('treats punctuation in the query as literal, not as a regex', async () => {
    await createUser({ agentNumber: '5555555', displayName: 'Ace' });
    const res = await request(app).get('/api/games/cbat/report-users?q=' + encodeURIComponent('a.*(')).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(0);
  });

  it('says which listed players have chosen a role, and which have not', async () => {
    // The picker shows this before anyone is opened, and the page then opens a player on their own
    // role — both need the choice on the list itself.
    const decided   = await createUser({ agentNumber: '7000001', cbatTargetBattery: 'pilot' });
    const undecided = await createUser({ agentNumber: '7000002' });
    await playAs(decided._id, 'cut', 2);
    await playAs(undecided._id, 'cut', 1);

    const res  = await request(app).get('/api/games/cbat/report-users').set('Cookie', adminCookie);
    const rows = res.body.data.users;

    expect(rows.find(u => u.agentNumber === '7000001').targetBattery).toBe('pilot');
    expect(rows.find(u => u.agentNumber === '7000002').targetBattery).toBeNull();
  });

  it('counts how many roles each listed player clears', async () => {
    // Median play across every scorable game scores 100 — which clears the ten roles with a cutoff
    // of 80/90/95/100 and misses Pilot (112). The exact split matters less than the two facts the
    // pill relies on: it is non-zero for a capable player, and it is not simply "all roles".
    const capable = await createUser({ agentNumber: '6000001' });
    for (const gameKey of SCORED_GAME_KEYS) {
      const cfg = CBAT_GAMES[gameKey];
      for (let i = 0; i < FORM_MIN_RUNS; i++) {
        await cfg.Model.create(makeDoc(cfg, capable._id, STANINE_ANCHORS[gameKey].median));
      }
    }

    const res = await request(app).get('/api/games/cbat/report-users').set('Cookie', adminCookie);
    const row = res.body.data.users.find(u => u.agentNumber === '6000001');

    expect(row.totalRoles).toBe(BATTERIES.length);
    expect(row.rolesPassed).toBeGreaterThan(0);
    expect(row.rolesPassed).toBeLessThan(BATTERIES.length);

    // Cross-checked against the per-role endpoint, so the pill can never drift from the report it
    // is advertising.
    let counted = 0;
    for (const b of BATTERIES) {
      const one = await request(app)
        .get(`/api/games/cbat/report/${b.key}?userId=${capable._id}`)
        .set('Cookie', adminCookie);
      if (one.body.data.status === 'pass') counted++;
    }
    expect(row.rolesPassed).toBe(counted);
  });

  it('reports zero roles for a player with runs but not enough of them', async () => {
    // Two runs of everything is below the three-run floor, so nothing scores and nothing passes —
    // the case the red pill exists for.
    const dabbler = await createUser({ agentNumber: '6000002' });
    for (const gameKey of SCORED_GAME_KEYS) {
      const cfg = CBAT_GAMES[gameKey];
      for (let i = 0; i < FORM_MIN_RUNS - 1; i++) {
        await cfg.Model.create(makeDoc(cfg, dabbler._id, STANINE_ANCHORS[gameKey].median));
      }
    }

    const res = await request(app).get('/api/games/cbat/report-users').set('Cookie', adminCookie);
    const row = res.body.data.users.find(u => u.agentNumber === '6000002');

    expect(row.plays).toBeGreaterThan(0);
    expect(row.rolesPassed).toBe(0);
  });

  it('reports zero roles for a searched player who has never played', async () => {
    await createUser({ agentNumber: '6000003', displayName: 'Ghost2' });
    const res = await request(app).get('/api/games/cbat/report-users?q=Ghost2').set('Cookie', adminCookie);
    expect(res.body.data.users[0].rolesPassed).toBe(0);
  });

  it('returns nothing when the search matches nobody', async () => {
    const res = await request(app).get('/api/games/cbat/report-users?q=zzzznobody').set('Cookie', adminCookie);
    expect(res.body.data.users).toEqual([]);
  });
});

describe('PATCH /api/users/me/target-battery', () => {
  it('saves a valid role and clears on null', async () => {
    let res = await request(app)
      .patch('/api/users/me/target-battery')
      .set('Cookie', cookie)
      .send({ batteryKey: 'control-officer-atc' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.cbatTargetBattery).toBe('control-officer-atc');

    res = await request(app)
      .patch('/api/users/me/target-battery')
      .set('Cookie', cookie)
      .send({ batteryKey: null });

    expect(res.status).toBe(200);
    expect(res.body.data.user.cbatTargetBattery).toBeNull();
  });

  it('rejects an unknown role', async () => {
    const res = await request(app)
      .patch('/api/users/me/target-battery')
      .set('Cookie', cookie)
      .send({ batteryKey: 'astronaut' });

    expect(res.status).toBe(400);
    expect((await User.findById(user._id)).cbatTargetBattery).toBeNull();
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).patch('/api/users/me/target-battery').send({ batteryKey: 'pilot' });
    expect(res.status).toBe(401);
  });
});
