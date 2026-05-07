/**
 * Chat — user-side tests
 *
 * Covers:
 *   POST /api/chat/conversations           — start (and coalesce) a help chat
 *   GET  /api/chat/conversations/mine      — list my conversations
 *   GET  /api/chat/unread/me               — navbar dot + entry visibility
 *   GET  /api/chat/conversations/:id/messages — thread, with isolation 403
 *   POST /api/chat/conversations/:id/messages — send, blocks on closed
 *   POST /api/chat/conversations/:id/read  — mark read (clears userLastReadAt)
 *   POST /api/chat/conversations/:id/close — user-initiated close + system message
 *
 *   Feature flag (chatEnabled=false) — all routes 503.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

// ── POST /conversations ──────────────────────────────────────────────────────

describe('POST /api/chat/conversations', () => {
  it('creates an open conversation tagged startedByRole=user', async () => {
    const u  = await createUser();
    const c  = authCookie(u._id);
    const res = await request(app).post('/api/chat/conversations').set('Cookie', c);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.status).toBe('open');
    expect(res.body.data.conversation.startedByRole).toBe('user');
    expect(res.body.data.conversation.userId).toBe(u._id.toString());
  });

  it('coalesces — calling twice returns the same open conversation', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const a = await request(app).post('/api/chat/conversations').set('Cookie', c);
    const b = await request(app).post('/api/chat/conversations').set('Cookie', c);
    expect(a.body.data.conversation._id).toBe(b.body.data.conversation._id);
    expect(await ChatConversation.countDocuments({ userId: u._id })).toBe(1);
  });

  it('rejects guests with 401', async () => {
    const res = await request(app).post('/api/chat/conversations');
    expect(res.status).toBe(401);
  });
});

// ── GET /conversations/mine ──────────────────────────────────────────────────

describe('GET /api/chat/conversations/mine', () => {
  it('returns only the requester\'s conversations', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    await ChatConversation.create({ userId: u1._id, startedByRole: 'user' });
    await ChatConversation.create({ userId: u2._id, startedByRole: 'user' });

    const res = await request(app).get('/api/chat/conversations/mine')
      .set('Cookie', authCookie(u1._id));
    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toHaveLength(1);
    expect(res.body.data.conversations[0].userId).toBe(u1._id.toString());
  });
});

// ── GET /unread/me ───────────────────────────────────────────────────────────

describe('GET /api/chat/unread/me', () => {
  it('hasAnyOpenChat=false / hasUnread=false when no conversations', async () => {
    const u = await createUser();
    const res = await request(app).get('/api/chat/unread/me')
      .set('Cookie', authCookie(u._id));
    expect(res.body.data).toEqual({ hasAnyOpenChat: false, hasUnread: false });
  });

  it('hasAnyOpenChat=true with no unread when only user has spoken', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', c);
    await request(app).post(`/api/chat/conversations/${start.body.data.conversation._id}/messages`)
      .set('Cookie', c).send({ body: 'hi' });

    const res = await request(app).get('/api/chat/unread/me').set('Cookie', c);
    expect(res.body.data.hasAnyOpenChat).toBe(true);
    expect(res.body.data.hasUnread).toBe(false);
  });

  it('hasUnread=true after admin sends; clears after user reads', async () => {
    const u = await createUser();
    const admin = await createUser({ isAdmin: true });
    const cu = authCookie(u._id);
    const ca = authCookie(admin._id);

    const start = await request(app).post('/api/chat/conversations').set('Cookie', cu);
    const id = start.body.data.conversation._id;

    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', ca).send({ body: 'reply' });

    let res = await request(app).get('/api/chat/unread/me').set('Cookie', cu);
    expect(res.body.data.hasUnread).toBe(true);

    await request(app).post(`/api/chat/conversations/${id}/read`).set('Cookie', cu);

    res = await request(app).get('/api/chat/unread/me').set('Cookie', cu);
    expect(res.body.data.hasUnread).toBe(false);
  });

  it('closed conversations do not surface as open', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', c);
    await request(app).post(`/api/chat/conversations/${start.body.data.conversation._id}/close`).set('Cookie', c);

    const res = await request(app).get('/api/chat/unread/me').set('Cookie', c);
    expect(res.body.data.hasAnyOpenChat).toBe(false);
  });
});

// ── messages: get + send + thread isolation ──────────────────────────────────

describe('messages thread', () => {
  it('returns messages oldest-first, respects ownership (403 for other user)', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const c1 = authCookie(u1._id);
    const c2 = authCookie(u2._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', c1);
    const id = start.body.data.conversation._id;
    await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', c1).send({ body: 'first' });
    await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', c1).send({ body: 'second' });

    const ok = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', c1);
    expect(ok.status).toBe(200);
    expect(ok.body.data.messages.map(m => m.body)).toEqual(['first', 'second']);

    const denied = await request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', c2);
    expect(denied.status).toBe(403);
  });

  it('rejects empty body and >4000 char body', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', c);
    const id = start.body.data.conversation._id;

    const empty = await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', c).send({ body: '   ' });
    expect(empty.status).toBe(400);

    const big = await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', c).send({ body: 'x'.repeat(4001) });
    expect(big.status).toBe(400);
  });

  it('blocks sending to a closed conversation with 400', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', c);
    const id = start.body.data.conversation._id;

    await request(app).post(`/api/chat/conversations/${id}/close`).set('Cookie', c);

    const res = await request(app).post(`/api/chat/conversations/${id}/messages`).set('Cookie', c).send({ body: 'still here' });
    expect(res.status).toBe(400);
  });
});

// ── close (user-initiated) ───────────────────────────────────────────────────

describe('POST /api/chat/conversations/:id/close (user)', () => {
  it('flips status to closed, records closedBy=user, inserts a system message', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const start = await request(app).post('/api/chat/conversations').set('Cookie', c);
    const id = start.body.data.conversation._id;

    const res = await request(app).post(`/api/chat/conversations/${id}/close`).set('Cookie', c);
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.status).toBe('closed');
    expect(res.body.data.conversation.closedBy).toBe('user');

    const sys = await ChatMessage.findOne({ conversationId: id, senderRole: 'system' });
    expect(sys).toBeTruthy();
    expect(sys.body).toBe('User closed this chat');
  });

  it('forbids a different user from closing', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const start = await request(app).post('/api/chat/conversations').set('Cookie', authCookie(u1._id));
    const id = start.body.data.conversation._id;

    const res = await request(app).post(`/api/chat/conversations/${id}/close`).set('Cookie', authCookie(u2._id));
    expect(res.status).toBe(403);
  });

  it('frees up POST /conversations to create a fresh open chat after close', async () => {
    const u = await createUser();
    const c = authCookie(u._id);
    const a = await request(app).post('/api/chat/conversations').set('Cookie', c);
    await request(app).post(`/api/chat/conversations/${a.body.data.conversation._id}/close`).set('Cookie', c);
    const b = await request(app).post('/api/chat/conversations').set('Cookie', c);
    expect(b.body.data.conversation._id).not.toBe(a.body.data.conversation._id);
    expect(b.body.data.conversation.status).toBe('open');
  });
});

// ── feature flag ─────────────────────────────────────────────────────────────

describe('chatEnabled feature flag', () => {
  it('returns 503 across all chat endpoints when disabled', async () => {
    await createSettings({ chatEnabled: false });
    const u = await createUser();
    const c = authCookie(u._id);

    const r1 = await request(app).post('/api/chat/conversations').set('Cookie', c);
    const r2 = await request(app).get('/api/chat/unread/me').set('Cookie', c);
    expect(r1.status).toBe(503);
    expect(r2.status).toBe(503);
  });
});
