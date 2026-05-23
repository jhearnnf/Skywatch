/**
 * updateNotifications.test.js
 *
 * Covers the user-facing selection rule for /api/update-notifications/{current,history,:id/acknowledge}.
 * The "current" rule is the load-bearing invariant: latest active doc not in this user's viewedBy.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createRank,
  createUser,
  authCookie,
} = require('../helpers/factories');

const UpdateNotification = require('../../models/UpdateNotification');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

async function createNotification(overrides = {}) {
  return UpdateNotification.create({
    title:     overrides.title ?? `Notif ${Date.now()}_${Math.random().toString(36).slice(2)}`,
    body:      overrides.body  ?? 'Some announcement body.',
    enabled:   overrides.enabled !== undefined ? overrides.enabled : true,
    validFrom: overrides.validFrom ?? null,
    expiresAt: overrides.expiresAt ?? null,
    targetPath: overrides.targetPath ?? '',
    imageMode: overrides.imageMode ?? 'none',
    imageUrl:  overrides.imageUrl ?? '',
    viewedBy:  overrides.viewedBy ?? [],
    ...overrides,
  });
}

describe('GET /api/update-notifications/current', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('401s for guests', async () => {
    const res = await request(app).get('/api/update-notifications/current');
    expect(res.status).toBe(401);
  });

  it('returns null when nothing is active', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.notification).toBeNull();
  });

  it('returns the single newest active notification the user has not seen', async () => {
    const user = await createUser();
    // Insertion order determines createdAt — last one inserted is the newest.
    await createNotification({ title: 'first' });
    await createNotification({ title: 'second' });
    const last = await createNotification({ title: 'last' });

    const res = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    expect(res.body.data.notification.title).toBe(last.title);
  });

  it('skips notifications the user has already seen — and does NOT fall back to older ones', async () => {
    const user = await createUser();
    await createNotification({ title: 'older-unseen' });
    const latest = await createNotification({
      title:    'latest-seen',
      viewedBy: [{ userId: user._id, viewedAt: new Date() }],
    });

    const res = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(user._id));
    // Critical: when the latest is already seen, older unseen ones are NOT shown.
    // Only the very newest unseen counts; if there isn't one, return null.
    expect(res.status).toBe(200);
    expect(res.body.data.notification).toBeNull();
    expect(latest.title).toBe('latest-seen'); // sanity
  });

  it('excludes notifications outside the validFrom/expiresAt window', async () => {
    const user = await createUser();
    const future = new Date(Date.now() + 60_000);
    const past   = new Date(Date.now() - 60_000);

    await createNotification({ title: 'future', validFrom: future });
    await createNotification({ title: 'expired', expiresAt: past });
    await createNotification({ title: 'live' });

    const res = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(user._id));
    expect(res.body.data.notification.title).toBe('live');
  });

  it('excludes disabled notifications', async () => {
    const user = await createUser();
    await createNotification({ title: 'disabled', enabled: false });
    const res = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(user._id));
    expect(res.body.data.notification).toBeNull();
  });

  it('matches targetPath exactly OR empty-string-as-wildcard', async () => {
    const user = await createUser();

    // Older notif targets /home only.
    await createNotification({ title: 'home-only', targetPath: '/home' });
    // Newer notif has no target (matches any page).
    const anywhere = await createNotification({ title: 'anywhere', targetPath: '' });

    // On /profile: home-only is out of scope; anywhere matches.
    const onProfile = await request(app)
      .get('/api/update-notifications/current?path=/profile')
      .set('Cookie', authCookie(user._id));
    expect(onProfile.body.data.notification.title).toBe(anywhere.title);

    // On /home: both are in scope; anywhere wins because it's newer.
    const onHome = await request(app)
      .get('/api/update-notifications/current?path=/home')
      .set('Cookie', authCookie(user._id));
    expect(onHome.body.data.notification.title).toBe(anywhere.title);

    // After acking the "anywhere" one, /home returns null — there is NO
    // fallback to home-only even though it's unseen. Older notifications are
    // only reachable via the modal's Previous/Next browser.
    await request(app)
      .post(`/api/update-notifications/${anywhere._id}/acknowledge`)
      .set('Cookie', authCookie(user._id));
    const onHome2 = await request(app)
      .get('/api/update-notifications/current?path=/home')
      .set('Cookie', authCookie(user._id));
    expect(onHome2.body.data.notification).toBeNull();
  });

  it('scopes "newest" per path — a /home-targeted notif still appears when no anywhere notif exists', async () => {
    const user = await createUser();
    await createNotification({ title: 'home-only', targetPath: '/home' });

    const onProfile = await request(app)
      .get('/api/update-notifications/current?path=/profile')
      .set('Cookie', authCookie(user._id));
    expect(onProfile.body.data.notification).toBeNull();

    const onHome = await request(app)
      .get('/api/update-notifications/current?path=/home')
      .set('Cookie', authCookie(user._id));
    expect(onHome.body.data.notification.title).toBe('home-only');
  });

  it('isolates viewed state per user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const notif = await createNotification({ title: 'shared' });

    // userA acks it
    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(userA._id));

    // userB still sees it
    const resB = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(userB._id));
    expect(resB.body.data.notification.title).toBe('shared');

    // userA does not
    const resA = await request(app)
      .get('/api/update-notifications/current')
      .set('Cookie', authCookie(userA._id));
    expect(resA.body.data.notification).toBeNull();
  });
});

describe('POST /api/update-notifications/:id/acknowledge', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('401s for guests', async () => {
    const notif = await createNotification();
    const res = await request(app).post(`/api/update-notifications/${notif._id}/acknowledge`);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown id', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/update-notifications/64b000000000000000000000/acknowledge')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(404);
  });

  it('is idempotent — repeat calls do not duplicate viewedBy entries', async () => {
    const user  = await createUser();
    const notif = await createNotification();

    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(user._id));
    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(user._id));

    const fresh = await UpdateNotification.findById(notif._id);
    expect(fresh.viewedBy).toHaveLength(1);
    expect(String(fresh.viewedBy[0].userId)).toBe(String(user._id));
  });

  it('stores a response when responsesEnabled and body.response provided', async () => {
    const user  = await createUser();
    const notif = await createNotification({ responsesEnabled: true });

    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(user._id))
      .send({ response: '  I like the new dark mode  ' });

    const fresh = await UpdateNotification.findById(notif._id);
    expect(fresh.viewedBy[0].response).toBe('I like the new dark mode'); // trimmed
  });

  it('ignores response when responsesEnabled is false', async () => {
    const user  = await createUser();
    const notif = await createNotification({ responsesEnabled: false });

    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(user._id))
      .send({ response: 'sneaky reply' });

    const fresh = await UpdateNotification.findById(notif._id);
    expect(fresh.viewedBy[0].response).toBe('');
  });

  it('does not clobber a previously-saved response with an empty resubmit', async () => {
    const user  = await createUser();
    const notif = await createNotification({ responsesEnabled: true });

    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(user._id))
      .send({ response: 'my first reply' });
    // Second ack with no response (e.g. a stale resubmit) should keep the original.
    await request(app)
      .post(`/api/update-notifications/${notif._id}/acknowledge`)
      .set('Cookie', authCookie(user._id))
      .send({});

    const fresh = await UpdateNotification.findById(notif._id);
    expect(fresh.viewedBy[0].response).toBe('my first reply');
  });
});

describe('GET /api/update-notifications/history', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('returns active notifications newest first regardless of seen-state', async () => {
    const user = await createUser();
    const a = await createNotification({ title: 'a' });
    const b = await createNotification({ title: 'b' });
    const c = await createNotification({ title: 'c' });

    // Mark `c` (the latest) as seen for this user.
    await request(app)
      .post(`/api/update-notifications/${c._id}/acknowledge`)
      .set('Cookie', authCookie(user._id));

    const res = await request(app)
      .get('/api/update-notifications/history')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(200);
    const titles = res.body.data.notifications.map(n => n.title);
    expect(titles).toEqual(['c', 'b', 'a']);
    expect(a && b).toBeTruthy(); // sanity
  });

  it('excludes disabled and expired notifications', async () => {
    const user = await createUser();
    await createNotification({ title: 'live' });
    await createNotification({ title: 'disabled', enabled: false });
    await createNotification({ title: 'expired',  expiresAt: new Date(Date.now() - 60_000) });

    const res = await request(app)
      .get('/api/update-notifications/history')
      .set('Cookie', authCookie(user._id));
    const titles = res.body.data.notifications.map(n => n.title);
    expect(titles).toEqual(['live']);
  });

  it('never leaks viewedBy', async () => {
    const user = await createUser();
    const n = await createNotification();
    await request(app)
      .post(`/api/update-notifications/${n._id}/acknowledge`)
      .set('Cookie', authCookie(user._id));

    const res = await request(app)
      .get('/api/update-notifications/history')
      .set('Cookie', authCookie(user._id));
    expect(res.body.data.notifications[0].viewedBy).toBeUndefined();
  });
});
