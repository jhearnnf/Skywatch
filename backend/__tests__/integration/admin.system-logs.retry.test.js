/**
 * admin.system-logs.retry.test.js
 *
 * Integration tests for POST /api/admin/system-logs/:id/retry.
 * The endpoint only supports priority_ranking_failure logs — it re-runs
 * reprioritizeCategory and marks the log resolved when every lead in that
 * category has a priorityNumber.
 */

process.env.JWT_SECRET = 'test_secret';

// Stub the ranking util so tests don't hit OpenRouter. Each test sets the impl
// via the exposed mock below.
jest.mock('../../utils/priorityRanking', () => ({
  reprioritizeCategory: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');

const { createSettings, createUser, createAdminUser, authCookie, createLead } = require('../helpers/factories');
const SystemLog = require('../../models/SystemLog');
const { reprioritizeCategory } = require('../../utils/priorityRanking');
const IntelLead = require('../../models/IntelLead');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  reprioritizeCategory.mockReset();
  reprioritizeCategory.mockResolvedValue(undefined);
});
afterEach(async () => { await db.clearDatabase(); });

async function createPriorityFailureLog(overrides = {}) {
  return SystemLog.create({
    type:             'priority_ranking_failure',
    category:         overrides.category ?? 'Roles',
    newStubs:         overrides.newStubs ?? [{ title: 'Stub A' }],
    sourceBriefTitle: overrides.sourceBriefTitle ?? 'Source brief',
    resolved:         false,
    ...overrides,
  });
}

// ── Auth guards ────────────────────────────────────────────────────────────

describe('POST /api/admin/system-logs/:id/retry — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const log = await createPriorityFailureLog();
    const res = await request(app).post(`/api/admin/system-logs/${log._id}/retry`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const log  = await createPriorityFailureLog();
    const user = await createUser();
    const res  = await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('POST /api/admin/system-logs/:id/retry — validation', () => {
  it('returns 404 when log does not exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/system-logs/507f1f77bcf86cd799439011/retry')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(404);
  });

  it('returns 400 when log type is not priority_ranking_failure', async () => {
    const admin = await createAdminUser();
    const log   = await SystemLog.create({
      type: 'image_fetch_failure', briefTitle: 'x', searchTerms: ['foo'],
    });
    const res = await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/image_fetch_failure/);
    expect(reprioritizeCategory).not.toHaveBeenCalled();
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe('POST /api/admin/system-logs/:id/retry — resolution', () => {
  it('invokes reprioritizeCategory with log context', async () => {
    const admin = await createAdminUser();
    const log   = await createPriorityFailureLog({
      category: 'Roles',
      newStubs: [{ title: 'NewA' }, { title: 'NewB' }],
      sourceBriefTitle: 'Parent brief',
    });

    await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(admin._id));

    expect(reprioritizeCategory).toHaveBeenCalledTimes(1);
    const [category, newStubs, _sourceId, sourceTitle] = reprioritizeCategory.mock.calls[0];
    expect(category).toBe('Roles');
    expect(newStubs.map(s => s.title)).toEqual(['NewA', 'NewB']);
    expect(sourceTitle).toBe('Parent brief');
  });

  it('marks log resolved when no unranked leads remain in category', async () => {
    const admin = await createAdminUser();
    await createLead({ category: 'Roles', priorityNumber: 1 });
    await createLead({ category: 'Roles', priorityNumber: 2 });
    const log = await createPriorityFailureLog({ category: 'Roles' });

    const res = await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resolved: true, stillUnranked: 0 });

    const fresh = await SystemLog.findById(log._id);
    expect(fresh.resolved).toBe(true);
  });

  it('leaves log unresolved and reports stillUnranked when leads remain', async () => {
    const admin = await createAdminUser();
    await createLead({ category: 'Roles', priorityNumber: 1 });
    await createLead({ category: 'Roles', priorityNumber: null });
    await createLead({ category: 'Roles', priorityNumber: null });
    const log = await createPriorityFailureLog({ category: 'Roles' });

    const res = await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resolved: false, stillUnranked: 2 });

    const fresh = await SystemLog.findById(log._id);
    expect(fresh.resolved).toBe(false);
  });

  it('ignores unranked leads in other categories when checking resolution', async () => {
    const admin = await createAdminUser();
    await createLead({ category: 'Roles',     priorityNumber: 1 });
    await createLead({ category: 'Squadrons', priorityNumber: null });
    const log = await createPriorityFailureLog({ category: 'Roles' });

    const res = await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.resolved).toBe(true);
  });

  it('returns 500 when reprioritizeCategory throws', async () => {
    const admin = await createAdminUser();
    reprioritizeCategory.mockRejectedValueOnce(new Error('OpenRouter timeout'));
    const log = await createPriorityFailureLog();

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post(`/api/admin/system-logs/${log._id}/retry`)
      .set('Cookie', authCookie(admin._id));
    errorSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('OpenRouter timeout');
  });
});
