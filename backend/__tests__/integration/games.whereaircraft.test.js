process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const GameSessionWhereAircraftResult = require('../../models/GameSessionWhereAircraftResult');
const {
  createUser,
  createBrief,
  createSettings,
  createReadRecord,
  authCookie,
} = require('../helpers/factories');

let user, cookie;
let aircraftBrief, baseBrief1, baseBrief2;

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await createSettings({
    aircoinsWhereAircraftRound1: 5,
    aircoinsWhereAircraftRound2: 10,
    aircoinsWhereAircraftBonus:  5,
  });
  // User with low spawn threshold so tests can trigger a spawn easily
  user   = await createUser({ whereAircraftSpawnThreshold: 1 });
  cookie = authCookie(user._id);

  baseBrief1    = await createBrief({ category: 'Bases',    title: 'RAF Coningsby' });
  baseBrief2    = await createBrief({ category: 'Bases',    title: 'RAF Lossiemouth' });
  aircraftBrief = await createBrief({
    category: 'Aircrafts',
    title:    'Eurofighter Typhoon',
    associatedBaseBriefIds: [baseBrief1._id],
  });
});

afterEach(async () => db.clearDatabase());
afterAll(async ()  => db.closeDatabase());

// ── Helper: satisfy prerequisites ─────────────────────────────────────────
async function satisfyPrereqs() {
  // Need ≥2 completed Bases reads and ≥2 completed Aircrafts reads
  const extraBase     = await createBrief({ category: 'Bases',    title: 'RAF Marham' });
  const extraAircraft = await createBrief({ category: 'Aircrafts', title: 'F-35 Lightning II' });

  await createReadRecord(user._id, baseBrief1._id,   { completed: true });
  await createReadRecord(user._id, extraBase._id,    { completed: true });
  await createReadRecord(user._id, aircraftBrief._id, { completed: true });
  await createReadRecord(user._id, extraAircraft._id, { completed: true });
}

// ── POST /api/games/wheres-aircraft/spawn-check ───────────────────────────
describe('POST /api/games/wheres-aircraft/spawn-check', () => {
  const endpoint = '/api/games/wheres-aircraft/spawn-check';

  it('returns spawn: false when user has fewer than 2 Bases reads', async () => {
    const extraAircraft = await createBrief({ category: 'Aircrafts', title: 'Extra Aircraft' });
    await createReadRecord(user._id, baseBrief1._id,    { completed: true }); // only 1 base
    await createReadRecord(user._id, aircraftBrief._id, { completed: true });
    await createReadRecord(user._id, extraAircraft._id, { completed: true });

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: aircraftBrief._id });

    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(false);
  });

  it('returns spawn: false when user has fewer than 2 Aircrafts reads', async () => {
    const extraBase = await createBrief({ category: 'Bases', title: 'RAF Marham' });
    await createReadRecord(user._id, baseBrief1._id,  { completed: true });
    await createReadRecord(user._id, extraBase._id,   { completed: true });
    await createReadRecord(user._id, aircraftBrief._id, { completed: true }); // only 1 aircraft

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: aircraftBrief._id });

    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(false);
  });

  it('returns spawn: false when prereqs are met but no eligible aircraft (no linked bases read)', async () => {
    // aircraft has baseBrief1 linked, but user hasn't read baseBrief1
    const extraBase     = await createBrief({ category: 'Bases',    title: 'RAF Marham' });
    const extraAircraft = await createBrief({ category: 'Aircrafts', title: 'F-35 Lightning II' });

    // Read 2 bases that are NOT linked to the aircraft
    await createReadRecord(user._id, baseBrief2._id,    { completed: true });
    await createReadRecord(user._id, extraBase._id,     { completed: true });
    await createReadRecord(user._id, aircraftBrief._id, { completed: true });
    await createReadRecord(user._id, extraAircraft._id, { completed: true });

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: aircraftBrief._id });

    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(false);
  });

  it('returns spawn: true with aircraftBriefId when all conditions are met', async () => {
    await satisfyPrereqs(); // reads baseBrief1 (which is linked to aircraftBrief)

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: aircraftBrief._id });

    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(true);
    expect(res.body.data.aircraftBriefId).toBeDefined();
    expect(res.body.data.aircraftTitle).toBe('Eurofighter Typhoon');
  });

  it('does not spawn the same aircraft again after the user has already won it', async () => {
    await satisfyPrereqs();

    // Mark aircraftBrief as already won by this user
    await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'prev-session',
      status:          'completed',
      won:             true,
      round1Correct:   true,
      round2Attempted: true,
      round2Correct:   true,
      selectedBaseIds: [],
      correctBaseIds:  [],
      aircoinsEarned:  20,
    });

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: aircraftBrief._id });

    // aircraftBrief is the only eligible aircraft — pool falls back to all eligible
    // so spawn still fires (all aircraft cleared = duplicates allowed)
    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(true);
    expect(String(res.body.data.aircraftBriefId)).toBe(String(aircraftBrief._id));
  });

  it('prefers unplayed aircraft over already-won ones when both are eligible', async () => {
    // Second aircraft brief linked to baseBrief1
    const secondAircraft = await createBrief({
      category: 'Aircrafts',
      title:    'Panavia Tornado',
      associatedBaseBriefIds: [baseBrief1._id],
    });

    await satisfyPrereqs();
    // Read the second aircraft too so it's eligible
    await createReadRecord(user._id, secondAircraft._id, { completed: true });

    // Mark the first aircraft as already won
    await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'prev-session',
      status:          'completed',
      won:             true,
      round1Correct:   true,
      round2Attempted: true,
      round2Correct:   true,
      selectedBaseIds: [],
      correctBaseIds:  [],
      aircoinsEarned:  20,
    });

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: secondAircraft._id });

    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(true);
    // Should pick the unplayed second aircraft, not the already-won first
    expect(String(res.body.data.aircraftBriefId)).toBe(String(secondAircraft._id));
  });

  it('returns spawn: false when counter has not reached threshold', async () => {
    // Reset user to threshold=3 so it takes multiple calls
    const User = require('../../models/User');
    await User.findByIdAndUpdate(user._id, { whereAircraftSpawnThreshold: 3, whereAircraftReadsSinceLastGame: 0 });
    await satisfyPrereqs();

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ briefId: aircraftBrief._id });

    expect(res.status).toBe(200);
    expect(res.body.data.spawn).toBe(false); // counter=1, threshold=3
  });
});

// ── POST /api/games/wheres-aircraft/round1 ────────────────────────────────
describe('POST /api/games/wheres-aircraft/round1', () => {
  const endpoint = '/api/games/wheres-aircraft/round1';
  const gameSessionId = 'test-session-round1';

  it('returns 5 options with exactly one isCorrect:true', async () => {
    // Need ≥4 other aircraft briefs for the random decoys
    for (let i = 0; i < 4; i++) {
      await createBrief({ category: 'Aircrafts', title: `Decoy Aircraft ${i}` });
    }

    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ aircraftBriefId: String(aircraftBrief._id), gameSessionId });

    expect(res.status).toBe(200);
    const { options, mediaUrl } = res.body.data;
    expect(options).toHaveLength(5);
    const correct = options.filter(o => o.isCorrect);
    expect(correct).toHaveLength(1);
    expect(correct[0].title).toBe('Eurofighter Typhoon');
    expect(mediaUrl).toBeNull(); // no media attached in test
  });

  it('returns 404 when aircraftBriefId does not exist', async () => {
    const fakeId = '000000000000000000000001';
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ aircraftBriefId: fakeId, gameSessionId });

    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ aircraftBriefId: String(aircraftBrief._id), gameSessionId });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/games/wheres-aircraft/round2 ────────────────────────────────
describe('POST /api/games/wheres-aircraft/round2', () => {
  const endpoint = '/api/games/wheres-aircraft/round2';
  const gameSessionId = 'test-session-round2';

  beforeEach(async () => {
    await createReadRecord(user._id, baseBrief1._id, { completed: true });
  });

  it('returns bases with isCorrect and isRead flags', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ aircraftBriefId: String(aircraftBrief._id), gameSessionId });

    expect(res.status).toBe(200);
    const { bases, correctBaseIds, correctBaseCount, aircraftTitle, round1Aircoins } = res.body.data;

    expect(aircraftTitle).toBe('Eurofighter Typhoon');
    expect(correctBaseCount).toBe(1);
    expect(correctBaseIds).toHaveLength(1);

    const correctBase = bases.find(b => b.isCorrect);
    expect(correctBase).toBeDefined();
    expect(correctBase.title).toBe('RAF Coningsby');

    // baseBrief1 (RAF Coningsby) was read — isRead should be true
    expect(correctBase.isRead).toBe(true);

    // baseBrief2 (RAF Lossiemouth) was not read — isRead should be false
    const unreadBase = bases.find(b => b.title === 'RAF Lossiemouth');
    expect(unreadBase).toBeDefined();
    expect(unreadBase.isRead).toBe(false);
    expect(unreadBase.isCorrect).toBe(false);

    // round1Aircoins included in response
    expect(typeof round1Aircoins).toBe('number');
    expect(round1Aircoins).toBe(5);
  });

  it('returns 404 when aircraftBriefId does not exist', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send({ aircraftBriefId: '000000000000000000000001', gameSessionId });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/games/wheres-aircraft/submit ────────────────────────────────
describe('POST /api/games/wheres-aircraft/submit', () => {
  const endpoint = '/api/games/wheres-aircraft/submit';

  function submitPayload(overrides = {}) {
    return {
      aircraftBriefId:  String(aircraftBrief._id),
      gameSessionId:    `sess-${Date.now()}`,
      round1Correct:    false,
      round2Attempted:  false,
      round2Correct:    false,
      selectedBaseIds:  [],
      correctBaseIds:   [],
      timeTakenSeconds: 30,
      status:           'completed',
      ...overrides,
    };
  }

  it('returns won:false and aircoinsEarned:0 when round 1 fails', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ round1Correct: false }));

    expect(res.status).toBe(201);
    expect(res.body.data.won).toBe(false);
    expect(res.body.data.aircoinsEarned).toBe(0);
  });

  it('awards round1 coins only when round1 correct but round2 not attempted', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ round1Correct: true, round2Attempted: false }));

    expect(res.status).toBe(201);
    expect(res.body.data.won).toBe(false);
    expect(res.body.data.aircoinsEarned).toBe(5); // round1 only
  });

  it('awards round1 + round2 coins when round1 correct, round2 attempted but wrong', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ round1Correct: true, round2Attempted: true, round2Correct: false }));

    expect(res.status).toBe(201);
    expect(res.body.data.won).toBe(false);
    expect(res.body.data.aircoinsEarned).toBe(5); // round1 only, no round2 or bonus
  });

  it('awards full coins (round1 + round2 + bonus) on a complete win', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ round1Correct: true, round2Attempted: true, round2Correct: true }));

    expect(res.status).toBe(201);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.aircoinsEarned).toBe(20); // 5 + 10 + 5
  });

  it('excludes round1 coins when round1AlreadyAwarded is true', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({
        round1Correct:        true,
        round2Attempted:      true,
        round2Correct:        true,
        round1AlreadyAwarded: true,
      }));

    expect(res.status).toBe(201);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.aircoinsEarned).toBe(15); // 10 + 5 (no round1 coins)
  });

  it('records abandoned game with status abandoned and awards no coins', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ status: 'abandoned', round1Correct: true }));

    expect(res.status).toBe(201);
    expect(res.body.data.aircoinsEarned).toBe(0);

    const record = await GameSessionWhereAircraftResult.findOne({ userId: user._id });
    expect(record.status).toBe('abandoned');
  });

  it('abandoned games are NOT counted in /api/users/stats gamesPlayed', async () => {
    await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ status: 'abandoned' }));

    const statsRes = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data.gamesPlayed).toBe(0);
  });

  // ── round1_only status ──────────────────────────────────────────────────

  it('round1_only awards round1 coins when round1AlreadyAwarded is false', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ status: 'round1_only', round1Correct: true, round1AlreadyAwarded: false }));

    expect(res.status).toBe(201);
    expect(res.body.data.aircoinsEarned).toBe(5); // round1 only
  });

  it('round1_only awards 0 extra coins when round1AlreadyAwarded is true', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ status: 'round1_only', round1Correct: true, round1AlreadyAwarded: true }));

    expect(res.status).toBe(201);
    expect(res.body.data.aircoinsEarned).toBe(0);
  });

  it('round1_only never awards round2 or bonus coins', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({
        status:          'round1_only',
        round1Correct:   true,
        round2Attempted: true,
        round2Correct:   true,
        round1AlreadyAwarded: false,
      }));

    expect(res.status).toBe(201);
    expect(res.body.data.aircoinsEarned).toBe(5); // round1 only, no round2/bonus
  });

  it('round1_only stores won=false and round2Attempted=false in DB', async () => {
    await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ status: 'round1_only', round1Correct: true }));

    const record = await GameSessionWhereAircraftResult.findOne({ userId: user._id });
    expect(record.status).toBe('round1_only');
    expect(record.won).toBe(false);
    expect(record.round1Correct).toBe(true);
    expect(record.round2Attempted).toBe(false);
  });

  it('round1_only games are NOT counted in /api/users/stats gamesPlayed', async () => {
    await request(app)
      .post(endpoint)
      .set('Cookie', cookie)
      .send(submitPayload({ status: 'round1_only', round1Correct: true }));

    const statsRes = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data.gamesPlayed).toBe(0);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post(endpoint)
      .send(submitPayload());

    expect(res.status).toBe(401);
  });
});

// ── GET /api/games/history/wheres-aircraft/:sessionId ─────────────────────
describe('GET /api/games/history/wheres-aircraft/:sessionId', () => {
  it('returns round breakdown for a completed session', async () => {
    const session = await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'drill-down-test',
      status:          'completed',
      round1Correct:   true,
      round2Attempted: true,
      round2Correct:   true,
      selectedBaseIds: [baseBrief1._id],
      correctBaseIds:  [baseBrief1._id],
      won:             true,
      aircoinsEarned:  20,
    });

    const res = await request(app)
      .get(`/api/games/history/wheres-aircraft/${session._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.aircraftName).toBe('Eurofighter Typhoon');
    expect(data.round1Correct).toBe(true);
    expect(data.round2Attempted).toBe(true);
    expect(data.round2Correct).toBe(true);
    expect(data.won).toBe(true);
    expect(data.correctBases).toHaveLength(1);
    expect(data.correctBases[0].title).toBe('RAF Coningsby');
    expect(data.selectedBases).toHaveLength(1);
    expect(data.selectedBases[0].title).toBe('RAF Coningsby');
  });

  it('returns round1_only session with empty round 2 base lists', async () => {
    const session = await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'drill-down-r1only',
      status:          'round1_only',
      round1Correct:   true,
      round2Attempted: false,
      round2Correct:   false,
      selectedBaseIds: [],
      correctBaseIds:  [baseBrief1._id],
      won:             false,
      aircoinsEarned:  5,
    });

    const res = await request(app)
      .get(`/api/games/history/wheres-aircraft/${session._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.round1Correct).toBe(true);
    expect(data.round2Attempted).toBe(false);
    expect(data.selectedBases).toHaveLength(0);
    expect(data.correctBases).toHaveLength(1);
  });

  it('shows wrong bases in selectedBases when user picked incorrectly', async () => {
    const session = await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'drill-down-wrong',
      status:          'completed',
      round1Correct:   true,
      round2Attempted: true,
      round2Correct:   false,
      selectedBaseIds: [baseBrief2._id],   // wrong base selected
      correctBaseIds:  [baseBrief1._id],   // correct base was baseBrief1
      won:             false,
      aircoinsEarned:  5,
    });

    const res = await request(app)
      .get(`/api/games/history/wheres-aircraft/${session._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.correctBases[0].title).toBe('RAF Coningsby');
    expect(data.selectedBases[0].title).toBe('RAF Lossiemouth');
  });

  it('returns 404 when session belongs to a different user', async () => {
    const otherUser   = await createUser({ email: 'other@test.com' });
    const otherCookie = authCookie(otherUser._id);

    const session = await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'other-user-session',
      status:          'completed',
      won:             true,
      aircoinsEarned:  20,
    });

    const res = await request(app)
      .get(`/api/games/history/wheres-aircraft/${session._id}`)
      .set('Cookie', otherCookie);

    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const session = await GameSessionWhereAircraftResult.create({
      userId:          user._id,
      aircraftBriefId: aircraftBrief._id,
      gameSessionId:   'unauth-session',
      status:          'completed',
      won:             true,
      aircoinsEarned:  20,
    });

    const res = await request(app)
      .get(`/api/games/history/wheres-aircraft/${session._id}`);

    expect(res.status).toBe(401);
  });
});
