/**
 * Admin — Flag Brief For Edit
 *
 * Covers:
 *   GET  /api/admin/briefs?flaggedForEdit=true — filter
 *   PATCH /api/admin/briefs/:id — stamps flaggedAt on false→true, clears on true→false
 *   POST /api/users/report-problem with briefId — attaches brief ref + auto-flags
 *   GET  /api/admin/problems — returns populated intelligenceBrief
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createBrief, createSettings, createGameType, authCookie,
} = require('../helpers/factories');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const ProblemReport     = require('../../models/ProblemReport');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await createGameType();
});
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── GET /api/admin/briefs?flaggedForEdit=true ────────────────────────────────

describe('GET /api/admin/briefs — flaggedForEdit filter', () => {
  it('returns only flagged briefs when flaggedForEdit=true', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Flagged one',  flaggedForEdit: true,  flaggedAt: new Date() });
    await createBrief({ title: 'Flagged two',  flaggedForEdit: true,  flaggedAt: new Date() });
    await createBrief({ title: 'Not flagged',  flaggedForEdit: false });

    const res = await request(app)
      .get('/api/admin/briefs?flaggedForEdit=true')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title).sort();
    expect(titles).toEqual(['Flagged one', 'Flagged two']);
  });

  it('returns all briefs when flaggedForEdit is absent', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'A', flaggedForEdit: true,  flaggedAt: new Date() });
    await createBrief({ title: 'B', flaggedForEdit: false });

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.briefs.length).toBe(2);
  });

  it('response rows include flaggedForEdit so the admin list can render the pill', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Flagged', flaggedForEdit: true, flaggedAt: new Date() });

    const res = await request(app)
      .get('/api/admin/briefs?flaggedForEdit=true')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.briefs[0].flaggedForEdit).toBe(true);
  });
});

// ── PATCH /api/admin/briefs/:id — flaggedAt stamping ─────────────────────────

describe('PATCH /api/admin/briefs/:id — flaggedAt stamping', () => {
  it('stamps flaggedAt when toggling false → true', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ flaggedForEdit: false });

    const res = await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'flag', flaggedForEdit: true });

    expect(res.status).toBe(200);
    const updated = await IntelligenceBrief.findById(brief._id).lean();
    expect(updated.flaggedForEdit).toBe(true);
    expect(updated.flaggedAt).toBeInstanceOf(Date);
  });

  it('clears flaggedAt when toggling true → false', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ flaggedForEdit: true, flaggedAt: new Date() });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'unflag', flaggedForEdit: false });

    const updated = await IntelligenceBrief.findById(brief._id).lean();
    expect(updated.flaggedForEdit).toBe(false);
    expect(updated.flaggedAt).toBeNull();
  });

  it('does not overwrite flaggedAt when flaggedForEdit is not in the patch body', async () => {
    const admin = await createAdminUser();
    const initial = new Date('2025-01-01T12:00:00Z');
    const brief = await createBrief({ flaggedForEdit: true, flaggedAt: initial });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'title tweak', title: 'Renamed' });

    const updated = await IntelligenceBrief.findById(brief._id).lean();
    expect(updated.flaggedForEdit).toBe(true);
    expect(updated.flaggedAt?.toISOString()).toBe(initial.toISOString());
  });
});

// ── POST /api/users/report-problem with briefId ──────────────────────────────

describe('POST /api/users/report-problem — briefId attachment', () => {
  it('saves intelligenceBrief ref when briefId is provided', async () => {
    const user  = await createUser();
    const brief = await createBrief({ title: 'Target brief' });

    const res = await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'Typo in section 2', briefId: String(brief._id) });

    expect(res.status).toBe(201);
    const stored = await ProblemReport.findById(res.body.data.report._id).lean();
    expect(String(stored.intelligenceBrief)).toBe(String(brief._id));
  });

  it('auto-flags the brief when a report is submitted against it', async () => {
    const user  = await createUser();
    const brief = await createBrief({ flaggedForEdit: false });

    await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'Wrong info', briefId: String(brief._id) });

    const updated = await IntelligenceBrief.findById(brief._id).lean();
    expect(updated.flaggedForEdit).toBe(true);
    expect(updated.flaggedAt).toBeInstanceOf(Date);
  });

  it('leaves already-flagged brief untouched (no duplicate stamp)', async () => {
    const user    = await createUser();
    const stamped = new Date('2025-02-01T00:00:00Z');
    const brief   = await createBrief({ flaggedForEdit: true, flaggedAt: stamped });

    await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'Another issue', briefId: String(brief._id) });

    const updated = await IntelligenceBrief.findById(brief._id).lean();
    expect(updated.flaggedForEdit).toBe(true);
    expect(updated.flaggedAt?.toISOString()).toBe(stamped.toISOString());
  });

  it('rejects an unknown briefId with 400', async () => {
    const user = await createUser();
    const fakeId = '507f1f77bcf86cd799439011';

    const res = await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'Issue', briefId: fakeId });

    expect(res.status).toBe(400);
  });

  it('still accepts reports without a briefId', async () => {
    const user = await createUser();

    const res = await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'General feedback' });

    expect(res.status).toBe(201);
    expect(res.body.data.report.intelligenceBrief).toBeNull();
  });
});

// ── GET /api/admin/problems — populates intelligenceBrief ────────────────────

describe('GET /api/admin/problems — intelligenceBrief population', () => {
  it('populates intelligenceBrief title on reports that have one', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const brief = await createBrief({ title: 'Populated Brief' });

    await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'bug', briefId: String(brief._id) });

    const res = await request(app)
      .get('/api/admin/problems')
      .set('Cookie', authCookie(admin._id));

    const report = res.body.data.problems[0];
    expect(report.intelligenceBrief).toBeDefined();
    expect(report.intelligenceBrief.title).toBe('Populated Brief');
    expect(report.intelligenceBrief._id).toBe(String(brief._id));
  });

  it('leaves intelligenceBrief null on reports without a brief', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();

    await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .send({ description: 'general' });

    const res = await request(app)
      .get('/api/admin/problems')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.problems[0].intelligenceBrief).toBeNull();
  });
});
