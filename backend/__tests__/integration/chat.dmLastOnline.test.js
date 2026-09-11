/**
 * Chat — "last online" in a DM header
 *
 * Covers:
 *   GET /api/chat/conversations/:id/messages
 *     — a DM tells an ADMIN when the other party was last on the site
 *     — a non-admin never receives the field, not even as null
 *     — channels never carry it
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const User             = require('../../models/User');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const openDm = async (from, to) => {
  const res = await request(app).post('/api/chat/dm')
    .set('Cookie', authCookie(from._id)).send({ userId: to._id });
  expect(res.status).toBe(200);
  return res.body.data.conversation._id;
};

const thread = (id, viewer) =>
  request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', authCookie(viewer._id));

describe('DM header: last online', () => {
  it('tells an admin when the other party was last seen', async () => {
    const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
    const target = await createUser({ displayName: 'Viper' });
    const seen   = new Date('2026-09-11T17:45:00.000Z');
    await User.updateOne({ _id: target._id }, { $set: { lastSeen: seen } });

    const res = await thread(await openDm(admin, target), admin);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.title).toBe('Viper');
    expect(res.body.data.conversation.otherLastSeen).toBe(seen.toISOString());
  });

  it('is null, not absent, for an admin when they have never been seen', async () => {
    const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
    const target = await createUser({ displayName: 'Viper' });

    const res = await thread(await openDm(admin, target), admin);
    expect(res.body.data.conversation).toHaveProperty('otherLastSeen', null);
  });

  it('never reaches a non-admin, even in their own DM', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    await User.updateOne({ _id: b._id }, { $set: { lastSeen: new Date() } });

    const res = await thread(await openDm(a, b), a);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.title).toBe('Viper');
    expect(res.body.data.conversation).not.toHaveProperty('otherLastSeen');
  });

  it('is not attached to channels', async () => {
    const admin = await createUser({ isAdmin: true, displayName: 'Control' });
    const channel = await ChatConversation.create({
      type: 'channel',
      channel: { name: 'General', slug: 'general', postPolicy: 'everyone' },
    });

    const res = await thread(channel._id, admin);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation).not.toHaveProperty('otherLastSeen');
  });
});
