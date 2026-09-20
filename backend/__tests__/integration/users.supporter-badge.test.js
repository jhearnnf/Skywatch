process.env.JWT_SECRET = 'test_secret';

/**
 * The "Supporter" mark and its opt-out.
 *
 * `User.supporter` is derived: a signed-in donation stamps
 * `donationPrompt.donatedAt` (see routes/stripeWebhook.js) and the donor may
 * then hide the mark with PATCH /api/users/me/supporter-badge. Every surface
 * reads it through one helper, so the tests here check that one switch covers
 * the boards, chat, the tap-a-name card and the profile, and that the switch
 * is refused for anyone who has never donated.
 */

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const User             = require('../../models/User');
const ChatConversation = require('../../models/ChatConversation');
const seedCbatLounge   = require('../../seeds/seedCbatLounge');
const { LOUNGE_SLUG }  = seedCbatLounge;

let donor, cookie, viewer, viewerCookie;

const patchBadge = (c, body) =>
  request(app).patch('/api/users/me/supporter-badge').set('Cookie', c).send(body);

const board = (period, c) =>
  request(app).get(`/api/games/cbat/target/leaderboard?period=${period}`).set('Cookie', c);

const rowFor = (res, userId) =>
  (res.body.data.leaderboard || []).find(e => String(e.userId) === String(userId));

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  donor = await createUser({
    agentNumber: '1000001', displayName: 'Falcon',
    donationPrompt: { donatedAt: new Date(), donatedTotalPence: 300 },
  });
  cookie = authCookie(donor._id);
  viewer = await createUser({ agentNumber: '1000002', displayName: 'Viper' });
  viewerCookie = authCookie(viewer._id);
  await request(app).post('/api/games/cbat/target/result').set('Cookie', cookie)
    .send({ totalScore: 900, totalTime: 60, grade: 'Outstanding' });
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('PATCH /api/users/me/supporter-badge', () => {
  it('hides the mark and returns the refreshed user', async () => {
    const res = await patchBadge(cookie, { visible: false });
    expect(res.status).toBe(200);
    expect(res.body.data.user.supporter).toBe(false);
    expect(res.body.data.user.hasDonated).toBe(true);
    expect((await User.findById(donor._id)).hideSupporterBadge).toBe(true);
  });

  it('shows it again', async () => {
    await patchBadge(cookie, { visible: false });
    const res = await patchBadge(cookie, { visible: true });
    expect(res.body.data.user.supporter).toBe(true);
  });

  it('rejects a non-boolean', async () => {
    expect((await patchBadge(cookie, { visible: 'no' })).status).toBe(400);
  });

  // A switch for a badge you have not earned would be noise at best and a
  // stray flag on the account at worst.
  it('is refused for an account that has never donated', async () => {
    const res = await patchBadge(viewerCookie, { visible: false });
    expect(res.status).toBe(403);
    expect((await User.findById(viewer._id)).hideSupporterBadge).toBe(false);
  });

  it('needs a session', async () => {
    const res = await request(app).patch('/api/users/me/supporter-badge').send({ visible: false });
    expect(res.status).toBe(401);
  });
});

describe('the mark on every surface, before and after opting out', () => {
  const expectEverywhere = async (expected) => {
    for (const period of ['all-time', 'weekly']) {
      const res = await board(period, viewerCookie);
      expect(res.status).toBe(200);
      expect(rowFor(res, donor._id).supporter).toBe(expected);
    }

    const card = await request(app).get(`/api/chat/users/${donor._id}/card`).set('Cookie', viewerCookie);
    expect(card.body.data.user.supporter).toBe(expected);

    const profile = await request(app).get(`/api/users/${donor._id}/profile`).set('Cookie', viewerCookie);
    expect(profile.body.data.user.supporter).toBe(expected);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.data.user.supporter).toBe(expected);
  };

  it('is worn by default, with no backfill', async () => {
    await expectEverywhere(true);
  });

  it('comes off everywhere with the one switch', async () => {
    await patchBadge(cookie, { visible: false });
    await expectEverywhere(false);
  });

  it('rides along with the chat sender profiles, and honours the switch there too', async () => {
    await seedCbatLounge();
    const convo = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();
    await request(app).post(`/api/chat/conversations/${convo._id}/messages`)
      .set('Cookie', cookie).send({ body: 'hello' });

    const senders = async () => (await request(app)
      .get(`/api/chat/conversations/${convo._id}/messages`).set('Cookie', viewerCookie))
      .body.data.senders[String(donor._id)];

    expect((await senders()).supporter).toBe(true);
    await patchBadge(cookie, { visible: false });
    expect((await senders()).supporter).toBe(false);
  });

  it('is never worn by someone who has not donated', async () => {
    const card = await request(app).get(`/api/chat/users/${viewer._id}/card`).set('Cookie', cookie);
    expect(card.body.data.user.supporter).toBe(false);
  });
});
