/**
 * admin.rankOrder.test.js
 *
 * Integration tests for the lead-driven rank-order system:
 *
 *   • POST /api/admin/ai/generate-rank-data/:id resolves via lead.rankOrder
 *     when one is set (the legacy hardcoded table is now a fallback only).
 *   • POST /api/admin/intel-leads/recompact-rank-order self-heals 1..N.
 *   • PATCH /api/admin/briefs/:id with a new gameData.rankHierarchyOrder
 *     propagates to the matching lead via setRankOrder, shifting siblings.
 *   • The endpoint also still resolves the legacy alias "Air Specialist
 *     (Class 1)" via the canonical fallback when no lead is present —
 *     the bug that prompted this change.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createAdminUser,
  createSettings,
  authCookie,
  createBrief,
  createLead,
} = require('../helpers/factories');

const IntelLead         = require('../../models/IntelLead');
const IntelligenceBrief = require('../../models/IntelligenceBrief');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(() => {});

describe('POST /api/admin/ai/generate-rank-data/:id — lead-driven', () => {
  it('resolves "Air Specialist (Class 1)" via the canonical fallback when no lead is present', async () => {
    // This is the original bug scenario: the title is the modern name introduced
    // by cleanseRanksBriefs.js, which the legacy hardcoded table did not know.
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'Ranks', title: 'Air Specialist (Class 1)' });

    const res = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.rankHierarchyOrder).toBe(19);
  });

  it('prefers lead.rankOrder over the canonical fallback', async () => {
    const admin = await createAdminUser();
    await createLead({
      title: 'Air Specialist (Class 1)',
      category: 'Ranks',
      subcategory: 'Specialist Role',
      rankOrder: 7, // Deliberately non-canonical to prove the lead wins.
    });
    const brief = await createBrief({ category: 'Ranks', title: 'Air Specialist (Class 1)' });

    const res = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.rankHierarchyOrder).toBe(7);
  });
});

describe('POST /api/admin/intel-leads/recompact-rank-order', () => {
  it('renumbers gappy rankOrders to a contiguous 1..N and mirrors to briefs', async () => {
    const admin = await createAdminUser();
    await createLead({ title: 'A', category: 'Ranks', rankOrder: 1 });
    await createLead({ title: 'B', category: 'Ranks', rankOrder: 5 });
    await createLead({ title: 'C', category: 'Ranks', rankOrder: 9 });
    await createBrief({ title: 'A', category: 'Ranks' });
    await createBrief({ title: 'B', category: 'Ranks' });
    await createBrief({ title: 'C', category: 'Ranks' });

    const res = await request(app)
      .post('/api/admin/intel-leads/recompact-rank-order')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const leads = await IntelLead.find({ category: 'Ranks' }).sort({ rankOrder: 1 }).lean();
    expect(leads.map(l => ({ t: l.title, o: l.rankOrder }))).toEqual([
      { t: 'A', o: 1 }, { t: 'B', o: 2 }, { t: 'C', o: 3 },
    ]);

    const briefs = await IntelligenceBrief.find({ category: 'Ranks' }).lean();
    const orderByTitle = Object.fromEntries(
      briefs.map(b => [b.title, b.gameData?.rankHierarchyOrder ?? null])
    );
    expect(orderByTitle).toEqual({ A: 1, B: 2, C: 3 });
  });
});

describe('PATCH /api/admin/briefs/:id — manual rankHierarchyOrder edits', () => {
  it('propagates a manual change into the lead and shifts siblings', async () => {
    const admin = await createAdminUser();
    // Seed three Ranks leads + briefs at slots 1..3.
    for (const [i, title] of ['A', 'B', 'C'].entries()) {
      await createLead({ title, category: 'Ranks', rankOrder: i + 1 });
      await createBrief({
        title,
        category: 'Ranks',
        gameData: { rankHierarchyOrder: i + 1 },
      });
    }

    const briefC = await IntelligenceBrief.findOne({ title: 'C' });

    // Admin edits brief C's slot from 3 → 1.
    const res = await request(app)
      .patch(`/api/admin/briefs/${briefC._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'reslot rank', gameData: { rankHierarchyOrder: 1 } });

    expect(res.status).toBe(200);

    // Lead C is now slot 1; A and B shifted down to 2 and 3.
    const leads = await IntelLead.find({ category: 'Ranks' }).sort({ rankOrder: 1 }).lean();
    expect(leads.map(l => ({ t: l.title, o: l.rankOrder }))).toEqual([
      { t: 'C', o: 1 }, { t: 'A', o: 2 }, { t: 'B', o: 3 },
    ]);

    // Briefs mirror the new order.
    const briefs = await IntelligenceBrief.find({ category: 'Ranks' }).lean();
    const orderByTitle = Object.fromEntries(
      briefs.map(b => [b.title, b.gameData?.rankHierarchyOrder ?? null])
    );
    expect(orderByTitle).toEqual({ C: 1, A: 2, B: 3 });
  });
});
