/**
 * Chat — read receipts
 *
 * Covers GET /api/chat/messages/:id/seen-by, which answers "who has read my
 * message" from the existing ChatRead markers rather than a per-message
 * receipt: opening a conversation records a lastReadAt, so anyone whose marker
 * is at or past the message necessarily had it on screen.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');

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
  const reader = await createUser({ displayName: 'Viper' });
  const absent = await createUser({ displayName: 'Nomad' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
  const channelId = made.body.data.channel._id;

  const sent = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
    .set('Cookie', authCookie(author._id)).send({ body: 'anyone about?' });

  return { admin, author, reader, absent, channelId, messageId: sent.body.data.message._id };
}

const openChannel = (userId, channelId) =>
  request(app).post(`/api/chat/conversations/${channelId}/read`).set('Cookie', authCookie(userId));

const seenBy = (userId, messageId) =>
  request(app).get(`/api/chat/messages/${messageId}/seen-by`).set('Cookie', authCookie(userId));

describe('GET /api/chat/messages/:id/seen-by', () => {
  it('names everyone who has opened the channel since the message went out', async () => {
    const { author, reader, absent, channelId, messageId } = await seedChannel();

    await openChannel(reader._id, channelId);

    const res = await seenBy(author._id, messageId);
    expect(res.status).toBe(200);
    expect(res.body.data.readers.map(r => r.displayName)).toEqual(['Viper']);
    expect(res.body.data.readers[0].seenAt).toBeTruthy();

    // Someone who never opened the channel has no read marker at all.
    expect(res.body.data.readers.some(r => String(r._id) === String(absent._id))).toBe(false);
  });

  it('leaves the sender off their own list', async () => {
    const { author, messageId } = await seedChannel();
    // Sending marks the conversation read for the sender, so without the
    // exclusion the author would always be the first name on the list.
    const res = await seenBy(author._id, messageId);
    expect(res.body.data.readers).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it('ignores a read marker that predates the message', async () => {
    const { author, reader, channelId } = await seedChannel();

    // Viper reads the channel, THEN Falcon posts again.
    await openChannel(reader._id, channelId);
    const later = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(author._id)).send({ body: 'still here?' });

    const res = await seenBy(author._id, later.body.data.message._id);
    expect(res.body.data.readers).toEqual([]);
  });

  it('refuses to show one user the readership of another user\'s message', async () => {
    const { reader, messageId } = await seedChannel();
    const res = await seenBy(reader._id, messageId);
    expect(res.status).toBe(403);
  });

  it('lets an admin inspect any message, since they already read every transcript', async () => {
    const { admin, reader, channelId, messageId } = await seedChannel();
    await openChannel(reader._id, channelId);

    const res = await seenBy(admin._id, messageId);
    expect(res.status).toBe(200);
    expect(res.body.data.readers.map(r => r.displayName)).toContain('Viper');
  });

  it('refuses someone who cannot read the conversation at all', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const outsider = await createUser({ displayName: 'Nomad' });

    const dm = await request(app).post('/api/chat/dm')
      .set('Cookie', authCookie(a._id)).send({ userId: b._id });
    const sent = await request(app).post(`/api/chat/conversations/${dm.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'private' });

    const res = await seenBy(outsider._id, sent.body.data.message._id);
    expect(res.status).toBe(403);
  });

  it('404s once the message has been removed', async () => {
    const { admin, author, messageId } = await seedChannel();
    await request(app).delete(`/api/chat/admin/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id));

    const res = await seenBy(author._id, messageId);
    expect(res.status).toBe(404);
  });
});
