// Making a capture look played rather than driven.
//
// ── What was wrong ──────────────────────────────────────────────────────────
// The generic `demoPlay` step pressed controls from inside the page, with
// `el.dispatchEvent(new PointerEvent('pointerdown', { bubbles, cancelable }))`.
// A PointerEvent built that way has clientX/clientY of 0, and the synthetic
// cursor (capture/cursor.js) draws its tap ripple at the event's coordinates -
// so every ripple in every generic capture landed in the top-left corner of the
// frame. The driver never dispatched pointermove at all, so the cursor dot sat
// off-screen at its start position for the whole recording.
//
// The result was footage where the UI reacts to nothing visible: numbers appear
// in the answer box, shapes light up, and no hand is anywhere near them. That
// reads as a replay or a glitch, never as somebody playing.
//
// Everything here therefore drives Playwright's real mouse. The cursor overlay
// follows it for free because those are genuine input events, the ripple lands
// under the pointer, and - the part no synthetic dispatch can give you - the
// browser hit-tests the click, so an imprecise aim genuinely misses.
//
// ── On being human ──────────────────────────────────────────────────────────
// Teleporting to a control and clicking it instantly is still robotic even with
// a visible cursor. Three things do most of the work: travel that eases and
// slightly overshoots, a pause between arriving and pressing, and a cadence
// that varies. Hesitation - drifting toward one target, pausing, then taking
// another - is the cheapest convincing detail, and unlike a wrong answer it
// costs nothing on camera.
//
// Deliberate mistakes are kept rare on purpose. This footage advertises an
// aptitude trainer, and a clip of the product being failed is a mixed message.
// A few genuine misses are honest, since nobody aces these tests; flailing is
// not. Hence MISS_RATE well below HESITATE_RATE.

// Deterministic by default so a run can be reproduced from its seed, and so the
// timing helpers are testable without stubbing Math.random.
function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Milliseconds between arriving over a control and pressing it. Below ~120ms
// the press reads as part of the movement rather than a decision.
const DWELL_MS = [150, 400];
// Between digits of one answer. This is the range that reads as typing: faster
// looks like a paste, slower looks like two separate decisions.
const DIGIT_GAP_MS = [120, 250];
// Pointer travel, independent of distance. Real hands do not move at constant
// speed, but they do take roughly constant time over short distances.
const TRAVEL_MS = [180, 340];
// How long a hesitation lingers over the target it does not take.
const HESITATE_MS = [220, 520];

const HESITATE_RATE = 0.18;
const MISS_RATE = 0.08;

// Fraction of the smaller box dimension that an aim may stray from centre. At
// 0.55 a press still lands inside an ordinary button; the scatter only matters
// when it is deliberately widened for a miss.
const AIM_SPREAD = 0.55;
const MISS_SPREAD = 1.6;

const between = ([lo, hi], rng) => Math.round(lo + (hi - lo) * rng());

// A pointer path from one point to another: ease-out, with a small overshoot
// that settles back. The overshoot is what separates a hand from an animation -
// a cursor that arrives exactly on target and stops dead reads as a tween.
function travelPath(from, to, { steps = 12, overshoot = 0.07, rng = Math.random } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const over = overshoot * (0.5 + rng());
  const path = [];

  // easeOutBack: rises past 1 in the last third, then settles back onto it.
  // An earlier version added a sine bump to an ease-out cubic and damped it by
  // (1 - eased), which is zero exactly where the overshoot was meant to happen
  // - so the curve never actually passed the target and the movement was still
  // a tween. c1 sets how far past it goes; the standard 1.70158 overshoots by
  // about a tenth, which is far too much for a pointer.
  const c1 = over * 17;
  const c3 = c1 + 1;

  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const k = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    path.push({ x: from.x + dx * k, y: from.y + dy * k });
  }

  // Always finish exactly on the target, whatever the overshoot did.
  path[path.length - 1] = { x: to.x, y: to.y };
  return path;
}

// Where inside a control to aim. Biased to the centre, because that is where
// people aim; `miss` widens the spread past the box edge so the click genuinely
// falls outside and the browser hit-tests it as a miss.
function aimPoint(box, { rng = Math.random, miss = false } = {}) {
  const spread = miss ? MISS_SPREAD : AIM_SPREAD;
  // Two samples averaged, so the distribution peaks at the centre rather than
  // being flat across the box.
  const bias = () => (rng() + rng()) / 2 - 0.5;
  return {
    x: box.x + box.width / 2 + bias() * box.width * spread,
    y: box.y + box.height / 2 + bias() * box.height * spread,
  };
}

// Does this control's label read as a single digit? Used to spot a numeric
// keypad without knowing which game is on screen: ten enabled single-digit
// controls is a numpad waiting for an answer, in FLAG or anywhere else.
function isDigitLabel(text) {
  return /^[0-9]$/.test(String(text ?? '').trim());
}

// A game that disables its keypad until a question is live (FLAG passes
// `disabled={!mathsActive}` to Numpad) tells us, just by having them enabled,
// that there is something to answer. No per-game knowledge required.
function digitTargets(targets) {
  return targets.filter(t => isDigitLabel(t.label));
}

// One hand on the mouse.
//
// Holds its own position because Playwright's mouse is stateful and a path has
// to start from wherever the pointer actually is - starting every move from the
// centre would produce a visible snap before each press.
function createHand(page, { rng = Math.random, startedAt = Date.now(), viewport, log = [] } = {}) {
  let at = { x: viewport.width / 2, y: viewport.height * 0.62 };

  // Normalised so the log survives the 596x1060 -> 1080x1920 upscale, and so a
  // consumer never has to know the capture viewport. See buildTimeline, which
  // turns these into a focus rect.
  const record = (point, kind) => {
    log.push({
      atMs: Math.max(0, Date.now() - startedAt),
      x: Number((point.x / viewport.width).toFixed(4)),
      y: Number((point.y / viewport.height).toFixed(4)),
      kind,
    });
  };

  async function moveTo(point, overMs) {
    const path = travelPath(at, point, { rng });
    const step = Math.max(8, Math.round((overMs ?? between(TRAVEL_MS, rng)) / path.length));
    for (const p of path) {
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(step);
    }
    at = point;
  }

  // down/up rather than click(): the pointer is already there, and click()
  // would issue a second move to the same coordinates.
  async function pressHere(kind) {
    await page.mouse.down();
    await page.waitForTimeout(between([40, 90], rng));
    await page.mouse.up();
    record(at, kind);
  }

  async function tap(box, { kind = 'press', miss = false } = {}) {
    await moveTo(aimPoint(box, { rng, miss }));
    await page.waitForTimeout(between(DWELL_MS, rng));
    await pressHere(miss ? 'miss' : kind);
  }

  // Drift toward one control, think better of it, take another. The pause over
  // the abandoned target is what sells it; without it this is just a curved
  // path to the real one.
  async function hesitateThenTap(decoyBox, box, opts = {}) {
    await moveTo(aimPoint(decoyBox, { rng }));
    await page.waitForTimeout(between(HESITATE_MS, rng));
    await tap(box, opts);
  }

  // Enter an answer as a run of digits rather than one key every cadence tick.
  // A two-digit answer typed in under half a second is the shot that reads as
  // "somebody answered that"; the same two presses 900ms apart read as noise.
  async function typeDigits(boxes) {
    for (let i = 0; i < boxes.length; i++) {
      await moveTo(aimPoint(boxes[i], { rng }));
      // Only the first keypress gets a full decision pause. Within a number the
      // hand is already committed.
      await page.waitForTimeout(i === 0 ? between(DWELL_MS, rng) : between(DIGIT_GAP_MS, rng));
      await pressHere('type');
    }
  }

  return { moveTo, tap, hesitateThenTap, typeDigits, log, position: () => ({ ...at }) };
}

module.exports = {
  makeRng,
  travelPath,
  aimPoint,
  isDigitLabel,
  digitTargets,
  createHand,
  between,
  DWELL_MS,
  DIGIT_GAP_MS,
  TRAVEL_MS,
  HESITATE_RATE,
  MISS_RATE,
};
