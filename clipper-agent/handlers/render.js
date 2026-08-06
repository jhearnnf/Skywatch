// Render job — turn an assembled timeline into a 1080x1920 MP4.
//
// Bundles src/remotion from the main repo, so the browser preview and this
// render run byte-identical component code. Rendering from a separate copy of
// the composition would let the two drift, and "the preview looked right" would
// stop meaning anything.

const path = require('path');
const os = require('os');
const fs = require('fs/promises');

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

module.exports = async function renderHandler({ job, progress }) {
  const { bundle } = require('@remotion/bundler');
  const { selectComposition, renderMedia } = require('@remotion/renderer');

  const timeline = job.payload?.timeline;
  if (!timeline?.beats?.length) throw new Error('render job has an empty timeline');

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
