// CBAT "Sensory Motor Apparatus Test" (SMA) — the red dot and the crosshair.
//
// Straight from the guide: "A red dot drifting continuously across the display
// and a crosshair fixed at its centre; the job is to keep the two aligned. The
// joystick handles the vertical axis — push away to bring the dot down, pull
// back to bring it up. Foot pedals handle the lateral axis ... right pedal when
// the dot drifts left. The dot never holds position between corrections, so it
// is already moving while you respond to the last drift."
//
// That last sentence is the whole design. It rules out the obvious
// implementation — control sets the dot's POSITION, drift nudges it, you drag it
// back — because under position control the dot does hold still between
// corrections. What it describes is RATE control: the control sets a VELOCITY
// that is summed with a drift velocity, and the dot integrates the pair. Take
// your hand off and it keeps going. Null the error and you are still holding an
// input, because the drift has not stopped. This is the standard compensatory
// tracking task and it is what the apparatus is for.
//
//   dot' = drift(t) + control × CONTROL_RATE          (per axis, per second)
//
// Everything is in ARENA RADII: the display is a circle of radius 1 with the
// crosshair at the origin, so the tracking error is just |dot| ∈ [0, 1] and the
// scoring, the HUD bar and the tolerance ring all read off one number. The dot
// is clamped to the bezel rather than allowed off-screen — losing it entirely
// would end the run in everything but name.
//
// SIGNS. +x moves the dot RIGHT, +y moves the dot DOWN. Both match what the
// input layer already produces without a flip anywhere:
//   • gamepad.js defines +y as STICK FORWARD, and the guide says pushing away
//     brings the dot down. Pull back for up falls out of the same sign.
//   • a pointer below the middle of the arena reads +y, and pushing the dot
//     down is what you want the low half of the screen to mean.
//   • the right pedal is +x and moves the dot right, which is what you press
//     when it has drifted left.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) and a run replays
// exactly. The sim owns no timers — the page steps it — so tests drive it
// directly, and no part of it touches the DOM.

// Arena radii per second at full control deflection. For scale: full deflection
// crosses the whole face in about 1.2 seconds, which leaves the drift (peak 0.30
// on Hard, below) comfortably correctable but never ignorable.
export const CONTROL_RATE = 0.85

// The dot drifts for this long before anything is scored. Not in the corpus —
// it is ours, and it is there because the alternative is scoring a player during
// the half-second their hand is still finding the control. The clock the page
// shows counts this down separately.
export const LEAD_IN_MS = 2500

// Points earned per second held exactly on the crosshair. Everything scales off
// this: a perfect Hard run (60 scored seconds) is 600, and a perfect Easier run
// (30 seconds) is 300.
export const POINTS_PER_SEC = 10

// ── Forcing function ─────────────────────────────────────────────────────────
// The drift is a sum of sinusoids, which is the textbook forcing function for a
// tracking task: continuous, never zero for long, and — because the frequencies
// are mutually incommensurate — non-repeating for far longer than any run.
//
// The four frequencies differ between the axes on purpose. Sharing them would
// make the dot trace a Lissajous figure, and a player who noticed would be
// tracking a shape rather than a disturbance.
const DRIFT_FREQS_X = [0.071, 0.113, 0.191, 0.313]
const DRIFT_FREQS_Y = [0.089, 0.137, 0.229, 0.367]
// Weights sum to 1, so the peak of the sum is exactly the amplitude asked for
// and a tuning's `driftRate` means what it says.
const DRIFT_WEIGHTS = [0.40, 0.30, 0.20, 0.10]

// One axis of the forcing function, frozen at construction. Returns radii/sec at
// a time in seconds.
function makeDrift(freqs, phases, amplitude) {
  return (t) => {
    let v = 0
    for (let i = 0; i < freqs.length; i++) {
      v += DRIFT_WEIGHTS[i] * Math.sin(2 * Math.PI * freqs[i] * t + phases[i])
    }
    return v * amplitude
  }
}

// ── Gusts ────────────────────────────────────────────────────────────────────
// Hard only. NOT from the corpus — nobody describes gusts, and this file would
// rather say so than dress an invention up as evidence.
//
// They are here for a known weakness of a pure sum-of-sinusoids: given long
// enough a player stops compensating and starts ANTICIPATING, at which point the
// task measures pattern learning instead of motor control. An impulse the
// forcing function cannot predict puts the player back on the back foot without
// changing what is being measured. It also keeps a minute from settling into one
// steady correction. Easier ships without them: at that drift rate, over thirty
// seconds, there is no pattern to learn in the first place.
const GUST_MIN_MS = 9000
const GUST_MAX_MS = 14000
// Peak radii/sec added at the instant of the gust, decaying exponentially.
const GUST_PEAK = 0.55
const GUST_TAU_MS = 700

export function createSmaSim({ rng = Math.random, tuning } = {}) {
  const t = tuning || {}
  const durationMs = t.durationMs ?? 60000
  const driftRate = t.driftRate ?? 0.30
  const ringRadius = t.ringRadius ?? 0.16
  const gusts = t.gusts !== false

  const phasesX = DRIFT_FREQS_X.map(() => rng() * Math.PI * 2)
  const phasesY = DRIFT_FREQS_Y.map(() => rng() * Math.PI * 2)
  const driftX = makeDrift(DRIFT_FREQS_X, phasesX, driftRate)
  const driftY = makeDrift(DRIFT_FREQS_Y, phasesY, driftRate)

  // The whole gust schedule is drawn up front rather than rolled as the run
  // goes, so a seed fixes the entire run and a test can assert where the gusts
  // land without stepping to them.
  const gustList = []
  if (gusts) {
    let at = GUST_MIN_MS + rng() * (GUST_MAX_MS - GUST_MIN_MS)
    while (at < LEAD_IN_MS + durationMs) {
      const angle = rng() * Math.PI * 2
      gustList.push({ at, vx: Math.cos(angle) * GUST_PEAK, vy: Math.sin(angle) * GUST_PEAK })
      at += GUST_MIN_MS + rng() * (GUST_MAX_MS - GUST_MIN_MS)
    }
  }

  const state = {
    elapsedMs: 0,
    durationMs,
    leadInMs: LEAD_IN_MS,
    ringRadius,
    // Dot position in arena radii. Starts on the crosshair, which is where the
    // real apparatus starts you, and immediately begins to wander.
    x: 0,
    y: 0,
    // Live error, so the page reads one field rather than recomputing hypot.
    error: 0,
    score: 0,
    finished: false,
    // Scoring-window accumulators. `scoredMs` is the denominator for every
    // percentage below and is NOT the same as elapsedMs — the lead-in is free.
    scoredMs: 0,
    onTargetMs: 0,
    sumSqError: 0,
    worstError: 0,
    gusts: gustList,
    _gustIdx: 0,
    // Gust velocity still decaying, in radii/sec.
    _gustVx: 0,
    _gustVy: 0,
  }

  // `input` is the control deflection, { x, y } each in [-1, 1], already
  // dead-zoned and curved by the input layer. The sim has no opinion about
  // where it came from — stick, mouse, thumb or arrow key all arrive here as
  // the same two numbers.
  function step(dtMs, input) {
    if (state.finished) return
    const dt = Math.max(0, dtMs) / 1000
    const scoring = state.elapsedMs >= state.leadInMs

    // Gusts fire on the crossing, and their contribution decays from there. The
    // while-loop rather than an if covers a long frame that jumped two gusts.
    while (state._gustIdx < state.gusts.length && state.elapsedMs >= state.gusts[state._gustIdx].at) {
      const g = state.gusts[state._gustIdx]
      state._gustVx += g.vx
      state._gustVy += g.vy
      state._gustIdx += 1
    }
    const decay = Math.exp(-dtMs / GUST_TAU_MS)

    // Drift is sampled at the MIDPOINT of the frame. At 60 Hz it makes no
    // measurable difference; at the 100 ms steps a backgrounded tab produces it
    // is the difference between the dot arriving where the maths says it should
    // and drifting off by a visible margin.
    const tMid = (state.elapsedMs + dtMs / 2) / 1000
    const vx = driftX(tMid) + state._gustVx + (input?.x || 0) * CONTROL_RATE
    const vy = driftY(tMid) + state._gustVy + (input?.y || 0) * CONTROL_RATE

    state.x += vx * dt
    state.y += vy * dt
    state._gustVx *= decay
    state._gustVy *= decay

    // Clamp to the bezel. Radial rather than per-axis, because the display is a
    // circle: clamping x and y separately would let the dot sit in a corner that
    // does not exist and read an error of 1.41 on a face whose edge is 1.
    const r = Math.hypot(state.x, state.y)
    if (r > 1) {
      state.x /= r
      state.y /= r
    }
    state.error = Math.min(1, r)

    if (scoring) {
      // Only the part of the frame inside the scoring window counts, so the
      // frame straddling the lead-in boundary is not scored whole.
      const scoredDt = Math.min(dt, (state.elapsedMs + dtMs - state.leadInMs) / 1000)
      state.scoredMs += scoredDt * 1000
      // Full rate dead centre, nothing at the ring, linear between. A player
      // parked just outside the ring earns nothing, which is what makes the ring
      // a target rather than decoration.
      const accuracy = Math.max(0, 1 - state.error / state.ringRadius)
      state.score += POINTS_PER_SEC * scoredDt * accuracy
      if (state.error <= state.ringRadius) state.onTargetMs += scoredDt * 1000
      state.sumSqError += state.error * state.error * scoredDt
      if (state.error > state.worstError) state.worstError = state.error
    }

    state.elapsedMs += dtMs
    if (state.elapsedMs >= state.leadInMs + state.durationMs) {
      state.elapsedMs = state.leadInMs + state.durationMs
      state.finished = true
    }
  }

  // A plain object for the render tree. The page writes the dot straight into
  // the DOM each frame instead (see CbatSma.jsx), so this is read at a few Hz
  // for the HUD numbers rather than every frame.
  function snapshot() {
    return {
      x: state.x,
      y: state.y,
      error: state.error,
      score: Math.round(state.score),
      elapsedMs: state.elapsedMs,
      leadInRemainingMs: Math.max(0, state.leadInMs - state.elapsedMs),
      remainingMs: Math.max(0, state.leadInMs + state.durationMs - state.elapsedMs),
      onTarget: state.error <= state.ringRadius,
      finished: state.finished,
    }
  }

  return { step, snapshot, state }
}

// The score a flawless run gets — the dot pinned exactly on the crosshair for
// every scored second. Unreachable in practice (the drift is never zero), which
// is the point: it is the denominator the results screen shows a percentage
// against, not a target.
export function maxSmaScore(tuning) {
  return Math.round(POINTS_PER_SEC * ((tuning?.durationMs ?? 60000) / 1000))
}

// Everything the results screen and the submitted payload need, derived from the
// accumulators rather than re-walked. Percentages are integers because nothing
// downstream wants a fifth significant figure on a tracking error.
export function smaStats(sim) {
  const s = sim.state
  const scoredSec = s.scoredMs / 1000
  const rms = scoredSec > 0 ? Math.sqrt(s.sumSqError / scoredSec) : 0
  return {
    totalScore: Math.round(s.score),
    // Share of the scored window spent inside the tolerance ring.
    onTargetPct: s.scoredMs > 0 ? Math.round((s.onTargetMs / s.scoredMs) * 100) : 0,
    // Root-mean-square radial error as a percentage of the display radius. The
    // single number a real tracking task is scored on, kept alongside our own
    // points so a run stays comparable if the points formula is ever retuned.
    rmsErrorPct: Math.round(rms * 100),
    worstErrorPct: Math.round(s.worstError * 100),
    totalTime: s.elapsedMs / 1000,
  }
}
