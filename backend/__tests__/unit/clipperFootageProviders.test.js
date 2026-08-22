/**
 * clipperFootageProviders.test.js
 *
 * Stock search swallows every provider failure so one dead source cannot fail a
 * whole beat. That is the right call, and it has one bad consequence: a
 * rejected API key looks exactly like a search that found nothing.
 *
 * DVIDS sat in that state unnoticed. It is the only public-domain military and
 * aviation source in the list, so while it was silently failing every video was
 * built from whatever generic stock the other two happened to have.
 *
 * These tests are about that distinction being reportable, not about the search
 * results themselves.
 */

const footage = require('../../utils/clipperFootage');

const ENV = { ...process.env };

beforeEach(() => {
  footage._resetProviderErrors();
  process.env.DVIDS_API_KEY = 'test-dvids';
  process.env.PEXELS_API_KEY = 'test-pexels';
  process.env.PIXABAY_API_KEY = 'test-pixabay';
  global.fetch = jest.fn();
});

afterEach(() => {
  process.env = { ...ENV };
  delete global.fetch;
});

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

describe('providerStatus', () => {
  it('reports nothing wrong before anything has been searched', () => {
    expect(footage.providerStatus().failing).toEqual({});
  });

  it('names a provider whose key was rejected', async () => {
    global.fetch.mockResolvedValue(fail(401));

    await footage.searchDvids('fighter jet cockpit');

    const { configured, failing } = footage.providerStatus();
    // Still "configured" - the key is set. That is exactly why the second
    // field has to exist.
    expect(configured.dvids).toBe(true);
    expect(failing.dvids).toBe('API key rejected');
  });

  it('distinguishes rate limiting from a bad key', async () => {
    global.fetch.mockResolvedValue(fail(429));
    await footage.searchPexels('runway');
    expect(footage.providerStatus().failing.pexels).toBe('rate limited');
  });

  it('reports a request that never completed', async () => {
    global.fetch.mockRejectedValue(new Error('ENOTFOUND'));
    await footage.searchPixabay('radar');
    expect(footage.providerStatus().failing.pixabay).toBe('request failed');
  });

  it('clears the error once the provider answers again', async () => {
    global.fetch.mockResolvedValueOnce(fail(403));
    await footage.searchDvids('tornado');
    expect(footage.providerStatus().failing.dvids).toBe('API key rejected');

    global.fetch.mockResolvedValueOnce(ok({ results: [{ id: 1, url: 'u' }] }));
    await footage.searchDvids('tornado');
    expect(footage.providerStatus().failing.dvids).toBeUndefined();
  });

  it('does not report a provider that was never configured', async () => {
    delete process.env.DVIDS_API_KEY;
    global.fetch.mockResolvedValue(fail(401));

    await footage.searchDvids('typhoon');

    // It returned early without asking, so there is nothing to report - the
    // "not configured" notice already covers this case.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(footage.providerStatus().failing.dvids).toBeUndefined();
  });

  it('an empty result set from a healthy provider is not an error', async () => {
    global.fetch.mockResolvedValue(ok({ results: [] }));
    await footage.searchDvids('something nobody filmed');
    expect(footage.providerStatus().failing).toEqual({});
  });
});
