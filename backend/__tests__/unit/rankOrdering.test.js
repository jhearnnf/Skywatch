/**
 * rankOrdering.test.js — unit tests for backend/utils/rankOrdering.js
 *
 * Covers the deterministic rank-order management used by Ranks leads:
 *   • compactRankOrder closes gaps and mirrors to briefs
 *   • insertRankAt bumps siblings ≥ slot
 *   • removeRank shifts everyone above the removed slot down
 *   • setRankOrder repositions an existing rank
 *   • appendRank places a new lead at max+1
 */

process.env.JWT_SECRET = 'test_secret';

const db                 = require('../helpers/setupDb');
const IntelLead          = require('../../models/IntelLead');
const IntelligenceBrief  = require('../../models/IntelligenceBrief');
const {
  compactRankOrder,
  insertRankAt,
  removeRank,
  setRankOrder,
  appendRank,
} = require('../../utils/rankOrdering');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// Seed N Ranks leads + matching stub briefs at slots 1..N. Order in `titles`
// is the desired rank order.
async function seedRanks(titles) {
  const leads = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const order = i + 1;
    leads.push(await IntelLead.create({
      title,
      category: 'Ranks',
      subcategory: 'Commissioned Officer',
      rankOrder: order,
    }));
    await IntelligenceBrief.create({
      title,
      category: 'Ranks',
      subcategory: 'Commissioned Officer',
      status: 'stub',
      gameData: { rankHierarchyOrder: order },
    });
  }
  return leads;
}

async function leadsByOrder() {
  const leads = await IntelLead.find({ category: 'Ranks' })
    .select('title rankOrder')
    .lean();
  return leads
    .filter(l => l.rankOrder != null)
    .sort((a, b) => a.rankOrder - b.rankOrder)
    .map(l => ({ title: l.title, rankOrder: l.rankOrder }));
}

async function briefMirror(title) {
  const b = await IntelligenceBrief.findOne({ category: 'Ranks', title }).lean();
  return b?.gameData?.rankHierarchyOrder ?? null;
}

// ── compactRankOrder ─────────────────────────────────────────────────────────
describe('compactRankOrder', () => {
  it('closes a gap left by a missing slot', async () => {
    await IntelLead.create({ title: 'A', category: 'Ranks', rankOrder: 1 });
    await IntelLead.create({ title: 'B', category: 'Ranks', rankOrder: 3 }); // gap at 2
    await IntelLead.create({ title: 'C', category: 'Ranks', rankOrder: 5 }); // gap at 4
    await IntelligenceBrief.create({ title: 'A', category: 'Ranks', status: 'stub' });
    await IntelligenceBrief.create({ title: 'B', category: 'Ranks', status: 'stub' });
    await IntelligenceBrief.create({ title: 'C', category: 'Ranks', status: 'stub' });

    const r = await compactRankOrder();
    expect(r.leadsCompacted).toBeGreaterThan(0);

    expect(await leadsByOrder()).toEqual([
      { title: 'A', rankOrder: 1 },
      { title: 'B', rankOrder: 2 },
      { title: 'C', rankOrder: 3 },
    ]);
    expect(await briefMirror('A')).toBe(1);
    expect(await briefMirror('B')).toBe(2);
    expect(await briefMirror('C')).toBe(3);
  });

  it('is idempotent — second run is a no-op', async () => {
    await seedRanks(['A', 'B', 'C']);
    const r1 = await compactRankOrder();
    expect(r1.leadsCompacted).toBe(0);
    const r2 = await compactRankOrder();
    expect(r2.leadsCompacted).toBe(0);
  });

  it('preserves null rankOrder leads — they stay out of the sequence', async () => {
    // Null leads are intentionally excluded (e.g. commission concepts in
    // Specialist Role). Compact must NOT re-assign them slots.
    await seedRanks(['A', 'B', 'C']);
    await IntelLead.create({ title: 'D', category: 'Ranks', rankOrder: null });
    await IntelligenceBrief.create({ title: 'D', category: 'Ranks', status: 'stub' });

    await compactRankOrder();

    expect(await leadsByOrder()).toEqual([
      { title: 'A', rankOrder: 1 },
      { title: 'B', rankOrder: 2 },
      { title: 'C', rankOrder: 3 },
    ]);
    const dLead = await IntelLead.findOne({ title: 'D' }).lean();
    expect(dLead.rankOrder).toBeNull();
    // D's brief mirror also stays null (no Seniority stat shown).
    expect(await briefMirror('D')).toBeNull();
  });
});

// ── insertRankAt ────────────────────────────────────────────────────────────
describe('insertRankAt', () => {
  it('bumps every existing lead at or above the target slot by +1', async () => {
    const [a, b, c] = await seedRanks(['A', 'B', 'C']);

    const newLead = await IntelLead.create({
      title: 'NewRank', category: 'Ranks', rankOrder: null,
    });
    await IntelligenceBrief.create({ title: 'NewRank', category: 'Ranks', status: 'stub' });

    await insertRankAt(newLead._id, 2);

    expect(await leadsByOrder()).toEqual([
      { title: 'A',       rankOrder: 1 },
      { title: 'NewRank', rankOrder: 2 },
      { title: 'B',       rankOrder: 3 },
      { title: 'C',       rankOrder: 4 },
    ]);
    // Mirror reaches all four briefs.
    expect(await briefMirror('A')).toBe(1);
    expect(await briefMirror('NewRank')).toBe(2);
    expect(await briefMirror('B')).toBe(3);
    expect(await briefMirror('C')).toBe(4);
  });

  it('clamps target to 1..N+1', async () => {
    await seedRanks(['A', 'B', 'C']);
    const lead = await IntelLead.create({ title: 'Z', category: 'Ranks', rankOrder: null });
    await IntelligenceBrief.create({ title: 'Z', category: 'Ranks', status: 'stub' });

    // 99 → clamp to 4 (end of list).
    await insertRankAt(lead._id, 99);
    const fresh = await IntelLead.findById(lead._id).lean();
    expect(fresh.rankOrder).toBe(4);
  });
});

// ── removeRank ──────────────────────────────────────────────────────────────
describe('removeRank', () => {
  it('shifts everyone above the removed slot down by 1', async () => {
    const [a, b, c, d] = await seedRanks(['A', 'B', 'C', 'D']);

    await removeRank(b._id);

    // B's slot is cleared; C and D shift down.
    const remaining = await leadsByOrder();
    expect(remaining).toEqual([
      { title: 'A', rankOrder: 1 },
      { title: 'C', rankOrder: 2 },
      { title: 'D', rankOrder: 3 },
    ]);
    const bAfter = await IntelLead.findById(b._id).lean();
    expect(bAfter.rankOrder).toBeNull();

    // B's brief has its mirror cleared.
    const bBrief = await IntelligenceBrief.findOne({ title: 'B', category: 'Ranks' }).lean();
    expect(bBrief?.gameData?.rankHierarchyOrder).toBeUndefined();
    expect(await briefMirror('C')).toBe(2);
    expect(await briefMirror('D')).toBe(3);
  });

  it('is a no-op when the lead has no rankOrder', async () => {
    const lead = await IntelLead.create({ title: 'X', category: 'Ranks', rankOrder: null });
    const r = await removeRank(lead._id);
    expect(r.leadsShifted).toBe(0);
  });
});

// ── setRankOrder ────────────────────────────────────────────────────────────
describe('setRankOrder', () => {
  it('moves a rank from slot 4 to slot 2 with no gaps', async () => {
    const [, , , d] = await seedRanks(['A', 'B', 'C', 'D']);

    await setRankOrder(d._id, 2);

    expect(await leadsByOrder()).toEqual([
      { title: 'A', rankOrder: 1 },
      { title: 'D', rankOrder: 2 },
      { title: 'B', rankOrder: 3 },
      { title: 'C', rankOrder: 4 },
    ]);
  });

  it('moves up the list (slot 2 → slot 4)', async () => {
    const [, b] = await seedRanks(['A', 'B', 'C', 'D']);

    await setRankOrder(b._id, 4);

    expect(await leadsByOrder()).toEqual([
      { title: 'A', rankOrder: 1 },
      { title: 'C', rankOrder: 2 },
      { title: 'D', rankOrder: 3 },
      { title: 'B', rankOrder: 4 },
    ]);
  });

  it('treats an unranked lead as an insertion', async () => {
    await seedRanks(['A', 'B', 'C']);
    const lead = await IntelLead.create({ title: 'New', category: 'Ranks', rankOrder: null });
    await IntelligenceBrief.create({ title: 'New', category: 'Ranks', status: 'stub' });

    await setRankOrder(lead._id, 1);

    expect(await leadsByOrder()).toEqual([
      { title: 'New', rankOrder: 1 },
      { title: 'A',   rankOrder: 2 },
      { title: 'B',   rankOrder: 3 },
      { title: 'C',   rankOrder: 4 },
    ]);
  });
});

// ── appendRank ──────────────────────────────────────────────────────────────
describe('appendRank', () => {
  it('places a new lead at max+1', async () => {
    await seedRanks(['A', 'B', 'C']);
    const lead = await IntelLead.create({ title: 'Tail', category: 'Ranks', rankOrder: null });
    await IntelligenceBrief.create({ title: 'Tail', category: 'Ranks', status: 'stub' });

    const r = await appendRank(lead._id);
    expect(r.rankOrder).toBe(4);

    const fresh = await IntelLead.findById(lead._id).lean();
    expect(fresh.rankOrder).toBe(4);
    expect(await briefMirror('Tail')).toBe(4);
  });

  it('skips when the lead already has a rankOrder', async () => {
    const [a] = await seedRanks(['A']);
    const r = await appendRank(a._id);
    expect(r).toEqual(expect.objectContaining({ briefsUpdated: 0 }));
    const fresh = await IntelLead.findById(a._id).lean();
    expect(fresh.rankOrder).toBe(1);
  });
});
