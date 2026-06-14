process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatTutorial = require('../../models/GameSessionCbatTutorial');

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

describe('GET /api/admin/reports/cbat — tutorial usage', () => {
  it('surfaces a Target (tutorial) entry, practiceKeys, and a per-step funnel', async () => {
    // Three playthroughs: two completed (one of them only reached step 2 before
    // the completion flag — unrealistic but fine), one abandoned at step 1.
    await GameSessionCbatTutorial.create([
      { userId: u1._id, gameKey: 'target', clientRunId: 'a', furthestStep: 3, totalSteps: 4, completed: true },
      { userId: u2._id, gameKey: 'target', clientRunId: 'b', furthestStep: 3, totalSteps: 4, completed: true },
      { userId: u2._id, gameKey: 'target', clientRunId: 'c', furthestStep: 1, totalSteps: 4, completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;

    // practiceKeys includes the tutorial + the trace-practise modes.
    expect(data.practiceKeys).toEqual(expect.arrayContaining(['target-tutorial', 'plane-turn-2d', 'plane-turn-3d']));

    // Tutorial appears as its own per-game row, labelled and flagged.
    const row = data.perGame.find(g => g.key === 'target-tutorial');
    expect(row).toBeTruthy();
    expect(row.label).toBe('Target (tutorial)');
    expect(row.isTutorial).toBe(true);
    expect(row.sessions).toBe(3);
    expect(row.players).toBe(2);

    // Tutorial usage is kept OUT of the engagement headline session count.
    expect(data.headlines.totalSessions).toBe(0);

    // Per-step funnel: 3 reached step 0/1, 2 reached step 2/3, 2 completed.
    const tut = data.tutorials.find(t => t.key === 'target-tutorial');
    expect(tut.sessions).toBe(3);
    expect(tut.completed).toBe(2);
    expect(tut.funnel.map(s => s.reached)).toEqual([3, 3, 2, 2]);
    // Drop-off between step 1 and step 2 = 1 (the abandoned run).
    expect(tut.funnel[1].dropOff).toBe(1);
  });

  it('returns an empty funnel when there are no tutorial plays', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const tut = res.body.data.tutorials.find(t => t.key === 'target-tutorial');
    expect(tut.sessions).toBe(0);
    expect(tut.funnel).toEqual([]);
  });
});
