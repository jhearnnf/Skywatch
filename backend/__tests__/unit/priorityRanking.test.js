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
