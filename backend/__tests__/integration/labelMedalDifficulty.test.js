/**
 * Backfill of the difficulty on medal messages already in the Medals channel.
 *
 * Old messages named the Easier half ("FLAG (Easier)") but not the Hard one
 * ("FLAG"), which reads as one board rather than two. A bare label can only have
 * come from the Hard key, so it maps cleanly.
 */
process.env.JWT_SECRET = 'test_secret';

const db = require('../helpers/setupDb');
const labelMedalDifficulty = require('../../migrations/labelMedalDifficulty');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

const silent = { log: () => {} };

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function seedFeed(texts) {
  const channel = await ChatConversation.create({
    type: 'channel', isArchived: false,
    channel: { name: 'Medals', slug: 'medals', postPolicy: 'bot' },
  });
  for (const body of texts) {
    await ChatMessage.create({ conversationId: channel._id, senderRole: 'user', body });
  }
  return channel;
}

const bodies = async (channelId) =>
  (await ChatMessage.find({ conversationId: channelId }).sort({ createdAt: 1 }).lean())
    .map(m => m.body);

it('marks a bare split-game label as Hard', async () => {
  const channel = await seedFeed([
    '🥇 Falcon took Gold on FLAG with 420.',
    '🥈 Viper took Silver on Cognitive Updating Test with 900. Up from 3rd.',
  ]);

  const res = await labelMedalDifficulty({ logger: silent });

  expect(res.fixed).toBe(2);
  expect(await bodies(channel._id)).toEqual([
    '🥇 Falcon took Gold on FLAG (Hard) with 420.',
    '🥈 Viper took Silver on Cognitive Updating Test (Hard) with 900. Up from 3rd.',
  ]);
});

it('leaves the Easier half, and games with no split, alone', async () => {
  const channel = await seedFeed([
    '🥇 Falcon took Gold on FLAG (Easier) with 300.',
    '🥉 Nomad took Bronze on Target with 4250.',
  ]);

  const res = await labelMedalDifficulty({ logger: silent });

  expect(res.fixed).toBe(0);
  expect(await bodies(channel._id)).toEqual([
    '🥇 Falcon took Gold on FLAG (Easier) with 300.',
    '🥉 Nomad took Bronze on Target with 4250.',
  ]);
});

it('does not rewrite a game name sitting anywhere but the game slot', async () => {
  // Display names are user-chosen, so one can read exactly like a game.
  const channel = await seedFeed(['🥇 FLAG took Gold on Target with 4250.']);

  await labelMedalDifficulty({ logger: silent });

  expect((await bodies(channel._id))[0]).toBe('🥇 FLAG took Gold on Target with 4250.');
});

it('is idempotent', async () => {
  const channel = await seedFeed(['🥇 Falcon took Gold on FLAG with 420.']);

  await labelMedalDifficulty({ logger: silent });
  const second = await labelMedalDifficulty({ logger: silent });

  expect(second.fixed).toBe(0);
  expect((await bodies(channel._id))[0]).toBe('🥇 Falcon took Gold on FLAG (Hard) with 420.');
});

it('does nothing when there is no Medals channel', async () => {
  expect(await labelMedalDifficulty({ logger: silent })).toEqual({ scanned: 0, fixed: 0 });
});
