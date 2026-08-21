/**
 * medals.announce.test.js
 *
 * CBAT medal announcements: a score that takes a NEW 1st/2nd/3rd place on a
 * game's all-time leaderboard is announced in the Medals channel. Everything
 * else stays quiet, and nothing leaves SkyWatch — the Discord webhook sink was
 * removed on 2026-08-07.
 *
 * Most cases use plane-turn-2d (lower rotations is better). With one real player
 * on the board, padLeaderboard injects 19 demo rows scored
 * [15,16,17,19,20,21,22,23,24,26,27,28,29,31,32,33,34,35,37] — so 12 rotations
 * is 1st, 16 is 2nd, 17 is 3rd and 19 is only 4th. (A tie on rotations breaks on
 * the lower time, so the sub-podium cases pass a time well under the demo rows'
 * ~30s.) Medals are ranked against that padded board on purpose: it is the board
 * the player is looking at.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app = require('../../app');
const db = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatPlaneTurnResult = require('../../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatFlagResult      = require('../../models/GameSessionCbatFlagResult');
const GameSessionCbatFlagEasierResult = require('../../models/GameSessionCbatFlagEasierResult');
const ChatMessage = require('../../models/ChatMessage');
const seedChatBot = require('../../seeds/seedChatBot');
const { announceCbatMedal } = require('../../utils/medals');
const { resetChatMedalsCache } = require('../../utils/chatMedals');

const PLANE_TURN_RESULT = '/api/games/cbat/plane-turn-2d/result';

beforeAll(async () => { await db.connect(); });

beforeEach(async () => {
  await createSettings();
  await seedChatBot();          // creates the Medals channel + its bot
  resetChatMedalsCache();
});

afterEach(async () => {
  await db.clearDatabase();
  resetChatMedalsCache();
  jest.restoreAllMocks();
});

afterAll(async () => { await db.closeDatabase(); });

// Save a plane-turn-2d session straight to the collection and run the announcer
// over it, so the assertion doesn't race the fire-and-forget call in the route.
async function score(user, totalRotations, totalTime = 20, extra = {}) {
  const doc = await GameSessionCbatPlaneTurnResult.create({
    userId: user._id,
    totalRotations,
    totalTime,
    levelsCompleted: 3,
    mode: '2d',
    ...extra,
  });
  return announceCbatMedal(GameSessionCbatPlaneTurnResult, doc.toObject());
}

const posted = () => ChatMessage.find({}).sort({ createdAt: 1 }).lean();
const lastPosted = async () => (await posted()).at(-1);

describe('medal announcements — the switch', () => {
  it('says nothing, and does no ranking work, without a Medals channel', async () => {
    await db.clearDatabase();
    await createSettings();       // no seedChatBot, so no channel
    resetChatMedalsCache();
    const user = await createUser({ agentNumber: '4000001' });

    const find = jest.spyOn(GameSessionCbatPlaneTurnResult, 'find');
    expect(await score(user, 30)).toBeNull();
    expect(await posted()).toHaveLength(0);
    // The channel check runs before detection: an announcement nobody can read
    // must not cost a leaderboard query on every score submission.
    expect(find).not.toHaveBeenCalled();
  });

  it('says nothing once an admin archives the channel', async () => {
    const ChatConversation = require('../../models/ChatConversation');
    await ChatConversation.updateOne({ 'channel.slug': 'medals' }, { $set: { isArchived: true } });
    resetChatMedalsCache();
    const user = await createUser({ agentNumber: '4000002' });

    expect(await score(user, 30)).toBeNull();
    expect(await posted()).toHaveLength(0);
  });
});

describe('medal announcements — which scores qualify', () => {
  it('announces a first-ever score that lands 1st as a gold medal', async () => {
    const user = await createUser({ agentNumber: '4100001', displayName: 'Maverick', displayNameLower: 'maverick' });

    const detail = await score(user, 12, 20);

    expect(detail.medal.word).toBe('Gold');
    expect((await lastPosted()).body)
      .toBe('🥇 Maverick took Gold on Trace Practise 2D with 12.');
  });

  it('announces 2nd as silver and 3rd as bronze', async () => {
    const silverUser = await createUser({ agentNumber: '4100002' });
    expect((await score(silverUser, 16)).medal.word).toBe('Silver');

    await db.clearDatabase();
    await createSettings();
    await seedChatBot();
    resetChatMedalsCache();

    const bronzeUser = await createUser({ agentNumber: '4100003' });
    expect((await score(bronzeUser, 17)).medal.word).toBe('Bronze');
  });

  it('stays quiet for a score just outside the podium', async () => {
    const user = await createUser({ agentNumber: '4100004' });

    expect(await score(user, 19)).toBeNull();
    expect(await posted()).toHaveLength(0);
  });

  it('reports the position the player is moving up from', async () => {
    const user = await createUser({ agentNumber: '4100005' });

    await score(user, 17);              // bronze
    const gold = await score(user, 12); // now 1st

    expect(gold.medal.word).toBe('Gold');
    expect(gold.previousRank).toBe(3);
    expect((await lastPosted()).body).toContain('Up from 3rd.');
  });

  it('does not re-announce a medal the player already holds', async () => {
    const user = await createUser({ agentNumber: '4100006' });

    await score(user, 12, 20);          // gold
    expect(await score(user, 10, 18)).toBeNull(); // still gold, nothing new
    expect(await posted()).toHaveLength(1);
  });

  it('ignores a run that does not beat the player own best', async () => {
    const user = await createUser({ agentNumber: '4100007' });

    await score(user, 12, 20);
    expect(await score(user, 25, 40)).toBeNull();
    expect(await posted()).toHaveLength(1);
  });

  it('ignores an offline score that synced in more than 24h after it was played', async () => {
    const user = await createUser({ agentNumber: '4100008' });

    const stale = await score(user, 12, 20, { createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) });

    expect(stale).toBeNull();
    expect(await posted()).toHaveLength(0);
  });

  it('does not announce twice when an offline flush is retried', async () => {
    const user = await createUser({ agentNumber: '4100009' });
    const cookie = authCookie(user._id);
    const body = { totalRotations: 12, totalTime: 20, clientResultId: 'abc-123' };

    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie).send(body);
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie).send(body);

    // The route announces fire-and-forget, so let the first call land before counting.
    await new Promise(r => setTimeout(r, 250));
    expect(await posted()).toHaveLength(1);
    expect(await GameSessionCbatPlaneTurnResult.countDocuments({ userId: user._id })).toBe(1);
  });
});

describe('medal announcements — what reaches the channel', () => {
  it('names a player without a display name by agent number, never by email', async () => {
    const user = await createUser({ email: 'private@test.com', agentNumber: '4200001' });

    await score(user, 12);

    const message = await lastPosted();
    expect(message.body).toContain('Agent 4200001');
    expect(message.body).not.toContain('private@test.com');
  });

  it('leaves markdown characters in a display name exactly as typed', async () => {
    // The chat renders plain text, so escaping would print the backslashes.
    const user = await createUser({
      agentNumber: '4200002',
      displayName: 'SkyWatch_Dev',
      displayNameLower: 'skywatch_dev',
    });

    await score(user, 12);

    expect((await lastPosted()).body).toContain('SkyWatch_Dev took Gold');
  });

  it('survives a channel post failing without failing the score submission', async () => {
    jest.spyOn(ChatMessage, 'create').mockRejectedValue(new Error('write conflict'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const user = await createUser({ agentNumber: '4200004' });

    const res = await request(app).post(PLANE_TURN_RESULT).set('Cookie', authCookie(user._id))
      .send({ totalRotations: 12, totalTime: 20 });

    expect(res.status).toBe(201);
    expect(await GameSessionCbatPlaneTurnResult.countDocuments({ userId: user._id })).toBe(1);
  });
});

// A split game keeps a separate board per difficulty, so "took Gold on FLAG"
// says nothing on its own about which board was won. Both halves are named.
describe('medal announcements — difficulty', () => {
  const flagScore = async (Model, user, totalScore) => {
    const doc = await Model.create({ userId: user._id, totalScore, totalTime: 60 });
    return announceCbatMedal(Model, doc.toObject());
  };

  it('names the Hard board as Hard, not by the bare game name', async () => {
    // FLAG's demo board tops out at 380.
    const user = await createUser({ agentNumber: '4300001', displayName: 'Viper', displayNameLower: 'viper' });

    const detail = await flagScore(GameSessionCbatFlagResult, user, 500);

    expect(detail.gameLabel).toBe('FLAG (Hard)');
    expect((await lastPosted()).body).toBe('🥇 Viper took Gold on FLAG (Hard) with 500.');
  });

  it('names the Easier board as Easier', async () => {
    // flag-easier's demo board tops out at 260.
    const user = await createUser({ agentNumber: '4300002', displayName: 'Nomad', displayNameLower: 'nomad' });

    const detail = await flagScore(GameSessionCbatFlagEasierResult, user, 400);

    expect(detail.gameLabel).toBe('FLAG (Easier)');
    expect((await lastPosted()).body).toContain('on FLAG (Easier) with 400.');
  });

  it('leaves a game with no difficulty split unqualified', async () => {
    const user = await createUser({ agentNumber: '4300003' });

    expect((await score(user, 12)).gameLabel).toBe('Trace Practise 2D');
  });
});
