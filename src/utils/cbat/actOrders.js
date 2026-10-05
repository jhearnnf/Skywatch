// ACT colour / number orders — Real CBAT theme only.
//
// Candidates who sat the real test describe a third kind of instruction on top
// of the shapes and the bleep: the ball carries a colour (red, green, yellow)
// and a number (1-9), and the voice tells you to change one of them, either
// straight away ("Bravo Echo, change colour to red") or at a set second on the
// round clock ("…change number to 7 at 45 seconds"). Orders on someone else's
// callsign are fakes and must be ignored.
//
// Everything here is pure so the rules can be tested without the audio engine
// or the canvas. The planner (cbatActPlan.js) decides WHERE in the round orders
// sit; this module decides what they say and how a change is scored.

export const ORDER_COLOURS = ['red', 'green', 'yellow']
export const ORDER_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

// Hex used for the ball and the HUD swatch. Saturated enough to read against
// the Real CBAT tunnel's dark blue.
export const ORDER_COLOUR_HEX = {
  red:    '#e5322d',
  green:  '#2fbf46',
  yellow: '#f2d22e',
}

// Keyboard: first letter of each colour, digits for the number.
export const COLOUR_KEYS = { r: 'red', g: 'green', y: 'yellow' }

// The spoken due time only ever falls in this range, because those are the
// only numbers recorded (twenty … eighty plus the units).
export const DUE_SECOND_MIN = 20
export const DUE_SECOND_MAX = 89

// An immediate order is open from the moment it starts playing until this long
// after the voice stops.
export const IMMEDIATE_WINDOW_S = 5

// A delayed order is open while the clock reads the due second and the next
// two after it. Earlier than that is too early; the order is spent.
export const DELAYED_WINDOW_S = 3

export const ORDER_SCORE = {
  OBEYED: 30,
  MISSED: -20,
  // A change no live order asked for: obeying a fake, the wrong value, or
  // fiddling with the ball.
  FALSE_CHANGE: -15,
}

// ── Audio chunk names ───────────────────────────────────────────────────────
// Internal buffer keys. The engine maps them to files — see ORDER_CHUNK_FILES.

export const ORDER_CHUNK = {
  changeColour: 'order_change_colour_to',
  changeNumber: 'order_change_number_to',
  at:           'order_at',
  seconds:      'order_seconds',
}
export const colourChunk = (c) => `order_${c}`
export const numberChunk = (n) => `order_${n}`

// Tens recorded for the due time. Units reuse the 1-9 number clips.
export const DUE_TENS = [20, 30, 40, 50, 60, 70, 80]

// Chunks spoken for a due second: "forty" + "five", or just "sixty".
export function dueSecondChunks(n) {
  const tens = Math.floor(n / 10) * 10
  const units = n % 10
  const out = [numberChunk(tens)]
  if (units) out.push(numberChunk(units))
  return out
}

// The full chunk list for one order, callsign first.
//   order: { attr: 'colour' | 'number', value, dueS? }
export function buildOrderSequence(callsigns, order) {
  const names = [...callsigns]
  if (order.attr === 'colour') names.push(ORDER_CHUNK.changeColour, colourChunk(order.value))
  else names.push(ORDER_CHUNK.changeNumber, numberChunk(order.value))
  if (order.dueS != null) names.push(ORDER_CHUNK.at, ...dueSecondChunks(order.dueS), ORDER_CHUNK.seconds)
  return names
}

// ── Values ──────────────────────────────────────────────────────────────────

export function randomBallState(rand = Math.random) {
  return {
    colour: ORDER_COLOURS[Math.floor(rand() * ORDER_COLOURS.length)],
    number: ORDER_NUMBERS[Math.floor(rand() * ORDER_NUMBERS.length)],
  }
}

// A value for `attr` that differs from `current`, so every order asks for a
// real change.
export function pickOrderValue(attr, current, rand = Math.random) {
  const pool = (attr === 'colour' ? ORDER_COLOURS : ORDER_NUMBERS).filter(v => v !== current)
  return pool[Math.floor(rand() * pool.length)]
}

// The second a delayed order is due, given the clock now, how long the voice
// will take and the planned lead. Null when it would fall outside the
// recorded range — the cue is then dropped rather than mis-spoken.
export function resolveDueSecond(elapsedS, audioS, leadS) {
  const due = Math.max(DUE_SECOND_MIN, Math.ceil(elapsedS + audioS + leadS))
  return due > DUE_SECOND_MAX ? null : due
}

// ── Scoring ─────────────────────────────────────────────────────────────────
// An armed order:
//   { attr, value, opensAtS, closesAtS, status: 'pending' | 'obeyed' | 'missed' }
// Times are round-clock seconds (the "Seconds" readout).

export function armImmediateOrder(attr, value, startedAtS, audioS) {
  return { attr, value, mode: 'now', opensAtS: startedAtS, closesAtS: startedAtS + audioS + IMMEDIATE_WINDOW_S, status: 'pending' }
}

export function armDelayedOrder(attr, value, dueS) {
  return { attr, value, mode: 'at', opensAtS: dueS, closesAtS: dueS + DELAYED_WINDOW_S, status: 'pending' }
}

// The player set `attr` to `value` at `nowS`. Mutates the matching order's
// status and returns what happened:
//   'obeyed'  — a live order asked for exactly this, inside its window
//   'early'   — a delayed order asked for this, but its second has not come;
//               the order is spent (missed) and there is no extra penalty
//   'false'   — nothing asked for this change
export function applyBallChange(orders, attr, value, nowS) {
  for (const o of orders) {
    if (o.status !== 'pending' || o.attr !== attr || o.value !== value) continue
    if (nowS >= o.opensAtS && nowS < o.closesAtS) { o.status = 'obeyed'; return 'obeyed' }
    if (nowS < o.opensAtS) { o.status = 'missed'; return 'early' }
  }
  return 'false'
}

// Close every pending order whose window has passed. Returns how many were
// missed this call.
export function expireOrders(orders, nowS) {
  let missed = 0
  for (const o of orders) {
    if (o.status === 'pending' && nowS >= o.closesAtS) { o.status = 'missed'; missed++ }
  }
  return missed
}

// End of round. An order whose window was already open counts as missed; one
// whose second never arrived is dropped unscored — the round ran out, not the
// player.
export function settleOrdersAtRoundEnd(orders, nowS) {
  let missed = 0
  for (const o of orders) {
    if (o.status !== 'pending') continue
    if (nowS >= o.opensAtS) { o.status = 'missed'; missed++ }
    else o.status = 'dropped'
  }
  return missed
}

// ── Splitting a two-word recording ──────────────────────────────────────────
// "at" and "seconds" were recorded as one take with no pause. They are cut
// apart at load time where the level first drops after the speech starts —
// the end of "at" — so each word can be spoken around the number. The cut is
// the START of that quiet run, not its quietest point: the female take runs
// "at" straight into the hiss of the "s", which sits inside the quiet run, and
// cutting at its quietest frame handed the "s" to "at" ("ats" / "econds").
// Returns the sample index to cut at, or null when no clear dip exists (the
// delayed orders then simply never play in that voice).
export function findWordSplit(samples, sampleRate, {
  frameS = 0.01, onsetDb = -15, gapDb = -20, minGapFrames = 3,
} = {}) {
  const frame = Math.max(1, Math.round(sampleRate * frameS))
  const rms = []
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let acc = 0
    for (let j = i; j < i + frame; j++) acc += samples[j] * samples[j]
    rms.push(Math.sqrt(acc / frame))
  }
  const peak = rms.reduce((m, v) => Math.max(m, v), 0)
  if (!peak) return null
  const onsetLevel = peak * 10 ** (onsetDb / 20)
  const gapLevel = peak * 10 ** (gapDb / 20)

  const onset = rms.findIndex(v => v >= onsetLevel)
  if (onset < 0) return null
  // First run of quiet frames after the onset.
  for (let i = onset; i < rms.length; i++) {
    if (rms[i] >= gapLevel) continue
    let end = i
    while (end < rms.length && rms[end] < gapLevel) end++
    if (end - i >= minGapFrames) {
      // Speech has to resume after the gap, or this is just the tail.
      const resumes = rms.slice(end).some(v => v >= onsetLevel)
      return resumes ? i * frame : null
    }
    i = end
  }
  return null
}
