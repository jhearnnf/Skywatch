/**
 * Chat — photos and videos
 *
 * Covers:
 *   where media is possible       — support tickets and DMs with an admin only
 *   the admin permission switch   — users need it, admins do not; off stops new
 *                                   uploads but keeps what was sent
 *   ownership of a file           — a send may only attach an upload Cloudinary
 *                                   really made, signed for this user here
 *   reading                       — signed links on read, hidden when removed,
 *                                   "Photo" stands in for an empty body
 *   the PostHog replay            — admin-only, link built server-side
 */
process.env.JWT_SECRET = 'test_secret';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'key';
process.env.CLOUDINARY_API_SECRET = 'secret';

jest.mock('../../utils/reportTitle', () => ({
  ...jest.requireActual('../../utils/reportTitle'),
  scheduleReportTitle: jest.fn(),
  scheduleTicketTitle: jest.fn(),
}));

jest.mock('../../utils/cloudinary', () => ({
  uploadBuffer: jest.fn(),
  destroyAsset: jest.fn().mockResolvedValue({ result: 'ok' }),
  signedUrl: jest.fn((id, o) => `https://res.cloudinary.com/test/image/authenticated/s--sig--/${o?.transformation ? 't/' : ''}${id}`),
  signedVideoUrl: jest.fn((id, o) => `https://res.cloudinary.com/test/video/authenticated/s--sig--/${id}.${o?.format ?? 'mp4'}`),
  signDirectUpload: jest.fn(({ publicId, resourceType, transformation, format }) => ({
    uploadUrl: `https://api.cloudinary.com/v1_1/test/${resourceType}/upload`,
    fields: { public_id: publicId, type: 'authenticated', transformation, ...(format ? { format } : {}), signature: 'sig' },
  })),
  // "good" is the only signature Cloudinary ever "made".
  verifyUploadResponse: jest.fn(({ signature }) => signature === 'good'),
  accountUsage: jest.fn().mockResolvedValue({ plan: 'Free', credits: { usage: 2, limit: 25, used_percent: 8 }, storage: { usage: 1000 } }),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage      = require('../../models/ChatMessage');
const ChatUpload       = require('../../models/ChatUpload');
const User             = require('../../models/User');
const { mediaAccess }  = require('../../utils/chatAttachments');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const SESSION = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b';

const openTicket = async (user) => {
  const res = await request(app).post('/api/chat/conversations').set('Cookie', authCookie(user._id)).send({});
  return res.body.data.conversation._id;
};
const openDm = async (from, to) => {
  const res = await request(app).post('/api/chat/dm').set('Cookie', authCookie(from._id)).send({ userId: to._id });
  return res.body.data.conversation._id;
};
const sign = (user, id, kind = 'image', bytes = 200_000) => request(app)
  .post(`/api/chat/conversations/${id}/attachments/sign`)
  .set('Cookie', authCookie(user._id))
  .send({ kind, bytes });
const allow = (admin, id, allowed = true) => request(app)
  .post(`/api/chat/conversations/${id}/media-permission`)
  .set('Cookie', authCookie(admin._id))
  .send({ allowed });
const send = (user, id, payload) => request(app)
  .post(`/api/chat/conversations/${id}/messages`)
  .set('Cookie', authCookie(user._id))
  .send(payload);
const read = (user, id) => request(app)
  .get(`/api/chat/conversations/${id}/messages`)
  .set('Cookie', authCookie(user._id));

// Sign, "upload", and hand back what the client would attach.
async function uploaded(user, id, kind = 'image') {
  const res = await sign(user, id, kind);
  expect(res.status).toBe(200);
  return { publicId: res.body.data.publicId, version: 1, signature: 'good', width: 800, height: 600 };
}

describe('support tickets', () => {
  it('needs the admin switch before the user can upload; admins always can', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(user);

    expect((await sign(user, id)).status).toBe(403);
    expect((await sign(admin, id)).status).toBe(200);

    const before = await read(user, id);
    expect(before.body.data.conversation.media).toMatchObject({ eligible: true, allowed: false, canAttach: false, canToggle: false });

    const on = await allow(admin, id);
    expect(on.status).toBe(200);
    expect(on.body.data.media.allowed).toBe(true);

    const after = await read(user, id);
    expect(after.body.data.conversation.media).toMatchObject({ allowed: true, canAttach: true });
    // The request for screenshots is posted into the thread.
    const line = after.body.data.messages.find(m => m.senderRole === 'system');
    expect(line.body).toMatch(/turned on photo and video uploads/);
    expect(line.body).not.toMatch(/—/);
  });

  it('only an admin can flip the switch', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const id = await openTicket(user);
    expect((await allow(user, id)).status).toBe(403);
  });

  it('sends a photo on its own, and serves it back with signed links', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(user);
    await allow(admin, id);

    const file = await uploaded(user, id);
    expect(file.publicId.startsWith(`chat-attachments/${id}/img_`)).toBe(true);

    const res = await send(user, id, { attachments: [file] });
    expect(res.status).toBe(200);
    expect(res.body.data.message.body).toBe('');
    expect(res.body.data.message.attachments).toEqual([
      expect.objectContaining({ kind: 'image', width: 800, height: 600, url: expect.stringContaining('s--sig--'), thumbUrl: expect.any(String) }),
    ]);

    const upload = await ChatUpload.findOne({ publicId: file.publicId });
    expect(String(upload.messageId)).toBe(res.body.data.message._id);

    // An empty body previews as "Photo" in the rail and in a reply quote.
    const reply = await send(admin, id, { body: 'Thanks', replyToId: res.body.data.message._id });
    expect(reply.body.data.message.replyTo.excerpt).toBe('Photo');
    const overview = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
    const ticket = overview.body.data.tickets.find(t => String(t._id) === String(id));
    expect(ticket.preview.body).toBe('Thanks');
  });

  it('switching off stops new uploads but keeps what was sent', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(user);
    await allow(admin, id);
    const file = await uploaded(user, id);
    const second = await uploaded(user, id);
    await send(user, id, { body: 'Here', attachments: [file] });

    await allow(admin, id, false);
    expect((await sign(user, id)).status).toBe(403);
    // A file signed before the switch went off cannot be sent after it.
    const late = await send(user, id, { attachments: [second] });
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('MEDIA_NOT_ALLOWED');

    const after = await read(user, id);
    expect(after.body.data.messages.find(m => m.body === 'Here').attachments).toHaveLength(1);
  });

  it('a removed photo is hidden from the user and kept for admins', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(user);
    await allow(admin, id);
    const sent = await send(user, id, { body: 'oops', attachments: [await uploaded(user, id)] });
    const del = await request(app).delete(`/api/chat/messages/${sent.body.data.message._id}`).set('Cookie', authCookie(user._id));
    expect(del.status).toBe(200);

    const mine = await read(user, id);
    expect(mine.body.data.messages.find(m => m._id === sent.body.data.message._id)).toBeUndefined();
    const theirs = await read(admin, id);
    expect(theirs.body.data.messages.find(m => m._id === sent.body.data.message._id).attachments).toHaveLength(1);
  });
});

describe('who owns a file', () => {
  it('refuses a forged upload, another user\'s upload, and another thread\'s upload', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(user);
    const other = await openTicket(await createUser({ displayName: 'Viper' }));
    await allow(admin, id);

    const file = await uploaded(user, id);
    expect((await send(user, id, { attachments: [{ ...file, signature: 'forged' }] })).status).toBe(400);

    const adminsFile = await uploaded(admin, id);
    expect((await send(user, id, { attachments: [adminsFile] })).status).toBe(400);

    const elsewhere = await uploaded(admin, other);
    expect((await send(admin, id, { attachments: [elsewhere] })).status).toBe(400);

    // And a file can be attached once only.
    expect((await send(user, id, { attachments: [file] })).status).toBe(200);
    expect((await send(user, id, { attachments: [file] })).status).toBe(400);
  });

  it('caps a message at four files and refuses an oversized video up front', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(user);
    const files = await Promise.all([1, 2, 3, 4, 5].map(() => uploaded(admin, id)));
    expect((await send(admin, id, { attachments: files })).status).toBe(400);

    const big = await sign(admin, id, 'video', 41 * 1024 * 1024);
    expect(big.status).toBe(413);
    expect(big.body.message).not.toMatch(/—/);
  });

  it('signs video uploads with the shrinking transformation and the conversation folder', async () => {
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openTicket(await createUser({ displayName: 'Falcon' }));
    const res = await sign(admin, id, 'video');
    expect(res.status).toBe(200);
    expect(res.body.data.uploadUrl).toMatch(/\/video\/upload$/);
    expect(res.body.data.fields).toMatchObject({ type: 'authenticated', format: 'mp4' });
    expect(res.body.data.fields.transformation).toMatch(/du_60/);
    expect(res.body.data.publicId.startsWith(`chat-attachments/${id}/vid_`)).toBe(true);
  });
});

describe('DMs', () => {
  it('no media between two ordinary users', async () => {
    const a = await createUser({ displayName: 'Falcon' });
    const b = await createUser({ displayName: 'Viper' });
    const id = await openDm(a, b);
    expect((await sign(a, id)).status).toBe(403);
    const res = await read(a, id);
    expect(res.body.data.conversation.media.eligible).toBe(false);
  });

  it('a DM with an admin works like a ticket, and stops when the admin is demoted', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const id = await openDm(admin, user);

    expect((await sign(user, id)).status).toBe(403);
    expect((await sign(admin, id)).status).toBe(200);
    expect((await allow(admin, id)).status).toBe(200);

    const file = await uploaded(user, id);
    expect((await send(user, id, { attachments: [file] })).status).toBe(200);

    await User.updateOne({ _id: admin._id }, { $set: { isAdmin: false } });
    expect((await sign(user, id)).status).toBe(403);
    // What was already sent stays.
    const res = await read(user, id);
    expect(res.body.data.messages.some(m => m.attachments?.length)).toBe(true);
  });

  it('another admin reading the DM cannot flip the switch', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const moderator = await createAdminUser({ displayName: 'Mod' });
    const id = await openDm(admin, user);
    expect((await allow(moderator, id)).status).toBe(403);
  });
});

describe('channels', () => {
  it('never carry media', async () => {
    const admin = await createAdminUser({ displayName: 'Ops' });
    const channel = await ChatConversation.create({ type: 'channel', channel: { name: 'General', slug: 'general' } });
    expect((await sign(admin, channel._id)).status).toBe(403);
    expect(mediaAccess(channel, admin).eligible).toBe(false);
  });
});

describe('PostHog replay on a ticket', () => {
  const report = (user, replay) => request(app)
    .post('/api/users/report-problem')
    .set('Cookie', authCookie(user._id))
    .send({ description: 'The dot never stops drifting off the screen', pageReported: '/cbat/sma', replay });

  it('is shown to admins only, with a link the server built', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const res = await report(user, {
      recording: true, sessionId: SESSION, offsetMs: 95_000, url: 'https://evil.example/phish',
    });
    expect(res.status).toBe(201);
    const id = res.body.data.conversationId;

    const asAdmin = await read(admin, id);
    const replay = asAdmin.body.data.conversation.replay;
    expect(replay.recording).toBe(true);
    expect(replay.url).toMatch(new RegExp(`^https://eu\\.posthog\\.com/.*replay/${SESSION}\\?t=95$`));
    expect(JSON.stringify(replay)).not.toMatch(/evil/);

    const asUser = await read(user, id);
    expect(asUser.body.data.conversation).not.toHaveProperty('replay');

    const problems = await request(app).get('/api/admin/problems').set('Cookie', authCookie(admin._id));
    expect(problems.body.data.problems[0].ticket.replay.url).toBe(replay.url);
  });

  it('says there is no recording when the browser was not recording', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const res = await report(user, { recording: false, sessionId: 'not-a-session' });
    const asAdmin = await read(admin, res.body.data.conversationId);
    expect(asAdmin.body.data.conversation.replay).toMatchObject({ recording: false, url: null });
  });

  it('a report from an old bundle has no replay at all', async () => {
    const user = await createUser({ displayName: 'Falcon' });
    const admin = await createAdminUser({ displayName: 'Ops' });
    const res = await report(user, undefined);
    const asAdmin = await read(admin, res.body.data.conversationId);
    expect(asAdmin.body.data.conversation.replay).toBeNull();
  });
});

describe('admin usage readout', () => {
  it('reports the plan usage to admins only', async () => {
    const admin = await createAdminUser({ displayName: 'Ops' });
    const user = await createUser({ displayName: 'Falcon' });
    const ok = await request(app).get('/api/chat/admin/media-usage').set('Cookie', authCookie(admin._id));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ creditsUsed: 2, creditsLimit: 25, creditsPercent: 8 });
    const no = await request(app).get('/api/chat/admin/media-usage').set('Cookie', authCookie(user._id));
    expect(no.status).toBe(403);
  });
});

describe('orphan sweep', () => {
  it('destroys uploads never sent after a day, and leaves sent ones alone', async () => {
    const { destroyAsset } = require('../../utils/cloudinary');
    const user = await createUser();
    const convo = await ChatConversation.create({ type: 'support', userId: user._id });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await ChatUpload.create({ publicId: 'chat-attachments/x/img_old', kind: 'image', conversationId: convo._id, userId: user._id, createdAt: old });
    await ChatUpload.create({ publicId: 'chat-attachments/x/img_sent', kind: 'image', conversationId: convo._id, userId: user._id, createdAt: old, messageId: convo._id });
    await ChatUpload.create({ publicId: 'chat-attachments/x/img_new', kind: 'image', conversationId: convo._id, userId: user._id });

    const chatRouter = require('../../routes/chat');
    await chatRouter.sweepOrphanUploads();

    const left = (await ChatUpload.find().lean()).map(u => u.publicId).sort();
    expect(left).toEqual(['chat-attachments/x/img_new', 'chat-attachments/x/img_sent']);
    expect(destroyAsset).toHaveBeenCalledWith('chat-attachments/x/img_old', expect.objectContaining({ type: 'authenticated' }));
  });
});

describe('the message model', () => {
  it('still requires text when there is nothing attached', async () => {
    const convo = await ChatConversation.create({ type: 'support' });
    await expect(ChatMessage.create({ conversationId: convo._id, senderRole: 'user', body: '' })).rejects.toThrow(/required/);
  });
});
