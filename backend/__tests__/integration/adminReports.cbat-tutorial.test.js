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
    // Every play saw the same shape, so the funnel covers all of them.
    expect(tut.funnelSessions).toBe(3);
    expect(tut.funnelCompleted).toBe(2);
  });

  it('builds the funnel only from plays that saw the current section count', async () => {
    // A window straddling the addition of a section. Step 1 of a 4-section run is
    // a different section from step 1 of a 5-section one, so mixing them would
    // blend two meanings into one bar — and the older runs can never reach the
    // new final step, which would fake a cliff at the end.
    await GameSessionCbatTutorial.create([
      { userId: u1._id, gameKey: 'target', clientRunId: 'old-a', furthestStep: 3, totalSteps: 4, completed: true },
      { userId: u1._id, gameKey: 'target', clientRunId: 'old-b', furthestStep: 1, totalSteps: 4, completed: false },
      { userId: u2._id, gameKey: 'target', clientRunId: 'new-a', furthestStep: 4, totalSteps: 5, completed: true },
      { userId: u2._id, gameKey: 'target', clientRunId: 'new-b', furthestStep: 1, totalSteps: 5, completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    const tut = res.body.data.tutorials.find(t => t.key === 'target-tutorial');

    // Headline usage spans every version. `completed` is the one measure that
    // survives a section being added: "reached the final step" means a different
    // section per version, but finishing the tutorial means the same thing in
    // both, so the historical completion total must never be scoped to a version.
    expect(tut.sessions).toBe(4);
    expect(tut.players).toBe(2);
    expect(tut.completed).toBe(2);          // one old + one new run finished
    expect(tut.completionRate).toBe(0.5);   // 2 of 4, not 1 of 2

    // The top-level funnel describes the current 5-section shape only: two plays,
    // one of which reached the last section.
    expect(tut.totalSteps).toBe(5);
    expect(tut.funnelSessions).toBe(2);
    expect(tut.funnelCompleted).toBe(1);
    expect(tut.funnel.map(s => s.reached)).toEqual([2, 2, 1, 1, 1]);
    expect(tut.funnel[1].dropOff).toBe(1);
    // The last step's drop-off compares against that shape's own completion count,
    // so it must not read as a loss just because older plays never got there.
    expect(tut.funnel[4].dropOff).toBe(0);

    // The older shape is reported alongside rather than discarded or shifted:
    // its step 1 is the Light section, which on the new shape is step 2.
    expect(tut.versions.map(v => v.totalSteps)).toEqual([5, 4]);
    const [live, old] = tut.versions;
    expect(live.current).toBe(true);
    expect(old.current).toBe(false);
    expect(old.sessions).toBe(2);
    expect(old.completed).toBe(1);
    expect(old.funnel.map(s => s.reached)).toEqual([2, 2, 1, 1]);

    // Per-version completions sum back to the headline total, so splitting the
    // funnel can never lose a completion — it only attributes it to a version.
    const summed = tut.versions.reduce((n, v) => n + v.completed, 0);
    expect(summed).toBe(tut.completed);
    expect(tut.versions.reduce((n, v) => n + v.sessions, 0)).toBe(tut.sessions);
  });

  it('reports a single version when every play saw the same section count', async () => {
    await GameSessionCbatTutorial.create([
      { userId: u1._id, gameKey: 'target', clientRunId: 'a', furthestStep: 4, totalSteps: 5, completed: true },
      { userId: u2._id, gameKey: 'target', clientRunId: 'b', furthestStep: 2, totalSteps: 5, completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    const tut = res.body.data.tutorials.find(t => t.key === 'target-tutorial');
    expect(tut.versions).toHaveLength(1);
    expect(tut.versions[0].current).toBe(true);
    expect(tut.versions[0].funnel).toEqual(tut.funnel);
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

  // Every CBAT game shipping a practice/tutorial mode must appear, not just Target.
  it('covers all tutorial-enabled games, with Target first', async () => {
    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const { data } = res.body;

    expect(data.tutorials.map(t => t.key))
      .toEqual(['target-tutorial', 'ant-tutorial', 'flag-tutorial', 'sat-tutorial']);
    // Labels are derived from CBAT_GAMES, so a game rename carries through.
    expect(data.gameLabels['flag-tutorial']).toBe('FLAG (tutorial)');
    expect(data.gameLabels['ant-tutorial']).toBe('Airborne Numerical Test (tutorial)');
    // All of them grey out and get a per-game row + stacked-chart series.
    for (const key of ['target-tutorial', 'ant-tutorial', 'flag-tutorial', 'sat-tutorial']) {
      expect(data.practiceKeys).toContain(key);
      expect(data.gameKeys).toContain(key);
      expect(data.perGame.find(g => g.key === key)?.isTutorial).toBe(true);
    }
  });

  it('builds funnels per game, keeping one game out of another\'s counts', async () => {
    await GameSessionCbatTutorial.create([
      { userId: u1._id, gameKey: 'ant',  clientRunId: 'ant-a',  furthestStep: 2, totalSteps: 3, completed: true },
      { userId: u2._id, gameKey: 'ant',  clientRunId: 'ant-b',  furthestStep: 0, totalSteps: 3, completed: false },
      { userId: u1._id, gameKey: 'flag', clientRunId: 'flag-a', furthestStep: 1, totalSteps: 2, completed: false },
    ]);

    const res = await request(app)
      .get('/api/admin/reports/cbat?window=all')
      .set('Cookie', cookie);

    const byKey = Object.fromEntries(res.body.data.tutorials.map(t => [t.key, t]));

    expect(byKey['ant-tutorial'].sessions).toBe(2);
    expect(byKey['ant-tutorial'].players).toBe(2);
    expect(byKey['ant-tutorial'].completed).toBe(1);
    expect(byKey['ant-tutorial'].funnel.map(s => s.reached)).toEqual([2, 1, 1]);
    // The run that never left step 0 drops off between step 1 and step 2.
    expect(byKey['ant-tutorial'].funnel[0].dropOff).toBe(1);

    expect(byKey['flag-tutorial'].sessions).toBe(1);
    expect(byKey['flag-tutorial'].completed).toBe(0);
    expect(byKey['sat-tutorial'].sessions).toBe(0);
    // Tutorials still stay out of the engagement headline session count.
    expect(res.body.data.headlines.totalSessions).toBe(0);
  });
});
