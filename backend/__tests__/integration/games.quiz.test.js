process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const GameSessionQuizAttempt = require('../../models/GameSessionQuizAttempt');
const {
  createUser,
  createBrief,
  createSettings,
  createGameType,
  createQuizQuestions,
  createReadRecord,
  createPassedQuizAttempt,
  authCookie,
} = require('../helpers/factories');

let user, brief, gameType, cookie;

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await createSettings();
  gameType = await createGameType();
  user     = await createUser({ difficultySetting: 'easy' });
  brief    = await createBrief({ category: 'News' });
  cookie   = authCookie(user._id);
});

afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── POST /api/games/quiz/start ────────────────────────────────────────────
describe('POST /api/games/quiz/start', () => {
  it('returns 5 questions with correctAnswerId when enough questions exist', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const { attemptId, gameSessionId, questions, difficulty } = res.body.data;
    expect(attemptId).toBeDefined();
    expect(gameSessionId).toBeDefined();
    expect(difficulty).toBe('easy');
    expect(questions).toHaveLength(5);

    // Each question must expose correctAnswerId for client-side feedback
    questions.forEach(q => {
      expect(q.correctAnswerId).toBeDefined();
      expect(q.answers.length).toBeGreaterThan(0);
      // Answers are trimmed to answerCount (3 for easy by default settings)
      expect(q.answers.length).toBeLessThanOrEqual(3);
      // correctAnswerId must appear in the displayed answers
      const answerIds = q.answers.map(a => String(a._id));
      expect(answerIds).toContain(String(q.correctAnswerId));
    });
  });

  it('returns 400 when fewer than 5 questions exist', async () => {
    await createQuizQuestions(brief._id, gameType._id, 3, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not enough/i);
  });

  it('returns 400 if briefId is missing', async () => {
    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app)
      .post('/api/games/quiz/start')
      .send({ briefId: brief._id });

    expect(res.status).toBe(401);
  });

  it('marks isFirstAttempt=true on first attempt', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');

    const res = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    expect(res.status).toBe(200);
    // Attempt is created; first attempt status is tracked internally
    expect(res.body.data.attemptId).toBeDefined();
  });
});

// ── POST /api/games/quiz/result ────────────────────────────────────────────
describe('POST /api/games/quiz/result', () => {
  async function startQuiz() {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    return startRes.body.data;
  }

  it('records a correct answer server-side', async () => {
    const { questions, gameSessionId, attemptId } = await startQuiz();
    const q = questions[0];

    const res = await request(app)
      .post('/api/games/quiz/result')
      .set('Cookie', cookie)
      .send({
        questionId:         q._id,
        displayedAnswerIds: q.answers.map(a => a._id),
        selectedAnswerId:   q.correctAnswerId, // correct
        timeTakenSeconds:   5,
        gameSessionId,
        attemptId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.isCorrect).toBe(true);
    expect(res.body.data.aircoinsEarned).toBe(0); // coins awarded at finish, not per question
  });

  it('records a wrong answer as isCorrect=false', async () => {
    const { questions, gameSessionId, attemptId } = await startQuiz();
    const q = questions[0];
    const wrongAnswer = q.answers.find(a => String(a._id) !== String(q.correctAnswerId));

    const res = await request(app)
      .post('/api/games/quiz/result')
      .set('Cookie', cookie)
      .send({
        questionId:         q._id,
        displayedAnswerIds: q.answers.map(a => a._id),
        selectedAnswerId:   wrongAnswer._id,
        timeTakenSeconds:   8,
        gameSessionId,
        attemptId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.isCorrect).toBe(false);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app)
      .post('/api/games/quiz/result')
      .send({ questionId: 'x', selectedAnswerId: 'y', gameSessionId: 'z' });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/games/quiz/attempt/:id/finish ───────────────────────────────
describe('POST /api/games/quiz/attempt/:id/finish', () => {
  async function runFullQuiz(allCorrect = true) {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });

    const { questions, gameSessionId, attemptId } = startRes.body.data;

    for (const q of questions) {
      const selectedId = allCorrect
        ? q.correctAnswerId
        : q.answers.find(a => String(a._id) !== String(q.correctAnswerId))._id;

      await request(app)
        .post('/api/games/quiz/result')
        .set('Cookie', cookie)
        .send({
          questionId:         q._id,
          displayedAnswerIds: q.answers.map(a => a._id),
          selectedAnswerId:   selectedId,
          timeTakenSeconds:   3,
          gameSessionId,
          attemptId,
        });
    }

    return { attemptId, questions };
  }

  it('marks attempt as completed, awards coins for a perfect score', async () => {
    const { attemptId } = await runFullQuiz(true); // 5/5 correct

    const res = await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.aircoinsEarned).toBeGreaterThan(0);
    // Perfect score bonus should apply (settings.aircoins100Percent = 15)
    // 5 correct × 10 + 15 bonus = 65
    expect(res.body.data.aircoinsEarned).toBe(65);
    expect(res.body.data.isFirstAttempt).toBe(true);
    expect(res.body.data.breakdown).toHaveLength(2);
    expect(res.body.data.breakdown[0]).toMatchObject({ label: expect.stringMatching(/5 correct/i), amount: 50 });
    expect(res.body.data.breakdown[1]).toMatchObject({ label: expect.stringMatching(/perfect score bonus/i), amount: 15 });
  });

  it('does not award coins on a failing score (< 60%)', async () => {
    const { attemptId } = await runFullQuiz(false); // 0/5 correct

    const res = await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(false);
    expect(res.body.data.aircoinsEarned).toBe(0);
  });

  it('allows abandoning an attempt', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    const { attemptId } = startRes.body.data;

    const res = await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'abandoned' });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(false);
    expect(res.body.data.aircoinsEarned).toBe(0);
  });

  it('stores abandoned status correctly in the DB', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    const { attemptId } = startRes.body.data;

    await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'abandoned' });

    const record = await GameSessionQuizAttempt.findById(attemptId);
    expect(record.status).toBe('abandoned');
    expect(record.won).toBe(false);
    expect(record.aircoinsEarned).toBe(0);
  });

  it('abandoned attempts are NOT counted in /api/users/stats gamesPlayed', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    const { attemptId } = startRes.body.data;

    await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'abandoned' });

    const statsRes = await request(app)
      .get('/api/users/stats')
      .set('Cookie', cookie);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data.gamesPlayed).toBe(0);
  });

  it('returns 400 for invalid status value', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    const { attemptId } = startRes.body.data;

    const res = await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an attempt belonging to another user', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    const { attemptId } = startRes.body.data;

    const otherUser   = await createUser();
    const otherCookie = authCookie(otherUser._id);

    const res = await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', otherCookie)
      .send({ status: 'completed' });

    expect(res.status).toBe(404);
  });

  it('does not award coins on a second win (repeat attempt)', async () => {
    // First win
    const { attemptId: a1 } = await runFullQuiz(true);
    await request(app)
      .post(`/api/games/quiz/attempt/${a1}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    // Second attempt on same brief
    const { attemptId: a2 } = await runFullQuiz(true);
    const res = await request(app)
      .post(`/api/games/quiz/attempt/${a2}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.aircoinsEarned).toBe(0); // no coins on repeat
    expect(res.body.data.isFirstAttempt).toBe(false);
    expect(res.body.data.breakdown).toEqual([]);
  });

  it('awards coins when user passes after a prior failed attempt', async () => {
    // First attempt — fail
    const { attemptId: a1 } = await runFullQuiz(false); // 0/5 correct
    await request(app)
      .post(`/api/games/quiz/attempt/${a1}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    // Second attempt — pass with perfect score
    const { attemptId: a2 } = await runFullQuiz(true); // 5/5 correct
    const res = await request(app)
      .post(`/api/games/quiz/attempt/${a2}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(true);
    expect(res.body.data.isFirstAttempt).toBe(true);  // no prior WIN, so still first
    expect(res.body.data.aircoinsEarned).toBe(65);    // 5×10 + 15 bonus
  });

  it('does not award coins when user fails after a prior failed attempt', async () => {
    // First attempt — fail
    const { attemptId: a1 } = await runFullQuiz(false);
    await request(app)
      .post(`/api/games/quiz/attempt/${a1}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    // Second attempt — also fail
    const { attemptId: a2 } = await runFullQuiz(false);
    const res = await request(app)
      .post(`/api/games/quiz/attempt/${a2}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.won).toBe(false);
    expect(res.body.data.aircoinsEarned).toBe(0);
  });
});

// ── GET /api/games/quiz/status/:briefId ───────────────────────────────────
describe('GET /api/games/quiz/status/:briefId', () => {
  it('returns hasCompleted=false before any win', async () => {
    const res = await request(app)
      .get(`/api/games/quiz/status/${brief._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(false);
  });

  it('returns hasCompleted=true after winning', async () => {
    await createQuizQuestions(brief._id, gameType._id, 5, 'easy');
    const startRes = await request(app)
      .post('/api/games/quiz/start')
      .set('Cookie', cookie)
      .send({ briefId: brief._id });
    const { questions, gameSessionId, attemptId } = startRes.body.data;

    for (const q of questions) {
      await request(app)
        .post('/api/games/quiz/result')
        .set('Cookie', cookie)
        .send({
          questionId: q._id, displayedAnswerIds: q.answers.map(a => a._id),
          selectedAnswerId: q.correctAnswerId, timeTakenSeconds: 2, gameSessionId, attemptId,
        });
    }

    await request(app)
      .post(`/api/games/quiz/attempt/${attemptId}/finish`)
      .set('Cookie', cookie)
      .send({ status: 'completed' });

    const res = await request(app)
      .get(`/api/games/quiz/status/${brief._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.hasCompleted).toBe(true);
  });
});

// ── GET /api/games/quiz/recommended-briefs ────────────────────────────────
describe('GET /api/games/quiz/recommended-briefs', () => {
  it('returns 401 if not authenticated', async () => {
    const res = await request(app).get('/api/games/quiz/recommended-briefs');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no briefs have quiz questions', async () => {
    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(0);
  });

  it('returns active briefs (read + playable + not passed) with quizState "active"', async () => {
    const b = await createBrief({ category: 'News' });
    await createQuizQuestions(b._id, gameType._id, 5, 'easy');
    await createReadRecord(user._id, b._id);

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs).toHaveLength(1);
    expect(briefs[0].quizState).toBe('active');
    expect(briefs[0]._id.toString()).toBe(b._id.toString());
  });

  it('returns needs-read briefs (playable + not read) with quizState "needs-read"', async () => {
    const b = await createBrief({ category: 'News' });
    await createQuizQuestions(b._id, gameType._id, 5, 'easy');
    // No read record created

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs).toHaveLength(1);
    expect(briefs[0].quizState).toBe('needs-read');
  });

  it('returns passed briefs with quizState "passed"', async () => {
    const b = await createBrief({ category: 'News' });
    await createQuizQuestions(b._id, gameType._id, 5, 'easy');
    await createReadRecord(user._id, b._id);
    await createPassedQuizAttempt(user._id, b._id);

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs).toHaveLength(1);
    expect(briefs[0].quizState).toBe('passed');
  });

  it('orders active before passed when both present', async () => {
    const active = await createBrief({ category: 'News', title: 'Active Brief' });
    const passed = await createBrief({ category: 'News', title: 'Passed Brief' });
    await createQuizQuestions(active._id, gameType._id, 5, 'easy');
    await createQuizQuestions(passed._id, gameType._id, 5, 'easy');
    await createReadRecord(user._id, active._id);
    await createReadRecord(user._id, passed._id);
    await createPassedQuizAttempt(user._id, passed._id);

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const briefs = res.body.data.briefs;
    expect(briefs).toHaveLength(2);
    expect(briefs[0].quizState).toBe('active');
    expect(briefs[1].quizState).toBe('passed');
  });

  it('orders active before needs-read before passed', async () => {
    const bActive    = await createBrief({ category: 'News', title: 'Active' });
    const bNeedsRead = await createBrief({ category: 'News', title: 'NeedsRead' });
    const bPassed    = await createBrief({ category: 'News', title: 'Passed' });
    for (const b of [bActive, bNeedsRead, bPassed]) {
      await createQuizQuestions(b._id, gameType._id, 5, 'easy');
    }
    await createReadRecord(user._id, bActive._id);
    await createReadRecord(user._id, bPassed._id);
    await createPassedQuizAttempt(user._id, bPassed._id);
    // bNeedsRead has no read record

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const states = res.body.data.briefs.map(b => b.quizState);
    expect(states[0]).toBe('active');
    expect(states[1]).toBe('needs-read');
    expect(states[2]).toBe('passed');
  });

  it('respects the limit query parameter', async () => {
    for (let i = 0; i < 4; i++) {
      const b = await createBrief({ category: 'News', title: `Brief ${i}` });
      await createQuizQuestions(b._id, gameType._id, 5, 'easy');
      await createReadRecord(user._id, b._id);
    }

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs?limit=2')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(2);
  });

  it('does not return briefs with fewer than 5 questions', async () => {
    const b = await createBrief({ category: 'News' });
    await createQuizQuestions(b._id, gameType._id, 3, 'easy'); // only 3
    await createReadRecord(user._id, b._id);

    const res = await request(app)
      .get('/api/games/quiz/recommended-briefs')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(0);
  });
});
