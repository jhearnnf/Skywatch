/**
 * admin.leads.test.js
 *
 * Integration tests for:
 *   GET  /api/admin/intel-leads
 *   POST /api/admin/intel-leads/mark-complete
 *   seedLeads parser
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createSettings, createAdminUser, authCookie } = require('../helpers/factories');
const IntelLead = require('../../models/IntelLead');
const { parseLeadsFile } = require('../../seeds/seedLeads');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(() => {});

// ── Parser unit tests ──────────────────────────────────────────────────────

describe('parseLeadsFile', () => {
  const SAMPLE = `
================================================================================
SKYWATCH — HEADER
================================================================================

LEGEND
  [DB]  = published

================================================================================
SECTION 1: RAF RANKS
================================================================================

--- COMMISSIONED OFFICER RANKS ---
Air Chief Marshal
Air Marshal [DB]

--- NON-COMMISSIONED RANKS ---
Flight Sergeant

================================================================================
SECTION 2: RAF SQUADRONS
================================================================================

--- ACTIVE FRONT-LINE SQUADRONS ---
No. 1 Squadron RAF
No. 617 Squadron RAF (The Dambusters) [DB]

END OF FILE
`.trim();

  it('returns one entry per lead line', () => {
    const leads = parseLeadsFile(SAMPLE);
    expect(leads).toHaveLength(5);
  });

  it('marks [DB] lines as isPublished: true and strips the tag from text', () => {
    const leads = parseLeadsFile(SAMPLE);
    const marshal = leads.find(l => l.text === 'Air Marshal');
    expect(marshal.isPublished).toBe(true);
  });

  it('marks non-[DB] lines as isPublished: false', () => {
    const leads = parseLeadsFile(SAMPLE);
    const acm = leads.find(l => l.text === 'Air Chief Marshal');
    expect(acm.isPublished).toBe(false);
  });

  it('strips [DB] from text so text does not contain the tag', () => {
    const leads = parseLeadsFile(SAMPLE);
    expect(leads.every(l => !l.text.includes('[DB]'))).toBe(true);
  });

  it('attaches section and subsection correctly', () => {
    const leads = parseLeadsFile(SAMPLE);
    const fs    = leads.find(l => l.text === 'Flight Sergeant');
    expect(fs.section).toBe('SECTION 1: RAF RANKS');
    expect(fs.subsection).toBe('NON-COMMISSIONED RANKS');
  });

  it('skips header/legend/footer lines', () => {
    const leads = parseLeadsFile(SAMPLE);
    expect(leads.find(l => l.text.includes('SKYWATCH'))).toBeUndefined();
    expect(leads.find(l => l.text.includes('LEGEND'))).toBeUndefined();
    expect(leads.find(l => l.text.includes('END OF'))).toBeUndefined();
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
    const res = await request(app).post('/api/admin/intel-leads/mark-complete').send({ lead: 'test' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/intel-leads ─────────────────────────────────────────────

describe('GET /api/admin/intel-leads', () => {
  it('returns only unpublished leads', async () => {
    await IntelLead.create([
      { text: 'Unpublished Lead A', section: 'S1', subsection: 'sub1', isPublished: false },
      { text: 'Published Lead B',   section: 'S1', subsection: 'sub1', isPublished: true  },
      { text: 'Unpublished Lead C', section: 'S2', subsection: 'sub2', isPublished: false },
    ]);

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.leads).toHaveLength(2);
    expect(res.body.data.leads.every(l => !l.isPublished)).toBe(true);
  });

  it('returns empty array when all leads are published', async () => {
    await IntelLead.create({ text: 'Done Lead', section: 'S1', subsection: 's', isPublished: true });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.leads).toHaveLength(0);
  });

  it('returns text, section, subsection fields', async () => {
    await IntelLead.create({ text: 'My Lead', section: 'SECTION 1', subsection: 'SUBSEC', isPublished: false });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app).get('/api/admin/intel-leads').set('Cookie', cookie);

    const lead = res.body.data.leads[0];
    expect(lead.text).toBe('My Lead');
    expect(lead.section).toBe('SECTION 1');
    expect(lead.subsection).toBe('SUBSEC');
  });
});

// ── POST /api/admin/intel-leads/mark-complete ──────────────────────────────

describe('POST /api/admin/intel-leads/mark-complete', () => {
  it('marks a lead as published', async () => {
    await IntelLead.create({ text: 'Typhoon FGR4', section: 'S1', subsection: 's', isPublished: false });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ lead: 'Typhoon FGR4' });

    expect(res.status).toBe(200);
    const updated = await IntelLead.findOne({ text: 'Typhoon FGR4' });
    expect(updated.isPublished).toBe(true);
  });

  it('returns 404 when lead text does not exist', async () => {
    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ lead: 'Nonexistent Lead' });

    expect(res.status).toBe(404);
  });

  it('returns 404 when lead is already published', async () => {
    await IntelLead.create({ text: 'Already Done', section: 'S1', subsection: 's', isPublished: true });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ lead: 'Already Done' });

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

  it('trims whitespace from the lead text when matching', async () => {
    await IntelLead.create({ text: 'Padded Lead', section: 'S1', subsection: 's', isPublished: false });

    const user   = await createAdminUser();
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/mark-complete')
      .set('Cookie', cookie)
      .send({ lead: '  Padded Lead  ' });

    expect(res.status).toBe(200);
    const updated = await IntelLead.findOne({ text: 'Padded Lead' });
    expect(updated.isPublished).toBe(true);
  });
});
