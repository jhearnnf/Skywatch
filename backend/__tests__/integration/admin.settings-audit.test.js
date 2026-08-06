/**
 * PATCH /api/admin/settings — the change applies AND the audit row is written.
 *
 * Regression cover for a bug that shipped: the route writes settings first,
 * then records an AdminAction whose type it derives from which keys changed.
 * Eight derived values were missing from the enum, so those saves applied the
 * change, threw on the audit row, and returned 500 — an error for a change that
 * had actually happened, with no audit trail behind it.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const AppSettings = require('../../models/AppSettings');
const AdminAction = require('../../models/AdminAction');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const patch = (cookie, body) =>
  request(app).patch('/api/admin/settings').set('Cookie', cookie)
    .send({ reason: 'test', ...body });

// One representative key per branch of the actionType chain in the route.
const CASES = [
  ['change_sound_settings',    { volumeCommunityMusic: 42 }],
  ['change_sound_settings',    { soundEnabledCommunityMusic: false }],
  ['change_economy_settings',  { airstarsFirstLogin: 7 }],
  ['change_quiz_settings',     { passThresholdEasy: 55 }],
  ['change_content_settings',  { welcomeEmailSubject: 'Hello' }],
  ['change_app_settings',      { chatEnabled: true }],
];

describe('settings save', () => {
  it.each(CASES)('records %s and applies the change', async (expectedType, body) => {
    const admin = await createUser({ isAdmin: true });

    const res = await patch(authCookie(admin._id), body);

    expect(res.status).toBe(200);
    const action = await AdminAction.findOne({ actionType: expectedType });
    expect(action).not.toBeNull();

    const [key, value] = Object.entries(body)[0];
    const settings = await AppSettings.findOne();
    expect(settings[key]).toBe(value);
  });

  it('never returns 200 without an audit row', async () => {
    // The pairing is the point: a save that succeeds silently and unaudited
    // would be as wrong as the 500 was.
    const admin = await createUser({ isAdmin: true });
    await patch(authCookie(admin._id), { volumeCommunityMusic: 33 });

    expect(await AdminAction.countDocuments({ userId: admin._id })).toBe(1);
  });

  it('is admin-only', async () => {
    const user = await createUser();
    const res = await patch(authCookie(user._id), { volumeCommunityMusic: 10 });
    expect(res.status).toBe(403);
  });
});
