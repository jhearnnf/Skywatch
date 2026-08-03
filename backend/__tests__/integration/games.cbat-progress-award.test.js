/**
 * games.cbat-progress-award.test.js
 *
 * The post-game progress-award milestone: POST /api/games/cbat/:gameKey/progress-award/claim,
 * the donation-outcome recorder, and the admin self-reset that makes the whole thing testable.
 *
 * The behaviour that matters here is that an award fires ONCE. Everything else — the flags, the
 * donation caps — exists to stop it firing when it shouldn't.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, createRank, authCookie } = require('../helpers/factories');

const User = require('../../models/User');
const AppSettings = require('../../models/AppSettings');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const GameSessionCbatAnglesResult = require('../../models/GameSessionCbatAnglesResult');

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Angles is higher-is-better out of 20. Lays down `count` runs oldest → newest, the first five
// scoring `from` and the last five scoring `to`, so the first-5/last-5 averages the award reads
// are exactly those two numbers.
async function seedAngles(count, from, to, userId = user._id) {
  const cfg = CBAT_GAMES['angles'];
  for (let i = 0; i < count; i++) {
    const score = i < 5 ? from : i >= count - 5 ? to : Math.round((from + to) / 2);
    await GameSessionCbatAnglesResult.create({
      userId,
      [cfg.primaryField]: score,
      totalTime: 30,
      roundsPlayed: 5,
      score,
      createdAt: daysAgo(count - i),
    });
  }
}

const claim = (gameKey = 'angles', c = cookie) =>
  request(app).post(`/api/games/cbat/${gameKey}/progress-award/claim`).set('Cookie', c);

const record = (action, c = cookie) =>
  request(app).post('/api/games/cbat/progress-award/donation').set('Cookie', c).send({ action });

describe('POST /api/games/cbat/:gameKey/progress-award/claim', () => {
  it('awards a tier once the player has improved enough', async () => {
    await seedAngles(10, 10, 15);   // +50%

    const res = await claim();

    expect(res.status).toBe(200);
    expect(res.body.data.award).toMatchObject({ gameKey: 'angles', tier: 50, pct: 50 });
    expect(res.body.data.award.attempts).toBe(10);
  });

  // The core guarantee. Without it the screen fires on every run for as long as the player stays
  // above the threshold, which is the difference between a milestone and a nag.
  it('does not award the same tier twice', async () => {
    await seedAngles(10, 10, 12);   // +20%, tier 15

    const first = await claim();
    expect(first.body.data.award).toMatchObject({ tier: 15 });

    const second = await claim();
    expect(second.body.data.award).toBeNull();
  });

  it('awards the next tier when the player improves further', async () => {
    await seedAngles(10, 10, 12);   // +20% → tier 15
    await claim();

    await GameSessionCbatAnglesResult.deleteMany({ userId: user._id });
    await seedAngles(12, 10, 16);   // +60% → tier 50

    const res = await claim();
    expect(res.body.data.award).toMatchObject({ tier: 50 });
  });

  // A fast improver crosses +15, +30 and +50 between two celebrations. One screen, and the
  // skipped tiers are burned so they can never fire later on a smaller delta.
  it('records every tier crossed, not just the one shown', async () => {
    await seedAngles(10, 10, 16);   // +60%

    const res = await claim();
    expect(res.body.data.award.tier).toBe(50);

    const saved = await User.findById(user._id).lean();
    expect(saved.cbatProgressAwards.map(a => a.tier).sort((a, b) => a - b)).toEqual([15, 30, 50]);
  });

  it('awards nothing below the attempt floor', async () => {
    await seedAngles(7, 10, 20);

    const res = await claim();
    expect(res.body.data.award).toBeNull();
    const saved = await User.findById(user._id).lean();
    expect(saved.cbatProgressAwards).toEqual([]);
  });

  it('awards nothing when the player has declined', async () => {
    await seedAngles(12, 18, 9);

    const res = await claim();
    expect(res.body.data.award).toBeNull();
  });

  it('awards nothing when the feature flag is off', async () => {
    await AppSettings.updateOne({}, { $set: { progressAwardEnabled: false } });
    await seedAngles(10, 10, 16);

    const res = await claim();
    expect(res.body.data.award).toBeNull();
    // Nothing is burned while the feature is off, so turning it back on still awards.
    const saved = await User.findById(user._id).lean();
    expect(saved.cbatProgressAwards).toEqual([]);
  });

  it('rejects an unknown game key', async () => {
    const res = await claim('not-a-game');
    expect(res.status).toBe(400);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/games/cbat/angles/progress-award/claim');
    expect(res.status).toBe(401);
  });

  it('keeps milestones separate per game', async () => {
    await seedAngles(10, 10, 12);
    await claim();

    const cfg = CBAT_GAMES['symbols'];
    for (let i = 0; i < 10; i++) {
      await cfg.Model.create({
        userId: user._id,
        [cfg.primaryField]: i < 5 ? 10 : 12,
        totalTime: 30, roundsPlayed: 5, score: i < 5 ? 10 : 12,
        createdAt: daysAgo(10 - i),
      });
    }

    const res = await claim('symbols');
    expect(res.body.data.award).toMatchObject({ gameKey: 'symbols', tier: 15 });
  });
});

describe('the donation note attached to an award', () => {
  const enableDonate = (url = 'https://ko-fi.com/skywatch') =>
    AppSettings.updateOne({}, { $set: { progressAwardDonateEnabled: true, progressAwardDonateUrl: url } });

  it('rides along with an award once configured', async () => {
    await enableDonate();
    await seedAngles(10, 10, 16);

    const res = await claim();
    expect(res.body.data.donate).toEqual({ url: 'https://ko-fi.com/skywatch' });
  });

  // Ships pointing at the live Stripe link, so the ask works on deploy rather than waiting for
  // an admin to paste it in.
  it('defaults to the configured Stripe payment link', async () => {
    const settings = await AppSettings.getSettings();
    expect(settings.progressAwardDonateUrl).toMatch(/^https:\/\/donate\.stripe\.com\//);
  });

  // Blanking the URL is the kill switch an admin reaches for, and it has to beat the flag.
  it('is withheld when the URL is blanked', async () => {
    await AppSettings.updateOne({}, { $set: { progressAwardDonateUrl: '' } });
    await seedAngles(10, 10, 16);

    const res = await claim();
    expect(res.body.data.donate).toBeNull();
  });

  it('is withheld when the donate flag is off', async () => {
    await enableDonate();
    await AppSettings.updateOne({}, { $set: { progressAwardDonateEnabled: false } });
    await seedAngles(10, 10, 16);

    const res = await claim();
    expect(res.body.data.donate).toBeNull();
  });

  // The cap is global, not per game — the whole reason it is separate state from the milestones.
  it('is not repeated on a second award inside the cooldown', async () => {
    await enableDonate();
    await seedAngles(10, 10, 12);          // tier 15, ask shown
    const first = await claim();
    expect(first.body.data.donate).not.toBeNull();

    await GameSessionCbatAnglesResult.deleteMany({ userId: user._id });
    await seedAngles(12, 10, 16);          // tier 50 on the same game, a second award
    const second = await claim();
    expect(second.body.data.award).toMatchObject({ tier: 50 });
    expect(second.body.data.donate).toBeNull();
  });

  // The award still fires when the ask has been exhausted — the celebration was never
  // conditional on the donation, and switching it off with the ask would be the tell that it
  // only ever existed to carry one.
  it('stops after the dismissal cap but keeps awarding milestones', async () => {
    await enableDonate();
    for (let i = 0; i < 2; i++) await record('dismissed');

    await seedAngles(10, 10, 16);
    const res = await claim();
    expect(res.body.data.donate).toBeNull();
    expect(res.body.data.award).toMatchObject({ tier: 50 });
  });

  // Looking is not giving — a click-through must not count as an answer, or we would stop asking
  // people who visited the page and changed their mind.
  it('does not count a click-through as a dismissal', async () => {
    await record('clicked');

    const saved = await User.findById(user._id).lean();
    expect(saved.donationPrompt.dismissCount).toBe(0);
    expect(saved.donationPrompt.clickCount).toBe(1);
  });

  it('rejects an unknown action', async () => {
    const res = await record('whatever');
    expect(res.status).toBe(400);
  });

  // The old three-button note reported this; the control it came from is gone, so the action is
  // no longer accepted rather than being silently ignored.
  it('rejects the retired "supported" action', async () => {
    const res = await record('supported');
    expect(res.status).toBe(400);
  });
});

describe('the donation funnel behind the admin stat', () => {
  it('counts an impression only when the note reports rendering', async () => {
    await record('shown');

    const saved = await User.findById(user._id).lean();
    expect(saved.donationPrompt.impressionCount).toBe(1);
  });

  // The stat's denominator must not come from the server's decision to offer the note: that is
  // taken while the award overlay is still up, so it would count players who left before the
  // card ever appeared.
  it('does not count an impression merely because the ask was offered', async () => {
    await AppSettings.updateOne({}, {
      $set: { progressAwardDonateEnabled: true, progressAwardDonateUrl: 'https://ko-fi.com/x' },
    });
    await seedAngles(10, 10, 16);

    const res = await claim();
    expect(res.body.data.donate).not.toBeNull();   // offered…

    const saved = await User.findById(user._id).lean();
    expect(saved.donationPrompt.lastShownAt).not.toBeNull();
    expect(saved.donationPrompt.impressionCount).toBe(0);   // …but not yet seen
  });

  it('reports both legs of the funnel on the admin stats endpoint', async () => {
    await createRank();
    const admin = await createAdminUser({ agentNumber: '2000004' });

    // One user saw it and clicked; one only saw it; one has never met it.
    await record('shown');
    await record('clicked');

    const seenOnly = await createUser({ agentNumber: '1000002' });
    await record('shown', authCookie(seenOnly._id));

    await createUser({ agentNumber: '1000003' });

    const res = await request(app).get('/api/admin/stats').set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.users.donationCardSeen).toBe(2);
    expect(res.body.data.users.donationLinkClicked).toBe(1);
  });

  // Counted in people, not events — otherwise one enthusiast opening the link repeatedly would
  // read as several conversions and the rate could exceed 100%.
  it('counts a user once however many times they click', async () => {
    await createRank();
    const admin = await createAdminUser({ agentNumber: '2000005' });

    await record('shown');
    await record('clicked');
    await record('clicked');
    await record('clicked');

    const res = await request(app).get('/api/admin/stats').set('Cookie', authCookie(admin._id));
    expect(res.body.data.users.donationLinkClicked).toBe(1);

    const saved = await User.findById(user._id).lean();
    expect(saved.donationPrompt.clickCount).toBe(3);   // the raw tally still accumulates
  });
});

describe('POST /api/admin/progress-award/reset', () => {
  it('clears the calling admin\'s milestones so an award can be earned again', async () => {
    await createRank();
    const admin = await createAdminUser({ agentNumber: '2000002' });
    const adminCookie = authCookie(admin._id);

    await seedAngles(10, 10, 16, admin._id);
    expect((await claim('angles', adminCookie)).body.data.award).not.toBeNull();
    expect((await claim('angles', adminCookie)).body.data.award).toBeNull();

    const reset = await request(app)
      .post('/api/admin/progress-award/reset')
      .set('Cookie', adminCookie);
    expect(reset.status).toBe(200);

    // The same history now awards again — which is the point: it lets an admin verify the
    // trigger fires, not just that the screen renders.
    expect((await claim('angles', adminCookie)).body.data.award).not.toBeNull();
  });

  it('rejects non-admins', async () => {
    const res = await request(app)
      .post('/api/admin/progress-award/reset')
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('only ever touches the caller, never another user', async () => {
    await createRank();
    const admin = await createAdminUser({ agentNumber: '2000003' });

    await User.updateOne(
      { _id: user._id },
      { $set: { cbatProgressAwards: [{ gameKey: 'angles', tier: 15, shownAt: new Date() }] } },
    );

    await request(app)
      .post('/api/admin/progress-award/reset')
      .set('Cookie', authCookie(admin._id));

    const other = await User.findById(user._id).lean();
    expect(other.cbatProgressAwards).toHaveLength(1);
  });
});
