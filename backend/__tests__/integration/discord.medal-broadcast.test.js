/**
 * discord.medal-broadcast.test.js
 *
 * Discord medal broadcasts: a CBAT score that takes a NEW 1st/2nd/3rd place on a
 * game's all-time leaderboard is announced in the SkyWatch Discord. Everything
 * else stays quiet.
 *
 * All cases use plane-turn-2d (lower rotations is better). With one real player
 * on the board, padLeaderboard injects 19 demo rows scored
 * [42,45,48,52,55,58,62,65,68,72,75,78,82,85,88,92,95,98,102] — so 30 rotations
 * is 1st, 44 is 2nd, 47 is 3rd and 50 is only 4th. Medals are ranked against
 * that padded board on purpose: it is the board the player is looking at.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app = require('../../app');
const db = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const GameSessionCbatPlaneTurnResult = require('../../models/GameSessionCbatPlaneTurnResult');
const { announceCbatMedal, resetDiscordCache } = require('../../utils/discordMedals');

const PLANE_TURN_RESULT = '/api/games/cbat/plane-turn-2d/result';
const WEBHOOK = 'https://discord.com/api/webhooks/test/token';

let originalWebhook;

beforeAll(async () => {
  await db.connect();
  originalWebhook = process.env.DISCORD_WEBHOOK_URL;
});

beforeEach(async () => {
  process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
  resetDiscordCache();
  await createSettings({ discordBroadcastEnabled: true });
});

afterEach(async () => {
  await db.clearDatabase();
  resetDiscordCache();
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (originalWebhook === undefined) delete process.env.DISCORD_WEBHOOK_URL;
  else process.env.DISCORD_WEBHOOK_URL = originalWebhook;
  await db.closeDatabase();
});

// Save a plane-turn-2d session straight to the collection and run the announcer
// over it, so the assertion doesn't race the fire-and-forget call in the route.
async function score(user, totalRotations, totalTime = 30, extra = {}) {
  const doc = await GameSessionCbatPlaneTurnResult.create({
    userId: user._id,
    totalRotations,
    totalTime,
    levelsCompleted: 5,
    mode: '2d',
    ...extra,
  });
  return announceCbatMedal(GameSessionCbatPlaneTurnResult, doc.toObject());
}

describe('medal broadcasts — the two switches', () => {
  it('posts nothing when DISCORD_WEBHOOK_URL is unset, however good the score', async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const user = await createUser({ agentNumber: '4000001' });

    expect(await score(user, 30)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts nothing when the admin kill switch is off', async () => {
    await createSettings({ discordBroadcastEnabled: false });
    resetDiscordCache();
    const user = await createUser({ agentNumber: '4000002' });

    expect(await score(user, 30)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('defaults the kill switch to off on a fresh settings document', async () => {
    const AppSettings = require('../../models/AppSettings');
    await db.clearDatabase();
    const s = await AppSettings.getSettings();
    expect(s.discordBroadcastEnabled).toBe(false);
  });

  it('lets an admin flip the kill switch, and nobody else', async () => {
    const AppSettings = require('../../models/AppSettings');
    const admin = await createUser({ isAdmin: true });
    const player = await createUser({ agentNumber: '4000003' });

    const denied = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(player._id))
      .send({ discordBroadcastEnabled: false, reason: 'try disable' });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ discordBroadcastEnabled: false, reason: 'pause broadcasts' });
    expect(allowed.status).toBe(200);
    expect((await AppSettings.findOne()).discordBroadcastEnabled).toBe(false);
  });

  it('tells the admin UI whether the webhook secret is present, without leaking it', async () => {
    const admin = await createUser({ isAdmin: true });

    const res = await request(app)
      .get('/api/admin/settings')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.discordWebhookConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(WEBHOOK);
  });
});

describe('medal broadcasts — which scores qualify', () => {
  it('announces a first-ever score that lands 1st as a gold medal', async () => {
    const user = await createUser({ agentNumber: '4100001', displayName: 'Maverick', displayNameLower: 'maverick' });

    const payload = await score(user, 30, 25);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(WEBHOOK);
    expect(payload.content).toContain('🥇');
    expect(payload.embeds[0].title).toBe('🥇 Gold medal — Trace Practise 2D');
    expect(payload.embeds[0].description).toContain('**Maverick**');
    expect(payload.embeds[0].description).toContain('1st');
  });

  it('announces 2nd as silver and 3rd as bronze', async () => {
    const silverUser = await createUser({ agentNumber: '4100002' });
    const silver = await score(silverUser, 44);
    expect(silver.embeds[0].title).toContain('Silver medal');

    await db.clearDatabase();
    await createSettings({ discordBroadcastEnabled: true });
    resetDiscordCache();

    const bronzeUser = await createUser({ agentNumber: '4100003' });
    const bronze = await score(bronzeUser, 47);
    expect(bronze.embeds[0].title).toContain('Bronze medal');
  });

  it('stays quiet for a score just outside the podium', async () => {
    const user = await createUser({ agentNumber: '4100004' });

    expect(await score(user, 50)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports the position the player is moving up from', async () => {
    const user = await createUser({ agentNumber: '4100005' });

    await score(user, 47);          // bronze
    const gold = await score(user, 30); // now 1st

    expect(gold.embeds[0].title).toContain('Gold medal');
    const previous = gold.embeds[0].fields.find(f => f.name === 'Previous position');
    expect(previous.value).toBe('3rd');
  });

  it('does not re-announce a medal the player already holds', async () => {
    const user = await createUser({ agentNumber: '4100006' });

    await score(user, 30, 25);      // gold
    global.fetch.mockClear();

    expect(await score(user, 25, 20)).toBeNull(); // still gold, nothing new
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores a run that does not beat the player own best', async () => {
    const user = await createUser({ agentNumber: '4100007' });

    await score(user, 30, 25);
    global.fetch.mockClear();

    expect(await score(user, 60, 40)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores an offline score that synced in more than 24h after it was played', async () => {
    const user = await createUser({ agentNumber: '4100008' });

    const stale = await score(user, 30, 25, { createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) });

    expect(stale).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not announce twice when an offline flush is retried', async () => {
    const user = await createUser({ agentNumber: '4100009' });
    const cookie = authCookie(user._id);
    const body = { totalRotations: 30, totalTime: 25, clientResultId: 'abc-123' };

    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie).send(body);
    await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie).send(body);

    // The route announces fire-and-forget, so let the first call land before counting.
    await new Promise(r => setTimeout(r, 250));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await GameSessionCbatPlaneTurnResult.countDocuments({ userId: user._id })).toBe(1);
  });
});

describe('medal broadcasts — what reaches the channel', () => {
  it('names a player without a display name by agent number, never by email', async () => {
    const user = await createUser({ email: 'private@test.com', agentNumber: '4200001' });

    const payload = await score(user, 30);

    expect(payload.embeds[0].description).toContain('Agent 4200001');
    expect(JSON.stringify(payload)).not.toContain('private@test.com');
  });

  it('defuses a display name that would otherwise ping the server', async () => {
    const user = await createUser({
      agentNumber: '4200002',
      displayName: '@everyone **boom**',
      displayNameLower: '@everyone **boom**',
    });

    const payload = await score(user, 30);

    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].description).toContain('\\*\\*boom\\*\\*');
  });

  // Display names are capped at 20 characters, which is still room enough for a
  // working markdown link — embed descriptions render [text](url) as a real one.
  it('stops a display name from becoming a clickable link', async () => {
    const user = await createUser({
      agentNumber: '4200005',
      displayName: '[win](https://x.co)',
      displayNameLower: '[win](https://x.co)',
    });

    const payload = await score(user, 30);

    expect(payload.embeds[0].description).toContain('\\[win\\]');
  });

  it('leaves hyphens alone so ordinary names are not littered with backslashes', async () => {
    const user = await createUser({
      agentNumber: '4200006',
      displayName: 'Top-Gun',
      displayNameLower: 'top-gun',
    });

    const payload = await score(user, 30);

    expect(payload.embeds[0].description).toContain('**Top-Gun**');
  });

  it('links back to the all-time board it is talking about', async () => {
    process.env.CLIENT_URL = 'https://skywatch.academy';
    const user = await createUser({ agentNumber: '4200003' });

    const payload = await score(user, 30);

    expect(payload.embeds[0].url).toBe('https://skywatch.academy/cbat/plane-turn-2d/leaderboard?period=all-time');
  });

  it('survives a webhook outage without failing the score submission', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const user = await createUser({ agentNumber: '4200004' });
    const cookie = authCookie(user._id);

    const res = await request(app).post(PLANE_TURN_RESULT).set('Cookie', cookie)
      .send({ totalRotations: 30, totalTime: 25 });

    expect(res.status).toBe(201);
    expect(await GameSessionCbatPlaneTurnResult.countDocuments({ userId: user._id })).toBe(1);
  });
});
