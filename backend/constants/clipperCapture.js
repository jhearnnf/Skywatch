// How much of a screen recording actually belongs on screen.
//
// Captures are recorded at 596x1060 — the largest viewport that still triggers
// the app's mobile layout — and upscaled to 1080x1920 at encode time (see the
// framing note in clipper-agent/handlers/capture.js). What that note does not
// cover is that the recorded frame and the *interesting* part of the recorded
// frame are not the same rectangle, and the difference is per page.
//
// These rects were measured off real captures, not guessed:
//
//   play-dpt            the game renders at a fixed width inside the viewport,
//                       so content stops at x=0.775 and the right fifth of
//                       every frame is empty background. Shown whole, a fifth
//                       of a short-form video is nothing at all.
//   cbat-home           fills the width. Only the status bar and BottomNav are
//                       worth losing, so the crop is mild.
//   browse-leaderboard  same layout as cbat-home.
//
// Rects are fractions of the frame and are kept at the 9:16 aspect of the
// composition, so applying one is a pure zoom-and-offset with no letterboxing.
// A punch-in costs sharpness — the source is already upscaled 1.81x — which is
// why the crops are as small as they can be while still doing their job.
const CAPTURE_FOCUS = {
  // 0.79 wide against content that ends at 0.775, so nothing is clipped;
  // sat high enough to keep the whole radar, which costs the bottom row of the
  // keypad. The radar is the thing being explained; the keypad is context.
  'play-dpt':           { x: 0,    y: 0.03,  width: 0.79, height: 0.79 },
  'cbat-home':          { x: 0.06, y: 0.04,  width: 0.88, height: 0.88 },
  'browse-leaderboard': { x: 0.06, y: 0.04,  width: 0.88, height: 0.88 },
};

// Anything we have not measured is left alone. A wrong crop is worse than no
// crop: it cuts the subject in half rather than merely framing it loosely.
function focusFor(recipeId) {
  return CAPTURE_FOCUS[String(recipeId || '')] ?? null;
}

// ── Focusing on where the hand actually went ────────────────────────────────
//
// The rects above are measured once, per recipe, and they answer "which part of
// this page is worth showing". They cannot answer the more useful question:
// which part of it is being USED right now. The capture bot reports an input
// log (clipper-agent/capture/humanInput.js) of every press it made, in clip
// time and normalised to the viewport, and that is a direct record of where the
// interesting thing happened.
//
// Deriving the crop here rather than baking a zoom into the recording is the
// whole point. A punch-in encoded into the MP4 cannot be retuned, cannot be
// switched off for a beat, and would fight both the Ken Burns move and the
// phone frame - all of which are decided at render time.

// Fraction of the frame the derived rect covers. Square in FRACTIONS, which on
// a 9:16 frame is a 9:16 rect - the same convention CAPTURE_FOCUS uses, so
// applying one stays a pure zoom-and-offset with no letterboxing.
const INPUT_FOCUS_SIZE = 0.72;

// Below this there is not enough evidence to say where the action was, and a
// crop built on one stray press is worse than no crop.
const MIN_INPUT_POINTS = 3;

// Median absolute deviation above which the presses are simply spread across
// the screen. Games like FLAG deliberately put the numpad, the play field and
// the callsign question in different corners; when a stretch of play touches
// all three there is no "where the action is", and zooming on their average
// centre would crop away every one of them.
const MAX_INPUT_SPREAD = 0.26;

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Median absolute deviation, not standard deviation: one press on the far side
// of the screen should not be able to veto a crop that the other twelve agree
// on.
const spread = (xs, mid) => median(xs.map(v => Math.abs(v - mid)));

const clamp01 = (v, size) => Math.min(Math.max(v, 0), 1 - size);

// The rect to punch in on for one shot, or null to leave the framing alone.
//
// `startMs`/`endMs` are positions in the CLIP, matching the log's own clock -
// a shot starting at trimInMs only cares about presses made while it is on
// screen.
function focusFromInput(inputLog, { startMs = 0, endMs = Infinity } = {}) {
  if (!Array.isArray(inputLog) || inputLog.length === 0) return null;

  const points = inputLog.filter(p =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && Number.isFinite(p.atMs) && p.atMs >= startMs && p.atMs <= endMs);

  if (points.length < MIN_INPUT_POINTS) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const cx = median(xs);
  const cy = median(ys);

  if (spread(xs, cx) > MAX_INPUT_SPREAD || spread(ys, cy) > MAX_INPUT_SPREAD) return null;

  const size = INPUT_FOCUS_SIZE;
  return {
    x: clamp01(cx - size / 2, size),
    y: clamp01(cy - size / 2, size),
    width: size,
    height: size,
  };
}

module.exports = {
  CAPTURE_FOCUS,
  focusFor,
  focusFromInput,
  INPUT_FOCUS_SIZE,
  MIN_INPUT_POINTS,
  MAX_INPUT_SPREAD,
};
