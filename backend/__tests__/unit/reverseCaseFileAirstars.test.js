'use strict';

const db = require('../helpers/setupDb');
const { createUser } = require('../helpers/factories');
const reverseCaseFileAirstars = require('../../migrations/reverseCaseFileAirstars');
const GameSessionCaseFileResult = require('../../models/GameSessionCaseFileResult');
const User = require('../../models/User');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

function makeSession(userId, overrides = {}) {
  return GameSessionCaseFileResult.create({
    userId,
    caseSlug:    overrides.caseSlug    ?? 'russia-ukraine',
    chapterSlug: overrides.chapterSlug ?? 'chapter-one',
    completedAt: overrides.completedAt === undefined ? new Date() : overrides.completedAt,
    scoring:     overrides.scoring     ?? {
      totalScore:      250,
      breakdown:       [],
      airstarsAwarded: 75,
      levelXpAwarded:  75,
    },
  });
}

describe('reverseCaseFileAirstars', () => {
  it('deducts airstarsAwarded from totalAirstars and cycleAirstars for completed sessions', async () => {
    const u = await createUser();
    await User.updateOne(
      { _id: u._id },
      { $set: { totalAirstars: 200, cycleAirstars: 200 } },
    );
    await makeSession(u._id, {
      scoring: { totalScore: 250, breakdown: [], airstarsAwarded: 75, levelXpAwarded: 75 },
    });

    const summary = await reverseCaseFileAirstars({ logger: { log: () => {} } });

    const after = await User.findById(u._id).lean();
    expect(after.totalAirstars).toBe(125);
    expect(after.cycleAirstars).toBe(125);
    expect(summary.sessionsReversed).toBe(1);
    expect(summary.totalAirstarsDeducted).toBe(75);
    expect(summary.usersTouched).toBe(1);
  });

  it('aggregates multiple sessions for the same user into one user update', async () => {
    const u = await createUser();
    await User.updateOne(
      { _id: u._id },
      { $set: { totalAirstars: 500, cycleAirstars: 500 } },
    );
    await makeSession(u._id, {
      chapterSlug: 'ch1',
      scoring: { totalScore: 100, breakdown: [], airstarsAwarded: 30, levelXpAwarded: 30 },
    });
    await makeSession(u._id, {
      chapterSlug: 'ch2',
      scoring: { totalScore: 200, breakdown: [], airstarsAwarded: 60, levelXpAwarded: 60 },
    });

    await reverseCaseFileAirstars({ logger: { log: () => {} } });

    const after = await User.findById(u._id).lean();
    expect(after.totalAirstars).toBe(410); // 500 - 90
    expect(after.cycleAirstars).toBe(410);
  });

  it('clamps cycleAirstars at 0 (never goes negative)', async () => {
    const u = await createUser();
    await User.updateOne(
      { _id: u._id },
      { $set: { totalAirstars: 100, cycleAirstars: 10 } },
    );
    await makeSession(u._id, {
      scoring: { totalScore: 250, breakdown: [], airstarsAwarded: 75, levelXpAwarded: 75 },
    });

    await reverseCaseFileAirstars({ logger: { log: () => {} } });

    const after = await User.findById(u._id).lean();
    expect(after.cycleAirstars).toBe(0);
    expect(after.totalAirstars).toBe(25);
  });

  it('clamps totalAirstars at 0 too', async () => {
    const u = await createUser();
    await User.updateOne(
      { _id: u._id },
      { $set: { totalAirstars: 20, cycleAirstars: 20 } },
    );
    await makeSession(u._id, {
      scoring: { totalScore: 250, breakdown: [], airstarsAwarded: 75, levelXpAwarded: 75 },
    });

    await reverseCaseFileAirstars({ logger: { log: () => {} } });

    const after = await User.findById(u._id).lean();
    expect(after.totalAirstars).toBe(0);
    expect(after.cycleAirstars).toBe(0);
  });

  it('is idempotent — running twice does not double-deduct', async () => {
    const u = await createUser();
    await User.updateOne(
      { _id: u._id },
      { $set: { totalAirstars: 200, cycleAirstars: 200 } },
    );
    await makeSession(u._id, {
      scoring: { totalScore: 250, breakdown: [], airstarsAwarded: 75, levelXpAwarded: 75 },
    });

    await reverseCaseFileAirstars({ logger: { log: () => {} } });
    const second = await reverseCaseFileAirstars({ logger: { log: () => {} } });

    expect(second.sessionsReversed).toBe(0);
    expect(second.totalAirstarsDeducted).toBe(0);

    const after = await User.findById(u._id).lean();
    expect(after.totalAirstars).toBe(125);
    expect(after.cycleAirstars).toBe(125);
  });

  it('marks each visited session with airstarsReversed:true', async () => {
    const u = await createUser();
    await User.updateOne({ _id: u._id }, { $set: { totalAirstars: 200, cycleAirstars: 200 } });
    const sess = await makeSession(u._id);

    await reverseCaseFileAirstars({ logger: { log: () => {} } });

    const reloaded = await GameSessionCaseFileResult.findById(sess._id).lean();
    expect(reloaded.scoring.airstarsReversed).toBe(true);
  });

  it('skips sessions that have not been completed', async () => {
    const u = await createUser();
    await User.updateOne({ _id: u._id }, { $set: { totalAirstars: 200, cycleAirstars: 200 } });
    // completedAt = null — incomplete session
    await GameSessionCaseFileResult.create({
      userId:      u._id,
      caseSlug:    'x',
      chapterSlug: 'y',
      completedAt: null,
      scoring:     null,
    });

    const summary = await reverseCaseFileAirstars({ logger: { log: () => {} } });

    expect(summary.sessionsReversed).toBe(0);
    const after = await User.findById(u._id).lean();
    expect(after.totalAirstars).toBe(200);
  });

  it('skips sessions with airstarsAwarded === 0', async () => {
    const u = await createUser();
    await User.updateOne({ _id: u._id }, { $set: { totalAirstars: 200, cycleAirstars: 200 } });
    await makeSession(u._id, {
      scoring: { totalScore: 0, breakdown: [], airstarsAwarded: 0, levelXpAwarded: 0 },
    });

    const summary = await reverseCaseFileAirstars({ logger: { log: () => {} } });

    expect(summary.sessionsReversed).toBe(0);
    const after = await User.findById(u._id).lean();
    expect(after.totalAirstars).toBe(200);
  });

  it('returns a no-op summary when there is nothing to reverse', async () => {
    const summary = await reverseCaseFileAirstars({ logger: { log: () => {} } });
    expect(summary).toEqual({
      sessionsReversed:      0,
      totalAirstarsDeducted: 0,
      usersTouched:          0,
    });
  });

  it('handles multiple users in one run', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    await User.updateOne({ _id: u1._id }, { $set: { totalAirstars: 100, cycleAirstars: 100 } });
    await User.updateOne({ _id: u2._id }, { $set: { totalAirstars: 300, cycleAirstars: 300 } });
    await makeSession(u1._id, {
      scoring: { totalScore: 100, breakdown: [], airstarsAwarded: 30, levelXpAwarded: 30 },
    });
    await makeSession(u2._id, {
      scoring: { totalScore: 250, breakdown: [], airstarsAwarded: 75, levelXpAwarded: 75 },
    });

    const summary = await reverseCaseFileAirstars({ logger: { log: () => {} } });

    expect(summary.usersTouched).toBe(2);
    expect(summary.sessionsReversed).toBe(2);
    expect(summary.totalAirstarsDeducted).toBe(105);

    const a1 = await User.findById(u1._id).lean();
    const a2 = await User.findById(u2._id).lean();
    expect(a1.totalAirstars).toBe(70);
    expect(a2.totalAirstars).toBe(225);
  });
});
