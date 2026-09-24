/**
 * Slim mode brings Learn back with only the categories in
 * constants/slimLearn.json open (Aircrafts first). They are open to every
 * signed-in player whatever their level or plan; every other category is
 * "coming soon"; guests can browse the pathway but must sign in to read.
 *
 * Settings are deliberately strict — Aircrafts is Silver-only and needs
 * Level 2 — so every pass below is the slim rule overriding them.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createSettings, createUser, createBrief, authCookie } = require('../helpers/factories');

const STRICT = {
  slimModeEnabled:  false,
  guestCategories:  ['News'],
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts'],
  pathwayUnlocks: [
    { category: 'News',      levelRequired: 1, rankRequired: 1 },
    { category: 'Aircrafts', levelRequired: 2, rankRequired: 1 },
  ],
};
const NATIVE = { 'X-Slim-App': '1' };

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(STRICT); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const freePlayer = () => createUser({ subscriptionTier: 'free', cycleAirstars: 0 });

describe('GET /api/briefs/:id in slim mode', () => {
  it('lets a free level-1 player read an aircraft brief from the native app', async () => {
    const user  = await freePlayer();
    const brief = await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get(`/api/briefs/${brief._id}`)
      .set(NATIVE).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.brief.category).toBe('Aircrafts');
  });

  it('does the same when an admin has turned slim mode on for the website', async () => {
    await createSettings({ slimModeEnabled: true });
    const user  = await freePlayer();
    const brief = await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
  });

  it('keeps the normal gating on the full site', async () => {
    const user  = await freePlayer();
    const brief = await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get(`/api/briefs/${brief._id}`).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('marks other categories coming soon, even for Gold', async () => {
    const user  = await createUser({ subscriptionTier: 'gold' });
    const brief = await createBrief({ category: 'News' });
    const res = await request(app).get(`/api/briefs/${brief._id}`)
      .set(NATIVE).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('soon');
  });

  it('closes aircraft briefs too once the admin switches Learn off', async () => {
    await createSettings({ slimLearnEnabled: false });
    const user  = await freePlayer();
    const brief = await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get(`/api/briefs/${brief._id}`)
      .set(NATIVE).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('soon');
  });

  it('asks a guest to sign in', async () => {
    const brief = await createBrief({ category: 'Aircrafts' });
    const res = await request(app).get(`/api/briefs/${brief._id}`).set(NATIVE);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('signin');
  });
});

describe('GET /api/briefs/pathway/:category in slim mode', () => {
  it('lists the aircraft pathway, for guests too', async () => {
    await createBrief({ category: 'Aircrafts', priorityNumber: 1 });
    const res = await request(app).get('/api/briefs/pathway/Aircrafts').set(NATIVE);
    expect(res.status).toBe(200);
    expect(res.body.data.briefs).toHaveLength(1);
  });

  it('refuses a coming-soon pathway', async () => {
    const res = await request(app).get('/api/briefs/pathway/News').set(NATIVE);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('soon');
  });
});

describe('GET /api/briefs/pathway-counts in slim mode', () => {
  it('only counts the open categories', async () => {
    const user = await freePlayer();
    await createBrief({ category: 'Aircrafts', priorityNumber: 1 });
    await createBrief({ category: 'News' });
    const res = await request(app).get('/api/briefs/pathway-counts')
      .set(NATIVE).set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.map(r => r.category)).toEqual(['Aircrafts']);
  });
});
