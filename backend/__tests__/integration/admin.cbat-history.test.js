/**
 * Admin — GET /api/admin/users/:id/cbat-history
 *
 * Covers:
 *   auth guards (401 unauthenticated, 403 non-admin)
 *   pairing logic — starts + finishes → finished + abandoned rows
 *   orphan finishes (finish without preceding start) still listed as finished
 *   gameKey + result filters
 *   most-recent-first sort
 *   pagination
 *   counts in response
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createSettings, authCookie,
} = require('../helpers/factories');
const { CBAT_GAMES }       = require('../../constants/cbatGames');
const GameSessionCbatStart = require('../../models/GameSessionCbatStart');

// Same payload-shape helper as admin.users.test.js — satisfies the union of
// required fields across every CBAT result schema.
function seedCbatFinish(cfg, userId, overrides = {}) {
  return cfg.Model.create({
    userId,
    [cfg.primaryField]: overrides[cfg.primaryField] ?? 1,
    totalTime:    overrides.totalTime    ?? 1,
    roundsPlayed: overrides.roundsPlayed ?? 1,
    ...overrides,
  });
}

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

describe('GET /api/admin/users/:id/cbat-history — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const user = await createUser();
    const res = await request(app).get(`/api/admin/users/${user._id}/cbat-history`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user  = await createUser();
    const other = await createUser();
    const res = await request(app)
      .get(`/api/admin/users/${other._id}/cbat-history`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('returns 404 when target user does not exist', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/users/507f1f77bcf86cd799439011/cbat-history')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/users/:id/cbat-history — empty state', () => {
  it('returns empty sessions and zero counts for a user with no CBAT activity', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.counts).toEqual({ total: 0, finished: 0, abandoned: 0 });
  });
});

describe('GET /api/admin/users/:id/cbat-history — pairing logic', () => {
  it('1 start + 1 finish (finish after start) → 1 finished row', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const cfg   = CBAT_GAMES['target'];

    const t0 = new Date('2026-04-01T10:00:00Z');
    const t1 = new Date('2026-04-01T10:05:00Z');
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target', startedAt: t0 });
    const finish = await seedCbatFinish(cfg, user._id);
    await cfg.Model.updateOne({ _id: finish._id }, { $set: { createdAt: t1 } });

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0].status).toBe('finished');
    expect(res.body.data.sessions[0].gameKey).toBe('target');
    expect(res.body.data.counts).toEqual({ total: 1, finished: 1, abandoned: 0 });
  });

  it('2 starts + 1 finish → 1 finished + 1 abandoned (earliest start paired)', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const cfg   = CBAT_GAMES['symbols'];

    const t0 = new Date('2026-04-01T10:00:00Z');
    const t1 = new Date('2026-04-01T10:05:00Z');
    const t2 = new Date('2026-04-01T11:00:00Z');
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols', startedAt: t0 });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols', startedAt: t2 });
    const finish = await seedCbatFinish(cfg, user._id);
    await cfg.Model.updateOne({ _id: finish._id }, { $set: { createdAt: t1 } });

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toHaveLength(2);
    const statuses = res.body.data.sessions.map(s => s.status).sort();
    expect(statuses).toEqual(['abandoned', 'finished']);
    expect(res.body.data.counts).toEqual({ total: 2, finished: 1, abandoned: 1 });
  });

  it('orphan finish (no preceding start) is still listed as finished', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const cfg   = CBAT_GAMES['ant'];

    await seedCbatFinish(cfg, user._id);

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0].status).toBe('finished');
    expect(res.body.data.sessions[0].startedAt).toBeNull();
  });

  it('start with no matching finish → abandoned', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'flag' });

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0].status).toBe('abandoned');
    expect(res.body.data.sessions[0].finishedAt).toBeNull();
  });
});

describe('GET /api/admin/users/:id/cbat-history — filters', () => {
  it('gameKey filter returns only matching games', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target' });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols' });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols' });

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history?gameKey=symbols`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.sessions).toHaveLength(2);
    expect(res.body.data.sessions.every(s => s.gameKey === 'symbols')).toBe(true);
    // Counts reflect the unfiltered totals so the page can show "X / Y total".
    expect(res.body.data.counts.total).toBe(3);
  });

  it('result=abandoned returns only abandoned rows', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const cfg   = CBAT_GAMES['target'];

    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target' });
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols' });
    await seedCbatFinish(cfg, user._id);

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history?result=abandoned`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.sessions.every(s => s.status === 'abandoned')).toBe(true);
  });

  it('result=finished returns only finished rows', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const cfg   = CBAT_GAMES['target'];

    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols' });
    await seedCbatFinish(cfg, user._id);

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history?result=finished`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.sessions.every(s => s.status === 'finished')).toBe(true);
  });
});

describe('GET /api/admin/users/:id/cbat-history — sort + pagination', () => {
  it('sorts most recent first using finishedAt or startedAt', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const cfg   = CBAT_GAMES['target'];

    // Older finished session
    const tStart1  = new Date('2026-04-01T10:00:00Z');
    const tFinish1 = new Date('2026-04-01T10:05:00Z');
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target', startedAt: tStart1 });
    const f1 = await seedCbatFinish(cfg, user._id);
    await cfg.Model.updateOne({ _id: f1._id }, { $set: { createdAt: tFinish1 } });

    // Newer abandoned session
    const tStart2 = new Date('2026-04-02T10:00:00Z');
    await GameSessionCbatStart.create({ userId: user._id, gameKey: 'symbols', startedAt: tStart2 });

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.sessions).toHaveLength(2);
    expect(res.body.data.sessions[0].gameKey).toBe('symbols');  // newer
    expect(res.body.data.sessions[1].gameKey).toBe('target');   // older
  });

  it('paginates results', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    for (let i = 0; i < 5; i++) {
      await GameSessionCbatStart.create({ userId: user._id, gameKey: 'target' });
    }

    const res = await request(app)
      .get(`/api/admin/users/${user._id}/cbat-history?limit=2&page=2`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.sessions).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.limit).toBe(2);
  });
});
