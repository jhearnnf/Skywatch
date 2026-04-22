/**
 * admin.leads.sync.test.js
 *
 * Integration tests for:
 *   POST /api/admin/ai/regenerate-subtitle/:id
 *   PATCH /api/admin/briefs/:id             (lead sync side-effect)
 *   POST /api/admin/intel-leads/sync-from-briefs
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

// Mock priorityRanking so the PATCH-brief category-change path doesn't make
// real AI calls — we just want to assert it's invoked with the right args.
jest.mock('../../utils/priorityRanking', () => ({
  reprioritizeCategory: jest.fn().mockResolvedValue(undefined),
}));

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');

const {
  createSettings,
  createAdminUser, authCookie,
  createBrief, createLead,
} = require('../helpers/factories');

const IntelLead         = require('../../models/IntelLead');
const IntelligenceBrief = require('../../models/IntelligenceBrief');
const { reprioritizeCategory } = require('../../utils/priorityRanking');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  reprioritizeCategory.mockClear();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
afterAll(() => {});

function mockOpenRouterOnce(content) {
  return jest.spyOn(global, 'fetch').mockImplementation((url) => {
    if (String(url).includes('openrouter.ai')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content } }] }),
        text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content } }] })),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ── POST /api/admin/ai/regenerate-subtitle/:id ────────────────────────────

describe('POST /api/admin/ai/regenerate-subtitle/:id', () => {
  it('returns 401 for unauthenticated request', async () => {
    const brief = await createBrief();
    const res = await request(app).post(`/api/admin/ai/regenerate-subtitle/${brief._id}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when brief does not exist', async () => {
    const admin = await createAdminUser();
    const fakeId = '507f1f77bcf86cd799439011';
    const res = await request(app)
      .post(`/api/admin/ai/regenerate-subtitle/${fakeId}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(404);
  });

  it('returns the regenerated subtitle without persisting it', async () => {
    mockOpenRouterOnce(JSON.stringify({ subtitle: 'A freshly minted one-line identity sentence.' }));
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Test Brief', subtitle: 'old subtitle', category: 'Aircrafts' });

    const res = await request(app)
      .post(`/api/admin/ai/regenerate-subtitle/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.subtitle).toBe('A freshly minted one-line identity sentence.');

    // Should NOT have been persisted — the admin saves via the normal PATCH flow.
    const reloaded = await IntelligenceBrief.findById(brief._id);
    expect(reloaded.subtitle).toBe('old subtitle');
  });

  it('returns 500 when the AI returns an empty subtitle', async () => {
    mockOpenRouterOnce(JSON.stringify({ subtitle: '' }));
    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .post(`/api/admin/ai/regenerate-subtitle/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(500);
  });

  it('returns 500 when the AI returns invalid JSON', async () => {
    mockOpenRouterOnce('not-json at all');
    const admin = await createAdminUser();
    const brief = await createBrief();

    const res = await request(app)
      .post(`/api/admin/ai/regenerate-subtitle/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(500);
  });
});

// ── PATCH /api/admin/briefs/:id — lead sync side-effect ────────────────────

describe('PATCH /api/admin/briefs/:id — lead sync', () => {
  it('propagates subtitle changes to the matching lead', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Eurofighter Typhoon', category: 'Aircrafts', subtitle: 'old sub' });
    await createLead({ title: 'Eurofighter Typhoon', category: 'Aircrafts', subtitle: 'old sub' });

    const res = await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'update subtitle', subtitle: 'new shiny subtitle' });

    expect(res.status).toBe(200);

    const lead = await IntelLead.findOne({ title: 'Eurofighter Typhoon' });
    expect(lead.subtitle).toBe('new shiny subtitle');
  });

  it('propagates category/subcategory changes to the matching lead', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({
      title: 'Ground-Based Air Defence',
      category: 'Aircrafts',
      subcategory: 'Fast Jet',
    });
    await createLead({
      title: 'Ground-Based Air Defence',
      category: 'Aircrafts',
      subcategory: 'Fast Jet',
    });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({
        reason:      'move to tech',
        category:    'Tech',
        subcategory: 'Weapons Systems',
      });

    const lead = await IntelLead.findOne({ title: 'Ground-Based Air Defence' });
    expect(lead.category).toBe('Tech');
    expect(lead.subcategory).toBe('Weapons Systems');
  });

  it('clears priorityNumber and triggers reprioritize for old + new category on category change', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'GBAD', category: 'Aircrafts' });
    await createLead({ title: 'GBAD', category: 'Aircrafts', priorityNumber: 3 });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'move to tech', category: 'Tech' });

    const lead = await IntelLead.findOne({ title: 'GBAD' });
    expect(lead.category).toBe('Tech');
    expect(lead.priorityNumber).toBeNull();

    const calls = reprioritizeCategory.mock.calls.map(c => c[0]);
    expect(calls).toContain('Aircrafts');
    expect(calls).toContain('Tech');
  });

  it('does NOT reprioritize when category is unchanged (subtitle-only edit)', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Typhoon', category: 'Aircrafts', subtitle: 'old' });
    await createLead({ title: 'Typhoon', category: 'Aircrafts', priorityNumber: 2 });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'subtitle only', subtitle: 'new' });

    const lead = await IntelLead.findOne({ title: 'Typhoon' });
    expect(lead.priorityNumber).toBe(2);
    expect(reprioritizeCategory).not.toHaveBeenCalled();
  });

  it('propagates nickname changes to the matching lead', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Tornado GR4', category: 'Aircrafts', nickname: '' });
    await createLead({ title: 'Tornado GR4', category: 'Aircrafts', nickname: '' });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'set nickname', nickname: 'Tonka' });

    const lead = await IntelLead.findOne({ title: 'Tornado GR4' });
    expect(lead.nickname).toBe('Tonka');
  });

  it('propagates historic flag to lead.isHistoric', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Cold War Asset', category: 'Aircrafts', historic: false });
    await createLead({ title: 'Cold War Asset', category: 'Aircrafts', isHistoric: false });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'flip historic', historic: true });

    const lead = await IntelLead.findOne({ title: 'Cold War Asset' });
    expect(lead.isHistoric).toBe(true);
  });

  it('matches leads by normalised title (punctuation/case insensitive)', async () => {
    const admin = await createAdminUser();
    // Brief has a "." in its title, lead does not — normalisation strips punctuation so they still match.
    const brief = await createBrief({ title: 'No. 617 Squadron RAF', category: 'Squadrons', subtitle: 'old' });
    const lead  = await createLead({ title: 'No 617 Squadron RAF', category: 'Squadrons', subtitle: 'old' });

    await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'normalised match', subtitle: 'The Dambusters squadron' });

    // Sync also propagates the brief's canonical title to the lead — so look up by _id.
    const updated = await IntelLead.findById(lead._id);
    expect(updated.subtitle).toBe('The Dambusters squadron');
    expect(updated.title).toBe('No. 617 Squadron RAF');
  });

  it('succeeds even when no matching lead exists (non-fatal)', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ title: 'Orphan Brief', category: 'News' });

    const res = await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'no matching lead', subtitle: 'updated' });

    expect(res.status).toBe(200);
    // Verify brief was still updated correctly despite no lead
    const updated = await IntelligenceBrief.findById(brief._id);
    expect(updated.subtitle).toBe('updated');
  });
});

// ── POST /api/admin/intel-leads/sync-from-briefs ──────────────────────────

describe('POST /api/admin/intel-leads/sync-from-briefs', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/intel-leads/sync-from-briefs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user   = await createAdminUser({ isAdmin: false });
    const cookie = authCookie(user._id);
    const res = await request(app)
      .post('/api/admin/intel-leads/sync-from-briefs')
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('overwrites drifted lead fields from matching briefs', async () => {
    const admin = await createAdminUser();
    // Brief is source of truth: category has been manually moved to Tech.
    await createBrief({
      title:       'GBAD System',
      category:    'Tech',
      subcategory: 'Weapons Systems',
      subtitle:    'ground-based air defence radar/missile system',
    });
    // Lead is stale — still points to the old category.
    await createLead({
      title:       'GBAD System',
      category:    'Aircrafts',
      subcategory: 'Fast Jet',
      subtitle:    'old placeholder',
    });

    const res = await request(app)
      .post('/api/admin/intel-leads/sync-from-briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.changedLeads).toBe(1);

    const lead = await IntelLead.findOne({ title: 'GBAD System' });
    expect(lead.category).toBe('Tech');
    expect(lead.subcategory).toBe('Weapons Systems');
    expect(lead.subtitle).toBe('ground-based air defence radar/missile system');
  });

  it('does NOT write anything in dryRun mode but still reports the diff', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Dry Run Target', category: 'Aircrafts', subtitle: 'new' });
    await createLead({ title: 'Dry Run Target', category: 'Aircrafts', subtitle: 'old' });

    const res = await request(app)
      .post('/api/admin/intel-leads/sync-from-briefs?dryRun=true')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.changedLeads).toBe(1);
    expect(res.body.changes[0].updates.subtitle).toBe('new');

    // Confirm lead was NOT actually updated
    const lead = await IntelLead.findOne({ title: 'Dry Run Target' });
    expect(lead.subtitle).toBe('old');
  });

  it('includes stubs as sources of truth (not just published briefs)', async () => {
    const admin = await createAdminUser();
    await createBrief({
      title:    'Stub With Fresh Category',
      category: 'Tech',
      status:   'stub',
    });
    await createLead({ title: 'Stub With Fresh Category', category: 'Aircrafts' });

    await request(app)
      .post('/api/admin/intel-leads/sync-from-briefs')
      .set('Cookie', authCookie(admin._id));

    const lead = await IntelLead.findOne({ title: 'Stub With Fresh Category' });
    expect(lead.category).toBe('Tech');
  });

  it('counts leads with no matching brief under unmatchedLeads', async () => {
    const admin = await createAdminUser();
    await createLead({ title: 'Orphan Lead', category: 'News' });

    const res = await request(app)
      .post('/api/admin/intel-leads/sync-from-briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.unmatchedLeads).toBe(1);
    expect(res.body.unmatched[0].title).toBe('Orphan Lead');
  });

  it('skips leads already in sync', async () => {
    const admin = await createAdminUser();
    await createBrief({ title: 'Already Synced', category: 'News', subtitle: 'same sub' });
    await createLead({ title: 'Already Synced', category: 'News', subtitle: 'same sub' });

    const res = await request(app)
      .post('/api/admin/intel-leads/sync-from-briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.changedLeads).toBe(0);
  });
});
