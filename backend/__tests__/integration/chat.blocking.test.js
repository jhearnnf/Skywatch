/**
 * Chat — user-level blocking
 *
 * The safeguard Community needs to be a place someone can leave a conversation
 * without waiting for a moderator. Google Play requires it of any app carrying
 * user-generated content, and the store declarations now say we have it.
 *
 * Covers:
 *   POST/DELETE /api/chat/users/:id/block  — block, unblock, idempotence
 *   GET  /api/chat/blocks                  — the list Profile offers as the undo
 *   channels                               — a blocked agent's messages vanish
 *   DMs                                    — barred in BOTH directions
 *   /overview                              — blocked DMs and previews drop out
 *   mention autocomplete                   — never offers a blocked agent
 *   admins                                 — still read everything
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

const block   = (cookie, id) => request(app).post(`/api/chat/users/${id}/block`).set('Cookie', cookie);
const unblock = (cookie, id) => request(app).delete(`/api/chat/users/${id}/block`).set('Cookie', cookie);
const openDm  = (cookie, id) => request(app).post('/api/chat/dm').set('Cookie', cookie).send({ userId: id });
const post    = (cookie, convo, body) =>
  request(app).post(`/api/chat/conversations/${convo}/messages`).set('Cookie', cookie).send({ body });
const readMessages = (cookie, convo) =>
  request(app).get(`/api/chat/conversations/${convo}/messages`).set('Cookie', cookie);

// A channel everyone can post in, plus the cast.
async function seedChannel() {
  const admin  = await createUser({ isAdmin: true, displayName: 'Control' });
  const viewer = await createUser({ displayName: 'Falcon' });
  const other  = await createUser({ displayName: 'Viper' });

  const made = await request(app).post('/api/chat/admin/channels')
    .set('Cookie', authCookie(admin._id)).send({ name: 'General' });

  return { admin, viewer, other, channelId: made.body.data.channel._id };
}

describe('POST /api/chat/users/:id/block', () => {
  it('records the block on the blocker, not the blocked', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const res = await block(authCookie(a._id), b._id);
    expect(res.status).toBe(200);

    const [blocker, blocked] = await Promise.all([
      User.findById(a._id).lean(),
      User.findById(b._id).lean(),
    ]);
    expect(blocker.blockedUserIds.map(String)).toEqual([String(b._id)]);
    // The block is one-way and silent: nothing is written to the other account.
    expect(blocked.blockedUserIds ?? []).toHaveLength(0);
  });

  it('is idempotent, so a double tap cannot duplicate the entry', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await block(authCookie(a._id), b._id);
    await block(authCookie(a._id), b._id);

    const blocker = await User.findById(a._id).lean();
    expect(blocker.blockedUserIds).toHaveLength(1);
  });

  it('refuses blocking yourself', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    expect((await block(authCookie(a._id), a._id)).status).toBe(400);
  });

  it('refuses blocking a bot, which would hide the guide answers', async () => {
    const a   = await createUser({ displayName: 'Falcon' });
    const bot = await createUser({ displayName: 'Guide Bot', isBot: true, botAnswersDms: true });

    expect((await block(authCookie(a._id), bot._id)).status).toBe(400);
  });

  it('404s on an unknown agent', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    expect((await block(authCookie(a._id), '507f1f77bcf86cd799439011')).status).toBe(404);
  });
});

describe('DELETE /api/chat/users/:id/block', () => {
  it('clears the entry', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await block(authCookie(a._id), b._id);
    expect((await unblock(authCookie(a._id), b._id)).status).toBe(200);

    const blocker = await User.findById(a._id).lean();
    expect(blocker.blockedUserIds).toHaveLength(0);
  });

  it('still clears an entry whose account has since gone', async () => {
    // Otherwise a deleted account would be stuck in the list with nothing able
    // to remove it.
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await block(authCookie(a._id), b._id);
    await User.deleteOne({ _id: b._id });

    expect((await unblock(authCookie(a._id), b._id)).status).toBe(200);
    expect((await User.findById(a._id).lean()).blockedUserIds).toHaveLength(0);
  });
});

describe('GET /api/chat/blocks', () => {
  it('lists who you have blocked, so the block can be undone', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await block(authCookie(a._id), b._id);

    const res = await request(app).get('/api/chat/blocks').set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toHaveLength(1);
    expect(res.body.data.blocked[0].displayName).toBe('Viper');
  });

  it('is empty for someone who has blocked nobody', async () => {
    const a = await createUser({ displayName: 'Falcon' });

    const res = await request(app).get('/api/chat/blocks').set('Cookie', authCookie(a._id));
    expect(res.body.data.blocked).toEqual([]);
  });
});

describe('a blocked agent in a channel', () => {
  it('disappears from the viewer, and only from the viewer', async () => {
    const { viewer, other, channelId } = await seedChannel();
    await post(authCookie(other._id),  channelId, 'something rude');
    await post(authCookie(viewer._id), channelId, 'unrelated');

    await block(authCookie(viewer._id), other._id);

    const mine = await readMessages(authCookie(viewer._id), channelId);
    expect(mine.body.data.messages.map(m => m.body)).toEqual(['unrelated']);

    // The person who did NOT block still sees the whole channel — a block is
    // not a removal.
    const theirs = await readMessages(authCookie(other._id), channelId);
    expect(theirs.body.data.messages).toHaveLength(2);
  });

  it('comes back when unblocked', async () => {
    const { viewer, other, channelId } = await seedChannel();
    await post(authCookie(other._id), channelId, 'something rude');

    await block(authCookie(viewer._id), other._id);
    await unblock(authCookie(viewer._id), other._id);

    const res = await readMessages(authCookie(viewer._id), channelId);
    expect(res.body.data.messages).toHaveLength(1);
  });

  it('is still visible to an admin, who has to be able to moderate it', async () => {
    const { admin, other, channelId } = await seedChannel();
    await post(authCookie(other._id), channelId, 'something rude');

    await block(authCookie(admin._id), other._id);

    const res = await readMessages(authCookie(admin._id), channelId);
    expect(res.body.data.messages).toHaveLength(1);
  });

  it('is never offered by mention autocomplete', async () => {
    const { viewer, other, channelId } = await seedChannel();

    const before = await request(app)
      .get(`/api/chat/conversations/${channelId}/mention-suggestions?q=Vip`)
      .set('Cookie', authCookie(viewer._id));
    expect(before.body.data.suggestions.map(s => s.displayName)).toContain('Viper');

    await block(authCookie(viewer._id), other._id);

    const after = await request(app)
      .get(`/api/chat/conversations/${channelId}/mention-suggestions?q=Vip`)
      .set('Cookie', authCookie(viewer._id));
    expect(after.body.data.suggestions.map(s => s.displayName)).not.toContain('Viper');
  });
});

describe('a blocked agent and DMs', () => {
  it('refuses to open one in either direction', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await block(authCookie(a._id), b._id);

    expect((await openDm(authCookie(a._id), b._id)).status).toBe(403);
    // And the other way: a block that only stopped the blocker would leave them
    // still receiving messages from someone they walked away from.
    expect((await openDm(authCookie(b._id), a._id)).status).toBe(403);
  });

  it('refuses to post into a thread that already existed', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const dm = await openDm(authCookie(a._id), b._id);
    const id = dm.body.data.conversation._id;
    await post(authCookie(b._id), id, 'hello');

    await block(authCookie(a._id), b._id);

    expect((await post(authCookie(b._id), id, 'hello again')).status).toBe(403);
    expect((await post(authCookie(a._id), id, 'go away')).status).toBe(403);
  });

  it('does not tell the blocked party that they were blocked', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    await block(authCookie(a._id), b._id);

    const res = await openDm(authCookie(b._id), a._id);
    expect(res.body.message).toBe('You cannot send messages to this agent.');
    expect(res.body.message).not.toMatch(/block/i);
  });

  it('drops the thread out of the blocker\'s rail', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const dm = await openDm(authCookie(a._id), b._id);
    await post(authCookie(b._id), dm.body.data.conversation._id, 'hello');

    await block(authCookie(a._id), b._id);

    const overview = await request(app).get('/api/chat/overview').set('Cookie', authCookie(a._id));
    expect(overview.body.data.dms ?? []).toHaveLength(0);
  });

  it('stops a blocked thread badging the navbar', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const dm = await openDm(authCookie(a._id), b._id);
    await post(authCookie(b._id), dm.body.data.conversation._id, 'hello');

    await block(authCookie(a._id), b._id);

    const unread = await request(app).get('/api/chat/unread/me').set('Cookie', authCookie(a._id));
    expect(unread.body.data.totalUnread).toBe(0);
  });
});

describe('GET /api/chat/users/:id/card', () => {
  it('reports whether this agent is blocked, and whether they can be', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });

    const before = await request(app)
      .get(`/api/chat/users/${b._id}/card`).set('Cookie', authCookie(a._id));
    expect(before.body.data.user.isBlocked).toBe(false);
    expect(before.body.data.user.canBlock).toBe(true);

    await block(authCookie(a._id), b._id);

    const after = await request(app)
      .get(`/api/chat/users/${b._id}/card`).set('Cookie', authCookie(a._id));
    expect(after.body.data.user.isBlocked).toBe(true);
  });

  it('does not offer to block yourself or a bot', async () => {
    const a   = await createUser({ displayName: 'Falcon' });
    const bot = await createUser({ displayName: 'Guide Bot', isBot: true, botAnswersDms: true });

    const self = await request(app)
      .get(`/api/chat/users/${a._id}/card`).set('Cookie', authCookie(a._id));
    expect(self.body.data.user.canBlock).toBe(false);

    const botCard = await request(app)
      .get(`/api/chat/users/${bot._id}/card`).set('Cookie', authCookie(a._id));
    expect(botCard.body.data.user.canBlock).toBe(false);
  });
});
