process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const SystemLog = require('../../models/SystemLog');

// Regression cover for the failure that started all this: the site is served on
// both the apex and www, www wasn't on the allowlist, and the CORS middleware
// threw — producing a 500 with no CORS headers. To the browser that's an opaque
// network error, so the app couldn't tell it from being offline: it kept the
// user "signed in" from cache, queued every score, and recorded nothing for
// five weeks. Nobody could see it from either end.

beforeAll(async () => { await db.connect(); });
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('CORS origin guard', () => {
  it('allows the apex origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://skywatch.academy');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://skywatch.academy');
  });

  it('allows the www origin — the one that was silently breaking the site', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://www.skywatch.academy');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://www.skywatch.academy');
  });

  it('allows the Capacitor origins used by the native app', async () => {
    for (const origin of ['https://localhost', 'capacitor://localhost']) {
      const res = await request(app).get('/api/health').set('Origin', origin);
      expect(res.status).toBe(200);
    }
  });

  it('allows requests with no Origin header at all (curl, server-to-server)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rejects an unknown origin with 403, not the old 500', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
  });

  it('records a rejected origin as a system log', async () => {
    await request(app).get('/api/health').set('Origin', 'https://not-allowed.example.com');

    const logs = await SystemLog.find({ type: 'cors_origin_rejected' });
    expect(logs).toHaveLength(1);
    expect(logs[0].origin).toBe('https://not-allowed.example.com');
    expect(logs[0].requestPath).toBe('/api/health');
    expect(logs[0].hitCount).toBe(1);
  });

  it('records the referer so the admin can see where the blocked request came from', async () => {
    await request(app)
      .get('/api/health')
      .set('Origin', 'https://not-allowed.example.com')
      .set('Referer', 'https://some-other-site.example.com/embed');

    const log = await SystemLog.findOne({ type: 'cors_origin_rejected', origin: 'https://not-allowed.example.com' });
    expect(log.referer).toBe('https://some-other-site.example.com/embed');
  });

  it('aggregates repeat offences into one row per origin per day', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/health').set('Origin', 'https://noisy.example.com');
    }

    const logs = await SystemLog.find({ type: 'cors_origin_rejected', origin: 'https://noisy.example.com' });
    expect(logs).toHaveLength(1);
    expect(logs[0].hitCount).toBe(5);
  });

  it('keeps separate rows for separate origins', async () => {
    await request(app).get('/api/health').set('Origin', 'https://one.example.com');
    await request(app).get('/api/health').set('Origin', 'https://two.example.com');

    const logs = await SystemLog.find({ type: 'cors_origin_rejected' });
    expect(logs).toHaveLength(2);
  });

  it('blocks the preflight too, so a POST never even gets attempted', async () => {
    const res = await request(app)
      .options('/api/games/cbat/target/result')
      .set('Origin', 'https://not-allowed.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
  });
});
