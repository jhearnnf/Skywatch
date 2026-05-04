/**
 * Integration tests for /api/admin/social/* endpoints.
 * OpenRouter, X API, and GitHub API are all mocked via global.fetch.
 */
const crypto = require('crypto');
process.env.JWT_SECRET        = 'test_secret';
process.env.OPENROUTER_KEY    = 'test_main_key';
process.env.OPENROUTER_KEY_SOCIALS = 'test_socials_key';
process.env.SOCIAL_TOKEN_KEY  = crypto.randomBytes(32).toString('base64');
process.env.X_CLIENT_ID       = 'cid';
process.env.X_CLIENT_SECRET   = 'csec';
process.env.X_REDIRECT_URI    = 'http://localhost:5000/api/admin/social/x/callback';
process.env.GITHUB_REPO       = 'jhearnnf/Skywatch';
process.env.GITHUB_TOKEN      = 'ghp_test';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createUser, createAdminUser, createSettings, authCookie, createBrief,
} = require('../helpers/factories');
const SocialAccount = require('../../models/SocialAccount');
const SocialPost    = require('../../models/SocialPost');
const { encrypt }   = require('../../utils/socialEncryption');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});
afterAll(() => {});

function jsonResp(body, ok = true, status = 200) {
  return Promise.resolve({
    ok, status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    headers: { get: () => 'application/json' },
  });
}

// ─── auth guards ─────────────────────────────────────────────────────────────

describe('Social routes — auth guards', () => {
  it('401s a guest', async () => {
    const res = await request(app).get('/api/admin/social/x/status');
    expect(res.status).toBe(401);
  });

  it('403s a non-admin', async () => {
    const u = await createUser();
    const res = await request(app)
      .get('/api/admin/social/x/status')
      .set('Cookie', authCookie(u._id));
    expect(res.status).toBe(403);
  });
});

// ─── /x/status ───────────────────────────────────────────────────────────────

describe('GET /x/status', () => {
  it('returns connected:false when no account exists', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/social/x/status')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: false, configured: true });
  });

  it('reports missing config keys', async () => {
    const a = await createAdminUser();
    const saved = process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_ID;
    const res = await request(app)
      .get('/api/admin/social/x/status')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.missing).toContain('X_CLIENT_ID');
    process.env.X_CLIENT_ID = saved;
  });

  it('reflects a connected account', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x',
      username: 'skywatch_uk',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    const res = await request(app)
      .get('/api/admin/social/x/status')
      .set('Cookie', authCookie(a._id));
    expect(res.body.connected).toBe(true);
    expect(res.body.username).toBe('skywatch_uk');
  });
});

// ─── /x/connect ──────────────────────────────────────────────────────────────

describe('GET /x/connect', () => {
  it('returns an authorizeUrl and sets the state cookie', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/social/x/connect')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(res.body.authorizeUrl).toMatch(/^https:\/\/x\.com\/i\/oauth2\/authorize\?/);
    const setCookieHeaders = res.headers['set-cookie'] || [];
    expect(setCookieHeaders.some(c => c.startsWith('x_oauth_state='))).toBe(true);
  });

  it('503s when X is not configured', async () => {
    const a = await createAdminUser();
    const saved = process.env.X_CLIENT_SECRET;
    delete process.env.X_CLIENT_SECRET;
    const res = await request(app)
      .get('/api/admin/social/x/connect')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(503);
    process.env.X_CLIENT_SECRET = saved;
  });
});

// ─── /briefs-for-recon + /latest-news-brief ─────────────────────────────────

describe('GET /briefs-for-recon', () => {
  it('returns published briefs', async () => {
    const a = await createAdminUser();
    await createBrief({ title: 'Published B1', status: 'published' });
    await createBrief({ title: 'Stub B2',      status: 'stub' });
    const res = await request(app)
      .get('/api/admin/social/briefs-for-recon')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    const titles = res.body.data.map(b => b.title);
    expect(titles).toContain('Published B1');
    expect(titles).not.toContain('Stub B2');
  });
});

describe('GET /latest-news-brief', () => {
  it('returns today\'s News brief with isFreshToday=true', async () => {
    const a = await createAdminUser();
    await createBrief({ title: 'Today News', category: 'News', status: 'published' });
    const res = await request(app)
      .get('/api/admin/social/latest-news-brief')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Today News');
    expect(res.body.data.isFreshToday).toBe(true);
  });

  it('returns null when no News brief exists', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .get('/api/admin/social/latest-news-brief')
      .set('Cookie', authCookie(a._id));
    expect(res.body.data).toBeNull();
  });
});

// ─── /x/draft ────────────────────────────────────────────────────────────────

describe('POST /x/draft', () => {
  it('rejects invalid postType', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'wat', tone: 7 });
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range tone', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 99 });
    expect(res.status).toBe(400);
  });

  it('requires briefId for daily-recon', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'daily-recon', tone: 7 });
    expect(res.status).toBe(400);
  });

  it('requires briefId for daily-recon-info', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'daily-recon-info', tone: 7 });
    expect(res.status).toBe(400);
  });

  it('generates a daily-recon-info draft — no poll, plain text with CTA (mocked OpenRouter)', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Typhoon', category: 'Aircrafts' });
    jest.spyOn(global, 'fetch').mockImplementation(() => jsonResp({
      choices: [{ message: { content: 'The Typhoon can supercruise.' } }],
      usage: { cost: 0.001 },
    }));
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'daily-recon-info', tone: 7, briefId: String(brief._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.poll).toBeNull();
    expect(res.body.data.text).toContain('Typhoon');
    expect(res.body.data.text).toContain('Read the full brief:');
    expect(res.body.data.briefName).toBe('Typhoon');
    expect(res.body.data.suggestedImageUrl).toBeNull(); // brief has no media in this test
  });

  it('generates a latest-intel draft (mocked OpenRouter)', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Today News', category: 'News' });
    jest.spyOn(global, 'fetch').mockImplementation(() => jsonResp({
      choices: [{ message: { content: 'Latest intel: a thing happened.' } }],
      usage: { cost: 0.001 },
      model: 'anthropic/claude-haiku-4-5',
    }));
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, briefId: String(brief._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.text).toContain('intel');
    expect(res.body.data.briefName).toBe('Today News');
    expect(res.body.data.poll).toBeNull();
  });

  it('routes the OpenRouter call through the socials key, not the main key', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Today News', category: 'News' });
    let seenAuth = null;
    let seenTitle = null;
    let seenLoggedKey = null;
    jest.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
      seenAuth  = opts?.headers?.Authorization || null;
      seenTitle = opts?.headers?.['X-Title'] || null;
      return jsonResp({
        choices: [{ message: { content: 'Latest intel: hi.' } }],
        usage: { cost: 0.001 },
      });
    });
    const OpenRouterUsageLog = require('../../models/OpenRouterUsageLog');
    const { _flushPendingLogWrites } = require('../../utils/openRouter');

    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, briefId: String(brief._id) });

    expect(res.status).toBe(200);
    expect(seenAuth).toBe('Bearer test_socials_key');
    expect(seenTitle).toBe('SkyWatch Socials');

    await _flushPendingLogWrites();
    const logs = await OpenRouterUsageLog.find().lean();
    seenLoggedKey = logs[0]?.key;
    expect(seenLoggedKey).toBe('socials');
  });

  it('generates a daily-recon draft with poll (mocked OpenRouter)', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Typhoon', category: 'Aircrafts' });
    jest.spyOn(global, 'fetch').mockImplementation(() => jsonResp({
      choices: [{
        message: {
          content: JSON.stringify({
            text: 'Typhoon — gen?',
            pollOptions: ['4', '4.5', '5', '6'],
            correctIndex: 1,
          }),
        },
      }],
      usage: { cost: 0.001 },
    }));
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'daily-recon', tone: 7, briefId: String(brief._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.poll.options).toHaveLength(4);
    expect(res.body.data.sourceMeta.correctIndex).toBe(1);
  });

  it('rejects out-of-range variantIndex', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Today News', category: 'News' });
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, briefId: String(brief._id), variantIndex: 5 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/variantIndex/);
  });

  it('echoes variantIndex in the response payload', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Today News', category: 'News' });
    jest.spyOn(global, 'fetch').mockImplementation(() => jsonResp({
      choices: [{ message: { content: 'body' } }],
      usage: { cost: 0.001 },
    }));
    const res = await request(app)
      .post('/api/admin/social/x/draft')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, briefId: String(brief._id), variantIndex: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.variantIndex).toBe(2);
  });

  it('three concurrent variant requests each apply their own nudge to the OpenRouter system prompt', async () => {
    const a = await createAdminUser();
    const brief = await createBrief({ title: 'Today News', category: 'News' });
    const seenSystemPrompts = [];
    jest.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
      const body = JSON.parse(opts?.body || '{}');
      const sys = body.messages?.find(m => m.role === 'system')?.content || '';
      seenSystemPrompts.push(sys);
      return jsonResp({
        choices: [{ message: { content: 'body' } }],
        usage: { cost: 0.001 },
      });
    });

    const { VARIANT_NUDGES } = require('../../utils/socialDraftGenerator');
    const responses = await Promise.all([0, 1, 2].map(idx =>
      request(app)
        .post('/api/admin/social/x/draft')
        .set('Cookie', authCookie(a._id))
        .send({ postType: 'latest-intel', tone: 7, briefId: String(brief._id), variantIndex: idx })
    ));
    responses.forEach(r => expect(r.status).toBe(200));

    // Each nudge should appear in at least one of the three system prompts.
    VARIANT_NUDGES.forEach(nudge => {
      expect(seenSystemPrompts.some(s => s.includes(nudge))).toBe(true);
    });
  });
});

// ─── /x/publish ──────────────────────────────────────────────────────────────

describe('POST /x/publish', () => {
  it('400s when no X account is connected', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, finalText: 'hello' });
    expect(res.status).toBe(400);
  });

  it('persists SocialPost as posted on success (mocked X API)', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x',
      username: 'skywatch_uk',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/2/tweets')) {
        return jsonResp({ data: { id: '1234', text: 'hello' } }, true, 201);
      }
      return jsonResp({});
    });

    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, finalText: 'hello world' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('posted');
    expect(res.body.data.externalPostId).toBe('1234');
    expect(res.body.data.externalPostUrl).toContain('/skywatch_uk/status/1234');

    const persisted = await SocialPost.findOne({});
    expect(persisted.status).toBe('posted');
    expect(persisted.finalText).toBe('hello world');
  });

  it('accepts a base64 data URL image, uploads it to X, and stores the [uploaded] sentinel', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x',
      username: 'skywatch_uk',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    let uploadCalled = false;
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/2/media/upload')) {
        uploadCalled = true;
        return jsonResp({ data: { id: 'media_999' } }, true, 201);
      }
      if (String(url).includes('/2/tweets')) {
        return jsonResp({ data: { id: '5678', text: 'hello' } }, true, 201);
      }
      return jsonResp({});
    });
    // 1×1 transparent PNG as a base64 data URL
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'daily-recon-info', tone: 7, finalText: 'hello world', imageUrl: dataUrl });
    expect(res.status).toBe(200);
    expect(uploadCalled).toBe(true);
    const persisted = await SocialPost.findOne({});
    expect(persisted.includedImageUrl).toBe('[uploaded]');
  });

  it('persists SocialPost as failed and returns 502 on X API error', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/2/tweets')) {
        return jsonResp({ detail: 'duplicate content' }, false, 403);
      }
      return jsonResp({});
    });
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, finalText: 'x' });
    expect(res.status).toBe(502);
    const persisted = await SocialPost.findOne({});
    expect(persisted.status).toBe('failed');
    expect(persisted.error).toMatch(/duplicate/);
  });

  it('publishes a daily-recon poll and forwards the poll body to X', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    let tweetBody = null;
    jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (String(url).includes('/2/tweets')) {
        tweetBody = JSON.parse(opts.body);
        return jsonResp({ data: { id: '9001' } }, true, 201);
      }
      return jsonResp({});
    });
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({
        postType: 'daily-recon', tone: 7,
        finalText: 'Typhoon — gen?',
        poll: { options: ['4', '4.5', '5', '6'], duration_minutes: 1440 },
        sourceMeta: { correctIndex: 1 },
      });
    expect(res.status).toBe(200);
    expect(tweetBody.poll).toEqual({
      options: ['4', '4.5', '5', '6'],
      duration_minutes: 1440,
    });
    const persisted = await SocialPost.findOne({});
    expect(persisted.poll.options).toEqual(['4', '4.5', '5', '6']);
  });

  it('400s when poll and imageUrl are sent together', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({
        postType: 'daily-recon', tone: 7,
        finalText: 'Q?',
        poll: { options: ['Y', 'N'], duration_minutes: 1440 },
        imageUrl: 'https://img/x.jpg',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/poll and image/);
  });

  it('400s when poll has too few options', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({
        postType: 'daily-recon', tone: 7,
        finalText: 'Q?',
        poll: { options: ['just one'], duration_minutes: 1440 },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2.4 options/);
  });

  it('400s when poll is sent on a non-daily-recon post', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted:  encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({
        postType: 'latest-intel', tone: 7,
        finalText: 'news!',
        poll: { options: ['Y', 'N'], duration_minutes: 1440 },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/daily-recon/);
  });

  it('400s on >280 chars', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted: encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectedBy: a._id,
    });
    const res = await request(app)
      .post('/api/admin/social/x/publish')
      .set('Cookie', authCookie(a._id))
      .send({ postType: 'latest-intel', tone: 7, finalText: 'x'.repeat(281) });
    expect(res.status).toBe(400);
  });
});

// ─── /posts ──────────────────────────────────────────────────────────────────

describe('GET /posts', () => {
  it('returns posts ordered newest first', async () => {
    const a = await createAdminUser();
    await SocialPost.create([
      {
        platform: 'x', postType: 'latest-intel', tone: 7,
        draftText: 'older', finalText: 'older',
        status: 'posted', createdBy: a._id, createdAt: new Date(Date.now() - 60_000),
      },
      {
        platform: 'x', postType: 'daily-recon', tone: 5,
        draftText: 'newer', finalText: 'newer',
        status: 'posted', createdBy: a._id, createdAt: new Date(),
      },
    ]);
    const res = await request(app)
      .get('/api/admin/social/posts')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].finalText).toBe('newer');
  });
});

// ─── PATCH /posts/:id/deleted ────────────────────────────────────────────────

describe('PATCH /posts/:id/deleted', () => {
  async function seedPost(adminId) {
    return SocialPost.create({
      platform: 'x', postType: 'latest-intel', tone: 7,
      draftText: 'd', finalText: 'd',
      status: 'posted', createdBy: adminId,
    });
  }

  it('stamps deletedAt when {deleted:true} and clears it when {deleted:false}', async () => {
    const a = await createAdminUser();
    const post = await seedPost(a._id);

    const r1 = await request(app)
      .patch(`/api/admin/social/posts/${post._id}/deleted`)
      .set('Cookie', authCookie(a._id))
      .send({ deleted: true });
    expect(r1.status).toBe(200);
    expect(r1.body.data.deletedAt).toBeTruthy();
    const persisted = await SocialPost.findById(post._id).lean();
    expect(persisted.deletedAt).toBeInstanceOf(Date);

    const r2 = await request(app)
      .patch(`/api/admin/social/posts/${post._id}/deleted`)
      .set('Cookie', authCookie(a._id))
      .send({ deleted: false });
    expect(r2.status).toBe(200);
    expect(r2.body.data.deletedAt).toBeNull();
    const persisted2 = await SocialPost.findById(post._id).lean();
    expect(persisted2.deletedAt).toBeNull();
  });

  it('404s an unknown id', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/social/posts/507f1f77bcf86cd799439011/deleted')
      .set('Cookie', authCookie(a._id))
      .send({ deleted: true });
    expect(res.status).toBe(404);
  });

  it('400s a malformed id', async () => {
    const a = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/social/posts/not-an-id/deleted')
      .set('Cookie', authCookie(a._id))
      .send({ deleted: true });
    expect(res.status).toBe(400);
  });

  it('403s a non-admin', async () => {
    const u  = await createUser();
    const ad = await createAdminUser();
    const post = await seedPost(ad._id);
    const res = await request(app)
      .patch(`/api/admin/social/posts/${post._id}/deleted`)
      .set('Cookie', authCookie(u._id))
      .send({ deleted: true });
    expect(res.status).toBe(403);
  });
});

// ─── /x/disconnect ───────────────────────────────────────────────────────────

describe('DELETE /x/disconnect', () => {
  it('removes the social account', async () => {
    const a = await createAdminUser();
    await SocialAccount.create({
      platform: 'x', username: 'sw',
      accessTokenEncrypted: encrypt('A'),
      refreshTokenEncrypted: encrypt('R'),
      expiresAt: new Date(Date.now() + 1000),
      connectedBy: a._id,
    });
    const res = await request(app)
      .delete('/api/admin/social/x/disconnect')
      .set('Cookie', authCookie(a._id));
    expect(res.status).toBe(200);
    expect(await SocialAccount.findOne({})).toBeNull();
  });
});
