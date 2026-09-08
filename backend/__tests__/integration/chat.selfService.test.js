/**
 * Chat — your own messages
 *
 * Covers:
 *   PATCH  /api/chat/messages/:id   — edit your own, with a preserved history
 *   DELETE /api/chat/messages/:id   — withdraw your own
 *
 * The author's half of the moderation routes: same soft delete, same "(edited)"
 * marker, same retained history. What differs is who may call them, the one-hour
 * window, and that they leave no AdminAction — withdrawing your own typo is not
 * a moderation event.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const AdminAction      = require('../../models/AdminAction');

const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
});
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function seedChannelWithMessage(body = 'somethign') {
  const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
  const author = await createUser({ displayName: 'Falcon' });
  const reader = await createUser({ displayName: 'Viper' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
  const channelId = made.body.data.channel._id;

  const sent = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
    .set('Cookie', authCookie(author._id)).send({ body });

  return { admin, author, reader, channelId, messageId: sent.body.data.message._id };
}

const messagesFor = (channelId, userId) =>
  request(app).get(`/api/chat/conversations/${channelId}/messages`).set('Cookie', authCookie(userId));

const ageMessage = (messageId, ms) =>
  ChatMessage.findByIdAndUpdate(messageId, { $set: { createdAt: new Date(Date.now() - ms) } });

describe('PATCH /api/chat/messages/:id', () => {
  it('lets the author correct their own message, and marks it edited for everyone', async () => {
    const { author, reader, channelId, messageId } = await seedChannelWithMessage();

    const res = await request(app).patch(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(author._id)).send({ body: 'something' });
    expect(res.status).toBe(200);
    expect(res.body.data.message.body).toBe('something');
    expect(res.body.data.message.edited).toBe(true);

    // The marker is public — someone rewriting what they said after it was
    // answered must not be able to do it silently.
    const asReader = await messagesFor(channelId, reader._id);
    expect(asReader.body.data.messages[0].body).toBe('something');
    expect(asReader.body.data.messages[0].edited).toBe(true);
  });

  it('keeps every superseded version, and shows them to admins only', async () => {
    const { admin, author, reader, channelId, messageId } = await seedChannelWithMessage('first');

    for (const body of ['second', 'third']) {
      await request(app).patch(`/api/chat/messages/${messageId}`)
        .set('Cookie', authCookie(author._id)).send({ body });
    }

    const asAdmin = await messagesFor(channelId, admin._id);
    const seen = asAdmin.body.data.messages[0];
    expect(seen.body).toBe('third');
    expect(seen.edits.map(e => e.body)).toEqual(['first', 'second']);
    // originalBody is still the FIRST version however many edits followed.
    expect(seen.originalBody).toBe('first');

    // A public history would turn every correction into a permanent record of
    // the mistake, which is the opposite of what editing is for.
    const asReader = await messagesFor(channelId, reader._id);
    expect(asReader.body.data.messages[0].edits).toBeUndefined();
    expect(asReader.body.data.messages[0].originalBody).toBeUndefined();

    // The author's own edit is not a moderation event.
    expect(await AdminAction.countDocuments({ actionType: 'chat_message_edit' })).toBe(0);
  });

  it('does not stamp an edit marker when the text has not changed', async () => {
    const { author, messageId } = await seedChannelWithMessage('unchanged');

    const res = await request(app).patch(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(author._id)).send({ body: 'unchanged' });
    expect(res.status).toBe(200);
    expect(res.body.data.message.edited).toBe(false);
    expect((await ChatMessage.findById(messageId)).edits).toHaveLength(0);
  });

  it('refuses another agent’s message, without confirming it exists', async () => {
    const { reader, messageId } = await seedChannelWithMessage();

    const res = await request(app).patch(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(reader._id)).send({ body: 'not yours' });
    expect(res.status).toBe(404);
    expect((await ChatMessage.findById(messageId)).body).toBe('somethign');
  });

  it('refuses an edit once the hour is up', async () => {
    const { author, messageId } = await seedChannelWithMessage();
    await ageMessage(messageId, HOUR + 60_000);

    const res = await request(app).patch(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(author._id)).send({ body: 'too late' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('window');
  });

  // Moderation has no deadline, and an admin's own old message is theirs to fix.
  it('exempts an admin from the window on their own message', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const made = await request(app).post('/api/chat/admin/channels')
      .set('Cookie', authCookie(admin._id)).send({ name: 'General' });
    const channelId = made.body.data.channel._id;
    const sent = await request(app).post(`/api/chat/conversations/${channelId}/messages`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'old news' });
    const messageId = sent.body.data.message._id;

    await ageMessage(messageId, 25 * HOUR);

    const res = await request(app).patch(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(admin._id)).send({ body: 'newer news' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/chat/messages/:id', () => {
  it('withdraws the message from everyone else entirely', async () => {
    const { author, reader, channelId, messageId } = await seedChannelWithMessage();

    const res = await request(app).delete(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(author._id));
    expect(res.status).toBe(200);

    // No tombstone, no placeholder: as far as a reader is concerned it was
    // never there. The same rule the moderation delete follows.
    const asReader = await messagesFor(channelId, reader._id);
    expect(asReader.body.data.messages).toHaveLength(0);
  });

  it('keeps it for admins, attributed to the author rather than a moderator', async () => {
    const { admin, author, channelId, messageId } = await seedChannelWithMessage();

    await request(app).delete(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(author._id));

    const asAdmin = await messagesFor(channelId, admin._id);
    const seen = asAdmin.body.data.messages[0];
    expect(seen.deleted).toBe(true);
    // The body survives — a moderation record that erases the evidence is
    // useless — and deletedByUserId is what separates "the author withdrew it"
    // from "a moderator took it down".
    expect(seen.body).toBe('somethign');
    expect(String(seen.deletedByUserId)).toBe(String(author._id));

    expect(await AdminAction.countDocuments({ actionType: 'chat_message_delete' })).toBe(0);
  });

  it('refuses another agent’s message', async () => {
    const { reader, messageId } = await seedChannelWithMessage();

    const res = await request(app).delete(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(reader._id));
    expect(res.status).toBe(404);
    expect((await ChatMessage.findById(messageId)).deletedAt).toBeNull();
  });

  it('refuses a withdrawal once the hour is up', async () => {
    const { author, messageId } = await seedChannelWithMessage();
    await ageMessage(messageId, HOUR + 60_000);

    const res = await request(app).delete(`/api/chat/messages/${messageId}`)
      .set('Cookie', authCookie(author._id));
    expect(res.status).toBe(403);
  });
});

describe('canEdit / canDelete on a served message', () => {
  it('offers the author both, and a bystander neither', async () => {
    const { author, reader, channelId } = await seedChannelWithMessage();

    const asAuthor = await messagesFor(channelId, author._id);
    expect(asAuthor.body.data.messages[0]).toMatchObject({ canEdit: true, canDelete: true });

    const asReader = await messagesFor(channelId, reader._id);
    expect(asReader.body.data.messages[0]).toMatchObject({ canEdit: false, canDelete: false });
  });

  it('offers an admin both on anyone’s message', async () => {
    const { admin, channelId } = await seedChannelWithMessage();

    const asAdmin = await messagesFor(channelId, admin._id);
    expect(asAdmin.body.data.messages[0]).toMatchObject({ canEdit: true, canDelete: true });
  });

  // The client must not have to know the rule has a clock in it — a button
  // offered here and refused by the server is worse than no button.
  it('withdraws the offer from the author once the window closes', async () => {
    const { author, channelId, messageId } = await seedChannelWithMessage();
    await ageMessage(messageId, HOUR + 60_000);

    const asAuthor = await messagesFor(channelId, author._id);
    expect(asAuthor.body.data.messages[0]).toMatchObject({ canEdit: false, canDelete: false });
  });
});
