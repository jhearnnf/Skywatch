/**
 * admin.leads.test.js
 *
 * Integration tests for:
 *   GET  /api/admin/intel-leads
 *   POST /api/admin/intel-leads/mark-complete
 *   POST /api/admin/leads/reset
 *   seedLeads (unit tests)
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createSettings, createAdminUser, authCookie, createLead } = require('../helpers/factories');
const IntelLead         = require('../../models/IntelLead');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const seedLeads         = require('../../seeds/seedLeads');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(() => {});

// ── seedLeads unit tests ────────────────────────────────────────────────────

describe('seedLeads', () => {
  it('inserts leads with title, nickname, subtitle fields', async () => {
    await seedLeads();
    const count = await IntelLead.countDocuments();
    expect(count).toBeGreaterThan(0);

    const lead = await IntelLead.findOne({ title: 'No. 617 Squadron RAF' });
    expect(lead).toBeTruthy();
    expect(lead.nickname).toBe('The Dambusters');
    expect(lead.subtitle).toBeTruthy();
    expect(lead.category).toBe('Squadrons');
  });

  it('creates a stub IntelligenceBrief for every lead', async () => {
    await seedLeads();
    const leadCount = await IntelLead.countDocuments();
    const stubCount = await IntelligenceBrief.countDocuments({ status: 'stub' });
    expect(stubCount).toBe(leadCount);
  });

  it('all seeded leads have isPublished: false', async () => {
    await seedLeads();
    const published = await IntelLead.countDocuments({ isPublished: true });
    expect(published).toBe(0);
  });

  it('all seeded stubs have no descriptionSections', async () => {
    await seedLeads();
    const withContent = await IntelligenceBrief.countDocuments({ descriptionSections: { $ne: [] } });
    expect(withContent).toBe(0);
  });
});

// ── Auth guards ────────────────────────────────────────────────────────────

describe('GET /api/admin/intel-leads — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/intel-leads');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user   = await createAdminUser({ isAdmin: false });
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/intel-leads/mark-complete — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/intel-leads/mark-complete').send({ title: 'test' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/intel-leads ─────────────────────────────────────────────

describe('GET /api/admin/intel-leads', () => {
  it('returns only unpublished leads', async () => {
    await createLead({ title: 'Unpublished Lead A', isPublished: false });
    await createLead({ title: 'Published Lead B',   isPublished: true  });
    await createLead({ title: 'Unpublished Lead C', isPublished: false });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.leads).toHaveLength(2);
    expect(res.body.data.leads.every(l => !l.isPublished)).toBe(true);
  });

  it('returns empty array when all leads are published', async () => {
    await createLead({ title: 'Done Lead', isPublished: true });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.leads).toHaveLength(0);
  });

  it('returns title, nickname, subtitle, section, subsection fields', async () => {
    await createLead({
      title:      'RAF Lossiemouth',
      nickname:   '',
      subtitle:   'Scotland\'s primary fast jet base',
      section:    'RAF BASES',
      subsection: 'UK Active',
      category:   'Bases',
    });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    const lead = res.body.data.leads[0];
    expect(lead.title).toBe('RAF Lossiemouth');
    expect(lead.subtitle).toBe('Scotland\'s primary fast jet base');
    expect(lead.section).toBe('RAF BASES');
    expect(lead.subsection).toBe('UK Active');
  });

  it('does NOT return the nickname/title/subtitle keys as undefined on leads without them', async () => {
    await createLead({ title: 'Plain Lead' });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    const lead = res.body.data.leads[0];
    expect(lead.title).toBe('Plain Lead');
    expect(lead.nickname).toBe('');
    expect(lead.subtitle).toBe('');
  });
});

// ── POST /api/admin/intel-leads/mark-complete ──────────────────────────────

describe('POST /api/admin/intel-leads/mark-complete', () => {
  it('marks a lead as published by title', async () => {
    await createLead({ title: 'Typhoon FGR4', isPublished: false });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ title: 'Typhoon FGR4' });

    expect(res.status).toBe(200);
    const updated = await IntelLead.findOne({ title: 'Typhoon FGR4' });
    expect(updated.isPublished).toBe(true);
  });

  it('returns 404 when lead title does not exist', async () => {
    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ title: 'Nonexistent Lead' });

    expect(res.status).toBe(404);
  });

  it('returns 404 when lead is already published', async () => {
    await createLead({ title: 'Already Done', isPublished: true });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ title: 'Already Done' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when no lead body provided', async () => {
    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it('trims whitespace from the lead title when matching', async () => {
    await createLead({ title: 'Padded Lead', isPublished: false });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ title: '  Padded Lead  ' });

    expect(res.status).toBe(200);
    const updated = await IntelLead.findOne({ title: 'Padded Lead' });
    expect(updated.isPublished).toBe(true);
  });
});

// ── POST /api/admin/leads/reset ───────────────────────────────────────────

describe('POST /api/admin/leads/reset', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/leads/reset').send({ reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user   = await createAdminUser({ isAdmin: false });
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/leads/reset')
      .set('Cookie', cookie)
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no reason provided', async () => {
    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/leads/reset')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('wipes leads and creates new leads + stub briefs', async () => {
    // Pre-populate some old leads so we can verify they are replaced
    await createLead({ title: 'Old Lead To Be Wiped' });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/leads/reset')
      .set('Cookie', cookie)
      .send({ reason: 'Resetting for new schema' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.leadsInserted).toBeGreaterThan(0);
    expect(res.body.data.stubsCreated).toBeGreaterThan(0);

    // Old lead should be gone
    const oldLead = await IntelLead.findOne({ title: 'Old Lead To Be Wiped' });
    expect(oldLead).toBeNull();

    // Stub briefs should exist
    const stubs = await IntelligenceBrief.find({ status: 'stub' });
    expect(stubs.length).toBe(res.body.data.stubsCreated);
    // Each stub should have at least title and category
    stubs.forEach(s => {
      expect(s.title).toBeTruthy();
      expect(s.category).toBeTruthy();
    });
  });
});
