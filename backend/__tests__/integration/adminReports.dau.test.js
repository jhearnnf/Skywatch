process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatSatResult = require('../../models/GameSessionCbatSatResult');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage = require('../../models/ChatMessage');

const DAY = 24 * 60 * 60 * 1000;

let admin, cookie, u1, u2;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser({ agentNumber: '1000099' });
  cookie = authCookie(admin._id);
  u1 = await createUser({ agentNumber: '1000001' });
  u2 = await createUser({ agentNumber: '1000002' });
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

function satAt(userId, when) {
  return GameSessionCbatSatResult.create({
    userId, correctCount: 10, totalQuestions: 12, totalTime: 120, createdAt: when,
  });
}

function channel(slug, postPolicy = 'everyone', extra = {}) {
  return ChatConversation.create({
    type: 'channel',
    channel: { name: slug, slug, postPolicy },
    ...extra,
  });
}

function messageAt(conversationId, userId, when, extra = {}) {
  return ChatMessage.create({
    conversationId,
    senderUserId: userId,
    senderRole:   'user',
    body:         'hello',
    createdAt:    when,
    ...extra,
  });
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const get = (qs) => request(app).get(`/api/admin/reports/dau${qs}`).set('Cookie', cookie);

describe('GET /api/admin/reports/dau', () => {
  it('defaults to 30 days, inclusive of today', async () => {
    const res = await get('');

    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(30);
    expect(res.body.data.dailyDau).toHaveLength(30);
    expect(res.body.data.dailyDau.at(-1).date).toBe(ymd(Date.now()));
  });

  it.each([7, 30, 90, 365])('returns a %i-day series when asked for one', async (days) => {
    const res = await get(`?days=${days}`);

    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(days);
    expect(res.body.data.dailyDau).toHaveLength(days);
  });

  it('counts distinct active users per day', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    await satAt(u1._id, twoDaysAgo);
    await satAt(u1._id, twoDaysAgo);  // same user twice on the same day → 1
    await satAt(u2._id, twoDaysAgo);

    const res = await get('?days=7');

    expect(res.status).toBe(200);
    const row = res.body.data.dailyDau.find(r => r.date === ymd(twoDaysAgo));
    expect(row.count).toBe(2);
    // Every other day in the window is present and zero-filled.
    const others = res.body.data.dailyDau.filter(r => r.date !== ymd(twoDaysAgo));
    expect(others.every(r => r.count === 0)).toBe(true);
  });

  it('only reaches back as far as the requested range', async () => {
    const longAgo = new Date(Date.now() - 40 * DAY);
    await satAt(u1._id, longAgo);

    const res = await get('?days=7');

    expect(res.status).toBe(200);
    expect(res.body.data.dailyDau.every(r => r.count === 0)).toBe(true);
  });

  it('falls back to 30 days for an unsupported or junk range', async () => {
    for (const qs of ['?days=1000', '?days=banana', '?days=-5']) {
      const res = await get(qs);
      expect(res.status).toBe(200);
      expect(res.body.data.days).toBe(30);
      expect(res.body.data.dailyDau).toHaveLength(30);
    }
  });

  describe('community messages series', () => {
    it('counts messages per day in channels members can post in', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * DAY);
      const general = await channel('general');
      const lounge  = await channel('cbat-lounge');
      await messageAt(general._id, u1._id, twoDaysAgo);
      await messageAt(general._id, u1._id, twoDaysAgo);  // same user twice → 2 messages
      await messageAt(lounge._id,  u2._id, twoDaysAgo);

      const res = await get('?days=7');

      expect(res.status).toBe(200);
      const row = res.body.data.dailyDau.find(r => r.date === ymd(twoDaysAgo));
      expect(row.messages).toBe(3);
      const others = res.body.data.dailyDau.filter(r => r.date !== ymd(twoDaysAgo));
      expect(others.every(r => r.messages === 0)).toBe(true);
    });

    it('ignores channels only the team or a bot can post in, and private threads', async () => {
      const now = new Date();
      const announcements = await channel('announcements', 'admin');
      const medals        = await channel('medals', 'bot');
      const dm      = await ChatConversation.create({ type: 'dm', participantIds: [u1._id, u2._id] });
      const support = await ChatConversation.create({ type: 'support', userId: u1._id });

      for (const c of [announcements, medals, dm, support]) await messageAt(c._id, u1._id, now);

      const res = await get('?days=7');

      expect(res.status).toBe(200);
      expect(res.body.data.dailyDau.every(r => r.messages === 0)).toBe(true);
    });

    it('excludes system, deleted and bot messages', async () => {
      const now = new Date();
      const bot = await createUser({ agentNumber: '1000003', isBot: true });
      const general = await channel('general');

      await messageAt(general._id, u1._id, now);                                  // counts
      await messageAt(general._id, null,   now, { senderRole: 'system' });
      await messageAt(general._id, u2._id, now, { deletedAt: now });
      await messageAt(general._id, bot._id, now);

      const res = await get('?days=7');

      expect(res.status).toBe(200);
      const row = res.body.data.dailyDau.find(r => r.date === ymd(now));
      expect(row.messages).toBe(1);
    });

    it('still counts messages posted in a channel that was later archived', async () => {
      const now = new Date();
      const old = await channel('retired', 'everyone', { isArchived: true });
      await messageAt(old._id, u1._id, now);

      const res = await get('?days=7');

      expect(res.status).toBe(200);
      expect(res.body.data.dailyDau.find(r => r.date === ymd(now)).messages).toBe(1);
    });

    it('zero-fills the series when there are no channels at all', async () => {
      const res = await get('?days=7');

      expect(res.status).toBe(200);
      expect(res.body.data.dailyDau).toHaveLength(7);
      expect(res.body.data.dailyDau.every(r => r.messages === 0)).toBe(true);
    });
  });

  it('requires an admin', async () => {
    const res = await request(app)
      .get('/api/admin/reports/dau')
      .set('Cookie', authCookie(u1._id));

    expect(res.status).toBe(403);
  });
});
