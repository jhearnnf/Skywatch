/**
 * Score Sharing — the opt-out (User.hideFromShowcase) takes a player off EVERY
 * shared score surface, not just the homepage wall and the profile card:
 *
 *   all-time leaderboard   — not listed, and not counted ahead of anyone
 *   weekly leaderboard     — same
 *   Recent Scores feed     — not listed, not counted ahead of anyone
 *   post-game chase window — other opted-out players are gone; the player
 *                            asking still sees their own row (private to them)
 *   medals                 — never announced, never on the avatar, never on
 *                            the admin profile's board chips
 *   the switch itself      — takes effect immediately (caches cleared)
 *
 * Symbols is higher-is-better (correctCount out of 15) with a time tiebreak.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatPlaneTurnResult = require('../../models/GameSessionCbatPlaneTurnResult');
const ChatMessage = require('../../models/ChatMessage');
const seedChatBot = require('../../seeds/seedChatBot');
const { announceCbatMedal } = require('../../utils/medals');
const { resetChatMedalsCache } = require('../../utils/chatMedals');
const { medalsForUsers, resetMedalHoldersCache } = require('../../utils/cbatMedalHolders');
const { clearScoreSharingCache } = require('../../utils/cbatScoreSharing');

const RESULT_URL      = '/api/games/cbat/symbols/result';
const LEADERBOARD_URL = '/api/games/cbat/symbols/leaderboard';
const RECENT_URL      = '/api/games/cbat/recent';
const WEEKLY_ME_URL   = '/api/games/cbat/symbols/weekly/me';

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  clearScoreSharingCache();
  resetMedalHoldersCache();
});
afterEach(async () => {
  await db.clearDatabase();
  clearScoreSharingCache();
  resetMedalHoldersCache();
  resetChatMedalsCache();
});
afterAll(async () => db.closeDatabase());

const play = (user, correctCount, totalTime) =>
  request(app).post(RESULT_URL).set('Cookie', authCookie(user._id)).send({ correctCount, totalTime });

// Three players: the opted-out one has the best score, so if the filter
// slips anywhere they show up on top and everyone below them drops a place.
async function seedThree() {
  const hidden = await createUser({ agentNumber: '5000001', displayName: 'Ghost', hideFromShowcase: true });
  const second = await createUser({ agentNumber: '5000002', displayName: 'Second' });
  const third  = await createUser({ agentNumber: '5000003', displayName: 'Third' });
  await play(hidden, 15, 20);
  await play(second, 14, 30);
  await play(third,  13, 40);
  clearScoreSharingCache();
  return { hidden, second, third };
}

describe('Score Sharing — all-time leaderboard', () => {
  it('leaves an opted-out player off the board and does not rank anyone behind them', async () => {
    const { hidden, second, third } = await seedThree();
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(third._id));
    expect(res.status).toBe(200);
    const reals = res.body.data.leaderboard.filter(e => !e.isFake);
    expect(reals.map(e => e.agentNumber)).toEqual([second.agentNumber, third.agentNumber]);
    expect(reals[0].rank).toBe(1);
    expect(res.body.data.leaderboard.some(e => e.agentNumber === hidden.agentNumber)).toBe(false);
  });

  it('hides them from an admin too', async () => {
    const { hidden } = await seedThree();
    const admin = await createAdminUser({ agentNumber: '5000009' });
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(admin._id));
    expect(res.body.data.leaderboard.some(e => e.agentNumber === hidden.agentNumber)).toBe(false);
  });

  it('still shows an opted-out player their own best and rank, privately', async () => {
    const { hidden } = await seedThree();
    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(hidden._id));
    expect(res.body.data.leaderboard.some(e => e.agentNumber === hidden.agentNumber)).toBe(false);
    expect(res.body.data.myBest.bestScore).toBe(15);
    expect(res.body.data.myBest.rank).toBe(1);
  });

  it('does not count an opted-out player as ahead of an off-board rank', async () => {
    // 20 visible players fill the board; a 21st sits just off it. An opted-out
    // 22nd with the top score must not make that 21st.
    const hidden = await createUser({ agentNumber: '5100000', hideFromShowcase: true });
    await play(hidden, 15, 1);
    for (let i = 0; i < 20; i++) {
      const u = await createUser({ agentNumber: `51000${String(i + 1).padStart(2, '0')}` });
      await play(u, 15, 30 + i);
    }
    const late = await createUser({ agentNumber: '5100099' });
    await play(late, 15, 500);
    clearScoreSharingCache();

    const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(late._id));
    expect(res.body.data.leaderboard.filter(e => !e.isFake)).toHaveLength(20);
    expect(res.body.data.myBest.rank).toBe(21);
  });
});

describe('Score Sharing — weekly leaderboard', () => {
  it('leaves an opted-out player off the weekly board and out of the weekly rank', async () => {
    const { hidden, second, third } = await seedThree();
    const res = await request(app).get(`${LEADERBOARD_URL}?period=weekly`).set('Cookie', authCookie(third._id));
    expect(res.status).toBe(200);
    // The weekly board pads a quiet week with demo rows above and below the
    // real ones, so the check is on the real rows: nobody real sits above
    // Second, and the opted-out player is nowhere.
    const reals = res.body.data.leaderboard.filter(e => !e.isFake);
    expect(reals.map(e => e.agentNumber)).toEqual([second.agentNumber, third.agentNumber]);
    expect(res.body.data.leaderboard.some(e => e.agentNumber === hidden.agentNumber)).toBe(false);
  });
});

describe('Score Sharing — Recent Scores feed', () => {
  it('never lists an opted-out player and does not count them ahead of anyone', async () => {
    const { hidden, second } = await seedThree();
    const res = await request(app).get(RECENT_URL).set('Cookie', authCookie(second._id));
    expect(res.status).toBe(200);
    const rows = res.body.data.recent;
    expect(rows.some(r => r.agentNumber === hidden.agentNumber)).toBe(false);
    expect(rows.find(r => r.agentNumber === second.agentNumber).rank).toBe(1);
  });
});

describe('Score Sharing — post-game chase window', () => {
  it('drops other opted-out players from the window', async () => {
    const { second } = await seedThree();
    const res = await request(app).get(WEEKLY_ME_URL).set('Cookie', authCookie(second._id));
    expect(res.body.data.played).toBe(true);
    // Demo rows pad the week, so the rank is not 1; what matters is that no
    // real player outranks Second and the opted-out one is not in the window.
    expect(res.body.data.neighbors.some(n => n.name === 'Ghost')).toBe(false);
    expect(res.body.data.neighbors.some(n => n.name === 'Second' && n.isMe)).toBe(true);
  });

  it('keeps the player asking on their own window even when they have opted out', async () => {
    const { hidden } = await seedThree();
    const res = await request(app).get(WEEKLY_ME_URL).set('Cookie', authCookie(hidden._id));
    expect(res.body.data.played).toBe(true);
    expect(res.body.data.neighbors.find(n => n.isMe)?.name).toBe('Ghost');
  });
});

describe('Score Sharing — medals', () => {
  it('never announces a medal for an opted-out player', async () => {
    await seedChatBot();
    resetChatMedalsCache();
    const hidden = await createUser({ agentNumber: '5200001', hideFromShowcase: true });
    clearScoreSharingCache();
    const doc = await GameSessionCbatPlaneTurnResult.create({
      userId: hidden._id, totalRotations: 12, totalTime: 20, levelsCompleted: 3, mode: '2d',
    });
    expect(await announceCbatMedal(GameSessionCbatPlaneTurnResult, doc.toObject())).toBeNull();
    expect(await ChatMessage.countDocuments({})).toBe(0);
  });

  it('hangs no medal off their avatar', async () => {
    const { hidden, second } = await seedThree();
    const medals = await medalsForUsers([hidden._id, second._id]);
    expect(medals[String(hidden._id)]).toBeUndefined();
    expect(medals[String(second._id)]?.[0]?.rank).toBe(1);
  });

  it('shows an admin no board place for them on the profile', async () => {
    const { hidden } = await seedThree();
    const admin = await createAdminUser({ agentNumber: '5200009' });
    const res = await request(app).get(`/api/admin/users/${hidden._id}/profile`).set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    const symbols = res.body.data.cbatGames.find(g => g.gameKey === 'symbols');
    expect(symbols.best).toBe(15);           // the admin still sees the score itself
    expect(symbols.boardRank).toBeNull();    // but there is no place on a board they are not on
    expect(res.body.data.medals).toEqual([]);
  });
});

describe('Score Sharing — the switch', () => {
  it('takes a player off the board the moment they flip it, and back on when they flip it back', async () => {
    const player = await createUser({ agentNumber: '5300001' });
    const viewer = await createUser({ agentNumber: '5300002' });
    await play(player, 15, 20);
    clearScoreSharingCache();

    const onBoard = async () => {
      const res = await request(app).get(LEADERBOARD_URL).set('Cookie', authCookie(viewer._id));
      return res.body.data.leaderboard.some(e => e.agentNumber === player.agentNumber);
    };
    expect(await onBoard()).toBe(true);

    await request(app).patch('/api/users/me/showcase').set('Cookie', authCookie(player._id)).send({ visible: false });
    expect(await onBoard()).toBe(false);

    await request(app).patch('/api/users/me/showcase').set('Cookie', authCookie(player._id)).send({ visible: true });
    expect(await onBoard()).toBe(true);
  });
});
