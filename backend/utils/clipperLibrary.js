// The curated b-roll library — clips we chose, rather than clips a stock API
// returned.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// A measured render came back with seven shots, none of them aviation. The
// stock providers are not to blame for that on their own: three libraries
// searched with the same handful of queries return the same handful of results,
// and after a few videos a channel is visibly drawing from the same shallow
// pool. Adding a fourth API would buy a little more variety and the same
// problem. A folder of clips somebody actually watched and kept is a different
// kind of source, and it is the only one that gets better over time.
//
// ── How it works ────────────────────────────────────────────────────────────
// Clips live in public/video/broll/ and are described by library.json beside
// them. The manifest is committed; the clips are not — they are large binaries,
// and Clipper only ever runs on the workstation. A checkout with no clips is a
// library with nothing in it, which behaves exactly like an unconfigured API
// key rather than like a fault.
//
// Durations come from the manifest rather than from probing the file. The shot
// splitter refuses to cut a clip whose length it does not know, so a missing
// duration would silently cost the clip its sub-shots — better to declare it
// once, next to the licence, than to shell out to ffprobe on every search.
//
// ── Provenance ──────────────────────────────────────────────────────────────
// Same rule as the stock providers and the music library: every clip SAYS what
// it is. A clip with no licence is dropped rather than used, because "where did
// this come from and may we use it?" has to be answerable months after the
// video went out.

const fs = require('fs');
const path = require('path');

// Relative to public/, which is what staticFile() and the browser both want.
const LIBRARY_DIR = 'video/broll';

// Absolute, for reading the manifest. Railway ships backend/ alone, so this
// path does not exist in production — the loader treats that as an empty
// library, which is the truth there.
const LIBRARY_ABS_DIR = path.join(__dirname, '..', '..', 'public', LIBRARY_DIR);
const MANIFEST_PATH = path.join(LIBRARY_ABS_DIR, 'library.json');

const clipPath = (file) => `${LIBRARY_DIR}/${file}`;

// Re-read only when the manifest actually changed. Dropping a clip in and
// editing the manifest should not need a server restart, but neither should
// every search re-parse a file that has not moved.
let cache = { mtimeMs: null, result: null };

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

// What the library holds, plus anything wrong with it.
//
// `problems` is returned rather than thrown for the same reason the stock
// providers swallow their failures: one bad row must not cost a beat its other
// candidates. It is surfaced in the footage stage so a clip that is being
// skipped never looks like a clip that does not exist.
function loadLibrary() {
  let stat;
  try {
    stat = fs.statSync(MANIFEST_PATH);
  } catch {
    // No manifest at all is the ordinary state of a fresh checkout, and of the
    // deployed backend. Not a problem to report.
    cache = { mtimeMs: null, result: { clips: [], problems: [] } };
    return cache.result;
  }

  if (cache.mtimeMs === stat.mtimeMs && cache.result) return cache.result;

  const problems = [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    const result = { clips: [], problems: [`library.json is not valid JSON (${err.message})`] };
    cache = { mtimeMs: stat.mtimeMs, result };
    return result;
  }

  const clips = [];
  for (const raw of (Array.isArray(parsed?.clips) ? parsed.clips : [])) {
    const file = String(raw?.file || '').trim();
    if (!file) { problems.push('a clip has no "file"'); continue; }

    // The manifest is hand-edited, so a filename is a claim rather than a fact.
    // A missing file would render as a black beat with no explanation.
    if (!fs.existsSync(path.join(LIBRARY_ABS_DIR, file))) {
      problems.push(`${file} is in library.json but not in the folder`);
      continue;
    }
    if (!String(raw?.licence || '').trim()) {
      problems.push(`${file} has no licence, so it is not usable`);
      continue;
    }

    const durationSec = Number(raw.durationSec) || null;
    if (!durationSec) problems.push(`${file} has no durationSec, so it cannot be split into shots`);

    clips.push({
      file,
      title: String(raw.title || file).slice(0, 200),
      tags: (Array.isArray(raw.tags) ? raw.tags : []).flatMap(tokens),
      durationSec,
      width:  Number(raw.width)  || null,
      height: Number(raw.height) || null,
      licence: String(raw.licence).trim(),
      sourceUrl: String(raw.sourceUrl || ''),
      poster: String(raw.poster || '').trim(),
    });
  }

  const result = { clips, problems };
  cache = { mtimeMs: stat.mtimeMs, result };
  return result;
}

// Rank a clip against a query. Tags are worth more than the title because they
// are what somebody wrote down deliberately; the title is often just the
// filename tidied up.
function scoreClip(clip, queryTokens) {
  const tags = new Set(clip.tags);
  const title = new Set(tokens(clip.title));

  let score = 0;
  for (const q of queryTokens) {
    if (tags.has(q)) score += 2;
    else if (title.has(q)) score += 1;
  }
  return score;
}

// Candidates in the shape every other provider returns, so the footage stage
// treats a curated clip and a stock one identically.
//
// `downloadUrl` is a path relative to public/ rather than a URL. The
// composition resolves it through staticFile(), which is how the SFX and music
// already work — nothing is fetched over the network at render time.
function searchLibrary(term, max = 8) {
  const queryTokens = tokens(term);
  if (queryTokens.length === 0) return [];

  const { clips } = loadLibrary();

  return clips
    .map(clip => ({ clip, score: scoreClip(clip, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ clip }) => ({
      provider:    'library',
      providerId:  clip.file,
      title:       clip.title,
      thumbUrl:    clip.poster ? `/${clipPath(clip.poster)}` : null,
      downloadUrl: clipPath(clip.file),
      assetUrl:    null,
      durationSec: clip.durationSec,
      width:       clip.width,
      height:      clip.height,
      licence:     clip.licence,
      sourceUrl:   clip.sourceUrl,
    }));
}

// Whether there is anything to search. Mirrors "is an API key set" for the
// stock providers: a library with no clips is unconfigured, not broken.
function libraryConfigured() {
  return loadLibrary().clips.length > 0;
}

module.exports = {
  searchLibrary, loadLibrary, libraryConfigured, scoreClip,
  LIBRARY_DIR, LIBRARY_ABS_DIR, MANIFEST_PATH,
  _resetCache: () => { cache = { mtimeMs: null, result: null }; },
};
