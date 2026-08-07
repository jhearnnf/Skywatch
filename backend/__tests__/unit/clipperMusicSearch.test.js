/**
 * clipperMusicSearch.test.js
 *
 * The licence guard on imported music.
 *
 * A query parameter is a request, not a guarantee. If Openverse changed its
 * filter semantics, or the parameter were misspelled, or the API started
 * ignoring an unknown one, the pool would quietly widen to licences that oblige
 * attribution — and the failure would surface as a published video that owes a
 * credit nobody knows about. So every result is checked against the licence it
 * actually carries, and these are the tests that keep that true.
 */

const {
  toCandidate, isFreeLicence, FREE_LICENCES, MAX_DURATION_MS, MIN_DURATION_MS,
} = require('../../utils/clipperMusicSearch');

const row = (over = {}) => ({
  id: 'abc',
  title: 'Thriller Ambient',
  creator: 'unfa',
  url: 'https://cdn.freesound.org/previews/157/157133_1038806-hq.mp3',
  foreign_landing_url: 'https://freesound.org/people/unfa/sounds/157133',
  license: 'cc0',
  license_version: '1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  duration: 90000,
  filetype: 'mp3',
  filesize: 1234,
  provider: 'freesound',
  attribution: '"Thriller Ambient" by unfa is marked with CC0 1.0.',
  ...over,
});

describe('isFreeLicence', () => {
  it('accepts only the licences that ask nothing of us', () => {
    expect([...FREE_LICENCES].sort()).toEqual(['cc0', 'pdm']);
    expect(isFreeLicence('cc0')).toBe(true);
    expect(isFreeLicence('pdm')).toBe(true);
  });

  // CC-BY is free and often better produced, but it obliges a visible credit on
  // every video for ever. That is a decision to take deliberately.
  it('rejects every licence that carries an obligation', () => {
    for (const l of ['by', 'by-sa', 'by-nc', 'by-nc-sa', 'by-nd', 'nc-sampling+', 'sampling+']) {
      expect(isFreeLicence(l)).toBe(false);
    }
  });

  it('rejects nothing-at-all', () => {
    expect(isFreeLicence('')).toBe(false);
    expect(isFreeLicence(null)).toBe(false);
    expect(isFreeLicence(undefined)).toBe(false);
  });

  it('is case-insensitive, because the API is not consistent about it', () => {
    expect(isFreeLicence('CC0')).toBe(true);
    expect(isFreeLicence('PDM')).toBe(true);
  });
});

describe('toCandidate', () => {
  it('keeps a CC0 track and captures its provenance', () => {
    const c = toCandidate(row());
    expect(c.providerId).toBe('abc');
    expect(c.licence).toBe('CC0 1.0');
    expect(c.licenceUrl).toContain('creativecommons.org');
    expect(c.sourceUrl).toBe('https://freesound.org/people/unfa/sounds/157133');
    expect(c.attribution).toMatch(/CC0/);
  });

  // The whole point of the second check: a result that slipped past the query
  // filter must not reach the UI, let alone an import.
  it('drops a result whose licence is not free, whatever the query asked for', () => {
    expect(toCandidate(row({ license: 'by' }))).toBeNull();
    expect(toCandidate(row({ license: 'by-nc-sa' }))).toBeNull();
    expect(toCandidate(row({ license: undefined }))).toBeNull();
  });

  it('drops a result with nothing to download', () => {
    expect(toCandidate(row({ url: undefined }))).toBeNull();
    expect(toCandidate(row({ id: undefined }))).toBeNull();
    expect(toCandidate(null)).toBeNull();
  });

  it('drops tracks too short or too long to sit under a video', () => {
    expect(toCandidate(row({ duration: MIN_DURATION_MS - 1 }))).toBeNull();
    expect(toCandidate(row({ duration: MAX_DURATION_MS + 1 }))).toBeNull();
    expect(toCandidate(row({ duration: MIN_DURATION_MS }))).not.toBeNull();
  });

  // Duration is missing on some providers; that is not a reason to reject a
  // track whose licence is fine.
  it('keeps a track whose duration is unknown', () => {
    expect(toCandidate(row({ duration: 0 }))).not.toBeNull();
  });

  it('defaults an unknown filetype rather than trusting it into a filename', () => {
    expect(toCandidate(row({ filetype: undefined })).filetype).toBe('mp3');
  });

  it('truncates a hostile title rather than storing it whole', () => {
    const c = toCandidate(row({ title: 'x'.repeat(500) }));
    expect(c.title.length).toBe(200);
  });
});

// Openverse rate-limits anonymous callers and, once the budget is spent,
// refuses with 401 rather than throttling. A handful of searches is enough, so
// the message has to say what happened and what to do about it — "Openverse
// search failed (401)" is a status code wearing a sentence.
describe('describeFailure', () => {
  const { describeFailure } = require('../../utils/clipperMusicSearch');

  it('explains the anonymous quota and names the fix', () => {
    const msg = describeFailure(401, null);
    expect(msg).toMatch(/rate-limits anonymous/);
    expect(msg).toMatch(/OPENVERSE_CLIENT_ID/);
    expect(msg).toMatch(/registerOpenverse/);
  });

  it('says something different once a key is in use', () => {
    const msg = describeFailure(401, 'a-token');
    expect(msg).toMatch(/rate limited/);
    expect(msg).not.toMatch(/OPENVERSE_CLIENT_ID/);
  });

  it('treats 429 as the same problem', () => {
    expect(describeFailure(429, null)).toMatch(/rate-limits anonymous/);
  });

  it('reports anything else plainly', () => {
    expect(describeFailure(500, null)).toBe('Openverse search failed (500)');
    expect(describeFailure(404, 'tok')).toBe('Openverse search failed (404)');
  });
});

describe('getAccessToken', () => {
  const { getAccessToken, resetTokenCache } = require('../../utils/clipperMusicSearch');

  afterEach(() => {
    resetTokenCache();
    delete process.env.OPENVERSE_CLIENT_ID;
    delete process.env.OPENVERSE_CLIENT_SECRET;
    global.fetch = undefined;
  });

  it('stays anonymous when no credentials are configured', async () => {
    global.fetch = jest.fn();
    expect(await getAccessToken()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exchanges credentials for a token', async () => {
    process.env.OPENVERSE_CLIENT_ID = 'id';
    process.env.OPENVERSE_CLIENT_SECRET = 'secret';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    });

    expect(await getAccessToken()).toBe('tok');
  });

  // A token lasts hours; fetching one per search would double the request count
  // on the very API we are being rate-limited by.
  it('reuses a token it already has', async () => {
    process.env.OPENVERSE_CLIENT_ID = 'id';
    process.env.OPENVERSE_CLIENT_SECRET = 'secret';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    });

    await getAccessToken();
    await getAccessToken();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // Bad credentials should behave like having none, not like a broken feature.
  it('falls back to anonymous when the exchange is refused', async () => {
    process.env.OPENVERSE_CLIENT_ID = 'id';
    process.env.OPENVERSE_CLIENT_SECRET = 'wrong';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    expect(await getAccessToken()).toBeNull();
  });
});
