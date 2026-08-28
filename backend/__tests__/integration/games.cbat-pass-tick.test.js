process.env.JWT_SECRET = 'test_secret';

/**
 * Who is told that an agent has passed the real CBAT.
 *
 * `User.cbatPassed` is set by hand by an admin, from the user telling us they
 * passed at OASC. It is a real, personally identifying fact about someone's
 * application, so it goes to signed-in agents only — a logged-out visitor is
 * never sent the field at all, rather than being sent it and trusted to hide
 * it in the client.
 */

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const seedCbatLounge   = require('../../seeds/seedCbatLounge');
const { LOUNGE_SLUG }  = seedCbatLounge;

let passer, cookie;

const post = (c, body) =>
  request(app).post('/api/games/cbat/target/result').set('Cookie', c).send(body);

const board = (period, c) => {
  const req = request(app).get(`/api/games/cbat/target/leaderboard?period=${period}`);
  return c ? req.set('Cookie', c) : req;
};

// The board is padded with demo rows, so the agent under test has to be picked
// out by id rather than by position.
const rowFor = (res, userId) =>
  (res.body.data.leaderboard || []).find(e => String(e.userId) === String(userId));

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  // A display name, or the channel refuses the message with DISPLAY_NAME_REQUIRED.
  passer = await createUser({
    agentNumber: '1000001', displayName: 'Falcon',
    cbatPassed: true, cbatPassedAt: new Date(),
  });
  cookie = authCookie(passer._id);
  await post(cookie, { totalScore: 900, totalTime: 60, grade: 'Outstanding' });
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('the CBAT pass flag on the leaderboards', () => {
  for (const period of ['all-time', 'weekly']) {
    describe(`${period} board`, () => {
      it('tells a signed-in agent who has passed', async () => {
        const res = await board(period, cookie);
        expect(res.status).toBe(200);
        expect(rowFor(res, passer._id).cbatPassed).toBe(true);
      });

      // The board itself is behind `protect`, which is what actually keeps the
      // flag away from logged-out visitors. Asserted so that opening the route
      // up later fails here rather than quietly publishing the flag.
      it('tells a logged-out visitor nothing at all', async () => {
        const res = await board(period);
        expect(res.status).toBe(401);
      });

      it('reports an agent who has not passed as false, not missing', async () => {
        const other = await createUser({ agentNumber: '1000002' });
        const otherCookie = authCookie(other._id);
        await post(otherCookie, { totalScore: 800, totalTime: 60, grade: 'Good' });

        const res = await board(period, cookie);
        expect(rowFor(res, other._id).cbatPassed).toBe(false);
      });
    });
  }
});

describe('the CBAT pass flag in chat', () => {
  it('rides along with the sender profiles that draw the avatars', async () => {
    await seedCbatLounge();
    const convo = await ChatConversation.findOne({ 'channel.slug': LOUNGE_SLUG }).lean();
    await request(app).post(`/api/chat/conversations/${convo._id}/messages`)
      .set('Cookie', cookie).send({ body: 'hello' });

    const res = await request(app).get(`/api/chat/conversations/${convo._id}/messages`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.senders[String(passer._id)].cbatPassed).toBe(true);
  });

  it('rides along with the tap-a-name card', async () => {
    const viewer = await createUser({ agentNumber: '1000003' });
    const res = await request(app).get(`/api/chat/users/${passer._id}/card`)
      .set('Cookie', authCookie(viewer._id));
    expect(res.status).toBe(200);
    expect(res.body.data.user.cbatPassed).toBe(true);
  });

  it('reports false for an agent who has not passed', async () => {
    const viewer = await createUser({ agentNumber: '1000004' });
    const res = await request(app).get(`/api/chat/users/${viewer._id}/card`)
      .set('Cookie', authCookie(viewer._id));
    expect(res.body.data.user.cbatPassed).toBe(false);
  });
});
