process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const User    = require('../../models/User');
const { COOLDOWN_DAYS } = require('../../utils/displayName');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const ROUTE = '/api/users/me/display-name';

describe('PATCH /api/users/me/display-name', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).patch(ROUTE).send({ displayName: 'Maverick' });
    expect(res.status).toBe(401);
  });

  it('sets a display name and bumps displayNameChangedAt', async () => {
    const user = await createUser();
    const cookie = authCookie(user._id);

    const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Maverick' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe('Maverick');

    const fresh = await User.findById(user._id).lean();
    expect(fresh.displayName).toBe('Maverick');
    expect(fresh.displayNameLower).toBe('maverick');
    expect(fresh.displayNameChangedAt).toBeTruthy();
  });

  it('clears the display name when given null', async () => {
    const user = await createUser({ displayName: 'Goose', displayNameLower: 'goose' });
    const cookie = authCookie(user._id);

    const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: null });

    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBeNull();

    const fresh = await User.findById(user._id).lean();
    expect(fresh.displayName).toBeNull();
    expect(fresh.displayNameLower).toBeNull();
  });

  describe('validation', () => {
    let cookie;
    beforeEach(async () => {
      const user = await createUser();
      cookie = authCookie(user._id);
    });

    it('rejects names that are too short', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'ab' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least/i);
    });

    it('rejects names that are too long', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'a'.repeat(21) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/20 characters/);
    });

    it('rejects invalid characters', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'bad!name' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/letters, numbers/i);
    });

    it('rejects leading/trailing whitespace', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: ' Maverick' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/whitespace/i);
    });

    it('rejects double spaces', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Top  Gun' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/double/i);
    });

    it('rejects purely numeric names', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: '1234567' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/only numbers/i);
    });

    it('rejects reserved prefixes (Agent)', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Agent 0007' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reserved/i);
    });

    it('rejects reserved prefixes (admin)', async () => {
      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'AdminGuy' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reserved/i);
    });
  });

  describe('admin override', () => {
    it('lets admins set names with reserved prefixes', async () => {
      const admin = await createUser({ email: 'admin@test.com', isAdmin: true });
      const cookie = authCookie(admin._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Skywatch Mod' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.displayName).toBe('Skywatch Mod');
    });

    it('still blocks profanity for admins', async () => {
      const admin = await createUser({ email: 'admin@test.com', isAdmin: true });
      const cookie = authCookie(admin._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'shitstorm' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not allowed/i);
    });

    it('still blocks reserved prefixes for non-admins', async () => {
      const user = await createUser();
      const cookie = authCookie(user._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Skywatch Mod' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reserved/i);
    });
  });

  describe('uniqueness', () => {
    it('rejects a name already taken (case-insensitive)', async () => {
      await createUser({ email: 'a@test.com', displayName: 'Iceman', displayNameLower: 'iceman' });
      const other = await createUser({ email: 'b@test.com' });
      const cookie = authCookie(other._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'ICEMAN' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already taken/i);
    });

    it('allows the same user to re-save their own name (no-op-ish)', async () => {
      // Note: in practice cooldown will block this; this asserts the
      // uniqueness check itself excludes the requester's own row.
      const user = await createUser({ displayName: 'Viper', displayNameLower: 'viper' });
      const cookie = authCookie(user._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Viper' });

      // First-set was free per factory (no displayNameChangedAt), so 200.
      expect(res.status).toBe(200);
    });
  });

  describe('30-day cooldown', () => {
    it('rejects a second change inside the window', async () => {
      const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const user = await createUser({
        displayName: 'Hollywood',
        displayNameLower: 'hollywood',
        displayNameChangedAt: recent,
      });
      const cookie = authCookie(user._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Slider' });

      expect(res.status).toBe(429);
      expect(res.body.message).toMatch(new RegExp(`${COOLDOWN_DAYS} days`, 'i'));
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
    });

    it('allows a change once the window has passed', async () => {
      const old = new Date(Date.now() - (COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000);
      const user = await createUser({
        displayName: 'Sundown',
        displayNameLower: 'sundown',
        displayNameChangedAt: old,
      });
      const cookie = authCookie(user._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Wolfman' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.displayName).toBe('Wolfman');
    });

    it('the very first set is free even without prior history', async () => {
      const user = await createUser(); // no displayNameChangedAt
      const cookie = authCookie(user._id);

      const res = await request(app).patch(ROUTE).set('Cookie', cookie).send({ displayName: 'Charlie' });
      expect(res.status).toBe(200);
    });
  });
});
