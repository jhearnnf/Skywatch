/**
 * Integration tests for the OpenRouter admin endpoints:
 *   GET /api/admin/openrouter/summary
 *   GET /api/admin/openrouter/logs
 *
 * /summary merges lifetime data from OpenRouter's /api/v1/key endpoint
 * (mocked via global.fetch) with today's spend aggregated from our own
 * OpenRouterUsageLog. /logs applies filters and always returns totalCost
 * across the FULL filter set (not just the page).
 */
process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_main_key';
process.env.OPENROUTER_KEY_APTITUDE = 'test_aptitude_key';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createSettings, authCookie,
} = require('../helpers/factories');
const OpenRouterUsageLog = require('../../models/OpenRouterUsageLog');

function mockFetchJson(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// Install a fetch mock that answers OpenRouter's /api/v1/key with
// per-key lifetime usage, driven by the bearer token on the request.
function installKeyUsageMock({ main = 12.34, aptitude = 5.67 } = {}) {
  return jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    const auth = opts?.headers?.Authorization || '';
    if (String(url).endsWith('/api/v1/key')) {
      if (auth.includes('test_aptitude_key')) return mockFetchJson({ data: { usage: aptitude, limit: null, label: 'SkyWatch.aptitude' } });
      return mockFetchJson({ data: { usage: main, limit: null, label: 'SkyWatch.main' } });
    }
    return mockFetchJson({});
  });
}

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
// forceExit in jest.config.js cleans up; avoid db.closeDatabase() to stop
// the fetch spy from interfering with mongoose teardown.
afterAll(() => {});

// ── auth guards ─────────────────────────────────────────────────────────────

describe('OpenRouter admin endpoints — auth', () => {
  it('403s a non-admin on /summary', async () => {
    const u = await createUser();
    const res = await request(app)
      .get('/api/admin/openrouter/summary')
      .set('Cookie', authCookie(u._id));
    expect(res.status).toBe(403);
  });

  it('401s a guest on /logs', async () => {
    const res = await request(app).get('/api/admin/openrouter/logs');
    expect(res.status).toBe(401);
  });
});

// ── /summary ────────────────────────────────────────────────────────────────

describe('GET /api/admin/openrouter/summary', () => {
  it('returns lifetime (from OpenRouter) and today (from logs) per key', async () => {
    installKeyUsageMock({ main: 20, aptitude: 3 });

    const today = new Date();
    await OpenRouterUsageLog.create([
      { key: 'main',     feature: 'generate-brief', costUsd: 0.10, totalTokens: 100, createdAt: today },
      { key: 'main',     feature: 'generate-quiz',  costUsd: 0.05, totalTokens: 50,  createdAt: today },
      { key: 'aptitude', feature: 'aptitude-sync',  costUsd: 0.02, totalTokens: 20,  createdAt: today },
    ]);

    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/openrouter/summary')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.main.lifetime).toBe(20);
    expect(res.body.data.main.today).toBeCloseTo(0.15, 5);
    expect(res.body.data.main.todayCalls).toBe(2);
    expect(res.body.data.main.todayByFeature['generate-brief'].cost).toBeCloseTo(0.10, 5);
    expect(res.body.data.aptitude.lifetime).toBe(3);
    expect(res.body.data.aptitude.today).toBeCloseTo(0.02, 5);
  });

  it('excludes yesterday from today but includes it in last7Days', async () => {
    installKeyUsageMock();

    const now       = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    await OpenRouterUsageLog.create([
      { key: 'main', feature: 'x', costUsd: 0.50, createdAt: yesterday },
      { key: 'main', feature: 'x', costUsd: 0.10, createdAt: now },
    ]);

    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/openrouter/summary')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.main.today).toBeCloseTo(0.10, 5);
    expect(res.body.data.main.last7Days).toBeCloseTo(0.60, 5);
  });
});

// ── /logs ───────────────────────────────────────────────────────────────────

describe('GET /api/admin/openrouter/logs', () => {
  // Hour-scale gaps keep the `from=` window test deterministic even if the
  // test runner is slow — setup jitter of seconds is irrelevant against a
  // 2.5-hour cutoff.
  const HOUR = 3600 * 1000;
  beforeEach(async () => {
    const now = new Date();
    await OpenRouterUsageLog.create([
      { key: 'main',     feature: 'generate-brief', costUsd: 0.20, totalTokens: 100, createdAt: new Date(now.getTime() - 1 * HOUR) },
      { key: 'main',     feature: 'generate-quiz',  costUsd: 0.10, totalTokens: 50,  createdAt: new Date(now.getTime() - 2 * HOUR) },
      { key: 'main',     feature: 'generate-brief', costUsd: 0.30, totalTokens: 200, createdAt: new Date(now.getTime() - 3 * HOUR) },
      { key: 'aptitude', feature: 'aptitude-sync',  costUsd: 0.04, totalTokens: 40,  createdAt: new Date(now.getTime() - 4 * HOUR) },
    ]);
  });

  it('returns all rows with totals when no filter is applied', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/openrouter/logs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(4);
    expect(res.body.data.totalCost).toBeCloseTo(0.64, 5);
    expect(res.body.data.totalCalls).toBe(4);
    expect(res.body.data.totalTokens).toBe(390);
    expect(res.body.data.features.sort()).toEqual(['aptitude-sync', 'generate-brief', 'generate-quiz']);
  });

  it('filters by key and recalculates totalCost', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/openrouter/logs?key=aptitude')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.totalCost).toBeCloseTo(0.04, 5);
    expect(res.body.data.totalCalls).toBe(1);
  });

  it('filters by feature (CSV) — totalCost reflects just the filtered features', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/openrouter/logs?feature=generate-brief')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.totalCost).toBeCloseTo(0.50, 5);
  });

  it('filters by from=<iso> to exclude older rows', async () => {
    const admin = await createAdminUser();
    const cutoff = new Date(Date.now() - 2.5 * HOUR).toISOString();
    const res = await request(app)
      .get(`/api/admin/openrouter/logs?from=${encodeURIComponent(cutoff)}`)
      .set('Cookie', authCookie(admin._id));

    // Only the two most-recent rows fall inside the window (1h and 2h ago).
    expect(res.body.data.totalCalls).toBe(2);
    expect(res.body.data.totalCost).toBeCloseTo(0.30, 5);
  });
});
