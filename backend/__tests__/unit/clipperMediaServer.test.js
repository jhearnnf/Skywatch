/**
 * clipperMediaServer.test.js
 *
 * The Clipper agent's loopback file server. Two things matter: it serves byte
 * ranges (the preview scrubber is unusable otherwise), and it serves nothing
 * outside the Clipper temp folder.
 *
 * It lives in clipper-agent/, which has no test runner of its own and never
 * ships to Railway — so it is exercised from here, the same way routes/clipper
 * already reaches into that folder to launch the agent.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const mediaServer = require('../../../clipper-agent/mediaServer');

const CLIP = path.join(mediaServer.ROOT, 'capture', 'mediaserver-test.mp4');
const BODY = Buffer.from('0123456789abcdef');

let base;
let close;

beforeAll(async () => {
  fs.mkdirSync(path.dirname(CLIP), { recursive: true });
  fs.writeFileSync(CLIP, BODY);
  const started = await mediaServer.start();
  base = started.baseUrl;
  close = started.close;
});

afterAll(async () => {
  await close();
  fs.rmSync(CLIP, { force: true });
});

const get = (query, init) => fetch(`${base}/file?path=${encodeURIComponent(query)}`, init);

describe('resolveWithinRoot', () => {
  it('accepts a file under the Clipper temp folder', () => {
    expect(mediaServer.resolveWithinRoot(CLIP)).toBe(path.resolve(CLIP));
  });

  it('rejects a traversal that climbs out of it', () => {
    expect(mediaServer.resolveWithinRoot(path.join(mediaServer.ROOT, '..', '..', 'secrets.txt')))
      .toBeNull();
  });

  it('rejects an unrelated absolute path', () => {
    expect(mediaServer.resolveWithinRoot(path.join(os.homedir(), '.ssh', 'id_rsa'))).toBeNull();
  });

  it('rejects the root itself and an empty path', () => {
    expect(mediaServer.resolveWithinRoot(mediaServer.ROOT)).toBeNull();
    expect(mediaServer.resolveWithinRoot('')).toBeNull();
  });
});

describe('parseRange', () => {
  it('reads a closed range', () => {
    expect(mediaServer.parseRange('bytes=2-5', 16)).toEqual({ start: 2, end: 5 });
  });

  it('reads an open-ended range', () => {
    expect(mediaServer.parseRange('bytes=8-', 16)).toEqual({ start: 8, end: 15 });
  });

  it('reads a suffix range as the last N bytes', () => {
    expect(mediaServer.parseRange('bytes=-4', 16)).toEqual({ start: 12, end: 15 });
  });

  it('clamps an end past the file', () => {
    expect(mediaServer.parseRange('bytes=10-999', 16)).toEqual({ start: 10, end: 15 });
  });

  it('returns null for nonsense, so the caller sends the whole file', () => {
    expect(mediaServer.parseRange('', 16)).toBeNull();
    expect(mediaServer.parseRange('bytes=-', 16)).toBeNull();
    expect(mediaServer.parseRange('bytes=9-2', 16)).toBeNull();
    expect(mediaServer.parseRange('items=0-1', 16)).toBeNull();
  });
});

describe('serving', () => {
  it('serves a capture whole, as video', async () => {
    const res = await get(CLIP);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY);
  });

  it('answers a range request with 206 and just those bytes', async () => {
    const res = await get(CLIP, { headers: { Range: 'bytes=4-7' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 4-7/${BODY.length}`);
    expect(await res.text()).toBe('4567');
  });

  it('refuses a path outside the temp folder', async () => {
    const res = await get(path.join(os.homedir(), '.ssh', 'id_rsa'));
    expect(res.status).toBe(403);
  });

  it('404s a swept temp file rather than erroring', async () => {
    const res = await get(path.join(mediaServer.ROOT, 'capture', 'gone.mp4'));
    expect(res.status).toBe(404);
  });

  it('404s any path other than /file', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('reports health, so the UI can tell a dead port from a missing clip', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

/**
 * The root is configurable (CLIPPER_MEDIA_ROOT), and recordings outlive a
 * change to it: a capture made before the setting existed is still referenced
 * by absolute path on the script that chose it. So the server reads from the
 * current root AND the legacy temp one, and from nowhere else - the widening is
 * exactly two known directories, not a relaxation of the check.
 */
describe('serving more than one root', () => {
  const { SERVE_ROOTS, LEGACY_ROOT, MEDIA_ROOT } = require('../../../clipper-agent/paths');

  it('always keeps the legacy temp folder readable', () => {
    expect(SERVE_ROOTS).toContain(LEGACY_ROOT);
    expect(mediaServer.resolveWithinRoot(path.join(LEGACY_ROOT, 'capture', 'old.mp4')))
      .toBe(path.join(LEGACY_ROOT, 'capture', 'old.mp4'));
  });

  it('lists the temp folder once when no root is configured', () => {
    // Unset is the default in the test environment, so the two roots collapse.
    if (MEDIA_ROOT === LEGACY_ROOT) expect(SERVE_ROOTS).toHaveLength(1);
    else expect(SERVE_ROOTS).toHaveLength(2);
  });

  it('still refuses a path outside every root', () => {
    expect(mediaServer.resolveWithinRoot(path.join(os.homedir(), '.ssh', 'id_rsa'))).toBeNull();
    expect(mediaServer.resolveWithinRoot(path.join(LEGACY_ROOT, '..', 'elsewhere.mp4'))).toBeNull();
  });

  // A root is a directory, not a file, and naming one is not a request for
  // anything servable.
  it('refuses a root directory itself', () => {
    for (const root of SERVE_ROOTS) expect(mediaServer.resolveWithinRoot(root)).toBeNull();
  });
});
