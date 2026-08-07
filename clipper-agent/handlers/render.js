// Render job — turn an assembled timeline into a 1080x1920 MP4.
//
// Bundles src/remotion from the main repo, so the browser preview and this
// render run byte-identical component code. Rendering from a separate copy of
// the composition would let the two drift, and "the preview looked right" would
// stop meaning anything.

const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const mediaServer = require('../mediaServer');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(REPO_ROOT, 'src', 'remotion', 'index.js');
// staticFile() in the composition resolves against this — it is how the sound
// effects in public/sounds/sound_effects reach the renderer. Without it the
// bundle looks for a public/ folder next to the entry point and finds nothing,
// and every stinger silently goes missing.
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const OUT_DIR = path.join(os.tmpdir(), 'skywatch-clipper', 'renders');

// Cached across jobs: bundling is the slow part and the composition only
// changes when the code does, not between renders.
let cachedBundle = null;

// Point screen recordings at the agent's media server.
//
// The renderer does NOT read local files. Every asset goes through its own
// downloader (@remotion/renderer/dist/assets/read-file.js), which handles
// http:// and https:// and throws on everything else — so the `file:///…` URL
// the backend stores for a capture beat fails the render outright rather than
// quietly rendering black. Both the Node-side downloader and the headless
// Chrome it drives are on this machine, so a loopback URL is all that is needed.
// Both media fields a beat can carry as a local file. Narration is one of them:
// the voice stage writes a wav to this machine's disk, and Remotion's <Audio>
// goes through the same downloader as <OffthreadVideo>.
const LOCAL_FIELDS = ['videoUrl', 'audioUrl'];

const isLocal = (url) => typeof url === 'string' && url.startsWith('file:');

function resolveLocalAssets(timeline) {
  const beats = timeline.beats ?? [];
  const local = beats.filter(b => LOCAL_FIELDS.some(f => isLocal(b[f])));
  if (local.length === 0) return timeline;

  if (!mediaServer.getBaseUrl()) {
    throw new Error(
      `${local.length} beat(s) use a local recording or narration file, which the renderer can ` +
      'only read over http - and the agent\'s media server is not running. Restart the agent and ' +
      'render again.',
    );
  }

  return {
    ...timeline,
    beats: beats.map(beat => {
      if (!LOCAL_FIELDS.some(f => isLocal(beat[f]))) return beat;

      const next = { ...beat };
      for (const field of LOCAL_FIELDS) {
        if (!isLocal(next[field])) continue;

        const served = mediaServer.toUrl(next[field]);
        if (!served) {
          // Only paths inside the Clipper temp folder are servable. Anything
          // else is from an older layout, or has been swept by the OS.
          throw new Error(
            `Beat "${beat.id}" points at a ${field === 'audioUrl' ? 'narration file' : 'recording'} ` +
            `the media server will not serve (${next[field]}). Regenerate that beat.`,
          );
        }
        next[field] = served;
      }
      return next;
    }),
  };
}

module.exports = async function renderHandler({ job, progress }) {
  const { bundle } = require('@remotion/bundler');
  const { selectComposition, renderMedia } = require('@remotion/renderer');

  const payloadTimeline = job.payload?.timeline;
  if (!payloadTimeline?.beats?.length) throw new Error('render job has an empty timeline');

  const timeline = resolveLocalAssets(payloadTimeline);

  await progress(5, 'bundling composition');
  if (!cachedBundle) {
    cachedBundle = await bundle({
      entryPoint: ENTRY,
      publicDir: PUBLIC_DIR,
      onProgress: () => {},
    });
  }

  await progress(20, 'resolving composition');
  const composition = await selectComposition({
    serveUrl: cachedBundle,
    id: 'ClipperVideo',
    inputProps: { timeline },
  });

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${job.scriptId}-${Date.now()}.mp4`);

  await renderMedia({
    composition,
    serveUrl: cachedBundle,
    codec: 'h264',
    outputLocation: outPath,
    inputProps: { timeline },
    // Short-form platforms re-encode anyway; a high CRF here would only waste
    // upload time for quality the viewer never sees.
    crf: 20,
    onProgress: ({ progress: p }) => {
      progress(20 + Math.round(p * 78), `rendering ${Math.round(p * 100)}%`);
    },
  });

  const { size } = await fs.stat(outPath);
  await progress(100, 'done');

  return {
    localPath: outPath,
    bytes: size,
    durationMs: timeline.totalDurationMs,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
  };
};

// Exported for tests: the asset rewrite is the part that decides whether a
// render succeeds at all, and exercising it should not mean rendering a video.
module.exports.resolveLocalAssets = resolveLocalAssets;
