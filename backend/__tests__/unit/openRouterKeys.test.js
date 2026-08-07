/**
 * Registry consistency for OpenRouter billing keys
 * (backend/constants/openRouterKeys.js).
 *
 * These exist because `clipper` was once added to the caller but not to the
 * usage-log enum. logUsage() deliberately swallows write errors so a logging
 * fault can never break a feature — which meant the calls billed normally and
 * their cost was silently discarded. Nothing surfaced the problem.
 *
 * Every derived consumer is pinned to the registry here so the next key added
 * cannot repeat it.
 */

process.env.OPENROUTER_KEY         = 'test_main_key';
process.env.OPENROUTER_KEY_CLIPPER = 'test_clipper_key';

const db = require('../helpers/setupDb');
const { OPENROUTER_KEYS, OPENROUTER_KEY_NAMES } = require('../../constants/openRouterKeys');
const OpenRouterUsageLog = require('../../models/OpenRouterUsageLog');
const { callOpenRouter, _flushPendingLogWrites } = require('../../utils/openRouter');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { jest.restoreAllMocks(); await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

describe('the key registry', () => {
  it('includes clipper', () => {
    expect(OPENROUTER_KEY_NAMES).toContain('clipper');
    expect(OPENROUTER_KEYS.clipper.env).toBe('OPENROUTER_KEY_CLIPPER');
  });

  it('gives every key a title for the X-Title header', () => {
    for (const name of OPENROUTER_KEY_NAMES) {
      expect(typeof OPENROUTER_KEYS[name].title).toBe('string');
      expect(OPENROUTER_KEYS[name].title.length).toBeGreaterThan(0);
    }
  });

  it('keeps main as the shared fallback with no dedicated env var', () => {
    expect(OPENROUTER_KEYS.main.env).toBeNull();
  });
});

describe('usage-log enum', () => {
  // The exact regression: an enum that omits a live key rejects every write
  // for it, and the rejection is swallowed.
  it('accepts every registered key', () => {
    const enumValues = OpenRouterUsageLog.schema.path('key').options.enum;
    expect([...enumValues].sort()).toEqual([...OPENROUTER_KEY_NAMES].sort());
  });

  it.each(OPENROUTER_KEY_NAMES)('persists a %s usage row', async (key) => {
    await OpenRouterUsageLog.create({ key, feature: 'test', costUsd: 0.01 });
    expect(await OpenRouterUsageLog.countDocuments({ key })).toBe(1);
  });

  it('still rejects a key that is not registered', async () => {
    await expect(
      OpenRouterUsageLog.create({ key: 'not-a-real-key', feature: 'test' }),
    ).rejects.toThrow();
  });
});

describe('clipper calls are billed and logged', () => {
  function mockOk(body) {
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  it('uses the clipper key and records the spend against it', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOk({
      choices: [{ message: { content: '{}' } }],
      model: 'anthropic/claude-sonnet-4-5',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0042 },
    }));

    await callOpenRouter({
      key: 'clipper',
      feature: 'clipper-script',
      body: { model: 'anthropic/claude-sonnet-4-5', messages: [] },
    });
    await _flushPendingLogWrites();

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test_clipper_key');
    expect(init.headers['X-Title']).toBe('SkyWatch Clipper');

    const row = await OpenRouterUsageLog.findOne({ key: 'clipper' }).lean();
    expect(row).not.toBeNull();
    expect(row.feature).toBe('clipper-script');
    expect(row.costUsd).toBeCloseTo(0.0042);
    expect(row.totalTokens).toBe(15);
  });

  it('falls back to the main key when no clipper key is configured', async () => {
    const saved = process.env.OPENROUTER_KEY_CLIPPER;
    delete process.env.OPENROUTER_KEY_CLIPPER;
    try {
      const fetchSpy = jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOk({
        choices: [{ message: { content: '{}' } }], usage: {},
      }));
      await callOpenRouter({ key: 'clipper', feature: 'clipper-ideas', body: { model: 'm', messages: [] } });
      expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer test_main_key');
    } finally {
      process.env.OPENROUTER_KEY_CLIPPER = saved;
    }
  });
});

describe('the Community key', () => {
  it('is registered, so its calls can be logged and filtered', () => {
    // Everything downstream — the usage-log enum, the admin summary tiles, the
    // spend page filters, the log query allowlist — is derived from this table.
    // A key used backend-side but missing here bills silently: logUsage swallows
    // write errors by design, so the cost never appears anywhere.
    expect(OPENROUTER_KEY_NAMES).toContain('community');
    expect(OPENROUTER_KEYS.community.env).toBe('OPENROUTER_KEY_COMMUNITY');
    expect(OPENROUTER_KEYS.community.title).toBe('SkyWatch Community');
  });
});
