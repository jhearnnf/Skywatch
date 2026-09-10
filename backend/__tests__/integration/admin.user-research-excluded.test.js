/**
 * admin.user-research-excluded.test.js
 *
 * Tests for PATCH /api/admin/users/:id/research-excluded — the do-not-contact
 * list for the Potential CBAT Passers questionnaire, ticked from the expanded
 * row in Admin › Users.
 *
 * The point of the field is that it is three-state in the database and resolved
 * to a plain boolean on the way out: null means "no admin has ruled on this
 * account, use the static list in constants/survey.js", so the panel is told the
 * answer rather than the input, and writes back an explicit true/false either
 * way. That is what lets an admin take someone OFF the shipped list.
 *
 * Coverage:
 *   - Auth guards (401 no cookie, 403 non-admin)
 *   - Sets the flag true / false and returns the new value
 *   - Coerces truthy/falsy bodies to a boolean
 *   - 404 for an unknown user id
 *   - A new account defaults to null, not false
 *   - GET /users resolves the static list into the flag it reports
 *   - An explicit false overrides the static list
 *   - The cohort honours both directions of the override
 */

process.env.JWT_SECRET = 'test_secret';
process.env.CLIENT_URL = 'https://skywatch.academy';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  createRank,
  authCookie,
} = require('../helpers/factories');

const User = require('../../models/User');
const GameSessionCbatTargetResult = require('../../models/GameSessionCbatTargetResult');
const { EXCLUDED_EMAILS, isExcludedAccount } = require('../../constants/survey');

const DAY = 24 * 60 * 60 * 1000;
const LISTED_EMAIL = EXCLUDED_EMAILS[EXCLUDED_EMAILS.length - 1];

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

function setExcluded(cookie, id, researchEmailExcluded) {
  const req = request(app).patch(`/api/admin/users/${id}/research-excluded`);
  if (cookie) req.set('Cookie', cookie);
  return req.send({ researchEmailExcluded });
}

// The row the Users list renders for this account.
async function rowFor(cookie, id) {
  const res = await request(app).get('/api/admin/users?limit=100').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data.users.find(u => u._id === id.toString());
}

describe('PATCH /api/admin/users/:id/research-excluded', () => {
  beforeEach(async () => { await createRank(); });

  it('returns 401 with no auth cookie', async () => {
    const user = await createUser();
    const res  = await setExcluded(null, user._id, true);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const caller = await createUser();
    const target = await createUser();
    const res    = await setExcluded(authCookie(caller._id), target._id, true);
    expect(res.status).toBe(403);
  });

  it('puts an account on the list', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setExcluded(authCookie(admin._id), target._id, true);

    expect(res.status).toBe(200);
    expect(res.body.data.researchEmailExcluded).toBe(true);
    expect((await User.findById(target._id)).researchEmailExcluded).toBe(true);
  });

  it('takes an account back off it', async () => {
    const admin  = await createAdminUser();
    const target = await createUser({ researchEmailExcluded: true });

    const res = await setExcluded(authCookie(admin._id), target._id, false);

    expect(res.status).toBe(200);
    expect(res.body.data.researchEmailExcluded).toBe(false);
    expect((await User.findById(target._id)).researchEmailExcluded).toBe(false);
  });

  it('coerces a non-boolean body to a boolean', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    const res = await setExcluded(authCookie(admin._id), target._id, 'yes');

    expect(res.status).toBe(200);
    expect(res.body.data.researchEmailExcluded).toBe(true);
  });

  it('returns 404 for an unknown user id', async () => {
    const admin = await createAdminUser();
    const res   = await setExcluded(authCookie(admin._id), '507f1f77bcf86cd799439011', true);
    expect(res.status).toBe(404);
  });

  it('leaves a new account unruled rather than false', async () => {
    const target = await createUser();
    // Null, not false: an account nobody has ruled on still answers to the
    // static list, and a stored false would silently override it.
    expect((await User.findById(target._id)).researchEmailExcluded).toBeNull();
  });
});

describe('the Users list reports the resolved flag', () => {
  let cookie;
  beforeEach(async () => {
    await createRank();
    cookie = authCookie((await createAdminUser())._id);
  });

  it('shows an ordinary account as not excluded', async () => {
    const target = await createUser();
    expect((await rowFor(cookie, target._id)).researchEmailExcluded).toBe(false);
  });

  it('shows an account on the static list as excluded, with nothing stored', async () => {
    const target = await createUser({ email: LISTED_EMAIL });
    expect((await User.findById(target._id)).researchEmailExcluded).toBeNull();
    expect((await rowFor(cookie, target._id)).researchEmailExcluded).toBe(true);
  });

  it('reports the tick straight back', async () => {
    const target = await createUser();
    await setExcluded(cookie, target._id, true);
    expect((await rowFor(cookie, target._id)).researchEmailExcluded).toBe(true);
  });

  it('lets an admin take someone off the static list', async () => {
    const target = await createUser({ email: LISTED_EMAIL });
    await setExcluded(cookie, target._id, false);

    expect((await rowFor(cookie, target._id)).researchEmailExcluded).toBe(false);
    expect(isExcludedAccount(await User.findById(target._id))).toBe(false);
  });
});

describe('the questionnaire cohort honours the flag', () => {
  let cookie;

  const listedEmails = async () => {
    const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', cookie);
    expect(res.status).toBe(200);
    return res.body.data.groups.flatMap(g => g.users.map(u => u.email));
  };

  // Someone who finished twelve games and went quiet a month ago: an ordinary
  // member of the cohort, so the only thing under test is the flag.
  async function candidate(overrides = {}) {
    const u  = await createUser(overrides);
    const at = new Date(Date.now() - 30 * DAY);
    await GameSessionCbatTargetResult.insertMany(
      Array.from({ length: 12 }, () => ({ userId: u._id, totalScore: 500, totalTime: 120, createdAt: at })),
    );
    await User.updateOne({ _id: u._id }, { lastSeen: at });
    return u;
  }

  beforeEach(async () => {
    await createSettings();
    await createRank();
    cookie = authCookie((await createAdminUser())._id);
  });

  it('drops a ticked account out of the list', async () => {
    const u = await candidate();
    expect(await listedEmails()).toContain(u.email);

    await setExcluded(cookie, u._id, true);
    expect(await listedEmails()).not.toContain(u.email);
  });

  it('puts an unticked account back in, even one on the static list', async () => {
    const u = await candidate({ email: LISTED_EMAIL });
    expect(await listedEmails()).not.toContain(u.email);

    await setExcluded(cookie, u._id, false);
    expect(await listedEmails()).toContain(u.email);
  });
});
