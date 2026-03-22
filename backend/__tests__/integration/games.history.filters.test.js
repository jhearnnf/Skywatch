process.env.JWT_SECRET = 'test_secret';

const request  = require('supertest');
const app      = require('../../app');
const db       = require('../helpers/setupDb');
const {
  createUser,
  createBrief,
  createSettings,
  authCookie,
  createPassedQuizAttempt,
  createWonBooResult,
  createBooBriefs,
} = require('../helpers/factories');
const GameSessionQuizAttempt         = require('../../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult = require('../../models/GameSessionOrderOfBattleResult');
const GameSessionWhereAircraftResult = require('../../models/GameSessionWhereAircraftResult');
const GameOrderOfBattle              = require('../../models/GameOrderOfBattle');

let user, cookie, brief;

beforeAll(async () => { await db.connect(); await createSettings(); });
beforeEach(async () => {
  user   = await createUser();
  cookie = authCookie(user._id);
  brief  = await createBrief();
});
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── helpers ───────────────────────────────────────────────────────────────

async function seedQuiz({ status = 'completed', percentageCorrect = 100 } = {}) {
  return GameSessionQuizAttempt.create({
    userId:            user._id,
    intelBriefId:      brief._id,
    gameSessionId:     `quiz-${Date.now()}-${Math.random()}`,
    difficulty:        'easy',
    status,
    percentageCorrect,
    correctAnswers:    status === 'abandoned' ? 0 : percentageCorrect === 100 ? 5 : 3,
    totalQuestions:    5,
  });
}

async function seedBoo({ abandoned = false, won = true } = {}) {
  const game = await GameOrderOfBattle.create({
    anchorBriefId: brief._id,
    category:      'Aircrafts',
    difficulty:    'easy',
    orderType:     'speed',
    choices:       [],
  });
  return GameSessionOrderOfBattleResult.create({
    userId:      user._id,
    gameId:      game._id,
    won,
    abandoned,
    userChoices: [],
  });
}

async function seedWta({ status = 'completed', won = true, round1Correct = true } = {}) {
  return GameSessionWhereAircraftResult.create({
    userId:          user._id,
    aircraftBriefId: brief._id,
    gameSessionId:   `wta-${Date.now()}-${Math.random()}`,
    status,
    won,
    round1Correct,
    round2Attempted: status === 'completed',
    round2Correct:   won,
  });
}

// ── GET /api/games/history — type filter ──────────────────────────────────

describe('GET /api/games/history — ?type filter', () => {
  it('returns all types by default', async () => {
    await seedQuiz();
    await seedBoo();

    const res = await request(app).get('/api/games/history').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const types = res.body.data.sessions.map(s => s.type);
    expect(types).toContain('quiz');
    expect(types).toContain('order_of_battle');
  });

  it('?type=quiz returns only quiz sessions', async () => {
    await seedQuiz();
    await seedBoo();

    const res = await request(app).get('/api/games/history?type=quiz').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every(s => s.type === 'quiz')).toBe(true);
  });

  it('?type=order_of_battle returns only BOO sessions', async () => {
    await seedQuiz();
    await seedBoo();

    const res = await request(app).get('/api/games/history?type=order_of_battle').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every(s => s.type === 'order_of_battle')).toBe(true);
  });

  it('?type=wheres_aircraft returns only WTA sessions', async () => {
    await seedQuiz();
    await seedWta();

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every(s => s.type === 'wheres_aircraft')).toBe(true);
  });

  it('?type filter total reflects only matching sessions', async () => {
    await seedQuiz();
    await seedQuiz();
    await seedBoo();

    const res = await request(app).get('/api/games/history?type=quiz').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });
});

// ── GET /api/games/history — ?result filter ───────────────────────────────

describe('GET /api/games/history — ?result filter', () => {
  it('?result=abandoned returns only abandoned sessions', async () => {
    await seedQuiz({ status: 'abandoned' });
    await seedBoo({ abandoned: true });
    await seedQuiz({ status: 'completed', percentageCorrect: 100 }); // not abandoned

    const res = await request(app).get('/api/games/history?result=abandoned').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBe(2);
    expect(sessions.every(s => s.resultCategory === 'abandoned')).toBe(true);
  });

  it('?result=perfect returns only perfect sessions', async () => {
    await seedQuiz({ percentageCorrect: 100 });  // perfect
    await seedQuiz({ percentageCorrect: 70 });   // passed
    await seedQuiz({ percentageCorrect: 40 });   // failed

    const res = await request(app).get('/api/games/history?result=perfect').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBe(1);
    expect(sessions[0].resultCategory).toBe('perfect');
  });

  it('?result=passed returns only passed sessions', async () => {
    await seedQuiz({ percentageCorrect: 80 }); // passed
    await seedBoo({ won: true });              // passed (BOO win)
    await seedQuiz({ percentageCorrect: 100 }); // perfect — excluded

    const res = await request(app).get('/api/games/history?result=passed').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBe(2);
    expect(sessions.every(s => s.resultCategory === 'passed')).toBe(true);
  });

  it('?result=failed returns only failed sessions', async () => {
    await seedQuiz({ percentageCorrect: 40 }); // failed
    await seedBoo({ won: false });             // failed
    await seedQuiz({ percentageCorrect: 90 }); // passed — excluded

    const res = await request(app).get('/api/games/history?result=failed').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBe(2);
    expect(sessions.every(s => s.resultCategory === 'failed')).toBe(true);
  });

  it('combined ?type=quiz&result=failed filters correctly', async () => {
    await seedQuiz({ percentageCorrect: 30 }); // quiz + failed ✓
    await seedQuiz({ percentageCorrect: 80 }); // quiz + passed ✗
    await seedBoo({ won: false });             // boo + failed ✗

    const res = await request(app).get('/api/games/history?type=quiz&result=failed').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { sessions } = res.body.data;
    expect(sessions.length).toBe(1);
    expect(sessions[0].type).toBe('quiz');
    expect(sessions[0].resultCategory).toBe('failed');
  });
});

// ── GET /api/games/history — resultCategory on WTA ───────────────────────

describe('GET /api/games/history — WTA resultCategory', () => {
  it('WTA won=true → resultCategory perfect', async () => {
    await seedWta({ status: 'completed', won: true });

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);
    expect(res.body.data.sessions[0].resultCategory).toBe('perfect');
  });

  it('WTA round1_only → resultCategory passed', async () => {
    await seedWta({ status: 'round1_only', won: false, round1Correct: true });

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);
    expect(res.body.data.sessions[0].resultCategory).toBe('passed');
  });

  it('WTA round1 failed → resultCategory failed', async () => {
    await seedWta({ status: 'completed', won: false, round1Correct: false });

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);
    expect(res.body.data.sessions[0].resultCategory).toBe('failed');
  });

  it('WTA abandoned → resultCategory abandoned', async () => {
    await seedWta({ status: 'abandoned', won: false, round1Correct: false });

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);
    expect(res.body.data.sessions[0].resultCategory).toBe('abandoned');
  });

  it('WTA non-abandoned sessions have canDrillDown: true', async () => {
    await seedWta({ status: 'completed', won: true });

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);
    expect(res.body.data.sessions[0].canDrillDown).toBe(true);
  });

  it('WTA abandoned sessions have canDrillDown: false', async () => {
    await seedWta({ status: 'abandoned', won: false, round1Correct: false });

    const res = await request(app).get('/api/games/history?type=wheres_aircraft').set('Cookie', cookie);
    expect(res.body.data.sessions[0].canDrillDown).toBe(false);
  });
});
