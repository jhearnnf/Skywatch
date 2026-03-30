/**
 * Admin — Reports tab tests
 *
 * Covers:
 *   GET  /api/admin/problems/count   — unsolved count for tab badge
 *   GET  /api/admin/problems         — list with optional solved filter
 *   POST /api/admin/problems/:id/update — add note and/or mark solved/reopened
 *   POST /api/admin/problems/:id/update + notifyUser=true — in-app notification
 *   POST /api/admin/problems/:id/update + sendEmail=true  — email delivery flag
 *   GET  /api/users/me/notifications  — fetch unread notifications
 *   POST /api/users/me/notifications/:id/read — mark notification read
 *
 * Auth guard:
 *   All admin routes require a logged-in admin (403 for regular users, 401 for guests).
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const ProblemReport    = require('../../models/ProblemReport');
const UserNotification = require('../../models/UserNotification');

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

// ── Notification delivery — in-app ────────────────────────────────────────────

describe('POST /api/admin/problems/:id/update — in-app notification', () => {
  it('creates a UserNotification when notifyUser=true and sendEmail is falsy', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Screen flickers' });

    const res = await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'We are looking into it', notifyUser: true, sendEmail: false });

    expect(res.status).toBe(200);

    const notif = await UserNotification.findOne({ userId: user._id });
    expect(notif).not.toBeNull();
    expect(notif.message).toBe('We are looking into it');
    expect(notif.read).toBe(false);
    expect(notif.relatedReportId.toString()).toBe(report._id);
  });

  it('does NOT create a UserNotification when notifyUser is false', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Bug report' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Internal admin note only', notifyUser: false });

    const count = await UserNotification.countDocuments({ userId: user._id });
    expect(count).toBe(0);
  });

  it('marks update entry as isUserVisible=true when notifyUser=true', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Crash on submit' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Fix deployed', notifyUser: true, sendEmail: false });

    const updated = await ProblemReport.findById(report._id);
    expect(updated.updates[0].isUserVisible).toBe(true);
    expect(updated.updates[0].emailSent).toBe(false);
  });

  it('leaves isUserVisible=false when notifyUser is not set', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Missing icon' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Internal note' });

    const updated = await ProblemReport.findById(report._id);
    expect(updated.updates[0].isUserVisible).toBe(false);
  });
});

// ── Notification delivery — email flag ────────────────────────────────────────

describe('POST /api/admin/problems/:id/update — sendEmail flag', () => {
  it('marks emailSent=true on the update entry when notifyUser=true and sendEmail=true', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Map not loading' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Fixed in latest release', notifyUser: true, sendEmail: true });

    const updated = await ProblemReport.findById(report._id);
    expect(updated.updates[0].isUserVisible).toBe(true);
    expect(updated.updates[0].emailSent).toBe(true);
  });

  it('does NOT create a UserNotification when sendEmail=true (email path, not in-app)', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Points not updating' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Corrected in next session', notifyUser: true, sendEmail: true });

    const count = await UserNotification.countDocuments({ userId: user._id });
    expect(count).toBe(0);
  });
});

// ── GET /api/users/me/notifications ──────────────────────────────────────────

describe('GET /api/users/me/notifications', () => {
  it('returns unread notifications for the logged-in user', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Timer bug' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Fixed!', notifyUser: true, sendEmail: false });

    const res = await request(app)
      .get('/api/users/me/notifications')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    const notifs = res.body.data.notifications;
    expect(notifs.length).toBe(1);
    expect(notifs[0].message).toBe('Fixed!');
    expect(notifs[0].read).toBe(false);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/users/me/notifications');
    expect(res.status).toBe(401);
  });

  it('does not return other users\' notifications', async () => {
    const admin   = await createAdminUser();
    const user1   = await createUser();
    const user2   = await createUser();
    const report1 = await submitReport(user1, { description: 'Bug A' });

    await request(app)
      .post(`/api/admin/problems/${report1._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Update for user1', notifyUser: true, sendEmail: false });

    const res = await request(app)
      .get('/api/users/me/notifications')
      .set('Cookie', authCookie(user2._id));

    expect(res.body.data.notifications.length).toBe(0);
  });
});

// ── POST /api/users/me/notifications/:id/read ─────────────────────────────────

describe('POST /api/users/me/notifications/:id/read', () => {
  it('marks a notification as read', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Sound broken' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Audio patch applied', notifyUser: true, sendEmail: false });

    const notif = await UserNotification.findOne({ userId: user._id });

    const res = await request(app)
      .post(`/api/users/me/notifications/${notif._id}/read`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);

    const updated = await UserNotification.findById(notif._id);
    expect(updated.read).toBe(true);
  });

  it('disappears from unread list after being marked read', async () => {
    const admin  = await createAdminUser();
    const user   = await createUser();
    const report = await submitReport(user, { description: 'Login issue' });

    await request(app)
      .post(`/api/admin/problems/${report._id}/update`)
      .set('Cookie', authCookie(admin._id))
      .send({ description: 'Session fix applied', notifyUser: true, sendEmail: false });

    const notif = await UserNotification.findOne({ userId: user._id });

    await request(app)
      .post(`/api/users/me/notifications/${notif._id}/read`)
      .set('Cookie', authCookie(user._id));

    const res = await request(app)
      .get('/api/users/me/notifications')
      .set('Cookie', authCookie(user._id));

    expect(res.body.data.notifications.length).toBe(0);
  });
});
