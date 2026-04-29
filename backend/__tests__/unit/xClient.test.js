const {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  postTweet,
  uploadMedia,
  DEFAULT_SCOPES,
} = require('../../utils/xClient');

describe('xClient — PKCE helpers', () => {
  test('generatePkce returns URL-safe verifier + sha256 challenge', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    // challenge is sha256 → 32 bytes → 43 base64url chars
    expect(challenge.length).toBe(43);
  });

  test('generateState produces a non-empty URL-safe string', () => {
    const s = generateState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThan(20);
  });
});

describe('xClient — buildAuthorizeUrl', () => {
  const params = {
    clientId: 'CID',
    redirectUri: 'https://example.com/cb',
    state: 'STATE',
    codeChallenge: 'CHAL',
  };

  test('includes all required OAuth 2.0 PKCE params', () => {
    const url = buildAuthorizeUrl(params);
    expect(url.startsWith('https://x.com/i/oauth2/authorize?')).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('https://example.com/cb');
    expect(u.searchParams.get('state')).toBe('STATE');
    expect(u.searchParams.get('code_challenge')).toBe('CHAL');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe(DEFAULT_SCOPES.join(' '));
  });

  test('throws when required field missing', () => {
    expect(() => buildAuthorizeUrl({ ...params, clientId: undefined })).toThrow(/clientId/);
    expect(() => buildAuthorizeUrl({ ...params, state: undefined })).toThrow(/state/);
  });

  test('respects custom scopes', () => {
    const url = buildAuthorizeUrl({ ...params, scopes: ['tweet.read'] });
    expect(new URL(url).searchParams.get('scope')).toBe('tweet.read');
  });
});

function mockFetchOnce(status, body) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  });
}

describe('xClient — token exchange', () => {
  test('exchangeCode posts authorization_code grant + Basic auth', async () => {
    const fetchImpl = mockFetchOnce(200, { access_token: 'A', refresh_token: 'R', expires_in: 7200, scope: 'tweet.write' });
    const out = await exchangeCode({
      clientId: 'CID', clientSecret: 'SEC',
      code: 'CODE', redirectUri: 'https://x/cb', codeVerifier: 'VER',
      fetchImpl,
    });
    expect(out.access_token).toBe('A');
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.x.com/2/oauth2/token');
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = opts.body.toString();
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=CODE');
    expect(body).toContain('code_verifier=VER');
  });

  test('exchangeCode throws on non-2xx with helpful message', async () => {
    const fetchImpl = mockFetchOnce(400, { error: 'invalid_grant', error_description: 'Bad code' });
    await expect(exchangeCode({
      clientId: 'CID', clientSecret: 'SEC',
      code: 'X', redirectUri: 'r', codeVerifier: 'v',
      fetchImpl,
    })).rejects.toThrow(/Bad code/);
  });

  test('refreshAccessToken sends refresh_token grant', async () => {
    const fetchImpl = mockFetchOnce(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 7200 });
    const out = await refreshAccessToken({
      clientId: 'CID', clientSecret: 'SEC', refreshToken: 'R1', fetchImpl,
    });
    expect(out.access_token).toBe('A2');
    const body = fetchImpl.mock.calls[0][1].body.toString();
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=R1');
  });
});

describe('xClient — postTweet', () => {
  test('posts text-only tweet', async () => {
    const fetchImpl = mockFetchOnce(201, { data: { id: '123', text: 'hello' } });
    const data = await postTweet({ accessToken: 'A', text: 'hello', fetchImpl });
    expect(data.id).toBe('123');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ text: 'hello' });
  });

  test('attaches media_ids when supplied', async () => {
    const fetchImpl = mockFetchOnce(201, { data: { id: '124' } });
    await postTweet({ accessToken: 'A', text: 'with image', mediaIds: ['m1'], fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ text: 'with image', media: { media_ids: ['m1'] } });
  });

  test('attaches poll when supplied', async () => {
    const fetchImpl = mockFetchOnce(201, { data: { id: '125' } });
    await postTweet({
      accessToken: 'A',
      text: 'pop quiz',
      poll: { options: ['A', 'B', 'C'], duration_minutes: 1440 },
      fetchImpl,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({
      text: 'pop quiz',
      poll: { options: ['A', 'B', 'C'], duration_minutes: 1440 },
    });
  });

  test('omits poll when options array is empty', async () => {
    const fetchImpl = mockFetchOnce(201, { data: { id: '126' } });
    await postTweet({
      accessToken: 'A',
      text: 'no poll',
      poll: { options: [], duration_minutes: 1440 },
      fetchImpl,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ text: 'no poll' });
  });

  test('defaults poll duration when not supplied', async () => {
    const fetchImpl = mockFetchOnce(201, { data: { id: '127' } });
    await postTweet({
      accessToken: 'A',
      text: 'q',
      poll: { options: ['Y', 'N'] },
      fetchImpl,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.poll.duration_minutes).toBe(1440);
  });

  test('throws on API error with detail message', async () => {
    const fetchImpl = mockFetchOnce(403, { detail: 'Forbidden — duplicate content' });
    await expect(postTweet({ accessToken: 'A', text: 'dup', fetchImpl }))
      .rejects.toThrow(/duplicate content/);
  });
});

describe('xClient — uploadMedia', () => {
  test('returns the media id from v2 response shape', async () => {
    const fetchImpl = mockFetchOnce(200, { data: { id: 'm-42', media_key: 'k' } });
    const id = await uploadMedia({
      accessToken: 'A',
      buffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/png',
      fetchImpl,
    });
    expect(id).toBe('m-42');
  });

  test('falls back to legacy media_id_string', async () => {
    const fetchImpl = mockFetchOnce(200, { media_id_string: 'legacy-7' });
    const id = await uploadMedia({
      accessToken: 'A', buffer: Buffer.from([1]), mimeType: 'image/jpeg', fetchImpl,
    });
    expect(id).toBe('legacy-7');
  });

  test('rejects when buffer or mimeType missing', async () => {
    await expect(uploadMedia({ accessToken: 'A', buffer: null, mimeType: 'image/png', fetchImpl: jest.fn() }))
      .rejects.toThrow(/buffer/);
    await expect(uploadMedia({ accessToken: 'A', buffer: Buffer.from([1]), mimeType: null, fetchImpl: jest.fn() }))
      .rejects.toThrow(/mimeType/);
  });

  test('sends media_category and media_type in the form (v2 requires both)', async () => {
    const fetchImpl = mockFetchOnce(200, { data: { id: 'm-1' } });
    await uploadMedia({
      accessToken: 'A', buffer: Buffer.from([1, 2]), mimeType: 'image/png', fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('media_category')).toBe('tweet_image');
    expect(init.body.get('media_type')).toBe('image/png');
  });

  test('maps gif and video MIME types to the right media_category', async () => {
    const gifFetch = mockFetchOnce(200, { data: { id: 'g' } });
    await uploadMedia({ accessToken: 'A', buffer: Buffer.from([1]), mimeType: 'image/gif', fetchImpl: gifFetch });
    expect(gifFetch.mock.calls[0][1].body.get('media_category')).toBe('tweet_gif');

    const vidFetch = mockFetchOnce(200, { data: { id: 'v' } });
    await uploadMedia({ accessToken: 'A', buffer: Buffer.from([1]), mimeType: 'video/mp4', fetchImpl: vidFetch });
    expect(vidFetch.mock.calls[0][1].body.get('media_category')).toBe('tweet_video');
  });
});
