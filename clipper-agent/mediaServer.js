// Serves the agent's own media files over loopback.
//
// Screen recordings only ever exist as files in the agent's temp folder, and
// the stored timeline references them as `file:///…`. Neither consumer of that
// timeline can open such a URL:
//
//   * The browser preview loads video into a <video> element, and a page served
//     over http:// may not read file:// resources — capture beats previewed as
//     black frames while stock clips (ordinary https URLs) played fine.
//   * The Remotion renderer fetches every asset through its own downloader
//     (@remotion/renderer/dist/assets/read-file.js), which accepts http and
//     https only and throws on anything else — so a render containing a capture
//     beat failed outright.
//
// Both are fixed by giving those files an http address. This server provides
// it; the UI rewrites for the preview (src/utils/clipperPreview.js) and the
// render handler rewrites for the renderer. Clipper only runs on the machine
// the agent is on (src/utils/localEnvironment.js), so nothing needs to leave
// loopback.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const url = require('node:url');

// The directories this server will read from, and nothing else. Both the
// capture handler and the render handler write beneath the first of them.
//
// More than one because the root is configurable and recordings outlive a
// change to it: a capture made before CLIPPER_MEDIA_ROOT was set is still
// referenced by absolute path on the script that chose it, and refusing to
// serve it would black out beats in videos that used to render. See paths.js.
const { SERVE_ROOTS, MEDIA_ROOT } = require('./paths');
const ROOT = MEDIA_ROOT;

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

// A request may only name a file inside one of the served roots. Resolving
// first and comparing the resolved path is what makes `..` segments harmless —
// checking the raw string would accept `<root>/../../.ssh/id_rsa`.
//
// An empty relative path means the request named a root directory itself, which
// is not a file and is refused along with everything above it.
function resolveWithinRoot(requested) {
  if (!requested) return null;
  const resolved = path.resolve(requested);

  return SERVE_ROOTS.some((root) => {
    const rel = path.relative(root, resolved);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }) ? resolved : null;
}

// Parse a single-range `Range: bytes=start-end` header. Multi-range requests
// are not worth supporting: browsers only send them for byte-serving PDFs, and
// a video element never does.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  // A suffix range (`bytes=-500`) asks for the last N bytes.
  let start = rawStart === '' ? size - Number(rawEnd) : Number(rawStart);
  let end = rawStart === '' || rawEnd === '' ? size - 1 : Number(rawEnd);

  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;

  return { start, end };
}

async function handle(req, res) {
  // The video element does not need CORS for playback, but the UI also HEADs
  // these URLs to tell "recording is there" from "agent restarted since", and
  // fetch() does.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root: ROOT, roots: SERVE_ROOTS }));
    return;
  }
  if (url.pathname !== '/file') { res.writeHead(404).end(); return; }

  const file = resolveWithinRoot(url.searchParams.get('path'));
  if (!file) { res.writeHead(403).end('Outside the media root'); return; }

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    // Temp files are swept by the OS, so a missing clip is an ordinary outcome
    // rather than a fault — the UI turns this into "re-record".
    res.writeHead(404).end('Not found');
    return;
  }
  if (!stat.isFile()) { res.writeHead(404).end('Not a file'); return; }

  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = parseRange(req.headers.range, stat.size);

  // Seeking in the preview player is a range request, and a server that answers
  // 200-with-everything makes the scrubber unusable on a 25-second clip.
  const head = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': range ? range.end - range.start + 1 : stat.size,
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}),
  };

  res.writeHead(range ? 206 : 200, head);
  if (req.method === 'HEAD') { res.end(); return; }

  const stream = fs.createReadStream(file, range ? { start: range.start, end: range.end } : {});
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

// The running server's base URL, or null. Module-level because the render
// handler needs it too and threading it down through the job dispatcher would
// mean every handler taking an argument only one of them uses.
let baseUrl = null;

// Starts on 127.0.0.1 and resolves with the base URL to advertise.
//
// Port 0 by default: the agent reports whatever it got on every heartbeat, so a
// fixed port buys nothing and a busy one would stop the agent starting at all.
function start({ port = Number(process.env.CLIPPER_MEDIA_PORT) || 0 } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve({
        server,
        port: server.address().port,
        baseUrl,
        close: () => new Promise(done => server.close(() => { baseUrl = null; done(); })),
      });
    });
  });
}

const getBaseUrl = () => baseUrl;

// An http URL for a local file, or null if there is no server to serve it from.
// Takes either a plain path or a file: URL, since the stored timeline uses the
// latter and callers on this side of the wire usually hold the former.
function toUrl(fileOrUrl) {
  if (!baseUrl || !fileOrUrl) return null;

  let file = String(fileOrUrl);
  if (file.startsWith('file:')) {
    try {
      file = url.fileURLToPath(file);
    } catch {
      return null;
    }
  }

  if (!resolveWithinRoot(file)) return null;
  return `${baseUrl}/file?path=${encodeURIComponent(file)}`;
}

module.exports = { start, getBaseUrl, toUrl, ROOT, SERVE_ROOTS, resolveWithinRoot, parseRange };
