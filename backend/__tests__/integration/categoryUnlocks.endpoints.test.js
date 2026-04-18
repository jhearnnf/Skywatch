/**
 * categoryUnlocks.endpoints.test.js — verifies PATCH endpoints for marking
 * category badges as seen (single category and bulk seen-all).
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const User    = require('../../models/User');
const { createUser, createSettings, authCookie } = require('../helpers/factories');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

async function userWithUnlocks(unlocks) {
  const user = await createUser();
  await User.findByIdAndUpdate(user._id, {
    $set: Object.fromEntries(
      Object.entries(unlocks).map(([cat, v]) => [`categoryUnlocks.${cat}`, v]),
    ),
  });
  return user;
}

describe('PATCH /api/users/me/category-unlocks/:category/seen', () => {
  it('marks the named category badge as seen', async () => {
    const user = await userWithUnlocks({
      Aircraft: { unlockedAt: new Date(), badgeSeen: false },
      Tech:     { unlockedAt: new Date(), badgeSeen: false },
    });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/category-unlocks/Aircraft/seen')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id).select('categoryUnlocks');
    expect(fresh.categoryUnlocks.get('Aircraft').badgeSeen).toBe(true);
    expect(fresh.categoryUnlocks.get('Tech').badgeSeen).toBe(false);
  });

  it('rejects category names with dots', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/category-unlocks/has.dot/seen')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).patch('/api/users/me/category-unlocks/Aircraft/seen');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/me/category-unlocks/seen-all', () => {
  it('marks every unseen badge as seen and leaves already-seen ones alone', async () => {
    const now = new Date();
    const user = await userWithUnlocks({
      Aircraft: { unlockedAt: now, badgeSeen: false },
      Tech:     { unlockedAt: now, badgeSeen: false },
      Threats:  { unlockedAt: now, badgeSeen: true },
    });
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/category-unlocks/seen-all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id).select('categoryUnlocks');
    expect(fresh.categoryUnlocks.get('Aircraft').badgeSeen).toBe(true);
    expect(fresh.categoryUnlocks.get('Tech').badgeSeen).toBe(true);
    expect(fresh.categoryUnlocks.get('Threats').badgeSeen).toBe(true);
  });

  it('handles users with no unlocks gracefully', async () => {
    const user   = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app)
      .patch('/api/users/me/category-unlocks/seen-all')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
