/**
 * priorityRanking.test.js
 *
 * Unit tests for reprioritizeCategory — specifically the two behaviours added
 * when the AI priority flow was generalised beyond keyword-linking auto-seeding:
 *
 *   1. After re-ranking IntelLead, matching IntelligenceBrief stubs must also
 *      receive the updated priorityNumber (brief-mirror behaviour).
 *   2. When called with an empty newStubs array, any leads with null
 *      priorityNumber must be treated as the "new" entries needing placement.
 *   3. A category that is already fully ranked (no nulls, no newStubs) must
 *      skip the AI call entirely.
 */

process.env.JWT_SECRET = 'test_secret';

const db = require('../helpers/setupDb');
const { reprioritizeCategory } = require('../../utils/priorityRanking');
const IntelLead         = require('../../models/IntelLead');
const IntelligenceBrief = require('../../models/IntelligenceBrief');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// Seed a small category with three leads + matching stub briefs.
async function seedCategory({ unranked = [], ranked = [] } = {}) {
  const leads = [];
  for (const { title, priorityNumber = null } of [...ranked, ...unranked]) {
    leads.push(await IntelLead.create({
      title,
      category: 'Roles',
      subcategory: 'Intelligence Officer',
      priorityNumber,
    }));
    await IntelligenceBrief.create({
      title,
      category: 'Roles',
      subcategory: 'Intelligence Officer',
      status: 'stub',
      priorityNumber,
    });
  }
  return leads;
}

// Build a fake openRouterChat that returns a pre-canned rankings array.
function mockChat(rankings) {
  return jest.fn(async () => ({
    choices: [{ message: { content: JSON.stringify({ rankings }) } }],
  }));
}

// Fake openRouterChat returning a pre-canned placements array (incremental mode).
function mockPlacementChat(placements) {
  return jest.fn(async () => ({
    choices: [{ message: { content: JSON.stringify({ placements }) } }],
  }));
}

describe('reprioritizeCategory — brief mirror + empty-newStubs behaviour', () => {
  it('mirrors updated priorities onto matching IntelligenceBrief documents', async () => {
    await seedCategory({
      ranked:   [{ title: 'Alpha', priorityNumber: 1 }, { title: 'Bravo', priorityNumber: 2 }],
      unranked: [{ title: 'Charlie' }],
    });

    const chat = mockChat([
      { title: 'Alpha',   priority: 1 },
      { title: 'Bravo',   priority: 3 },
      { title: 'Charlie', priority: 2 },
    ]);

    await reprioritizeCategory(
      'Roles',
      [{ title: 'Charlie' }],
      null,
      'test',
      chat,
    );

    expect(chat).toHaveBeenCalledTimes(1);

    // Leads updated
    const alphaLead   = await IntelLead.findOne({ title: 'Alpha' });
    const bravoLead   = await IntelLead.findOne({ title: 'Bravo' });
    const charlieLead = await IntelLead.findOne({ title: 'Charlie' });
    expect(alphaLead.priorityNumber).toBe(1);
    expect(bravoLead.priorityNumber).toBe(3);
    expect(charlieLead.priorityNumber).toBe(2);

    // Briefs mirrored
    const alphaBrief   = await IntelligenceBrief.findOne({ title: 'Alpha', category: 'Roles' });
    const bravoBrief   = await IntelligenceBrief.findOne({ title: 'Bravo', category: 'Roles' });
    const charlieBrief = await IntelligenceBrief.findOne({ title: 'Charlie', category: 'Roles' });
    expect(alphaBrief.priorityNumber).toBe(1);
    expect(bravoBrief.priorityNumber).toBe(3);
    expect(charlieBrief.priorityNumber).toBe(2);
  });

  it('treats every null-priority lead as "new" when called with empty newStubs', async () => {
    await seedCategory({
      ranked:   [{ title: 'Alpha', priorityNumber: 1 }],
      unranked: [{ title: 'Bravo' }, { title: 'Charlie' }],
    });

    const chat = mockChat([
      { title: 'Alpha',   priority: 1 },
      { title: 'Bravo',   priority: 2 },
      { title: 'Charlie', priority: 3 },
    ]);

    await reprioritizeCategory('Roles', [], null, 'test', chat);

    expect(chat).toHaveBeenCalledTimes(1);
    // Prompt must mention the two null-priority leads as the ones to place
    const prompt = chat.mock.calls[0][0][0].content;
    expect(prompt).toContain('"Bravo"');
    expect(prompt).toContain('"Charlie"');

    const bravo = await IntelLead.findOne({ title: 'Bravo' });
    const charlie = await IntelLead.findOne({ title: 'Charlie' });
    expect(bravo.priorityNumber).toBe(2);
    expect(charlie.priorityNumber).toBe(3);
  });

  it('skips the AI call entirely when the category is already fully ranked', async () => {
    await seedCategory({
      ranked: [
        { title: 'Alpha', priorityNumber: 1 },
        { title: 'Bravo', priorityNumber: 2 },
      ],
    });

    const chat = mockChat([]); // should never be consulted
    await reprioritizeCategory('Roles', [], null, 'test', chat);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('reprioritizeCategory — incremental placement for large categories', () => {
  // Build a category with `rankedCount` already-ranked leads (titles R1..Rn)
  // and `unrankedTitles` null-priority leads.
  async function seedLarge(rankedCount, unrankedTitles = []) {
    const ranked = [];
    for (let i = 1; i <= rankedCount; i++) {
      ranked.push({ title: `R${i}`, priorityNumber: i });
    }
    await seedCategory({
      ranked,
      unranked: unrankedTitles.map(title => ({ title })),
    });
  }

  it('uses incremental placement when ranked >= 20 and new <= 10', async () => {
    await seedLarge(25, ['NewA', 'NewB']);

    // Incremental prompt expects "placements", not "rankings".
    const chat = mockPlacementChat([
      { title: 'NewA', priority: 5 },
      { title: 'NewB', priority: 20 },
    ]);

    await reprioritizeCategory('Roles', [{ title: 'NewA' }, { title: 'NewB' }], null, 'test', chat);

    expect(chat).toHaveBeenCalledTimes(1);
    const prompt = chat.mock.calls[0][0][0].content;
    // Incremental prompt says "inserting" and asks for "placements"
    expect(prompt).toContain('inserting new RAF intel brief topics');
    expect(prompt).toContain('"placements"');

    // NewA inserted at priority 5 → pushes R5..R25 down by 1
    const newA = await IntelLead.findOne({ title: 'NewA' });
    expect(newA.priorityNumber).toBe(5);

    // R1..R4 untouched
    const r1 = await IntelLead.findOne({ title: 'R1' });
    const r4 = await IntelLead.findOne({ title: 'R4' });
    expect(r1.priorityNumber).toBe(1);
    expect(r4.priorityNumber).toBe(4);

    // R5 pushed to 6
    const r5 = await IntelLead.findOne({ title: 'R5' });
    expect(r5.priorityNumber).toBe(6);

    // NewB requested priority 20. After NewA inserted at slot 5,
    // working list is [R1..R4, NewA, R5..R25] (26 items). Inserting NewB at
    // index 19 places it at final priority 20. R19 (which was at working
    // index 19 after NewA's insertion — i.e. R19 itself) shifts down.
    const newB = await IntelLead.findOne({ title: 'NewB' });
    expect(newB.priorityNumber).toBe(20);

    // Final list must be a valid 1..27 sequence with no gaps/duplicates.
    const all = await IntelLead.find({ category: 'Roles' }).lean();
    const priorities = all.map(l => l.priorityNumber).sort((a, b) => a - b);
    expect(priorities).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));

    // Brief mirrors
    const newABrief = await IntelligenceBrief.findOne({ title: 'NewA', category: 'Roles' });
    const newBBrief = await IntelligenceBrief.findOne({ title: 'NewB', category: 'Roles' });
    expect(newABrief.priorityNumber).toBe(5);
    expect(newBBrief.priorityNumber).toBe(20);
  });

  it('falls back to full rerank when incremental AI response is invalid', async () => {
    await seedLarge(25, ['NewA']);

    // First call returns incremental response (placements) but with wrong
    // length → fails validation on all 3 attempts. Fourth call onwards
    // returns full-rerank response (rankings).
    const fullRankings = [];
    for (let i = 1; i <= 25; i++) fullRankings.push({ title: `R${i}`, priority: i });
    fullRankings.push({ title: 'NewA', priority: 26 });

    const chat = jest.fn()
      // attempts 1-3: malformed incremental (empty placements array)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ placements: [] }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ placements: [] }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ placements: [] }) } }] })
      // fallback full rerank
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ rankings: fullRankings }) } }] });

    await reprioritizeCategory('Roles', [{ title: 'NewA' }], null, 'test', chat);

    expect(chat).toHaveBeenCalledTimes(4);

    const newA = await IntelLead.findOne({ title: 'NewA' });
    expect(newA.priorityNumber).toBe(26);
  });

  it('uses full rerank (not incremental) when too many new items are to place', async () => {
    // 25 ranked + 11 new → toPlace (11) exceeds INCREMENTAL_MAX_TO_PLACE (10)
    const newTitles = Array.from({ length: 11 }, (_, i) => `N${i + 1}`);
    await seedLarge(25, newTitles);

    const fullRankings = [];
    for (let i = 1; i <= 25; i++) fullRankings.push({ title: `R${i}`, priority: i });
    newTitles.forEach((t, i) => fullRankings.push({ title: t, priority: 26 + i }));

    const chat = mockChat(fullRankings);
    await reprioritizeCategory('Roles', newTitles.map(title => ({ title })), null, 'test', chat);

    expect(chat).toHaveBeenCalledTimes(1);
    // Prompt must be the full-rerank variant, not incremental
    const prompt = chat.mock.calls[0][0][0].content;
    expect(prompt).toContain('ordering a list of RAF intel brief topics');
    expect(prompt).not.toContain('"placements"');
  });
});
