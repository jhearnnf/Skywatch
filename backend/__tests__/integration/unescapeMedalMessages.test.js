/**
 * One-shot repair of medal messages that carry Discord's markdown escaping.
 *
 * Fixtures build their backslashes from String.fromCharCode(92) rather than
 * escape sequences. Written inline, the source is ambiguous enough that an
 * earlier version of this file seeded a name with NO backslash at all, and
 * every assertion passed against data that never had the bug.
 */
process.env.JWT_SECRET = 'test_secret';

const db = require('../helpers/setupDb');
const unescapeMedalMessages = require('../../migrations/unescapeMedalMessages');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

const silent = { log: () => {} };
const BS = String.fromCharCode(92);
const GOLD = '🥇';

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function makeChannel() {
  return ChatConversation.create({
    type: 'channel', isArchived: false,
    channel: { name: 'Medals', slug: 'medals', postPolicy: 'bot' },
  });
}

async function seedFeed(texts) {
  const channel = await makeChannel();
  for (const text of texts) {
    // Guard against a fixture that lost its backslash and would make every
    // assertion below pass for the wrong reason.
    expect(text).toContain(BS);
    await ChatMessage.create({ conversationId: channel._id, senderRole: 'user', body: text });
  }
  return channel;
}

const bodies = async (channelId) =>
  (await ChatMessage.find({ conversationId: channelId }).sort({ createdAt: 1 }).lean())
    .map(m => m.body);

it('unescapes a name that reached the feed with Discord escaping', async () => {
  const channel = await seedFeed([GOLD + ' SkyWatch' + BS + '_Dev took Gold on Target with 940.']);

  const res = await unescapeMedalMessages({ logger: silent });

  expect(res.fixed).toBe(1);
  const [text] = await bodies(channel._id);
  expect(text).toContain('SkyWatch_Dev took Gold');
  expect(text).not.toContain(BS);
});

it('handles every character the escaper touched', async () => {
  const messy = ['_', '*', '~', '`', '|', '[', ']']
    .map(ch => 'a' + BS + ch + 'b').join(' ');
  const channel = await seedFeed([messy]);

  await unescapeMedalMessages({ logger: silent });

  expect((await bodies(channel._id))[0]).toBe('a_b a*b a~b a`b a|b a[b a]b');
});

it('leaves clean messages alone', async () => {
  const channel = await makeChannel();
  await ChatMessage.create({
    conversationId: channel._id, senderRole: 'user',
    body: GOLD + ' Falcon took Gold on Target with 940.',
  });

  const res = await unescapeMedalMessages({ logger: silent });

  expect(res.fixed).toBe(0);
  expect((await bodies(channel._id))[0]).toContain('Falcon took Gold');
});

it('is idempotent', async () => {
  const channel = await seedFeed([GOLD + ' SkyWatch' + BS + '_Dev took Gold.']);

  await unescapeMedalMessages({ logger: silent });
  const second = await unescapeMedalMessages({ logger: silent });

  expect(second.fixed).toBe(0);
  expect((await bodies(channel._id))[0]).toContain('SkyWatch_Dev');
});

it('does nothing when there is no Medals channel', async () => {
  expect(await unescapeMedalMessages({ logger: silent })).toEqual({ scanned: 0, fixed: 0 });
});
