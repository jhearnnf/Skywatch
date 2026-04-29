'use strict';

/**
 * Admin — Case Files tier gating tests
 *
 * Covers PATCH /api/admin/case-files/:slug:
 *   auth guards (non-admin, unauthenticated)
 *   validation (missing tiers, non-array tiers, invalid tier values, missing reason)
 *   404 when slug does not exist
 *   200 success — DB updated, AdminAction logged
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

const request     = require('supertest');
const app         = require('../../app');
const db          = require('../helpers/setupDb');
const {
  createUser,
  createAdminUser,
  createSettings,
  authCookie,
} = require('../helpers/factories');

const GameCaseFile  = require('../../models/GameCaseFile');
const AdminAction   = require('../../models/AdminAction');

// ── Minimal case factory (local to this file) ──────────────────────────────
async function createCase(overrides = {}) {
  return GameCaseFile.create({
    slug:        overrides.slug        ?? `case-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title:       overrides.title       ?? 'Test Case',
    affairLabel: overrides.affairLabel ?? 'Test Affair',
    summary:     overrides.summary     ?? 'Test summary',
    status:      overrides.status      ?? 'published',
    tags:        overrides.tags        ?? [],
    tiers:       overrides.tiers       ?? ['admin'],
    ...overrides,
  });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── Auth guards ────────────────────────────────────────────────────────────

describe('PATCH /api/admin/case-files/:slug — auth guards', () => {
  it('returns 401 for an unauthenticated request', async () => {
    const caseDoc = await createCase({ slug: 'auth-guard-case' });
    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .send({ tiers: ['free'], reason: 'open up' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const user    = await createUser();
    const caseDoc = await createCase({ slug: 'nonadmin-case' });
    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(user._id))
      .send({ tiers: ['free'], reason: 'open up' });
    expect(res.status).toBe(403);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('PATCH /api/admin/case-files/:slug — validation', () => {
  it('returns 400 when tiers is missing from the body', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'missing-tiers-case' });
    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'testing' }); // no tiers
    expect(res.status).toBe(400);
  });

  it('returns 400 when tiers is a string, not an array', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'string-tiers-case' });
    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: 'gold', reason: 'testing' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when tiers contains an invalid value', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'invalid-tier-case' });
    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: ['free', 'platinum'], reason: 'testing' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing (requireReason middleware)', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'no-reason-case' });
    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: ['free'] }); // no reason
    expect(res.status).toBe(400);
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/case-files/:slug — 404', () => {
  it('returns 404 when the slug does not exist', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/case-files/slug-that-does-not-exist')
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: ['gold'], reason: 'restricting access' });
    expect(res.status).toBe(404);
  });
});

// ── Success ────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/case-files/:slug — success', () => {
  it('returns 200 and updates tiers on the case document', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'success-case', tiers: ['admin'] });

    const res = await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: ['gold', 'silver'], reason: 'opening to paid users' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.caseFile.tiers).toEqual(['gold', 'silver']);
  });

  it('persists the new tiers to the database', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'persist-case', tiers: ['admin'] });

    await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: ['free'], reason: 'fully open' });

    const updated = await GameCaseFile.findOne({ slug: 'persist-case' }).lean();
    expect(updated.tiers).toEqual(['free']);
  });

  it('creates an AdminAction with actionType change_app_settings and the supplied reason', async () => {
    const admin   = await createAdminUser();
    const caseDoc = await createCase({ slug: 'action-case', tiers: ['admin'] });

    await request(app)
      .patch(`/api/admin/case-files/${caseDoc.slug}`)
      .set('Cookie', authCookie(admin._id))
      .send({ tiers: ['gold'], reason: 'gold only now' });

    const action = await AdminAction.findOne({ actionType: 'change_app_settings' }).lean();
    expect(action).not.toBeNull();
    expect(action.userId.toString()).toBe(admin._id.toString());
    expect(action.reason).toBe('gold only now');
  });
});
