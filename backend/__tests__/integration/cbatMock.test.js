process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const CbatMockAssessment = require('../../models/CbatMockAssessment');
const GameSessionCbatFlagResult = require('../../models/GameSessionCbatFlagResult');
const { IDLE_LIMIT_MS } = require('../../utils/cbatMock');

let user, cookie;

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings({ cbatTiers: ['free', 'silver', 'gold'] });
  user   = await createUser({ agentNumber: '2000001' });
  cookie = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const flagRun = (extra = {}) => ({ totalScore: 60, totalTime: 60, grade: 'Good', ...extra });
const visRun  = (extra = {}) => ({ correctCount: 8, tier1Correct: 5, tier2Correct: 3, totalTime: 90, grade: 'Good', ...extra });

// Start a mock, then pin its steps to a short known list so a test can walk it.
async function startPinned(steps, breakAfter = []) {
  const res = await request(app).post('/api/cbat-mock/start').set('Cookie', cookie).send({ battery: 'pilot' });
  expect(res.status).toBe(201);
  const id = res.body.data.mock.id;
  await CbatMockAssessment.updateOne({ _id: id }, { $set: { steps, breakAfter, currentStep: 0 } });
  return id;
}

const FLAG_STEP = { codes: ['FLAG'], gameKeys: ['flag'], minutes: 1.5 };
const VISS_STEP = { codes: ['VISS'], gameKeys: ['visualisation-2d', 'visualisation-3d'], minutes: 4 };

describe('GET /api/cbat-mock/preview', () => {
  it('lists a role\'s tests, the time and which the player has never played', async () => {
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(flagRun());
    const res = await request(app).get('/api/cbat-mock/preview?battery=pilot').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toMatchObject({ scope: 'role', batteryKey: 'pilot', region: 'GB' });
    expect(data.totalMinutes).toBeGreaterThan(30);
    expect(data.steps.find(s => s.gameKeys.includes('flag')).played).toBe(true);
    expect(data.steps.find(s => s.gameKeys.includes('cut')).played).toBe(false);
  });

  it('previews every role in a region', async () => {
    const res = await request(app).get('/api/cbat-mock/preview?battery=all&region=CA').set('Cookie', cookie);
    expect(res.body.data.scope).toBe('all');
    expect(res.body.data.batteries.map(b => b.key)).toEqual(expect.arrayContaining(['rcaf-pilot', 'rcaf-acso', 'rcaf-aec']));
  });
});

describe('POST /api/cbat-mock/start', () => {
  it('starts a shuffled role mock and refuses a second one while it runs', async () => {
    const res = await request(app).post('/api/cbat-mock/start').set('Cookie', cookie).send({ battery: 'intelligence' });
    expect(res.status).toBe(201);
    expect(res.body.data.mock).toMatchObject({ scope: 'role', batteryKey: 'intelligence', status: 'active', currentStep: 0 });
    expect(res.body.data.mock.testsTotal).toBe(8);

    const again = await request(app).post('/api/cbat-mock/start').set('Cookie', cookie).send({ battery: 'pilot' });
    expect(again.status).toBe(409);
  });

  it('is closed to players when the admin switch is off, but not to admins', async () => {
    await createSettings({ cbatMockAssessmentEnabled: false });
    const res = await request(app).post('/api/cbat-mock/start').set('Cookie', cookie).send({ battery: 'pilot' });
    expect(res.status).toBe(403);

    const admin = await createAdminUser({ agentNumber: '2000009', email: 'mockadmin@test.com' });
    const ok = await request(app).post('/api/cbat-mock/start').set('Cookie', authCookie(admin._id)).send({ battery: 'pilot' });
    expect(ok.status).toBe(201);
  });

  it('leaves out a game an admin has switched off', async () => {
    await createSettings({ cbatGameEnabled: { flag: false } });
    const res = await request(app).post('/api/cbat-mock/start').set('Cookie', cookie).send({ battery: 'pilot' });
    const games = res.body.data.mock.steps.flatMap(s => s.gameKeys);
    expect(games).not.toContain('flag');
  });
});

describe('claiming runs', () => {
  it('moves the mock on when the run it is waiting for arrives, and starts a break where one falls', async () => {
    const id = await startPinned([FLAG_STEP, VISS_STEP], [0]);

    const res = await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(flagRun({ mockId: id }));
    expect(res.status).toBe(201);

    const mock = await CbatMockAssessment.findById(id);
    expect(mock.currentStep).toBe(1);
    expect(mock.steps[0].done).toBe(true);
    expect(mock.steps[0].results[0]).toMatchObject({ gameKey: 'flag', score: 60 });
    expect(mock.breakStartedAt).not.toBeNull();
  });

  it('needs both halves of a two-game step before moving on, then completes the mock', async () => {
    const id = await startPinned([VISS_STEP]);
    await request(app).post('/api/games/cbat/visualisation-2d/result').set('Cookie', cookie).send(visRun({ mockId: id }));
    let mock = await CbatMockAssessment.findById(id);
    expect(mock.currentStep).toBe(0);
    expect(mock.status).toBe('active');

    await request(app).post('/api/games/cbat/visualisation-3d/result').set('Cookie', cookie).send(visRun({ mockId: id }));
    mock = await CbatMockAssessment.findById(id);
    expect(mock.status).toBe('completed');
    expect(mock.endedAt).not.toBeNull();
  });

  it('saves a run for the wrong game as normal without moving the mock', async () => {
    const id = await startPinned([VISS_STEP, FLAG_STEP]);
    const res = await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(flagRun({ mockId: id }));
    expect(res.status).toBe(201);
    expect(await GameSessionCbatFlagResult.countDocuments()).toBe(1);
    expect((await CbatMockAssessment.findById(id)).currentStep).toBe(0);
  });

  it('does not claim a retried submission twice', async () => {
    const id = await startPinned([FLAG_STEP, VISS_STEP]);
    const body = flagRun({ mockId: id, clientResultId: 'same-run' });
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(body);
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(body);
    const mock = await CbatMockAssessment.findById(id);
    expect(mock.steps[0].results).toHaveLength(1);
    expect(mock.currentStep).toBe(1);
  });

  it('will not let another player\'s run move your mock', async () => {
    const id = await startPinned([FLAG_STEP]);
    const other = await createUser({ agentNumber: '2000002', email: 'mockother@test.com' });
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', authCookie(other._id)).send(flagRun({ mockId: id }));
    expect((await CbatMockAssessment.findById(id)).currentStep).toBe(0);
  });
});

describe('the idle limit', () => {
  it('closes a mock left idle past the limit, keeps its scores, and tells the player once', async () => {
    const id = await startPinned([FLAG_STEP, VISS_STEP]);
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(flagRun({ mockId: id }));
    const lastActivityAt = new Date(Date.now() - IDLE_LIMIT_MS - 60_000);
    await CbatMockAssessment.updateOne({ _id: id }, { $set: { lastActivityAt } });

    const res = await request(app).get('/api/cbat-mock/current').set('Cookie', cookie);
    expect(res.body.data.mock).toBeNull();
    expect(res.body.data.closed).toMatchObject({ id, status: 'expired', testsDone: 1 });
    expect(new Date(res.body.data.closed.endedAt).getTime()).toBe(lastActivityAt.getTime() + IDLE_LIMIT_MS);
    expect(await GameSessionCbatFlagResult.countDocuments()).toBe(1);

    await request(app).post(`/api/cbat-mock/${id}/notice-seen`).set('Cookie', cookie);
    const again = await request(app).get('/api/cbat-mock/current').set('Cookie', cookie);
    expect(again.body.data.closed).toBeNull();
  });

  it('restarts the idle clock and ends the break when the next test begins', async () => {
    const id = await startPinned([FLAG_STEP, VISS_STEP], [0]);
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(flagRun({ mockId: id }));
    const res = await request(app).post(`/api/cbat-mock/${id}/begin`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.mock.breakStartedAt).toBeNull();
  });
});

describe('leaving, history and the score sheet', () => {
  it('abandons on request and keeps the sitting in history with a sheet', async () => {
    const id = await startPinned([FLAG_STEP, VISS_STEP]);
    await request(app).post('/api/games/cbat/flag/result').set('Cookie', cookie).send(flagRun({ mockId: id }));
    const res = await request(app).post(`/api/cbat-mock/${id}/abandon`).set('Cookie', cookie);
    expect(res.body.data.mock.status).toBe('abandoned');

    const hist = await request(app).get('/api/cbat-mock/history').set('Cookie', cookie);
    expect(hist.body.data.mocks).toHaveLength(1);
    expect(hist.body.data.mocks[0]).toMatchObject({ id, status: 'abandoned', testsDone: 1, batteryKey: 'pilot' });

    const one = await request(app).get(`/api/cbat-mock/${id}`).set('Cookie', cookie);
    const [pilot] = one.body.data.mock.sheet.batteries;
    expect(pilot.key).toBe('pilot');
    // Only FLAG was sat, so the role cannot be judged.
    expect(pilot.status).toBe('provisional');
    const cip = pilot.domains.find(d => d.key === 'CIP');
    expect(cip.stanine).not.toBeNull();
    expect(cip.minStanine).toBe(5);
  });

  it('never shows one player another\'s mock', async () => {
    const id = await startPinned([FLAG_STEP]);
    const other = await createUser({ agentNumber: '2000003', email: 'mockother3@test.com' });
    const res = await request(app).get(`/api/cbat-mock/${id}`).set('Cookie', authCookie(other._id));
    expect(res.status).toBe(404);
  });
});
