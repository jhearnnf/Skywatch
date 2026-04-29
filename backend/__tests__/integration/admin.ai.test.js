/**
 * admin.ai.test.js
 *
 * Tests for all AI generation routes in /api/admin/ai/*.
 * External API calls (OpenRouter/Perplexity + Wikipedia) are mocked at the
 * global fetch level so no real network requests are made.
 *
 * Routes covered:
 *   POST /api/admin/ai/news-headlines
 *   POST /api/admin/ai/generate-brief
 *   POST /api/admin/ai/generate-keywords
 *   POST /api/admin/ai/generate-quiz
 *   POST /api/admin/ai/generate-image
 *   POST /api/admin/ai/regenerate-brief/:id
 *   POST /api/admin/ai/generate-rank-data/:id
 */

process.env.JWT_SECRET    = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

jest.mock('../../utils/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/image/upload/test.jpg',
    public_id:  'brief-images/test',
  }),
  destroyAsset: jest.fn().mockResolvedValue({ result: 'ok' }),
}));

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie, createBrief, createLead } = require('../helpers/factories');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
// Do not call db.closeDatabase() here — jest.spyOn(global.fetch) interacts
// with Mongoose's internal teardown path causing MongoClientClosedError.
// forceExit in jest.config.js handles process cleanup instead.
afterAll(() => {});

// ── fetch mock helpers ────────────────────────────────────────────────────────

// Builds a mock Response-like object that global.fetch will return
function mockFetchResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockOpenRouter(content) {
  return mockFetchResponse({
    choices: [{ message: { content } }],
  });
}

// Smart fetch mock: dispatches OpenRouter responses by inspecting the outbound
// request body. The regenerate-brief + generate-brief routes make many internal
// AI calls (brief generation, keyword passes, quiz generation, mnemonics,
// autoLinkKeywords) and naive sequential mocks let later calls fall through to
// real fetch. This helper returns a safe `{}` for anything unrecognised.
function installAiFetchMock({ brief, quiz, headlines, keywords, mnemonics } = {}) {
  return jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    if (!String(url).includes('openrouter.ai')) {
      return mockFetchResponse({});
    }
    const bodyStr = typeof opts?.body === 'string' ? opts.body : JSON.stringify(opts?.body ?? '');
    if (headlines && bodyStr.includes('RAF) news articles')) return mockOpenRouter(headlines);
    if (quiz     && bodyStr.includes('easyQuestions') && bodyStr.includes('mediumQuestions')) return mockOpenRouter(quiz);
    if (mnemonics && bodyStr.includes('mnemonic'))    return mockOpenRouter(mnemonics);
    if (keywords && bodyStr.includes('keywords')    && bodyStr.includes('generatedDescription') && !bodyStr.includes('descriptionSections')) return mockOpenRouter(keywords);
    if (brief    && bodyStr.includes('descriptionSections')) return mockOpenRouter(brief);
    // Safe default — valid JSON object, lets keyword passes / mnemonics / autoLink gracefully no-op.
    return mockOpenRouter('{}');
  });
}

// ── POST /api/admin/ai/news-headlines ─────────────────────────────────────────

describe('POST /api/admin/ai/news-headlines', () => {
  it('returns array of headline objects from mocked AI', async () => {
    const today = new Date().toISOString().slice(0, 10);
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouter(`[{"headline":"RAF Typhoons deploy to Estonia","eventDate":"${today}"},{"headline":"New F-35 squadron declared operational","eventDate":"${today}"}]`)
    );

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines')
      .set('Cookie', authCookie(admin._id))
      .send({ timestamp: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.headlines)).toBe(true);
    expect(res.body.data.headlines.map(h => h.headline)).toContain('RAF Typhoons deploy to Estonia');
  });

  it('returns empty array when AI returns []', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter('[]'));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines')
      .set('Cookie', authCookie(admin._id))
      .send({ timestamp: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toEqual([]);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/admin/ai/news-headlines')
      .send({ timestamp: new Date().toISOString() });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .post('/api/admin/ai/news-headlines')
      .set('Cookie', authCookie(user._id))
      .send({ timestamp: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('keeps headline with unparseable date by falling back to target date', async () => {
    // Previously the route silently dropped any item with an invalid eventDate,
    // which caused frequent empty results when the model returned non-ISO formats.
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouter(`[{"headline":"RAF Typhoons scrambled","eventDate":"not a date"}]`)
    );

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines')
      .set('Cookie', authCookie(admin._id))
      .send({ date: '2026-04-15' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toHaveLength(1);
    expect(res.body.data.headlines[0].headline).toBe('RAF Typhoons scrambled');
    expect(res.body.data.headlines[0].eventDate).toBe('2026-04-15');
  });

  it('exposes rawCount so frontend can distinguish "AI returned nothing" vs "all filtered"', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter('[]'));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines')
      .set('Cookie', authCookie(admin._id))
      .send({ date: '2026-04-15' });

    expect(res.status).toBe(200);
    expect(res.body.data.rawCount).toBe(0);
  });
});

// ── POST /api/admin/ai/news-headlines-month ──────────────────────────────────

describe('POST /api/admin/ai/news-headlines-month', () => {
  it('returns headlines for ISO-formatted dates within the month', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(JSON.stringify([
      { headline: 'RAF F-35 IOC declared', eventDate: '2026-04-05' },
      { headline: 'Typhoons in Estonia',   eventDate: '2026-04-22' },
    ])));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-04' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toHaveLength(2);
  });

  it('accepts ISO timestamps that the old startsWith filter would have dropped', async () => {
    // The previous filter required eventDate.startsWith("YYYY-MM"), which failed
    // for valid ISO timestamps like "2026-04-15T00:00:00Z".
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(JSON.stringify([
      { headline: 'Sentinel R1 retired', eventDate: '2026-04-15T00:00:00Z' },
    ])));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-04' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toHaveLength(1);
    expect(res.body.data.headlines[0].eventDate).toBe('2026-04-15');
  });

  it('clamps an out-of-month date to mid-month rather than dropping the item', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(JSON.stringify([
      { headline: 'Story whose date the model got wrong', eventDate: '2026-03-30' },
    ])));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-04' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toHaveLength(1);
    expect(res.body.data.headlines[0].eventDate).toBe('2026-04-15');
  });

  it('falls back to mid-month when eventDate is missing or unparseable', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(JSON.stringify([
      { headline: 'Story with bad date', eventDate: 'sometime in April' },
      { headline: 'Story with no date' },
    ])));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-04' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toHaveLength(2);
    expect(res.body.data.headlines.every(h => h.eventDate === '2026-04-15')).toBe(true);
  });

  it('drops items missing a headline string', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(JSON.stringify([
      { headline: 'Real headline', eventDate: '2026-04-10' },
      { eventDate: '2026-04-11' }, // no headline → drop
    ])));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-04' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toHaveLength(1);
    expect(res.body.data.headlines[0].headline).toBe('Real headline');
  });

  it('rejects malformed month parameter', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-4' });

    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .send({ month: '2026-04' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(user._id))
      .send({ month: '2026-04' });
    expect(res.status).toBe(403);
  });

  it('returns empty headlines when AI returns []', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter('[]'));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/news-headlines-month')
      .set('Cookie', authCookie(admin._id))
      .send({ month: '2026-04' });

    expect(res.status).toBe(200);
    expect(res.body.data.headlines).toEqual([]);
    expect(res.body.data.rawCount).toBe(0);
  });
});

// ── POST /api/admin/ai/generate-brief ─────────────────────────────────────────

describe('POST /api/admin/ai/generate-brief', () => {
  const MOCK_BRIEF_JSON = JSON.stringify({
    title: 'RAF Typhoon',
    subtitle: 'Multi-role fast jet',
    descriptionSections: [
      'The Eurofighter Typhoon is a multi-role combat aircraft operated by the RAF.',
      'The Typhoon entered service in 2003 at RAF Coningsby.',
    ],
    keywords: [
      { keyword: 'Typhoon', generatedDescription: 'Multi-role fast jet' },
      { keyword: 'RAF Coningsby', generatedDescription: 'RAF base in Lincolnshire' },
    ],
    sources: [{ url: 'https://raf.mod.uk', siteName: 'RAF', articleDate: '2024-01-01' }],
  });

  it('generates brief object from a headline', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(MOCK_BRIEF_JSON));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed to Falkland Islands' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.brief.title).toBe('RAF Typhoon');
    expect(Array.isArray(res.body.data.brief.descriptionSections)).toBe(true);
    expect(Array.isArray(res.body.data.brief.keywords)).toBe(true);
  });

  it('generates brief object from a topic', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(MOCK_BRIEF_JSON));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ topic: 'Eurofighter Typhoon' });

    expect(res.status).toBe(200);
    // Route locks title to the provided topic value, overriding AI output
    expect(res.body.data.brief.title).toBe('Eurofighter Typhoon');
  });

  it('returns 400 when neither headline nor topic is provided', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/headline or topic/i);
  });


  it('returns 500 with message when AI returns malformed JSON', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter('This is not JSON at all!!!'));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ topic: 'something' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/not valid json/i);
  });

  it('injects lead grounding (subtitle + nickname) into the topic prompt when a matching lead exists', async () => {
    const capturedBodies = [];
    jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (!String(url).includes('openrouter.ai')) return mockFetchResponse({});
      const bodyStr = typeof opts?.body === 'string' ? opts.body : JSON.stringify(opts?.body ?? '');
      capturedBodies.push(bodyStr);
      return mockOpenRouter(MOCK_BRIEF_JSON);
    });

    await createLead({
      title:    'Operation AZALEA',
      category: 'Missions',
      subtitle: 'RAF standing air defence patrol of the Falkland Islands',
      nickname: 'AZALEA',
    });

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ topic: 'Operation AZALEA', category: 'Missions' });

    expect(res.status).toBe(200);
    const body = capturedBodies.find(b => b.includes('Operation AZALEA')) ?? '';
    expect(body).toContain('Authoritative context');
    expect(body).toContain('RAF standing air defence patrol of the Falkland Islands');
    expect(body).toContain('Also known as');
    expect(body).toContain('AZALEA');
  });

  it('omits grounding block when no matching lead exists', async () => {
    const capturedBodies = [];
    jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (!String(url).includes('openrouter.ai')) return mockFetchResponse({});
      const bodyStr = typeof opts?.body === 'string' ? opts.body : JSON.stringify(opts?.body ?? '');
      capturedBodies.push(bodyStr);
      return mockOpenRouter(MOCK_BRIEF_JSON);
    });

    const admin = await createAdminUser();
    await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ topic: 'Some Unmatched Topic', category: 'Missions' });

    const body = capturedBodies.find(b => b.includes('Some Unmatched Topic')) ?? '';
    expect(body).not.toContain('Authoritative context');
  });

  it('sets staleSourceWarning: true for a news headline with a source older than 24 hours', async () => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const staleJson = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [{ url: 'https://raf.mod.uk', siteName: 'RAF', articleDate: staleDate }],
    });
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(staleJson));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed overseas' });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.staleSourceWarning).toBe(true);
  });

  it('sets staleSourceWarning: false for a news headline with all sources within 24 hours', async () => {
    const freshDate = new Date().toISOString().slice(0, 10);
    const freshJson = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [{ url: 'https://raf.mod.uk', siteName: 'RAF', articleDate: freshDate }],
    });
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(freshJson));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed overseas' });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.staleSourceWarning).toBe(false);
  });

  it('sets staleSourceWarning: true for a news headline when articleDate is missing', async () => {
    const noDateJson = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [{ url: 'https://raf.mod.uk', siteName: 'RAF' }],
    });
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(noDateJson));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed overseas' });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.staleSourceWarning).toBe(true);
  });

  it('does not set staleSourceWarning for a topic brief (non-news)', async () => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const staleJson = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [{ url: 'https://raf.mod.uk', siteName: 'RAF', articleDate: staleDate }],
    });
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(staleJson));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ topic: 'Eurofighter Typhoon' });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.staleSourceWarning).toBe(false);
  });

  it('drops sources older than the supplied eventDate but keeps fresh ones', async () => {
    const eventDate = '2026-04-20';
    const json = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [
        { url: 'https://old.example.com',   siteName: 'Old',   articleDate: '2024-06-15' },
        { url: 'https://fresh.example.com', siteName: 'Fresh', articleDate: '2026-04-22' },
      ],
    });
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(json));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed overseas', eventDate });

    expect(res.status).toBe(200);
    expect(res.body.data.brief.sources).toHaveLength(1);
    expect(res.body.data.brief.sources[0].url).toBe('https://fresh.example.com');
  });

  it('returns 422 when no sources survive the eventDate floor', async () => {
    const eventDate = '2026-04-20';
    const json = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [{ url: 'https://old.example.com', siteName: 'Old', articleDate: '2024-06-15' }],
    });
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(json));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed overseas', eventDate });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/2026-04-20/);
  });

  it('passes search_after_date_filter to Perplexity when eventDate is supplied', async () => {
    const eventDate = '2026-04-20';
    const json = JSON.stringify({
      title: 'RAF Typhoon', subtitle: 'Multi-role fast jet',
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
      keywords: [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
      sources: [{ url: 'https://fresh.example.com', siteName: 'Fresh', articleDate: '2026-04-22' }],
    });
    let capturedBody = '';
    jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (String(url).includes('openrouter.ai')) {
        capturedBody = String(opts?.body ?? '');
        return mockOpenRouter(json);
      }
      return mockFetchResponse({});
    });

    const admin = await createAdminUser();
    await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(admin._id))
      .send({ headline: 'RAF Typhoons deployed overseas', eventDate });

    expect(capturedBody).toContain('search_after_date_filter');
    expect(capturedBody).toContain('04/20/2026');
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/admin/ai/generate-brief')
      .send({ topic: 'Typhoon' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .post('/api/admin/ai/generate-brief')
      .set('Cookie', authCookie(user._id))
      .send({ topic: 'Typhoon' });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/ai/generate-keywords ──────────────────────────────────────

describe('POST /api/admin/ai/generate-keywords', () => {
  const DESCRIPTION = 'The Typhoon is a multi-role combat aircraft. It operates from RAF Coningsby and RAF Lossiemouth.';

  it('returns keywords array for a valid description', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouter(JSON.stringify({
        keywords: [
          { keyword: 'Typhoon', generatedDescription: 'A fast jet' },
          { keyword: 'RAF Coningsby', generatedDescription: 'A base' },
        ],
      }))
    );

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-keywords')
      .set('Cookie', authCookie(admin._id))
      .send({ description: DESCRIPTION, needed: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.keywords)).toBe(true);
  });

  it('returns 400 when description is missing', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-keywords')
      .set('Cookie', authCookie(admin._id))
      .send({ needed: 5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/description/i);
  });

  it('filters out keywords not present verbatim in description', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouter(JSON.stringify({
        keywords: [
          { keyword: 'Typhoon', generatedDescription: 'A fast jet' },
          { keyword: 'invisible ghost word', generatedDescription: 'Not in text' },
        ],
      }))
    );

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-keywords')
      .set('Cookie', authCookie(admin._id))
      .send({ description: DESCRIPTION });

    expect(res.status).toBe(200);
    const kws = res.body.data.keywords;
    expect(kws.some(k => k.keyword === 'Typhoon')).toBe(true);
    expect(kws.some(k => k.keyword === 'invisible ghost word')).toBe(false);
  });

  it('does not repeat existingKeywords', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(
      mockOpenRouter(JSON.stringify({
        keywords: [
          { keyword: 'Typhoon', generatedDescription: 'A fast jet' },
          { keyword: 'RAF Coningsby', generatedDescription: 'A base' },
        ],
      }))
    );

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-keywords')
      .set('Cookie', authCookie(admin._id))
      .send({ description: DESCRIPTION, existingKeywords: ['Typhoon'], needed: 2 });

    expect(res.status).toBe(200);
    const kws = res.body.data.keywords;
    expect(kws.some(k => k.keyword.toLowerCase() === 'typhoon')).toBe(false);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/admin/ai/generate-keywords')
      .send({ description: DESCRIPTION });
    expect(res.status).toBe(401);
  });
});

// ── POST /api/admin/ai/generate-quiz ──────────────────────────────────────────

describe('POST /api/admin/ai/generate-quiz', () => {
  function makeQ(i) {
    return {
      question: `Question ${i}?`,
      answers: Array.from({ length: 10 }, (_, j) => ({ title: `Answer ${j}` })),
      correctAnswerIndex: 0,
    };
  }

  const MOCK_QUIZ = JSON.stringify({
    easyQuestions:   Array.from({ length: 10 }, (_, i) => makeQ(i)),
    mediumQuestions: Array.from({ length: 10 }, (_, i) => makeQ(i + 10)),
  });

  it('returns easyQuestions and mediumQuestions arrays', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter(MOCK_QUIZ));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-quiz')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Typhoon', description: 'The Typhoon is a fast jet.' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.easyQuestions)).toBe(true);
    expect(Array.isArray(res.body.data.mediumQuestions)).toBe(true);
    expect(res.body.data.easyQuestions.length).toBe(10);
  });

  it('returns 400 when neither title nor description is provided', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-quiz')
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title or description/i);
  });

  it('handles malformed AI JSON gracefully — returns 500 with message', async () => {
    jest.spyOn(global, 'fetch').mockReturnValueOnce(mockOpenRouter('not json at all!!!'));

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-quiz')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Typhoon', description: 'A fast jet.' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/not valid json/i);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/admin/ai/generate-quiz')
      .send({ title: 'Typhoon', description: 'A fast jet.' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const user = await createUser();
    const res  = await request(app)
      .post('/api/admin/ai/generate-quiz')
      .set('Cookie', authCookie(user._id))
      .send({ title: 'Typhoon', description: 'A fast jet.' });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/ai/generate-image ─────────────────────────────────────────

describe('POST /api/admin/ai/generate-image', () => {
  // generate-image makes multiple fetch calls:
  //   1. OpenRouter (GPT-4o-mini) → returns search terms array
  //   2. Wikipedia search API    → returns page title
  //   3. Wikipedia thumbnail API → returns image URL
  //   4. Image download          → returns image buffer

  function setupImageMocks() {
    const mockFetch = jest.spyOn(global, 'fetch');

    // Call 1: OpenRouter → search terms
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["Eurofighter Typhoon"]' } }],
      }),
    });

    // Call 2: Wikipedia search
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        query: { search: [{ title: 'Eurofighter Typhoon' }] },
      }),
    });

    // Call 3: Wikipedia thumbnail
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        query: { pages: { '123': { thumbnail: { source: 'https://upload.wikimedia.org/test.jpg' } } } },
      }),
    });

    // Call 4: Image download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('fake-image-data').buffer),
    });

    return mockFetch;
  }

  it('returns images array with url, term, wikiPage', async () => {
    setupImageMocks();

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-image')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'RAF Typhoon', subtitle: 'Multi-role fast jet' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.images)).toBe(true);
    expect(res.body.data.images.length).toBeGreaterThan(0);
    expect(res.body.data.images[0]).toHaveProperty('url');
    expect(res.body.data.images[0]).toHaveProperty('term');
    expect(res.body.data.images[0]).toHaveProperty('wikiPage');
  });

  it('returns 400 when title is missing', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-image')
      .set('Cookie', authCookie(admin._id))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title/i);
  });

  it('returns 500 with message when no Wikipedia images are found', async () => {
    const mockFetch = jest.spyOn(global, 'fetch');

    // OpenRouter → search terms
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["Nonexistent Subject XYZ"]' } }],
      }),
    });

    // Wikipedia search → no results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ query: { search: [] } }),
    });

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-image')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Nonexistent Subject XYZ' });

    expect(res.status).toBe(500);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/admin/ai/generate-image')
      .send({ title: 'Typhoon' });
    expect(res.status).toBe(401);
  });

  it('reuses an existing Media doc when the AI search term matches a previous one', async () => {
    const Media = require('../../models/Media');
    const { uploadBuffer } = require('../../utils/cloudinary');
    uploadBuffer.mockClear();

    // Seed: a Media doc that was previously generated for "Eurofighter Typhoon"
    const existing = await Media.create({
      mediaType: 'picture',
      mediaUrl: 'https://res.cloudinary.com/test/image/upload/existing.jpg',
      cloudinaryPublicId: 'brief-images/existing',
      name: 'Eurofighter Typhoon',
      searchTerm: 'Eurofighter Typhoon',
      wikiPageTitle: 'Eurofighter Typhoon',
    });

    const mockFetch = jest.spyOn(global, 'fetch');
    // Only the OpenRouter call should happen — Wikipedia + download must NOT
    // fire because the DB lookup short-circuits on the normalized search term.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["eurofighter typhoon"]' } }],
      }),
    });

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-image')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'RAF Typhoon' });

    expect(res.status).toBe(200);
    expect(res.body.data.images).toHaveLength(1);
    expect(String(res.body.data.images[0].mediaId)).toBe(String(existing._id));
    expect(res.body.data.images[0].url).toBe(existing.mediaUrl);

    // No new Cloudinary upload and no extra Media doc should have been created
    expect(uploadBuffer).not.toHaveBeenCalled();
    const mediaCount = await Media.countDocuments({});
    expect(mediaCount).toBe(1);

    // Only the OpenRouter call — Wikipedia fetches were skipped entirely
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing Media doc when the resolved Wikipedia page matches a previous one', async () => {
    const Media = require('../../models/Media');
    const { uploadBuffer } = require('../../utils/cloudinary');
    uploadBuffer.mockClear();

    // Seed: previously saved under the canonical wiki page title only. A new
    // request whose AI term is different but resolves to the same page should
    // still reuse this record.
    const existing = await Media.create({
      mediaType: 'picture',
      mediaUrl: 'https://res.cloudinary.com/test/image/upload/existing.jpg',
      cloudinaryPublicId: 'brief-images/existing',
      name: 'Eurofighter Typhoon',
      searchTerm: 'some earlier term',
      wikiPageTitle: 'Eurofighter Typhoon',
    });

    const mockFetch = jest.spyOn(global, 'fetch');
    // 1. OpenRouter → returns a different-wording search term
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["RAF Typhoon fighter"]' } }],
      }),
    });
    // 2. Wikipedia search → resolves to the canonical page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        query: { search: [{ title: 'Eurofighter Typhoon' }] },
      }),
    });
    // (No thumbnail or download calls — helper should short-circuit after
    // the DB lookup on the resolved page title)

    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-image')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Typhoon' });

    expect(res.status).toBe(200);
    expect(String(res.body.data.images[0].mediaId)).toBe(String(existing._id));
    expect(uploadBuffer).not.toHaveBeenCalled();
    const mediaCount = await Media.countDocuments({});
    expect(mediaCount).toBe(1);
  });
});

// ── POST /api/admin/ai/regenerate-brief/:id ────────────────────────────────────

describe('POST /api/admin/ai/regenerate-brief/:id', () => {
  function makeQ(i) {
    return {
      question: `Question ${i}?`,
      answers: Array.from({ length: 10 }, (_, j) => ({ title: `Answer option ${j} for question ${i}` })),
      correctAnswerIndex: 0,
    };
  }

  const MOCK_BRIEF_JSON = JSON.stringify({
    descriptionSections: [
      'The Typhoon is a multi-role combat aircraft operated by the RAF.',
      'The Typhoon is based at RAF Coningsby in Lincolnshire.',
    ],
    keywords: [
      { keyword: 'Typhoon', generatedDescription: 'Multi-role fast jet' },
      { keyword: 'RAF Coningsby', generatedDescription: 'RAF base in Lincolnshire' },
    ],
  });

  const MOCK_QUIZ_JSON = JSON.stringify({
    easyQuestions:   Array.from({ length: 10 }, (_, i) => makeQ(i)),
    mediumQuestions: Array.from({ length: 10 }, (_, i) => makeQ(i + 10)),
  });

  it('returns descriptionSections, keywords, easyQuestions, mediumQuestions on success', async () => {
    installAiFetchMock({ brief: MOCK_BRIEF_JSON, quiz: MOCK_QUIZ_JSON });

    const brief = await createBrief({ title: 'Eurofighter Typhoon', category: 'Aircrafts' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.descriptionSections)).toBe(true);
    expect(res.body.data.descriptionSections.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.keywords)).toBe(true);
    expect(Array.isArray(res.body.data.easyQuestions)).toBe(true);
    expect(Array.isArray(res.body.data.mediumQuestions)).toBe(true);
    expect(res.body.data.easyQuestions.length).toBe(10);
    expect(res.body.data.mediumQuestions.length).toBe(10);
  });

  it('returns 404 when brief does not exist', async () => {
    const { Types } = require('mongoose');
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${new Types.ObjectId()}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/brief not found/i);
  });

  it('injects lead grounding into the regenerate prompt when a matching lead exists', async () => {
    const capturedBodies = [];
    jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (!String(url).includes('openrouter.ai')) return mockFetchResponse({});
      const bodyStr = typeof opts?.body === 'string' ? opts.body : JSON.stringify(opts?.body ?? '');
      capturedBodies.push(bodyStr);
      if (bodyStr.includes('easyQuestions') && bodyStr.includes('mediumQuestions')) return mockOpenRouter(MOCK_QUIZ_JSON);
      if (bodyStr.includes('descriptionSections')) return mockOpenRouter(MOCK_BRIEF_JSON);
      return mockOpenRouter('{}');
    });

    await createLead({
      title:    'Operation PELEGRI',
      category: 'Missions',
      subtitle: 'Ongoing RAF maintenance of air superiority in the Falkland Islands from RAF Mount Pleasant',
    });
    const brief = await createBrief({ title: 'Operation PELEGRI', category: 'Missions' });

    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const body = capturedBodies.find(b => b.includes('Rewrite a comprehensive intelligence brief') && b.includes('Operation PELEGRI')) ?? '';
    expect(body).toContain('Authoritative context');
    expect(body).toContain('Falkland Islands');
    expect(body).toContain('RAF Mount Pleasant');
  });

  it('omits grounding block on regenerate when no matching lead exists', async () => {
    const capturedBodies = [];
    jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (!String(url).includes('openrouter.ai')) return mockFetchResponse({});
      const bodyStr = typeof opts?.body === 'string' ? opts.body : JSON.stringify(opts?.body ?? '');
      capturedBodies.push(bodyStr);
      if (bodyStr.includes('easyQuestions') && bodyStr.includes('mediumQuestions')) return mockOpenRouter(MOCK_QUIZ_JSON);
      if (bodyStr.includes('descriptionSections')) return mockOpenRouter(MOCK_BRIEF_JSON);
      return mockOpenRouter('{}');
    });

    const brief = await createBrief({ title: 'No Lead For This Brief', category: 'Aircrafts' });
    const admin = await createAdminUser();
    await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    const body = capturedBodies.find(b => b.includes('Rewrite a comprehensive intelligence brief') && b.includes('No Lead For This Brief')) ?? '';
    expect(body).not.toContain('Authoritative context');
  });

  it('returns 500 with message when brief-generation AI returns malformed JSON', async () => {
    // Dispatcher matches the brief prompt by descriptionSections and returns bad JSON.
    jest.spyOn(global, 'fetch').mockImplementation(() => mockOpenRouter('not json at all!!!'));

    const brief = await createBrief({ title: 'Test Brief' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/not valid json/i);
  });

  it('returns 500 with message when quiz-generation AI returns malformed JSON', async () => {
    installAiFetchMock({ brief: MOCK_BRIEF_JSON, quiz: 'not json!!!' });

    const brief = await createBrief({ title: 'Test Brief' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/not valid json/i);
  });

  it('strips keywords not present verbatim in the fresh descriptionSections', async () => {
    // Keywords are now produced by separate multi-pass calls, so we return them
    // from the keyword-pass mock. The route must still strip any keyword that
    // doesn't appear verbatim in the fresh descriptionSections.
    const briefJson = JSON.stringify({
      descriptionSections: ['The Typhoon is operated at RAF Coningsby.'],
    });
    const keywordsJson = JSON.stringify({
      keywords: [
        { keyword: 'Typhoon', generatedDescription: 'A fast jet' },
        { keyword: 'completely absent phrase xyz', generatedDescription: 'Should be stripped' },
      ],
    });

    installAiFetchMock({ brief: briefJson, keywords: keywordsJson, quiz: MOCK_QUIZ_JSON });

    const brief = await createBrief({ title: 'Test Brief' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const kws = res.body.data.keywords;
    expect(kws.some(k => k.keyword === 'Typhoon')).toBe(true);
    expect(kws.some(k => k.keyword === 'completely absent phrase xyz')).toBe(false);
  });

  it('returns 401 for unauthenticated request', async () => {
    const brief = await createBrief();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-brief/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/ai/regenerate-description/:id ──────────────────────────

describe('POST /api/admin/ai/regenerate-description/:id', () => {
  const MOCK_DESC_JSON = JSON.stringify({
    descriptionSections: [
      { heading: 'Role and Structure', body: 'The Typhoon is a multi-role combat aircraft operated by the RAF.' },
      { heading: 'Operating Base',     body: 'It is based primarily at RAF Coningsby in Lincolnshire.' },
    ],
  });

  const REASON = 'Test regeneration';

  it('returns descriptionSections array on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter(MOCK_DESC_JSON));

    const brief = await createBrief({ title: 'Eurofighter Typhoon' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.descriptionSections)).toBe(true);
    expect(res.body.data.descriptionSections.length).toBeGreaterThan(0);
    expect(res.body.data.descriptionSections[0].body).toContain('Typhoon');
    expect(res.body.data.descriptionSections[0].heading).toBe('Role and Structure');
  });

  it('returns cascade stats alongside descriptionSections', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter(MOCK_DESC_JSON));

    const brief = await createBrief({ title: 'Eurofighter Typhoon' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.data.cascade).toBeDefined();
    expect(typeof res.body.data.cascade.coinsReversed).toBe('number');
    expect(typeof res.body.data.cascade.briefReadsMarked).toBe('number');
  });

  it('response does NOT include keywords, easyQuestions, or mediumQuestions', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter(MOCK_DESC_JSON));

    const brief = await createBrief({ title: 'Eurofighter Typhoon' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.data.keywords).toBeUndefined();
    expect(res.body.data.easyQuestions).toBeUndefined();
    expect(res.body.data.mediumQuestions).toBeUndefined();
  });

  it('returns sources when the AI provides them (fresh citations for the new description)', async () => {
    const descWithSources = JSON.stringify({
      descriptionSections: [
        { heading: 'Role', body: 'Typhoon body.' },
        { heading: 'Base', body: 'RAF Coningsby.' },
      ],
      sources: [
        { url: 'https://www.raf.mod.uk/typhoon', siteName: 'RAF', articleDate: '2024-05-01' },
        { url: 'https://en.wikipedia.org/wiki/Eurofighter_Typhoon', siteName: 'Wikipedia', articleDate: '2024-06-15' },
      ],
    });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter(descWithSources));

    const brief = await createBrief({ title: 'Eurofighter Typhoon' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.sources)).toBe(true);
    expect(res.body.data.sources.length).toBe(2);
    expect(res.body.data.sources[0].url).toContain('raf.mod.uk');
  });

  it('returns an empty sources array when the AI omits them (reset behaviour)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter(MOCK_DESC_JSON));

    const brief = await createBrief({ title: 'Eurofighter Typhoon' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.sources)).toBe(true);
    expect(res.body.data.sources.length).toBe(0);
  });

  it('returns 400 when reason is missing', async () => {
    const brief = await createBrief();
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
  });

  it('returns 404 when brief does not exist', async () => {
    const { Types } = require('mongoose');
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${new Types.ObjectId()}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/brief not found/i);
  });

  it('returns 500 with message when AI returns malformed JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter('not json at all!!!'));

    const brief = await createBrief({ title: 'Test Brief' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: REASON });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/not valid json/i);
  });

  it('returns 401 for unauthenticated request', async () => {
    const brief = await createBrief();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .send({ reason: REASON });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const brief = await createBrief();
    const user  = await createUser();
    const res   = await request(app)
      .post(`/api/admin/ai/regenerate-description/${brief._id}`)
      .set('Cookie', authCookie(user._id))
      .send({ reason: REASON });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/ai/generate-rank-data/:id ─────────────────────────────────

describe('POST /api/admin/ai/generate-rank-data/:id — auth guards', () => {
  it('returns 401 for unauthenticated request', async () => {
    const brief = await createBrief({ category: 'Ranks', title: 'Sergeant' });
    const res   = await request(app).post(`/api/admin/ai/generate-rank-data/${brief._id}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const brief = await createBrief({ category: 'Ranks', title: 'Sergeant' });
    const user  = await createUser();
    const res   = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown brief id', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .post('/api/admin/ai/generate-rank-data/000000000000000000000000')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/ai/generate-rank-data/:id — category guard', () => {
  it('returns 400 for a non-Ranks brief', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'Aircrafts', title: 'Typhoon' });
    const res   = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a ranks category/i);
  });
});

describe('POST /api/admin/ai/generate-rank-data/:id — hierarchy lookup', () => {
  const cases = [
    { title: 'Marshal of the Royal Air Force', expected: 1  },
    { title: 'Air Chief Marshal',              expected: 2  },
    { title: 'Air Marshal',                    expected: 3  },
    { title: 'Air Vice-Marshal',               expected: 4  },
    { title: 'Air Commodore',                  expected: 5  },
    { title: 'Group Captain',                  expected: 6  },
    { title: 'Wing Commander',                 expected: 7  },
    { title: 'Squadron Leader',                expected: 8  },
    { title: 'Flight Lieutenant',              expected: 9  },
    { title: 'Flying Officer',                 expected: 10 },
    { title: 'Pilot Officer',                  expected: 11 },
    { title: 'Warrant Officer (RAF)',           expected: 12 },
    { title: 'Master Aircrew',                 expected: 13 },
    { title: 'Flight Sergeant',                expected: 14 },
    { title: 'Chief Technician',               expected: 15 },
    { title: 'Sergeant (RAF)',                  expected: 16 },
    { title: 'Corporal (RAF)',                  expected: 17 },
    { title: 'Junior Technician',              expected: 18 },
    { title: 'Senior Aircraftman / Senior Aircraftwoman', expected: 19 },
    { title: 'Leading Aircraftman / Leading Aircraftwoman', expected: 20 },
    { title: 'Aircraftman / Aircraftwoman',    expected: 21 },
  ];

  test.each(cases)('$title → #$expected', async ({ title, expected }) => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'Ranks', title });
    const res   = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.rankHierarchyOrder).toBe(expected);
  });

  it('returns 422 when title does not match any known rank', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'Ranks', title: 'Unknown Custom Rank' });
    const res   = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/could not determine rank order/i);
  });

  it('Air Vice-Marshal resolves to #4, not confused with Air Marshal (#3)', async () => {
    const admin = await createAdminUser();
    const brief = await createBrief({ category: 'Ranks', title: 'Air Vice-Marshal' });
    const res   = await request(app)
      .post(`/api/admin/ai/generate-rank-data/${brief._id}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.body.data.rankHierarchyOrder).toBe(4);
  });
});

// ── POST /api/admin/ai/bulk-generate-stub/:id ─────────────────────────────────

describe('POST /api/admin/ai/bulk-generate-stub/:id', () => {
  it('returns 404 when brief does not exist', async () => {
    const { Types } = require('mongoose');
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/bulk-generate-stub/${new Types.ObjectId()}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/brief not found/i);
  });

  it('returns 400 when brief is not a stub', async () => {
    const brief = await createBrief({ title: 'Not a stub', status: 'published' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/bulk-generate-stub/${brief._id}`)
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a stub/i);
  });

  // Regression: the catch block used to reference `brief` declared inside the try block,
  // which threw ReferenceError and crashed the Node process on unhandled rejection.
  // The handler must now return a clean 500 JSON response instead.
  it('returns 500 JSON (not a ReferenceError crash) when AI pipeline throws', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockOpenRouter('not json at all!!!'));

    const brief = await createBrief({ title: 'Test Stub', status: 'stub' });
    const admin = await createAdminUser();
    const res   = await request(app)
      .post(`/api/admin/ai/bulk-generate-stub/${brief._id}`)
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(500);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.message).not.toMatch(/brief is not defined/i);
  });

  it('returns 401 for unauthenticated request', async () => {
    const brief = await createBrief({ status: 'stub' });
    const res   = await request(app)
      .post(`/api/admin/ai/bulk-generate-stub/${brief._id}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const brief = await createBrief({ status: 'stub' });
    const user  = await createUser();
    const res   = await request(app)
      .post(`/api/admin/ai/bulk-generate-stub/${brief._id}`)
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

// ── POST /api/admin/ai/generate-links ─────────────────────────────────────────

describe('POST /api/admin/ai/generate-links', () => {
  it('supports Roles:bases (role brief → associated base briefs)', async () => {
    const admin = await createAdminUser();
    const base1 = await createBrief({ title: 'RAF Cranwell', category: 'Bases', subcategory: 'UK Active' });
    const base2 = await createBrief({ title: 'RAF Halton',   category: 'Bases', subcategory: 'UK Active' });

    jest.spyOn(global, 'fetch').mockImplementation(() =>
      mockOpenRouter(JSON.stringify({ titles: ['RAF Cranwell'] }))
    );

    const res = await request(app)
      .post('/api/admin/ai/generate-links')
      .set('Cookie', authCookie(admin._id))
      .send({
        sourceTitle: 'Officer',
        sourceDescription: 'Officers begin training at RAF Cranwell.',
        sourceCategory: 'Roles',
        linkType: 'bases',
        pool: [
          { _id: base1._id, title: base1.title },
          { _id: base2._id, title: base2.title },
        ],
        isHistoric: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.ids).toEqual([String(base1._id)]);
  });

  it('supports Training:squadrons (training brief → delivering squadron briefs)', async () => {
    const admin = await createAdminUser();
    const sqn1  = await createBrief({ title: 'IV(R) Squadron RAF', category: 'Squadrons', subcategory: 'Training' });
    const sqn2  = await createBrief({ title: 'No. 41 Squadron RAF', category: 'Squadrons', subcategory: 'Active Front-Line' });

    jest.spyOn(global, 'fetch').mockImplementation(() =>
      mockOpenRouter(JSON.stringify({ titles: ['IV(R) Squadron RAF'] }))
    );

    const res = await request(app)
      .post('/api/admin/ai/generate-links')
      .set('Cookie', authCookie(admin._id))
      .send({
        sourceTitle: 'Advanced Fast Jet Training',
        sourceDescription: 'AFJT is delivered at RAF Valley by IV(R) Squadron.',
        sourceCategory: 'Training',
        linkType: 'squadrons',
        pool: [
          { _id: sqn1._id, title: sqn1.title },
          { _id: sqn2._id, title: sqn2.title },
        ],
        isHistoric: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.ids).toEqual([String(sqn1._id)]);
  });

  it('supports Aircrafts:tech (aircraft brief → carried tech briefs)', async () => {
    const admin = await createAdminUser();
    const tech1 = await createBrief({ title: 'Meteor BVRAAM',   category: 'Tech', subcategory: 'Weapons Systems' });
    const tech2 = await createBrief({ title: 'Storm Shadow',    category: 'Tech', subcategory: 'Weapons Systems' });
    const tech3 = await createBrief({ title: 'AGM-65 Maverick', category: 'Tech', subcategory: 'Weapons Systems' });

    jest.spyOn(global, 'fetch').mockImplementation(() =>
      mockOpenRouter(JSON.stringify({ titles: ['Meteor BVRAAM', 'Storm Shadow'] }))
    );

    const res = await request(app)
      .post('/api/admin/ai/generate-links')
      .set('Cookie', authCookie(admin._id))
      .send({
        sourceTitle: 'Eurofighter Typhoon',
        sourceDescription: 'Typhoon carries Meteor BVRAAM and Storm Shadow cruise missiles.',
        sourceCategory: 'Aircrafts',
        linkType: 'tech',
        pool: [
          { _id: tech1._id, title: tech1.title },
          { _id: tech2._id, title: tech2.title },
          { _id: tech3._id, title: tech3.title },
        ],
        isHistoric: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.ids).toEqual([String(tech1._id), String(tech2._id)]);
  });
});
