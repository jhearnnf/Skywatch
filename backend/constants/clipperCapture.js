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

module.exports = { CAPTURE_FOCUS, focusFor };
