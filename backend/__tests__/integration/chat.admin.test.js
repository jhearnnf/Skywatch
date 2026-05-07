/**
 * Chat — admin-side tests
 *
 * Covers:
 *   GET  /api/chat/unread/admin                 — global navbar dot + entry visibility
 *   GET  /api/chat/admin/conversations          — inbox, with status filter
 *   GET  /api/chat/admin/users/:userId/conversations — per-user history (open + closed)
 *   POST /api/chat/admin/conversations          — start/coalesce a chat with a user
 *   POST /api/chat/admin/conversations/:id/close — admin-initiated close
 *   POST /api/chat/admin/conversations/:id/reopen — undo a close
 *
 *   Auth guard: non-admin gets 403 on every /admin/* route.
 *   Symmetric unread: any admin reading clears the dot for all admins.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const AdminAction      = require('../../models/AdminAction');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// ── unread/admin ─────────────────────────────────────────────────────────────

describe('GET /api/chat/unread/admin', () => {
  it('hasUnread=true after a user posts; clears when any admin marks read', async () => {
    const user   = await createUser();
    const admin1 = await createUser({ isAdmin: true });
    const admin2 = await createUser({ isAdmin: true });
    const cu  = authCookie(user._id);
    const ca1 = authCookie(admin1._id);
    const ca2 = authCookie(admin2._id);

    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', cu).send({ body: 'help' });

    let res = await request(app).get('/api/chat/unread/admin').set('Cookie', ca1);
    expect(res.body.data.hasUnread).toBe(true);
    expect(res.body.data.totalUnreadConversations).toBe(1);

    // Admin 1 reads → admin 2's dot also clears (shared adminLastReadAt)
    await request(app).post(`/api/chat/conversations/${id}/read`).set('Cookie', ca1);
    res = await request(app).get('/api/chat/unread/admin').set('Cookie', ca2);
    expect(res.body.data.hasUnread).toBe(false);
  });

  it('admin reply also counts as read (sending = reading)', async () => {
    const user  = await createUser();
    const admin = await createUser({ isAdmin: true });
    const cu = authCookie(user._id);
    const ca = authCookie(admin._id);

    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', cu).send({ body: 'help' });

    await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', ca).send({ body: 'on it' });

    const res = await request(app).get('/api/chat/unread/admin').set('Cookie', ca);
    expect(res.body.data.hasUnread).toBe(false);
  });

  it('rejects non-admin with 403', async () => {
    const u = await createUser();
    const res = await request(app).get('/api/chat/unread/admin').set('Cookie', authCookie(u._id));
    expect(res.status).toBe(403);
  });
});

// ── admin/conversations list ─────────────────────────────────────────────────

describe('GET /api/chat/admin/conversations', () => {
  it('returns conversations across all users with hasAdminUnread tagging', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const admin = await createUser({ isAdmin: true });
    const ca = authCookie(admin._id);

    // u1 has an unread message; u2 has only their own conversation with no message yet
    const c1 = await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u1._id));
    await request(app).post(`/api/chat/conversations/${c1.body.data.conversation._id}/messages`)
      .set('Cookie', authCookie(u1._id)).send({ body: 'help' });
    await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u2._id));

    const res = await request(app).get('/api/chat/admin/conversations').set('Cookie', ca);
    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toHaveLength(2);
    const u1Row = res.body.data.conversations.find(c => c.userId._id === u1._id.toString());
    expect(u1Row.hasAdminUnread).toBe(true);
  });

  it('status=closed filter returns only closed', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const admin = await createUser({ isAdmin: true });

    const c1 = await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u1._id));
    await request(app).post(`/api/chat/conversations/${c1.body.data.conversation._id}/close`)
      .set('Cookie', authCookie(u1._id));
    await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u2._id));

    const res = await request(app).get('/api/chat/admin/conversations?status=closed')
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.conversations).toHaveLength(1);
    expect(res.body.data.conversations[0].status).toBe('closed');
  });

  it('rejects non-admin with 403', async () => {
    const u = await createUser();
    const res = await request(app).get('/api/chat/admin/conversations').set('Cookie', authCookie(u._id));
    expect(res.status).toBe(403);
  });
});

// ── admin/users/:userId/conversations ────────────────────────────────────────

describe('GET /api/chat/admin/users/:userId/conversations', () => {
  it('returns the targeted user\'s open AND closed conversations', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });
    const cu = authCookie(u._id);
    const ca = authCookie(admin._id);

    const a = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    await request(app).post(`/api/chat/conversations/${a.body.data.conversation._id}/close`).set('Cookie', cu);
    await request(app).post('/api/chat/conversations').set('Cookie', cu);

    const res = await request(app).get(`/api/chat/admin/users/${u._id}/conversations`).set('Cookie', ca);
    expect(res.body.data.conversations).toHaveLength(2);
    const statuses = res.body.data.conversations.map(c => c.status).sort();
    expect(statuses).toEqual(['closed', 'open']);
  });
});

// ── admin start chat ─────────────────────────────────────────────────────────

describe('POST /api/chat/admin/conversations', () => {
  it('creates a new open conversation tagged startedByRole=admin', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });

    const res = await request(app).post('/api/chat/admin/conversations')
      .set('Cookie', authCookie(admin._id))
      .send({ userId: u._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.startedByRole).toBe('admin');
    expect(res.body.data.created).toBe(true);

    const log = await AdminAction.findOne({ actionType: 'chat_start' });
    expect(log).toBeTruthy();
    expect(log.targetUserId.toString()).toBe(u._id.toString());
  });

  it('coalesces — if user already has an open chat, returns it without a new AdminAction', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });
    await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u._id));

    const res = await request(app).post('/api/chat/admin/conversations')
      .set('Cookie', authCookie(admin._id))
      .send({ userId: u._id.toString() });

    expect(res.body.data.created).toBe(false);
    expect(await ChatConversation.countDocuments({ userId: u._id })).toBe(1);
    expect(await AdminAction.countDocuments({ actionType: 'chat_start' })).toBe(0);
  });

  it('two parallel admin starts produce a single conversation (no race duplicates)', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });
    const ca = authCookie(admin._id);
    // Wait for the partial unique index to actually be built before racing
    await ChatConversation.syncIndexes();

    const [r1, r2] = await Promise.all([
      request(app).post('/api/chat/admin/conversations').set('Cookie', ca).send({ userId: u._id.toString() }),
      request(app).post('/api/chat/admin/conversations').set('Cookie', ca).send({ userId: u._id.toString() }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.data.conversation._id).toBe(r2.body.data.conversation._id);
    expect(await ChatConversation.countDocuments({ userId: u._id, status: 'open' })).toBe(1);
    // Only the winning create should have logged an AdminAction
    expect(await AdminAction.countDocuments({ actionType: 'chat_start' })).toBe(1);
  });
});

// ── admin close + reopen ─────────────────────────────────────────────────────

describe('POST /api/chat/admin/conversations/:id/close + reopen', () => {
  it('close flips status, inserts system message, snaps both read timestamps, logs AdminAction', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });
    const cu = authCookie(u._id);
    const ca = authCookie(admin._id);

    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', cu).send({ body: 'help' });

    const res = await request(app).post(`/api/chat/admin/conversations/${id}/close`).set('Cookie', ca);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.status).toBe('closed');
    expect(res.body.data.conversation.closedBy).toBe('admin');

    const sys = await ChatMessage.findOne({ conversationId: id, senderRole: 'system', body: 'Admin closed this chat' });
    expect(sys).toBeTruthy();

    // Both read timestamps snapped → no stale dot on either side
    const userUnread  = await request(app).get('/api/chat/unread/me').set('Cookie', cu);
    const adminUnread = await request(app).get('/api/chat/unread/admin').set('Cookie', ca);
    expect(userUnread.body.data.hasUnread).toBe(false);
    expect(adminUnread.body.data.hasUnread).toBe(false);

    expect(await AdminAction.countDocuments({ actionType: 'chat_close' })).toBe(1);
  });

  it('reopen flips status back to open and logs AdminAction', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });
    const ca = authCookie(admin._id);

    const start = await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u._id));
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/admin/conversations/${id}/close`).set('Cookie', ca);

    const res = await request(app).post(`/api/chat/admin/conversations/${id}/reopen`).set('Cookie', ca);
    expect(res.body.data.conversation.status).toBe('open');
    expect(await AdminAction.countDocuments({ actionType: 'chat_reopen' })).toBe(1);
  });
});
