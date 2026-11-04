/**
 * Chat — a retried send lands once
 *
 * The client retries a send whose answer never came back (src/lib/chatOutbox.js),
 * and the first try may already have landed. Each message carries the client's
 * own id for it, and a repeat of that id hands back the first message rather
 * than posting a second copy.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

beforeAll(async () => {
  await db.connect();
  await ChatConversation.syncIndexes();
  await ChatMessage.syncIndexes();
});
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function dmBetween() {
  const a = await createUser({ displayName: 'Falcon' });
  const b = await createUser({ displayName: 'Viper' });
  const res = await request(app).post('/api/chat/dm').set('Cookie', authCookie(a._id)).send({ userId: b._id });
  return { a, b, id: res.body.data.conversation._id };
}

const post = (cookie, id, body) =>
  request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', cookie).send(body);

describe('POST /api/chat/conversations/:id/messages with a clientId', () => {
  it('answers a repeat of the same clientId with the first message', async () => {
    const { a, id } = await dmBetween();
    const cookie = authCookie(a._id);

    const first  = await post(cookie, id, { body: 'hello', clientId: 'cabc12345678' });
    const second = await post(cookie, id, { body: 'hello', clientId: 'cabc12345678' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.message._id).toBe(first.body.data.message._id);
    expect(first.body.data.message.clientId).toBe('cabc12345678');
    expect(await ChatMessage.countDocuments({ conversationId: id })).toBe(1);
  });

  it('lands two racing tries of the same send once', async () => {
    const { a, id } = await dmBetween();
    const cookie = authCookie(a._id);

    const [x, y] = await Promise.all([
      post(cookie, id, { body: 'race', clientId: 'crace1234567' }),
      post(cookie, id, { body: 'race', clientId: 'crace1234567' }),
    ]);

    expect(x.status).toBe(200);
    expect(y.status).toBe(200);
    expect(x.body.data.message._id).toBe(y.body.data.message._id);
    expect(await ChatMessage.countDocuments({ conversationId: id })).toBe(1);
  });

  it('keeps different clientIds, and sends without one, as separate messages', async () => {
    const { a, id } = await dmBetween();
    const cookie = authCookie(a._id);

    await post(cookie, id, { body: 'one', clientId: 'cone12345678' });
    await post(cookie, id, { body: 'two', clientId: 'ctwo12345678' });
    await post(cookie, id, { body: 'three' });
    await post(cookie, id, { body: 'three' });

    expect(await ChatMessage.countDocuments({ conversationId: id })).toBe(4);
  });

  it('shows the clientId to the sender only', async () => {
    const { a, b, id } = await dmBetween();
    await post(authCookie(a._id), id, { body: 'mine', clientId: 'cmine1234567' });

    const theirs = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', authCookie(b._id));
    const mine   = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', authCookie(a._id));

    expect(theirs.body.data.messages[0].clientId).toBeUndefined();
    expect(mine.body.data.messages[0].clientId).toBe('cmine1234567');
  });

  it('ignores a malformed clientId rather than refusing the message', async () => {
    const { a, id } = await dmBetween();
    const res = await post(authCookie(a._id), id, { body: 'odd', clientId: 'bad id!' });
    expect(res.status).toBe(200);
    expect(res.body.data.message.clientId).toBeUndefined();
  });
});
