// Make a render timeline playable in a browser.
//
// Screen-recording beats are stored with a `file:///…` URL, which nothing can
// actually open: a page served over http may not load file: resources, and the
// Remotion renderer downloads assets over http/https only. So those beats
// previewed as black frames and failed the render outright.
//
// The agent serves its temp folder over loopback (clipper-agent/mediaServer.js)
// and reports the base URL on each heartbeat. This rewrites for the preview;
// the agent's render handler does the equivalent for the renderer. Rewriting at
// both ends rather than in the stored script keeps the database free of a port
// number that changes every time the agent restarts.

// The path a file: URL points at, in the OS's own form. `new URL().pathname`
// keeps a leading slash before a Windows drive letter and leaves the rest
// percent-encoded, so both need undoing.
export function fileUrlToPath(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null;
  try {
    const { pathname } = new URL(url);
    const decoded = decodeURIComponent(pathname);
    return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return null;
  }
}

// An address the agent's media server will answer, for a local file given
// either as a path or a file: URL. Null when there is nowhere to serve it from.
export function mediaUrl(pathOrFileUrl, mediaBaseUrl) {
  if (!pathOrFileUrl || !mediaBaseUrl) return null;

  const filePath = String(pathOrFileUrl).startsWith('file:')
    ? fileUrlToPath(pathOrFileUrl)
    : String(pathOrFileUrl);
  if (!filePath) return null;

  return `${String(mediaBaseUrl).replace(/\/$/, '')}/file?path=${encodeURIComponent(filePath)}`;
}

// A timeline's video URL as something a browser can load.
//
// Remote clips pass through untouched. A local one returns null when the agent
// is down — deliberately, because the composition draws its backdrop for a beat
// with no video, so the beat previews as the brand gradient with its captions
// and overlay intact rather than as an unexplained black rectangle.
export function toPreviewUrl(url, mediaBaseUrl) {
  if (typeof url !== 'string' || !url) return null;
  if (!url.startsWith('file:')) return url;
  return mediaUrl(url, mediaBaseUrl);
}

const isLocal = (url) => typeof url === 'string' && url.startsWith('file:');

// Both media fields a beat can carry as a local file. Narration is one of them:
// the voice stage writes a wav to the agent's disk, so the preview can no more
// play it from there than it can play a screen recording.
const LOCAL_FIELDS = ['videoUrl', 'audioUrl'];

// The same timeline with every local media URL pointed at the media server.
//
// Returns the input untouched when nothing needs rewriting, so the Player is
// not handed a new object identity on every render.
export function previewTimeline(timeline, mediaBaseUrl) {
  const beats = timeline?.beats;
  if (!Array.isArray(beats) || !beats.some(b => LOCAL_FIELDS.some(f => isLocal(b[f])))) {
    return timeline;
  }

  return {
    ...timeline,
    beats: beats.map(beat => {
      if (!LOCAL_FIELDS.some(f => isLocal(beat[f]))) return beat;

      const next = { ...beat };
      for (const field of LOCAL_FIELDS) {
        if (isLocal(next[field])) next[field] = toPreviewUrl(next[field], mediaBaseUrl);
      }
      return next;
    }),
  };
}

// How many beats hold local media the preview cannot reach. Drives the one-line
// explanation in the render panel, so a black or silent beat is never a
// mystery.
export function unplayableCaptureCount(timeline, mediaBaseUrl) {
  if (mediaBaseUrl) return 0;
  return (timeline?.beats ?? [])
    .filter(b => LOCAL_FIELDS.some(f => isLocal(b[f])))
    .length;
}
