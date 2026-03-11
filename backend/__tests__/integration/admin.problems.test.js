/**
 * Admin — Reports tab tests
 *
 * Covers:
 *   GET  /api/admin/problems/count   — unsolved count for tab badge
 *   GET  /api/admin/problems         — list with optional solved filter
 *   POST /api/admin/problems/:id/update — add note and/or mark solved/reopened
 *
 * Auth guard:
 *   All admin routes require a logged-in admin (403 for regular users, 401 for guests).
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const ProblemReport = require('../../models/ProblemReport');

// ── helpers ───────────────────────────────────────────────────────────────────

async function submitReport(user, overrides = {}) {
  const cookie = authCookie(user._id);
  const res = await request(app)
    .post('/api/users/report-problem')
    .set('Cookie', cookie)
    .send({
      pageReported:  overrides.pageReported  ?? '/learn',
      description:   overrides.description   ?? 'Something is broken',
    });
  return res.body.data?.report;
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── GET /api/admin/problems/count ─────────────────────────────────────────────

describe('GET /api/admin/problems/count', () => {
  it('returns 0 when there are no reports', async () => {
    const admin  = await createAdminUser();
    const cookie = authCookie(admin._id);

    const res = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.unsolvedCount).toBe(0);
  });

  it('counts only unsolved reports', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();

    await submitReport(user, { description: 'Bug A' });
    await submitReport(user, { description: 'Bug B' });

    // Mark one as solved directly in the DB
    await ProblemReport.findOneAndUpdate({ description: 'Bug A' }, { solved: true });

    const res = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.unsolvedCount).toBe(1);
  });

  it('returns 0 after all reports are solved', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();

    const report = await submitReport(user, { description: 'Fixed this' });
    await ProblemReport.findByIdAndUpdate(report._id, { solved: true });

    const res = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.unsolvedCount).toBe(0);
  });

  it('count increments when a new report is submitted', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const before = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', authCookie(admin._id));
    expect(before.body.data.unsolvedCount).toBe(0);

    await submitReport(user);

    const after = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', authCookie(admin._id));
    expect(after.body.data.unsolvedCount).toBe(1);
  });

  it('returns 403 for a non-admin user', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', cookie);

    expect(res.status).toBe(403);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/problems/count');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/problems ───────────────────────────────────────────────────

describe('GET /api/admin/problems', () => {
  it('returns all reports with updates array and user info', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await submitReport(user, { description: 'Login broken', pageReported: '/login' });

    const res = await request(app)
      .get('/api/admin/problems')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const problems = res.body.data.problems;
    expect(problems.length).toBe(1);
    expect(problems[0].description).toBe('Login broken');
    expect(problems[0].pageReported).toBe('/login');
    expect(Array.isArray(problems[0].updates)).toBe(true);
    expect(problems[0].userId).toBeDefined(); // populated
  });

  it('?solved=false returns only unsolved reports', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const r1 = await submitReport(user, { description: 'Open issue' });
    await submitReport(user, { description: 'Closed issue' });
    await ProblemReport.findByIdAndUpdate(r1._id, { solved: true });

    const res = await request(app)
      .get('/api/admin/problems?solved=false')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.problems.length).toBe(1);
    expect(res.body.data.problems[0].description).toBe('Closed issue');
    expect(res.body.data.problems[0].solved).toBe(false);
  });

  it('?solved=true returns only solved reports', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    const r1 = await submitReport(user, { description: 'Fixed one' });
    await submitReport(user, { description: 'Still open' });
    await ProblemReport.findByIdAndUpdate(r1._id, { solved: true });

    const res = await request(app)
      .get('/api/admin/problems?solved=true')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.problems.length).toBe(1);
    expect(res.body.data.problems[0].solved).toBe(true);
  });
});

// ── POST /api/admin/problems/:id/update ───────────────────────────────────────

describe('POST /api/admin/problems/:id/update', () => {
  it('adds an update entry to the report', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Nav is broken' });

    const res = await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Investigating now' });

    expect(res.status).toBe(200);
    const updated = res.body.data.report;
    expect(updated.updates.length).toBe(1);
    expect(updated.updates[0].description).toBe('Investigating now');
  });

  it('multiple notes all appear in the updates array', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user);

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'First note' });

    const res = await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Second note' });

    expect(res.body.data.report.updates.length).toBe(2);
  });

  it('marks report as solved and decrements unsolved count', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user);

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Marked as solved', solved: true });

    const countRes = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', authCookie(admin._id));

    expect(countRes.body.data.unsolvedCount).toBe(0);
  });

  it('reopening a solved report increments unsolved count', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user);

    // Solve it
    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Fixed', solved: true });

    // Reopen it
    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Reopened — still happening', solved: false });

    const countRes = await request(app)
      .get('/api/admin/problems/count')
      .set('Cookie', authCookie(admin._id));

    expect(countRes.body.data.unsolvedCount).toBe(1);
  });

  it('returns 403 for non-admin', async () => {
    const user   = await createUser();
    const report = await submitReport(user);

    const res = await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(user._id))
      .send({ description: 'Sneaky note' });

    expect(res.status).toBe(403);
  });
});
