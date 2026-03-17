/**
 * admin.logs.test.js
 *
 * Integration tests for GET /api/admin/actions
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');

const {
  createSettings,
  createUser, createAdminUser, authCookie,
  createAdminAction,
} = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(() => {});

// ── Auth guards ────────────────────────────────────────────────────────────

describe('GET /api/admin/actions — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/actions');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── Response shape ─────────────────────────────────────────────────────────

describe('GET /api/admin/actions — response shape', () => {
  it('returns empty list when no actions exist', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.actions).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.totalPages).toBe(0);
  });

  it('returns actions newest-first', async () => {
    const admin = await createAdminUser();
    await createAdminAction(admin._id, { actionType: 'edit_brief',   reason: 'first'  });
    await createAdminAction(admin._id, { actionType: 'create_brief', reason: 'second' });

    const res = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.actions[0].reason).toBe('second');
    expect(res.body.data.actions[1].reason).toBe('first');
  });

  it('populates userId with agentNumber and email', async () => {
    const admin = await createAdminUser();
    await createAdminAction(admin._id, { actionType: 'edit_brief', reason: 'check population' });

    const res = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    const action = res.body.data.actions[0];
    expect(action.userId).toBeDefined();
    expect(typeof action.userId).toBe('object');
    expect(action.userId.agentNumber).toBeDefined();
  });

  it('populates targetUserId when present', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();
    await createAdminAction(admin._id, { actionType: 'ban_user', reason: 'misbehaving', targetUserId: target._id });

    const res = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    const action = res.body.data.actions[0];
    expect(action.targetUserId).toBeDefined();
    expect(typeof action.targetUserId).toBe('object');
    expect(String(action.targetUserId._id)).toBe(String(target._id));
  });

  it('targetUserId is null when not set', async () => {
    const admin = await createAdminUser();
    await createAdminAction(admin._id, { actionType: 'edit_brief', reason: 'no target' });

    const res = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.actions[0].targetUserId ?? null).toBeNull();
  });

  it('includes actionType, reason, and time fields', async () => {
    const admin = await createAdminUser();
    await createAdminAction(admin._id, { actionType: 'delete_brief', reason: 'outdated content' });

    const res = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    const action = res.body.data.actions[0];
    expect(action.actionType).toBe('delete_brief');
    expect(action.reason).toBe('outdated content');
    expect(action.time).toBeDefined();
  });
});

// ── Type filter ────────────────────────────────────────────────────────────

describe('GET /api/admin/actions — type filter', () => {
  it('returns only matching actions when ?type= is set', async () => {
    const admin = await createAdminUser();
    await createAdminAction(admin._id, { actionType: 'ban_user',    reason: 'ban'    });
    await createAdminAction(admin._id, { actionType: 'edit_brief',  reason: 'edit'   });
    await createAdminAction(admin._id, { actionType: 'edit_brief',  reason: 'edit 2' });

    const res = await request(app)
      .get('/api/admin/actions?type=edit_brief')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.actions.every(a => a.actionType === 'edit_brief')).toBe(true);
  });

  it('returns all actions when no type filter provided', async () => {
    const admin = await createAdminUser();
    await createAdminAction(admin._id, { actionType: 'ban_user',   reason: 'a' });
    await createAdminAction(admin._id, { actionType: 'edit_brief', reason: 'b' });

    const res = await request(app)
      .get('/api/admin/actions')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.total).toBe(2);
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────

describe('GET /api/admin/actions — pagination', () => {
  it('paginates results using page and limit params', async () => {
    const admin = await createAdminUser();
    for (let i = 0; i < 5; i++) {
      await createAdminAction(admin._id, { actionType: 'edit_brief', reason: `reason ${i}` });
    }

    const res = await request(app)
      .get('/api/admin/actions?page=1&limit=2')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.actions).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.totalPages).toBe(3);
    expect(res.body.data.page).toBe(1);
  });

  it('returns second page correctly', async () => {
    const admin = await createAdminUser();
    for (let i = 0; i < 5; i++) {
      await createAdminAction(admin._id, { actionType: 'edit_brief', reason: `reason ${i}` });
    }

    const res = await request(app)
      .get('/api/admin/actions?page=2&limit=2')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.actions).toHaveLength(2);
    expect(res.body.data.page).toBe(2);
  });
});
