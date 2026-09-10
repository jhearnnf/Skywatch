/**
 * Admin — Users list tests
 *
 * Covers GET /api/admin/users, GET /api/admin/users/stats and
 * GET /api/admin/users/search:
 *   auth guards
 *   the list is deliberately unenriched — counted stats come from /users/stats
 *   profileStats.brifsRead — counts only completed: true reads, isolated per user
 */
process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createSettings, authCookie,
} = require('../helpers/factories');
const IntelligenceBriefRead  = require('../../models/IntelligenceBriefRead');
const { CBAT_GAMES }         = require('../../constants/cbatGames');
const GameSessionCbatStart   = require('../../models/GameSessionCbatStart');
const User     = require('../../models/User');
const mongoose = require('mongoose');

// Minimal payload satisfying the union of required fields across every CBAT
// schema. If a new CBAT game adds a required field not listed here, tests that
// seed these docs will fail loudly — signalling the helper needs updating.
// Extra keys are ignored by Mongoose strict mode on schemas that don't declare
// them, so this stays safe across the registry.
// modeFilter is spread in so split-game registry entries (e.g. plane-turn-2d
// and plane-turn-3d share one collection but require mode='2d'/'3d') seed docs
// that match their cfg's filter.
function seedCbatDoc(cfg, userId) {
  return cfg.Model.create({
    userId,
    [cfg.primaryField]: 1,
    totalTime: 1,
    ...(cfg.modeFilter ?? {}),
    roundsPlayed: 1,
    score: 0, // required by GameSessionCbatTrace1Result; stripped by others
  });
}

// The counted half of a Users row, asked for the way the list asks for it when
// an admin expands one — see GET /api/admin/users/stats.
async function statsFor(admin, users) {
  const ids = [].concat(users).map(u => u._id.toString()).join(',');
  return request(app)
    .get(`/api/admin/users/stats?ids=${ids}`)
    .set('Cookie', authCookie(admin._id));
}

// ── lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── auth guards ───────────────────────────────────────────────────────────────

describe('GET /api/admin/users — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── stale streak sweep ───────────────────────────────────────────────────────

describe('GET /api/admin/users — stale streak sweep', () => {
  it('zeros loginStreak on users whose lastStreakDate is older than yesterday', async () => {
    const admin  = await createAdminUser();
    const today  = new Date();
    const week   = new Date(Date.now() - 7 * 86400000);
    const fresh  = await createUser({ loginStreak: 4, lastStreakDate: today });
    const stale  = await createUser({ loginStreak: 1, lastStreakDate: week });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const byId   = Object.fromEntries(res.body.data.users.map(u => [u._id.toString(), u]));
    expect(byId[fresh._id.toString()].loginStreak).toBe(4);
    expect(byId[stale._id.toString()].loginStreak).toBe(0);

    // Sweep is persistent — re-reading the doc shows the cleared value
    const User = require('../../models/User');
    const reloaded = await User.findById(stale._id);
    expect(reloaded.loginStreak).toBe(0);
  });
});

// ── sort order ────────────────────────────────────────────────────────────────

describe('GET /api/admin/users — sort order', () => {
  it('places admins before non-admins regardless of registration date', async () => {
    // Seed three non-admins with old createdAt and one admin with new createdAt;
    // admin must still appear ahead of all of them.
    const oldDate = new Date('2020-01-01T00:00:00Z');
    const newDate = new Date('2025-12-31T23:59:59Z');

    const oldUser1 = await createUser({ createdAt: oldDate });
    const oldUser2 = await createUser({ createdAt: oldDate });
    const oldUser3 = await createUser({ createdAt: oldDate });
    const newAdmin = await createAdminUser({ createdAt: newDate });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(newAdmin._id));

    expect(res.status).toBe(200);
    const ids = res.body.data.users.map(u => u._id.toString());

    const adminIdx = ids.indexOf(newAdmin._id.toString());
    expect(adminIdx).toBe(0);
    [oldUser1, oldUser2, oldUser3].forEach(u => {
      expect(ids.indexOf(u._id.toString())).toBeGreaterThan(adminIdx);
    });
  });

  it('orders non-admin users oldest first within their group', async () => {
    const admin   = await createAdminUser({ createdAt: new Date('2020-01-01') });
    const userOld = await createUser({ createdAt: new Date('2021-01-01') });
    const userMid = await createUser({ createdAt: new Date('2022-01-01') });
    const userNew = await createUser({ createdAt: new Date('2023-01-01') });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const ids = res.body.data.users.map(u => u._id.toString());

    expect(ids.indexOf(userOld._id.toString()))
      .toBeLessThan(ids.indexOf(userMid._id.toString()));
    expect(ids.indexOf(userMid._id.toString()))
      .toBeLessThan(ids.indexOf(userNew._id.toString()));
  });
});

// ── the list is deliberately unenriched ──────────────────────────────────────
// Enriching every account cost eight aggregations plus one per registered CBAT
// game, all to fill panels that were still collapsed. The list now answers on
// identity and status alone; /users/stats fills a row in when it is opened.

describe('GET /api/admin/users — deferred stats', () => {
  it('omits the counted stats and says so on every row', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    await IntelligenceBriefRead.create({
      userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true,
    });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const row = res.body.data.users.find(x => x._id.toString() === user._id.toString());
    expect(row.statsLoaded).toBe(false);
    expect(row.profileStats).toBeUndefined();
    expect(row.emailsSent).toBeUndefined();
  });

  it('still carries what a collapsed row renders', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ email: 'row@test.com', totalAirstars: 120, loginStreak: 3 });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const row = res.body.data.users.find(x => x._id.toString() === user._id.toString());
    expect(row.email).toBe('row@test.com');
    expect(row.totalAirstars).toBe(120);
    expect(row.loginStreak).toBe(3);
    expect(row.subscriptionTier).toBeDefined();
    expect(row).toHaveProperty('lastTestAppOpenAt');
    expect(res.body.data.latestClients).toBeDefined();
  });
});

// ── GET /users/stats ─────────────────────────────────────────────────────────

describe('GET /api/admin/users/stats — request shape', () => {
  it('returns 403 for a non-admin user', async () => {
    const actor = await createUser();
    const res   = await request(app)
      .get(`/api/admin/users/stats?ids=${actor._id}`)
      .set('Cookie', authCookie(actor._id));
    expect(res.status).toBe(403);
  });

  it('answers for several accounts in one request', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();

    await IntelligenceBriefRead.create([
      { userId: userA._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
      { userId: userA._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
      { userId: userB._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
    ]);

    const res = await statsFor(admin, [userA, userB]);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.stats)).toHaveLength(2);
    expect(res.body.data.stats[userA._id.toString()].profileStats.brifsRead).toBe(2);
    expect(res.body.data.stats[userB._id.toString()].profileStats.brifsRead).toBe(1);
  });

  it('carries the email count a row badges', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await statsFor(admin, user);
    expect(res.body.data.stats[user._id.toString()].emailsSent).toBe(0);
  });

  it('returns an empty map when asked for nothing', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/users/stats')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toEqual({});
  });

  it('ignores ids that are not valid object ids rather than failing the request', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await request(app)
      .get(`/api/admin/users/stats?ids=not-an-id,${user._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.stats)).toEqual([user._id.toString()]);
  });

  it('omits ids that match no account', async () => {
    const admin   = await createAdminUser();
    const missing = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/admin/users/stats?ids=${missing}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toEqual({});
  });
});

// ── profileStats.brifsRead ────────────────────────────────────────────────────

describe('GET /api/admin/users/stats — profileStats.brifsRead', () => {
  it('returns 0 when the user has no brief reads', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.brifsRead).toBe(0);
  });

  it('counts only completed: true reads, not opened-only records', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await IntelligenceBriefRead.create([
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false }, // opened only
    ]);

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.brifsRead).toBe(2);
  });

  it('isolates brief read counts per user', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();

    await IntelligenceBriefRead.create([
      { userId: userA._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
      { userId: userA._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
      { userId: userB._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true },
    ]);

    const res = await statsFor(admin, [userA, userB]);

    const aRow = res.body.data.stats[userA._id.toString()];
    const bRow = res.body.data.stats[userB._id.toString()];

    expect(aRow.profileStats.brifsRead).toBe(2);
    expect(bRow.profileStats.brifsRead).toBe(1);
  });
});

// ── profileStats.cbatPlayed ──────────────────────────────────────────────────

describe('GET /api/admin/users/stats — profileStats.cbatPlayed', () => {
  it('returns 0 when the user has no CBAT submissions', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.cbatPlayed).toBe(0);
  });

  // This is the key guard: iterating CBAT_GAMES means any new game added to
  // the shared registry is automatically covered by the admin stat — no edits
  // to admin.js or this test required for the count to stay correct.
  it('sums submissions across every game in the CBAT_GAMES registry', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await Promise.all(Object.values(CBAT_GAMES).map(cfg => seedCbatDoc(cfg, user._id)));

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.cbatPlayed).toBe(Object.keys(CBAT_GAMES).length);
  });

  it('isolates CBAT counts per user', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();

    const firstGame = Object.values(CBAT_GAMES)[0];
    await seedCbatDoc(firstGame, userA._id);
    await seedCbatDoc(firstGame, userA._id);
    await seedCbatDoc(firstGame, userB._id);

    const res = await statsFor(admin, [userA, userB]);

    const aRow = res.body.data.stats[userA._id.toString()];
    const bRow = res.body.data.stats[userB._id.toString()];

    expect(aRow.profileStats.cbatPlayed).toBe(2);
    expect(bRow.profileStats.cbatPlayed).toBe(1);
  });
});

// ── profileStats.cbatStarted ─────────────────────────────────────────────────

describe('GET /api/admin/users/stats — profileStats.cbatStarted', () => {
  it('returns 0 when the user has no CBAT start docs', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.cbatStarted).toBe(0);
  });

  it('sums starts across multiple gameKeys for a user', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const gameKeys = Object.keys(CBAT_GAMES);

    await Promise.all(gameKeys.map(k => GameSessionCbatStart.create({ userId: user._id, gameKey: k })));

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.cbatStarted).toBe(gameKeys.length);
  });

  it('cbatPlayed and cbatStarted are independent — starts without finishes', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target' });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'angles' });

    const res = await statsFor(admin, user);

    const u = res.body.data.stats[user._id.toString()];
    expect(u.profileStats.cbatStarted).toBe(2);
    expect(u.profileStats.cbatPlayed).toBe(0);
  });

  it('isolates cbatStarted counts per user', async () => {
    const admin = await createAdminUser();
    const userA = await createUser();
    const userB = await createUser();

    await GameSessionCbatStart.create({ userId: userA._id, gameKey: 'target' });
    await GameSessionCbatStart.create({ userId: userA._id, gameKey: 'target' });
    await GameSessionCbatStart.create({ userId: userB._id, gameKey: 'symbols' });

    const res = await statsFor(admin, [userA, userB]);

    const aRow = res.body.data.stats[userA._id.toString()];
    const bRow = res.body.data.stats[userB._id.toString()];
    expect(aRow.profileStats.cbatStarted).toBe(2);
    expect(bRow.profileStats.cbatStarted).toBe(1);
  });
});

// ── lastTestGameAt (idle-tester flag) ────────────────────────────────────────
// The one counted value the *collapsed* list still needs, because an idle tester
// is bordered and sorted differently. It is answered from the session-start log
// alone and only for flagged testers — see GET /users for why that is enough.

describe('GET /api/admin/users — lastTestGameAt', () => {
  const rowFor = (res, user) => res.body.data.users.find(x => x._id.toString() === user._id.toString());

  it('is null when a tester has no CBAT activity', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isTester: true });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    expect(rowFor(res, user).lastTestGameAt).toBeNull();
  });

  it('reflects the most recent CBAT start time for a tester', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isTester: true });

    const older  = new Date('2026-07-16T09:00:00Z');
    const newer  = new Date('2026-07-17T14:30:00Z');
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target',  startedAt: older });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols', startedAt: newer });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    expect(new Date(rowFor(res, user).lastTestGameAt).getTime()).toBe(newer.getTime());
  });

  it('isolates lastTestGameAt per tester', async () => {
    const admin = await createAdminUser();
    const userA = await createUser({ isTester: true });
    const userB = await createUser({ isTester: true });

    const tA = new Date('2026-07-17T08:00:00Z');
    await GameSessionCbatStart.create({ userId: userA._id, gameKey: 'target', startedAt: tA });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    expect(new Date(rowFor(res, userA).lastTestGameAt).getTime()).toBe(tA.getTime());
    expect(rowFor(res, userB).lastTestGameAt).toBeNull();
  });

  it('leaves it null for accounts that are not flagged as testers', async () => {
    // Nobody is asking the question of them, and answering it for all 400
    // accounts is what made this list slow in the first place.
    const admin = await createAdminUser();
    const user  = await createUser({ isTester: false });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target', startedAt: new Date() });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    expect(rowFor(res, user).lastTestGameAt).toBeNull();
  });

  it('still reports the field when no account is flagged as a tester', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const row = rowFor(res, user);
    expect(row).toHaveProperty('lastTestGameAt');
    expect(row.lastTestGameAt).toBeNull();
  });

  // The gap this rule accepts, written down: an offline run syncs a finish with
  // no start record. That is a native session by definition, so lastClients has
  // already reported the app open and the row still reads as tested today.
  it('an offline tester with no start record is still covered by their app open', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isTester: true });
    const seen  = new Date();
    await User.findByIdAndUpdate(user._id, {
      'lastClients.android': { version: '1.2.3', build: '7', buildNumber: 7, lastSeenAt: seen },
    });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', authCookie(admin._id));

    const row = rowFor(res, user);
    expect(row.lastTestGameAt).toBeNull();
    expect(new Date(row.lastTestAppOpenAt).getTime()).toBe(seen.getTime());
  });
});

// ── lastTestAppOpenAt (idle-tester flag) ─────────────────────────────────────
// Opening the app counts as testing on its own, so the Users list needs the last
// *native* client sighting alongside the last game.

describe('GET /api/admin/users — lastTestAppOpenAt', () => {
  const rowFor = (res, user) => res.body.data.users.find(x => x._id.toString() === user._id.toString());

  it('is null when the account has never been seen on a native client', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(rowFor(res, user).lastTestAppOpenAt).toBeNull();
  });

  it('reports the Android client sighting', async () => {
    const admin = await createAdminUser();
    const seen  = new Date('2026-07-17T14:30:00Z');
    const user  = await createUser();
    await User.findByIdAndUpdate(user._id, {
      'lastClients.android': { version: '1.2.3', build: '7', buildNumber: 7, lastSeenAt: seen },
    });

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(new Date(rowFor(res, user).lastTestAppOpenAt).getTime()).toBe(seen.getTime());
  });

  it('ignores a web-only sighting — the browser is not the app', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    await User.findByIdAndUpdate(user._id, {
      'lastClients.web': { version: '1.2.3', build: 'a3f9c21', buildNumber: null, lastSeenAt: new Date() },
    });

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(rowFor(res, user).lastTestAppOpenAt).toBeNull();
  });

  it('takes the most recent across native platforms', async () => {
    const admin   = await createAdminUser();
    const older   = new Date('2026-07-16T09:00:00Z');
    const newer   = new Date('2026-07-17T14:30:00Z');
    const user    = await createUser();
    await User.findByIdAndUpdate(user._id, {
      'lastClients.android': { version: '1.2.3', build: '7', buildNumber: 7, lastSeenAt: older },
      'lastClients.ios':     { version: '1.2.3', build: '7', buildNumber: 7, lastSeenAt: newer },
    });

    const res = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin._id));
    expect(new Date(rowFor(res, user).lastTestAppOpenAt).getTime()).toBe(newer.getTime());
  });
});

// ── search endpoint ───────────────────────────────────────────────────────────

describe('GET /api/admin/users/search — profileStats.brifsRead', () => {
  it('includes correct brifsRead in search results', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ email: 'search-target@test.com' });

    await IntelligenceBriefRead.create([
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true  },
      { userId: user._id, intelBriefId: new mongoose.Types.ObjectId(), completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/users/search?q=search-target')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.users[0].profileStats.brifsRead).toBe(1);
  });
});

describe('GET /api/admin/users/search — partial matching', () => {
  it('matches a partial agent number', async () => {
    const admin = await createAdminUser();
    await createUser({ email: 'agent@test.com', agentNumber: '333111666' });

    const res = await request(app)
      .get('/api/admin/users/search?q=333')
      .set('Cookie', authCookie(admin._id));

    const hit = res.body.data.users.find(u => u.agentNumber === '333111666');
    expect(hit).toBeTruthy();
  });

  it('matches an agent number from the middle of the string', async () => {
    const admin = await createAdminUser();
    await createUser({ email: 'agent2@test.com', agentNumber: '333111666' });

    const res = await request(app)
      .get('/api/admin/users/search?q=1116')
      .set('Cookie', authCookie(admin._id));

    const hit = res.body.data.users.find(u => u.agentNumber === '333111666');
    expect(hit).toBeTruthy();
  });

  it('matches a partial display name, case-insensitively', async () => {
    const admin = await createAdminUser();
    await createUser({
      email: 'named@test.com', displayName: 'Maverick', displayNameLower: 'maverick',
    });

    const res = await request(app)
      .get('/api/admin/users/search?q=aver')
      .set('Cookie', authCookie(admin._id));

    const hit = res.body.data.users.find(u => u.displayName === 'Maverick');
    expect(hit).toBeTruthy();
  });

  it('treats regex punctuation in the query as literal text', async () => {
    const admin = await createAdminUser();
    await createUser({ email: 'literal@test.com' });

    const res = await request(app)
      .get(`/api/admin/users/search?q=${encodeURIComponent('lit(era')}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(0);
  });
});

// ── unban endpoint ────────────────────────────────────────────────────────────

describe('POST /api/admin/users/:id/unban', () => {
  it('returns 401 for unauthenticated request', async () => {
    const user = await createUser({ isBanned: true });
    const res  = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .send({ reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const actor = await createUser();
    const user  = await createUser({ isBanned: true });
    const res   = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .set('Cookie', authCookie(actor._id))
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('sets isBanned to false on the target user', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isBanned: true });

    const res = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'appealed successfully' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await (require('../../models/User')).findById(user._id);
    expect(updated.isBanned).toBe(false);
  });

  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ isBanned: true });

    const res = await request(app)
      .post(`/api/admin/users/${user._id}/unban`)
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent user id', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/users/${new mongoose.Types.ObjectId()}/unban`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'test' });
    expect(res.status).toBe(404);
  });
});

// ── subscription tier endpoint ─────────────────────────────────────────────

describe('PATCH /api/admin/users/:id/subscription — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .send({ tier: 'gold', reason: 'upgrade' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const actor = await createUser();
    const user  = await createUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(actor._id))
      .send({ tier: 'gold', reason: 'upgrade' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/users/:id/subscription — validation', () => {
  it('returns 400 when reason is missing', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid tier', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'platinum', reason: 'test' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent user id', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch(`/api/admin/users/${new mongoose.Types.ObjectId()}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold', reason: 'test' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/users/:id/subscription — tier change', () => {
  const User = require('../../models/User');
  const AdminAction = require('../../models/AdminAction');

  it('updates subscriptionTier on the target user (free → gold)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });

    const res = await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold', reason: 'manual upgrade' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('gold');
  });

  it('updates subscriptionTier (gold → free)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'gold' });

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'free', reason: 'downgrade' });

    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('free');
  });

  it('sets trialStartDate and trialDurationDays when tier is trial', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });

    const before = new Date();

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'trial', reason: 'free trial grant' });

    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('trial');
    expect(updated.trialStartDate).toBeDefined();
    expect(new Date(updated.trialStartDate).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.trialDurationDays).toBeGreaterThan(0);
  });

  it('resets ammunitionRemaining on all read records for the target user', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });
    const other = await createUser();

    // Create read records for both users
    await IntelligenceBriefRead.create([
      { userId: user._id,  intelBriefId: new mongoose.Types.ObjectId(), completed: true,  ammunitionRemaining: 0 },
      { userId: user._id,  intelBriefId: new mongoose.Types.ObjectId(), completed: false, ammunitionRemaining: 0 },
      { userId: other._id, intelBriefId: new mongoose.Types.ObjectId(), completed: true,  ammunitionRemaining: 0 },
    ]);

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'gold', reason: 'upgrade to gold' });

    const userRecords  = await IntelligenceBriefRead.find({ userId: user._id });
    const otherRecords = await IntelligenceBriefRead.find({ userId: other._id });

    // Gold ammo = 9999
    expect(userRecords.every(r => r.ammunitionRemaining === 9999)).toBe(true);
    // Other user's records must not be touched
    expect(otherRecords[0].ammunitionRemaining).toBe(0);
  });

  it('logs an AdminAction with change_subscription type', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ subscriptionTier: 'free' });

    await request(app)
      .patch(`/api/admin/users/${user._id}/subscription`)
      .set('Cookie', authCookie(admin._id))
      .send({ tier: 'silver', reason: 'gift subscription' });

    const action = await AdminAction.findOne({ actionType: 'change_subscription' });
    expect(action).not.toBeNull();
    expect(action.userId.toString()).toBe(admin._id.toString());
    expect(action.targetUserId.toString()).toBe(user._id.toString());
    expect(action.reason).toBe('gift subscription');
  });
});

// ── emailsSent ────────────────────────────────────────────────────────────────

describe('GET /api/admin/users/stats — emailsSent', () => {
  const EmailLog = require('../../models/EmailLog');
  const logFor = (user, props = {}) => EmailLog.create({
    type: 'welcome', status: 'sent',
    recipientEmail: user.email, recipientUserId: user._id, ...props,
  });

  it('counts every logged email per user, isolated between users', async () => {
    const admin = await createAdminUser();
    const a     = await createUser({ email: 'a@test.com' });
    const b     = await createUser({ email: 'b@test.com' });

    await logFor(a);
    await logFor(a, { type: 'app_invite' });
    await logFor(a, { status: 'failed', error: 'bounced' }); // failures count too
    await logFor(b);

    const res = await statsFor(admin, [a, b, admin]);

    expect(res.status).toBe(200);
    const byId = res.body.data.stats;
    expect(byId[a._id.toString()].emailsSent).toBe(3);
    expect(byId[b._id.toString()].emailsSent).toBe(1);
    expect(byId[admin._id.toString()].emailsSent).toBe(0);
  });

  it('is included in search results too', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ email: 'searchme@test.com' });
    await logFor(user);
    await logFor(user);

    const res = await request(app)
      .get('/api/admin/users/search?q=searchme')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const hit = res.body.data.users.find(u => u._id === user._id.toString());
    expect(hit.emailsSent).toBe(2);
  });
});
