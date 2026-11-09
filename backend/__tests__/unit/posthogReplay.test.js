const { sanitiseReplay, replayUrl, serializeReplay, fetchEarlierSessions } = require('../../utils/posthogReplay');

const S1 = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b';
const S2 = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6c';
const S3 = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6d';

const okFetch = (results) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ results }) });

beforeEach(() => {
  process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test';
  process.env.POSTHOG_PROJECT_ID = '164400';
});
afterAll(() => {
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  delete process.env.POSTHOG_PROJECT_ID;
});

describe('sanitiseReplay', () => {
  it('keeps a real session id and drops everything else the client sent', () => {
    const r = sanitiseReplay({ recording: true, sessionId: S1.toUpperCase(), offsetMs: 1234.6, url: 'https://evil.example' });
    expect(r).toMatchObject({ recording: true, sessionId: S1, offsetMs: 1235 });
    expect(r).not.toHaveProperty('url');
  });

  it('is not recording without a valid id, and ignores a silly offset', () => {
    expect(sanitiseReplay({ recording: true, sessionId: '../x', offsetMs: -5 })).toMatchObject({ recording: false, sessionId: null, offsetMs: null });
    expect(sanitiseReplay(null)).toBeNull();
  });
});

describe('replayUrl', () => {
  it('builds the project link with a jump in seconds', () => {
    expect(replayUrl(S1, 95_400)).toBe(`https://eu.posthog.com/project/164400/replay/${S1}?t=95`);
    expect(replayUrl('nope')).toBeNull();
  });
});

describe('serializeReplay', () => {
  it('reports a lookup that never finished as failed', () => {
    const r = serializeReplay({ recording: true, sessionId: S1, capturedAt: new Date(Date.now() - 10 * 60 * 1000), earlier: { status: 'pending', sessions: [] } });
    expect(r.earlier.status).toBe('failed');
  });
});

describe('fetchEarlierSessions', () => {
  it('lists sessions that visited the reported page first, and leaves out the current one', async () => {
    const fetchImpl = okFetch([
      [S1, '2026-11-09T10:00:00Z', '2026-11-09T10:05:00Z', ['/cbat/sma']],
      [S2, '2026-11-08T10:00:00Z', '2026-11-08T10:01:00Z', ['/cbat']],
      [S3, '2026-11-07T10:00:00Z', '2026-11-07T10:10:00Z', ['/cbat/sma/', '/profile']],
    ]);
    const r = await fetchEarlierSessions({ userId: 'u1', excludeSessionId: S1, reportedPath: '/cbat/sma', fetchImpl });
    expect(r.status).toBe('ready');
    expect(r.sessions.map(s => s.sessionId)).toEqual([S3, S2]);
    expect(r.sessions[0]).toMatchObject({ matchesReport: true, durationSec: 600 });
    // Labels, never paths.
    expect(r.sessions[0].pages.every(p => !p.startsWith('/'))).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://eu.posthog.com/api/projects/164400/query/');
    expect(init.headers.Authorization).toBe('Bearer phx_test');
    expect(JSON.parse(init.body).query.values).toEqual({ uid: 'u1' });
  });

  it('never throws: a failed or missing call reports itself', async () => {
    expect((await fetchEarlierSessions({ userId: 'u', fetchImpl: jest.fn().mockResolvedValue({ ok: false }) })).status).toBe('failed');
    expect((await fetchEarlierSessions({ userId: 'u', fetchImpl: jest.fn().mockRejectedValue(new Error('down')) })).status).toBe('failed');
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    expect((await fetchEarlierSessions({ userId: 'u', fetchImpl: okFetch([]) })).status).toBe('unconfigured');
  });
});
