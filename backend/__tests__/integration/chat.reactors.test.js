/**
 * Chat — who reacted (admin only)
 *
 * Covers GET /api/chat/messages/:id/reactions. Reactions are public in
 * aggregate — every member sees the emoji, the count and whether one of them
 * was theirs — but the identities behind them go to admins only, so that
 * tapping a reaction stays cheap enough that people keep doing it.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const User             = require('../../models/User');

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
});
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// A general channel with one message from `author`.
async function seedChannel() {
  const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
  const author = await createUser({ displayName: 'Falcon' });
  const member = await createUser({ displayName: 'Viper' });
  const other  = await createUser({ displayName: 'Nomad' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
  const channelId = made.body.data.channel._id;

  const sent = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
    .set('Cookie', authCookie(author._id)).send({ body: 'anyone about?' });

  return { admin, author, member, other, channelId, messageId: sent.body.data.message._id };
}

const react = (userId, messageId, emoji) =>
  request(app).post(`/api/chat/messages/${messageId}/reactions`)
    .set('Cookie', authCookie(userId)).send({ emoji });

const reactors = (userId, messageId) =>
  request(app).get(`/api/chat/messages/${messageId}/reactions`).set('Cookie', authCookie(userId));

describe('GET /api/chat/messages/:id/reactions', () => {
  it('names every reactor, grouped by emoji, for an admin', async () => {
    const { admin, member, other, messageId } = await seedChannel();

    await react(member._id, messageId, '👍');
    await react(other._id,  messageId, '👍');
    await react(other._id,  messageId, '🔥');

    const res = await reactors(admin._id, messageId);
    expect(res.status).toBe(200);
    expect(res.body.data.reactions).toEqual([
      { emoji: '👍', count: 2, users: [
        expect.objectContaining({ displayName: 'Viper', isAdmin: false }),
        expect.objectContaining({ displayName: 'Nomad', isAdmin: false }),
      ] },
      { emoji: '🔥', count: 1, users: [
        expect.objectContaining({ displayName: 'Nomad' }),
      ] },
    ]);
  });

  it('refuses an ordinary member, including on their own message', async () => {
    const { author, member, messageId } = await seedChannel();
    await react(member._id, messageId, '👍');

    expect((await reactors(member._id, messageId)).status).toBe(403);
    expect((await reactors(author._id, messageId)).status).toBe(403);
  });

  it('still tells that member the count and whether one was theirs', async () => {
    const { member, other, messageId } = await seedChannel();
    await react(other._id,  messageId, '👍');
    // The toggle response is the same serialiser the message list uses.
    const res = await react(member._id, messageId, '👍');

    expect(res.body.data.message.reactions).toEqual([{ emoji: '👍', count: 2, mine: true }]);
    // and no trace of who the other one was.
    expect(JSON.stringify(res.body.data.message.reactions)).not.toContain(String(other._id));
  });

  it('drops an emoji nobody is left reacting with', async () => {
    const { admin, member, messageId } = await seedChannel();
    await react(member._id, messageId, '👍');
    await react(member._id, messageId, '👍'); // toggled back off

    const res = await reactors(admin._id, messageId);
    expect(res.body.data.reactions).toEqual([]);
  });

  it('counts a deleted account it cannot name', async () => {
    const { admin, member, other, messageId } = await seedChannel();
    await react(member._id, messageId, '👍');
    await react(other._id,  messageId, '👍');
    await User.deleteOne({ _id: other._id });

    const res = await reactors(admin._id, messageId);
    // The count is what the pill shows; the list is who is left to name.
    expect(res.body.data.reactions[0].count).toBe(2);
    expect(res.body.data.reactions[0].users.map(u => u.displayName)).toEqual(['Viper']);
  });

  it('still answers on a message the admin has removed', async () => {
    const { admin, member, messageId } = await seedChannel();
    await react(member._id, messageId, '😮');
    await request(app).delete(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id));

    const res = await reactors(admin._id, messageId);
    expect(res.status).toBe(200);
    expect(res.body.data.reactions.map(r => r.emoji)).toEqual(['😮']);
  });

  it('404s on a message id that does not exist', async () => {
    const { admin } = await seedChannel();
    const res = await reactors(admin._id, '507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
  });
});
