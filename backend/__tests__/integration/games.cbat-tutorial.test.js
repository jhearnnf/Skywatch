process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatTutorial = require('../../models/GameSessionCbatTutorial');

let user, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const post = (body) =>
  request(app).post('/api/games/cbat/target/tutorial').set('Cookie', cookie).send(body);

describe('POST /api/games/cbat/:gameKey/tutorial — auth & validation', () => {
  it('returns 401 without an auth cookie', async () => {
    const res = await request(app).post('/api/games/cbat/target/tutorial').send({ clientRunId: 'r1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for an unknown gameKey', async () => {
    const res = await request(app)
      .post('/api/games/cbat/not-a-real-game/tutorial')
      .set('Cookie', cookie)
      .send({ clientRunId: 'r1' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown game');
  });

  it('returns 400 when clientRunId is missing', async () => {
    const res = await post({ furthestStep: 0 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/games/cbat/:gameKey/tutorial — upsert per playthrough', () => {
  it('creates one row on entry and updates it in place as the user advances', async () => {
    await post({ clientRunId: 'run-A', furthestStep: 0, totalSteps: 4 });
    await post({ clientRunId: 'run-A', furthestStep: 1, totalSteps: 4 });
    await post({ clientRunId: 'run-A', furthestStep: 2, totalSteps: 4 });

    const docs = await GameSessionCbatTutorial.find({ userId: user._id });
    expect(docs).toHaveLength(1);
    expect(docs[0].furthestStep).toBe(2);
    expect(docs[0].totalSteps).toBe(4);
    expect(docs[0].gameKey).toBe('target');
    expect(docs[0].completed).toBe(false);
  });

  it('keeps furthestStep monotonic — a backward jump cannot lower the recorded reach', async () => {
    await post({ clientRunId: 'run-B', furthestStep: 3, totalSteps: 4 });
    await post({ clientRunId: 'run-B', furthestStep: 1, totalSteps: 4 });

    const doc = await GameSessionCbatTutorial.findOne({ clientRunId: 'run-B' });
    expect(doc.furthestStep).toBe(3);
  });

  it('marks completed=true and never flips it back to false', async () => {
    await post({ clientRunId: 'run-C', furthestStep: 3, totalSteps: 4, completed: true });
    await post({ clientRunId: 'run-C', furthestStep: 3, totalSteps: 4, completed: false });

    const doc = await GameSessionCbatTutorial.findOne({ clientRunId: 'run-C' });
    expect(doc.completed).toBe(true);
  });

  it('separate clientRunIds create separate rows (two playthroughs = two docs)', async () => {
    await post({ clientRunId: 'run-D', furthestStep: 0, totalSteps: 4 });
    await post({ clientRunId: 'run-E', furthestStep: 0, totalSteps: 4 });

    const count = await GameSessionCbatTutorial.countDocuments({ userId: user._id });
    expect(count).toBe(2);
  });

  it('returns 200 with the stored doc', async () => {
    const res = await post({ clientRunId: 'run-F', furthestStep: 1, totalSteps: 4 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.clientRunId).toBe('run-F');
    expect(res.body.data.userId.toString()).toBe(user._id.toString());
  });
});
