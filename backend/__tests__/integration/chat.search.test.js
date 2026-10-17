/**
 * Chat — search, and the jump-to-a-result paging behind it
 *
 * Covers:
 *   GET /api/chat/search                             — text match, access, filters, paging
 *   GET /api/chat/search/channels                    — the lounge widget's three rooms
 *   GET /api/chat/conversations/:id/messages?around= — a chunk either side of a result
 *   GET /api/chat/conversations/:id/messages?after=  — paging back down to the present
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

const channel = (slug, extra = {}) => ChatConversation.create({
  type: 'channel',
  channel: { name: slug, slug, postPolicy: 'everyone', ...extra },
});

// Messages one second apart, oldest first, so the order is unambiguous.
const T0 = new Date('2026-01-01T00:00:00Z').getTime();
const seed = (convo, sender, bodies, { offset = 0 } = {}) => ChatMessage.insertMany(
  bodies.map((body, i) => ({
    conversationId: convo._id,
    senderUserId: sender._id,
    senderRole: 'user',
    senderDisplayName: sender.displayName,
    body,
    createdAt: new Date(T0 + (offset + i) * 1000),
  })),
);

const search = (cookie, q, ids, extra = '') =>
  request(app).get(`/api/chat/search?q=${encodeURIComponent(q)}&in=${ids.join(',')}${extra}`).set('Cookie', cookie);

describe('GET /api/chat/search', () => {
  it('finds messages containing the text, case-insensitive, newest first', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    await seed(c, u, ['Hello there', 'the SDT is hard', 'unrelated', 'any tips for sdt?']);

    const res = await search(authCookie(u._id), 'sdt', [c._id]);
    expect(res.status).toBe(200);
    expect(res.body.data.results.map(r => r.body)).toEqual(['any tips for sdt?', 'the SDT is hard']);
    expect(String(res.body.data.results[0].conversationId)).toBe(String(c._id));
    expect(res.body.data.senders[String(u._id)]).toBeTruthy();
    expect(res.body.data.hasMore).toBe(false);
  });

  it('treats the query as plain text, not a pattern', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    await seed(c, u, ['what is 2+2', 'what is 22']);
    const res = await search(authCookie(u._id), '2+2', [c._id]);
    expect(res.body.data.results.map(r => r.body)).toEqual(['what is 2+2']);
  });

  it('searches several conversations at once', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const a = await channel('cbat-lounge');
    const b = await channel('general');
    await seed(a, u, ['radar in the lounge']);
    await seed(b, u, ['radar in general'], { offset: 5 });
    const res = await search(authCookie(u._id), 'radar', [a._id, b._id]);
    expect(res.body.data.results.map(r => r.body)).toEqual(['radar in general', 'radar in the lounge']);
    expect(res.body.data.conversations).toHaveLength(2);
  });

  it('leaves out removed messages, system lines and blocked senders', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const other = await createUser({ displayName: 'Hawk' });
    const c = await channel('general');
    await seed(c, u, ['keep this radar']);
    await ChatMessage.create([
      { conversationId: c._id, senderUserId: u._id, senderRole: 'user', body: 'gone radar', deletedAt: new Date() },
      { conversationId: c._id, senderUserId: null, senderRole: 'system', body: 'radar joined' },
      { conversationId: c._id, senderUserId: other._id, senderRole: 'user', body: 'blocked radar' },
    ]);
    await request(app).post(`/api/chat/users/${other._id}/block`).set('Cookie', authCookie(u._id));

    const res = await search(authCookie(u._id), 'radar', [c._id]);
    expect(res.body.data.results.map(r => r.body)).toEqual(['keep this radar']);
  });

  it('pages back with `before`', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    await seed(c, u, Array.from({ length: 30 }, (_, i) => `hit ${i}`));
    const cookie = authCookie(u._id);

    const first = await search(cookie, 'hit', [c._id]);
    expect(first.body.data.results).toHaveLength(25);
    expect(first.body.data.hasMore).toBe(true);
    const last = first.body.data.results[24];
    const second = await search(cookie, 'hit', [c._id], `&before=${encodeURIComponent(last.createdAt)}`);
    expect(second.body.data.results.map(r => r.body)).toEqual(['hit 4', 'hit 3', 'hit 2', 'hit 1', 'hit 0']);
    expect(second.body.data.hasMore).toBe(false);
  });

  it('refuses a conversation the viewer cannot read', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const a = await createUser({ displayName: 'Hawk' });
    const b = await createUser({ displayName: 'Kite' });
    const dm = await ChatConversation.create({ type: 'dm', participantIds: [a._id, b._id] });
    await seed(dm, a, ['secret radar']);
    const res = await search(authCookie(u._id), 'radar', [dm._id]);
    expect(res.status).toBe(403);
  });

  it('rejects a query that is too short, or no conversations', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    expect((await search(authCookie(u._id), 'a', [c._id])).status).toBe(400);
    expect((await search(authCookie(u._id), 'radar', [])).status).toBe(400);
  });
});

describe('GET /api/chat/search/channels', () => {
  it('names the lounge, General and the announcements board', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    await channel('cbat-lounge');
    await channel('general');
    await channel('announcements', { postPolicy: 'admin' });
    await channel('archived-general', { postPolicy: 'admin' }).then(c =>
      ChatConversation.updateOne({ _id: c._id }, { isArchived: true }));

    const res = await request(app).get('/api/chat/search/channels').set('Cookie', authCookie(u._id));
    expect(res.status).toBe(200);
    expect(res.body.data.channels.map(c => c.key)).toEqual(['lounge', 'general', 'announcements']);
  });

  it('leaves out a room that does not exist', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    await channel('general');
    const res = await request(app).get('/api/chat/search/channels').set('Cookie', authCookie(u._id));
    expect(res.body.data.channels.map(c => c.key)).toEqual(['general']);
  });
});

describe('GET /api/chat/conversations/:id/messages — around and after', () => {
  const page = (cookie, id, qs) =>
    request(app).get(`/api/chat/conversations/${id}/messages?${qs}`).set('Cookie', cookie);

  it('returns a chunk either side of the target, with both flags', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    const msgs = await seed(c, u, Array.from({ length: 100 }, (_, i) => `m${i}`));
    const cookie = authCookie(u._id);

    const res = await page(cookie, c._id, `around=${msgs[40]._id}&limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.data.messages.map(m => m.body))
      .toEqual(['m35', 'm36', 'm37', 'm38', 'm39', 'm40', 'm41', 'm42', 'm43', 'm44', 'm45']);
    expect(res.body.data.hasMore).toBe(true);
    expect(res.body.data.hasNewer).toBe(true);
  });

  it('says when the chunk reaches either end', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    const msgs = await seed(c, u, ['a', 'b', 'c']);
    const res = await page(authCookie(u._id), c._id, `around=${msgs[1]._id}&limit=10`);
    expect(res.body.data.messages.map(m => m.body)).toEqual(['a', 'b', 'c']);
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.hasNewer).toBe(false);
  });

  it('pages down with `after` until it meets the present', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    const msgs = await seed(c, u, Array.from({ length: 15 }, (_, i) => `m${i}`));
    const cookie = authCookie(u._id);

    const first = await page(cookie, c._id, `after=${encodeURIComponent(msgs[2].createdAt.toISOString())}&limit=5`);
    expect(first.body.data.messages.map(m => m.body)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
    expect(first.body.data.hasNewer).toBe(true);
    expect(first.body.data.hasMore).toBeUndefined();

    const last = await page(cookie, c._id, `after=${encodeURIComponent(msgs[9].createdAt.toISOString())}&limit=5`);
    expect(last.body.data.messages.map(m => m.body)).toEqual(['m10', 'm11', 'm12', 'm13', 'm14']);
    expect(last.body.data.hasNewer).toBe(false);
  });

  it('reports the newest page as caught up', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    await seed(c, u, ['a', 'b']);
    const res = await page(authCookie(u._id), c._id, 'limit=10');
    expect(res.body.data.hasNewer).toBe(false);
  });

  it('404s on a removed target for a non-admin, so a stale result cannot open a hidden row', async () => {
    const u = await createUser({ displayName: 'Falcon' });
    const c = await channel('general');
    const [gone] = await ChatMessage.create([
      { conversationId: c._id, senderUserId: u._id, senderRole: 'user', body: 'x', deletedAt: new Date() },
    ]);
    const res = await page(authCookie(u._id), c._id, `around=${gone._id}`);
    expect(res.status).toBe(404);
  });
});
