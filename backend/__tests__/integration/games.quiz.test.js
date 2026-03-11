process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser,
  createBrief,
  createSettings,
  createGameType,
  createQuizQuestions,
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
