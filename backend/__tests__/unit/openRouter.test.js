/**
 * Unit tests for the shared OpenRouter helper (backend/utils/openRouter.js).
 *
 * Covers:
 *   - callOpenRouter() logs a usage row with cost/tokens/feature/key
 *   - withFeature() scopes the feature tag for nested calls
 *   - a logging failure never leaks into the caller
 *   - fetchOpenRouterKeyUsage() parses the /api/v1/key response
 */

process.env.OPENROUTER_KEY          = 'test_main_key';
process.env.OPENROUTER_KEY_APTITUDE = 'test_aptitude_key';
process.env.OPENROUTER_KEY_SOCIALS  = 'test_socials_key';

const db = require('../helpers/setupDb');
const OpenRouterUsageLog = require('../../models/OpenRouterUsageLog');
const { callOpenRouter, withFeature, setBrief, fetchOpenRouterKeyUsage, _flushPendingLogWrites } = require('../../utils/openRouter');

function mockFetchJson(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeAll(async () => { await db.connect(); });
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
afterAll(async () => { await db.closeDatabase(); });

describe('callOpenRouter', () => {
  it('logs a usage row with cost, tokens, feature, and key on a successful call', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockFetchJson({
        choices: [{ message: { content: 'hi' } }],
        usage:   { cost: 0.0123, prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model:   'openai/gpt-4o-mini',
      })
    );

    const res = await callOpenRouter({
      key:     'main',
      feature: 'test-feature',
      body:    { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.choices[0].message.content).toBe('hi');

    // Allow the fire-and-forget log to flush
    await _flushPendingLogWrites();
    const rows = await OpenRouterUsageLog.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key:              'main',
      feature:          'test-feature',
      model:            'openai/gpt-4o-mini',
      promptTokens:     10,
      completionTokens: 20,
      totalTokens:      30,
      costUsd:          0.0123,
    });
  });

  it('tags the log with the key resolved from the aptitude env var', async () => {
    jest.spyOn(global, 'fetch').mockImplementationOnce((url, opts) => {
      expect(opts.headers.Authorization).toBe('Bearer test_aptitude_key');
      return mockFetchJson({ choices: [], usage: { cost: 0 } });
    });

    await callOpenRouter({ key: 'aptitude', feature: 'aptitude-sync', body: { model: 'x', messages: [] } });
    await _flushPendingLogWrites();

    const rows = await OpenRouterUsageLog.find().lean();
    expect(rows[0].key).toBe('aptitude');
  });

  it('tags the log with the key resolved from the socials env var', async () => {
    jest.spyOn(global, 'fetch').mockImplementationOnce((url, opts) => {
      expect(opts.headers.Authorization).toBe('Bearer test_socials_key');
      expect(opts.headers['X-Title']).toBe('SkyWatch Socials');
      return mockFetchJson({ choices: [], usage: { cost: 0 } });
    });

    await callOpenRouter({ key: 'socials', feature: 'social-draft-x', body: { model: 'x', messages: [] } });
    await _flushPendingLogWrites();

    const rows = await OpenRouterUsageLog.find().lean();
    expect(rows[0].key).toBe('socials');
  });

  it('falls back to OPENROUTER_KEY when OPENROUTER_KEY_SOCIALS is unset', async () => {
    const saved = process.env.OPENROUTER_KEY_SOCIALS;
    delete process.env.OPENROUTER_KEY_SOCIALS;
    jest.spyOn(global, 'fetch').mockImplementationOnce((url, opts) => {
      expect(opts.headers.Authorization).toBe('Bearer test_main_key');
      return mockFetchJson({ choices: [], usage: { cost: 0 } });
    });

    await callOpenRouter({ key: 'socials', feature: 'social-draft-x', body: { model: 'x', messages: [] } });
    process.env.OPENROUTER_KEY_SOCIALS = saved;
  });

  it('injects usage:{ include: true } into the outbound body', async () => {
    let sentBody;
    jest.spyOn(global, 'fetch').mockImplementationOnce((_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return mockFetchJson({ choices: [], usage: { cost: 0 } });
    });

    await callOpenRouter({ feature: 'test', body: { model: 'x', messages: [] } });

    expect(sentBody.usage).toEqual({ include: true });
  });

  it('throws on non-2xx responses', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockFetchJson({ error: 'bad' }, false, 500));

    await expect(
      callOpenRouter({ feature: 'test', body: { model: 'x', messages: [] } })
    ).rejects.toThrow(/OpenRouter 500/);
  });

  it('uses the feature from withFeature() scope when no explicit feature is passed', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockFetchJson({ choices: [], usage: { cost: 0.001 }, model: 'x' })
    );

    await withFeature('scoped-feature', async () => {
      await callOpenRouter({ body: { model: 'x', messages: [] } });
    });
    await _flushPendingLogWrites();

    const rows = await OpenRouterUsageLog.find().lean();
    expect(rows[0].feature).toBe('scoped-feature');
  });

  it('persists briefId from setBrief() on the logged row', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockFetchJson({ choices: [], usage: { cost: 0 }, model: 'x' })
    );

    const mongoose = require('mongoose');
    const briefId  = new mongoose.Types.ObjectId();

    await withFeature('generate-quiz', async () => {
      setBrief(briefId);
      await callOpenRouter({ body: { model: 'x', messages: [] } });
    });
    await _flushPendingLogWrites();

    const rows = await OpenRouterUsageLog.find().lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].briefId)).toBe(String(briefId));
  });

  it('leaves briefId null when setBrief() is not called', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockFetchJson({ choices: [], usage: { cost: 0 }, model: 'x' })
    );

    await withFeature('news-headlines', async () => {
      await callOpenRouter({ body: { model: 'x', messages: [] } });
    });
    await _flushPendingLogWrites();

    const rows = await OpenRouterUsageLog.find().lean();
    expect(rows[0].briefId).toBeNull();
  });

  it('does not throw when the log write fails', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockFetchJson({ choices: [], usage: { cost: 0 }, model: 'x' })
    );
    jest.spyOn(OpenRouterUsageLog, 'create').mockRejectedValueOnce(new Error('db down'));

    await expect(
      callOpenRouter({ feature: 'test', body: { model: 'x', messages: [] } })
    ).resolves.toBeDefined();
  });
});

describe('fetchOpenRouterKeyUsage', () => {
  it('parses /api/v1/key response into { usage, limit, label }', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockFetchJson({ data: { usage: 4.20, limit: 100, label: 'SkyWatch.main' } })
    );

    const out = await fetchOpenRouterKeyUsage('main');
    expect(out).toEqual({ usage: 4.20, limit: 100, label: 'SkyWatch.main', error: null });
  });

  it('returns an error string (not a throw) when OpenRouter fails', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockFetchJson({}, false, 503));

    const out = await fetchOpenRouterKeyUsage('main');
    expect(out.usage).toBe(0);
    expect(out.error).toMatch(/OpenRouter 503/);
  });
});
