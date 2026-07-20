// ACT audio plan + shape stream generation.
//
// Extracted from CbatAct.jsx so the planner can be unit-tested without pulling
// in three.js / R3F. The planner is pure JS — pass `curveLen` (world units)
// instead of a curve object.

import { generateDistractorCallsign, CODE_DIGITS } from './actAudio'
//
// Core invariants enforced here (the source of truth for ACT scheduling):
//   1. Triangles are NEVER the target of an "avoid" command. They're pure
//      default-thread filler that creates buffer space between cue and target.
//   2. When an avoid cue's audio STARTS, the target shape is not yet rendered
//      on screen (≥ RENDERED_AHEAD + 1 events between firstUpcoming and target).
//   3. Between an avoid cue's audio start and the first time the player sees
//      a same-shape rendered, NO same-shape exists. The target is the FIRST
//      same-shape the player will see — never preceded by another same-shape
//      that wasn't already passed.
//   4. There's always ≥ MIN_THINK_TIME_S of dead air between the END of avoid
//      audio (~AUDIO_DURATION_S_EST) and the target's arrival, so the player
//      has time to commit the instruction to working memory.
//   5. Two avoid cues never overlap: the next cue's audio cannot start until
//      the previous target has been crossed + POST_TARGET_GAP_S.
//   6. On the final round, NO cue of any kind — avoid, distractor or bleep —
//      overlaps the memory-code block. The readout is ~7s of speech the player
//      has to hold for the rest of the round; the audio engine would silently
//      drop whichever exclusive sequence started second, and a bleep landing
//      mid-readout masks a digit.

// ── Tunable constants ───────────────────────────────────────────────────────

// Matches ActScene's rendering window in CbatAct.jsx (firstUpcoming..+3).
// If you change the rendered upcoming count there, change this here too.
export const RENDERED_AHEAD = 3

// Seconds of dead air between audio END and target arrival. ~3s lets the
// player commit "avoid the next circle" to memory before steering at the
// target shape.
export const MIN_THINK_TIME_S = 3

// Worst-case length of an avoid audio sequence (3 callsign clips + the
// combined "avoid the next X" clip). Used to convert MIN_THINK_TIME_S to a
// t-distance via cfg.speed and curveLen.
export const AUDIO_DURATION_S_EST = 2.8

// Real-time gap between target A being crossed and audio for avoid cue B
// being allowed to start. Stops two "avoid the next circle" cues stacking
// while the player is still resolving the first.
export const POST_TARGET_GAP_S = 0.6

// No audio cues fire before the ball reaches this fraction along the curve.
export const AUDIO_WARMUP_T = 0.15

// World-space buffer before the first shape — long enough that the 3-second
// callsign overlay can play out before the ball arrives.
export const START_BUFFER_WORLD_UNITS = 45
export const END_MARGIN_T = 0.05

// Markov repeat probability for CIRCLE↔SQUARE (triangles never repeat-bias).
// Higher rounds produce longer same-type runs, but only when both shapes are
// circle/square — triangles always intermix freely.
export const SHAPE_REPEAT_PROB = [0.30, 0.45, 0.55, 0.65, 0.72]

// Shape mix in the stream — the INITIAL roll probability for triangles.
// The spacing invariant (≥ RENDERED_AHEAD+1 between same-shape events) forces
// additional triangles when both circle and square are blocked, so the actual
// triangle ratio ends up ~15-20 points higher than this value. Keep this low
// enough that round 1 has enough non-triangle events to support 2+ avoid
// cues (each avoid needs a non-triangle target at index ≥ RENDERED_AHEAD+1).
export const TRIANGLE_FRACTION = 0.30

// Max lateral offset of a shape from the curve centreline, in world units.
// Each event gets a random {offsetU, offsetV} within a disc of this radius —
// the renderer applies it through the shape's local cross-section frame, so
// shapes appear off-centre in the tunnel instead of all sitting dead-centre.
// Tunnel radius is 2.0 and shape radius is 0.7, so 0.7 keeps the shape edge
// at ≤ 1.4 from the wall — still comfortably threadable.
export const MAX_SHAPE_OFFSET = 0.7

// ── Round-5 memory code ─────────────────────────────────────────────────────

// Only the final round carries the memory code.
export const CODE_ROUND_IDX = 4

export const CODE_LENGTH = 7

// Where the readout starts — roughly a quarter of the way in, so the player
// carries the code for most of the round. Jittered a little so it isn't
// metronomic across replays.
export const CODE_CUE_T = 0.25
export const CODE_CUE_JITTER_T = 0.02

// Conservative estimate of the readout's length ("remember code" + 7 digits,
// spaced by CODE_DIGIT_GAP_S). The engine measures the real duration from its
// decoded buffers at runtime; this only has to be long enough that the
// reserved block never under-covers.
export const CODE_AUDIO_DURATION_S_EST = 10

// Points for the recall at the end of round 5. Partial credit per digit in the
// right position, plus a bonus for a clean sweep — a 6/7 recall shouldn't be
// worth the same as never listening. No penalty for a wrong answer: losing a
// round's worth of attention to the code is cost enough.
export const CODE_SCORE = {
  PER_DIGIT:   25,
  ALL_CORRECT: 75,
}

// A fresh code. Digits repeat freely (CODE_DIGITS has no zero — see actAudio).
export function generateMemoryCode(length = CODE_LENGTH) {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_DIGITS[Math.floor(Math.random() * CODE_DIGITS.length)]
  }
  return out
}

// Score a recall attempt. Correct-in-position only: transposed digits earn
// nothing, which is the point of a serial-recall task.
export function scoreCodeRecall(expected, entered) {
  const exp = String(expected ?? '')
  const got = String(entered ?? '')
  let digitsCorrect = 0
  for (let i = 0; i < exp.length; i++) {
    if (got[i] === exp[i]) digitsCorrect++
  }
  const allCorrect = exp.length > 0 && digitsCorrect === exp.length && got.length === exp.length
  const score = digitsCorrect * CODE_SCORE.PER_DIGIT + (allCorrect ? CODE_SCORE.ALL_CORRECT : 0)
  return { digitsCorrect, allCorrect, score }
}

// Floor on per-round avoid cue count — the player must hear their callsign
// at least this many times so they can train recognition under stress.
export const MIN_AVOID_CUES = 2

// Ceiling on per-round avoid cue count — even when avoidOdds rolls high, no
// round should ship more than this many avoids. Keeps round duration honest
// and prevents pile-ups when the same-shape stream happens to be dense.
export const MAX_AVOID_CUES = 7

// ── Shape stream ────────────────────────────────────────────────────────────

// Produce the in-tunnel shape sequence for one round. Returns events in
// strict t-order with ids 0..count-1.
//
// Spacing invariant: any two same-shape circle/square events are at least
// RENDERED_AHEAD + 2 apart in index. The audio planner rejects any avoid
// target with prevSameShape >= i - RENDERED_AHEAD - 1, so prevSameShape
// must satisfy i - prevSameShape > RENDERED_AHEAD + 1. Without this
// invariant the constraint rejects ~70% of candidates and rounds end up
// with only 1 avoid cue.
export function generateShapeEvents(curveLen, count, roundIdx) {
  const startMarginT = Math.min(0.45, START_BUFFER_WORLD_UNITS / curveLen)
  const repeatProb = SHAPE_REPEAT_PROB[Math.min(roundIdx, 4)]
  const events = []
  let prev = null
  let lastCircleIdx = -Infinity
  let lastSquareIdx = -Infinity
  for (let i = 0; i < count; i++) {
    const t = startMarginT + (1 - END_MARGIN_T - startMarginT) * (i / Math.max(1, count - 1))
    const canCircle = i - lastCircleIdx > RENDERED_AHEAD + 1
    const canSquare = i - lastSquareIdx > RENDERED_AHEAD + 1
    let shape
    if (Math.random() < TRIANGLE_FRACTION || (!canCircle && !canSquare)) {
      shape = 'triangle'
    } else if (canCircle && canSquare) {
      if (prev === 'circle' || prev === 'square') {
        // Repeat-bias only applies when the previous shape was a
        // circle/square; after a triangle, fresh 50/50 keeps the
        // avoid-target pool balanced.
        shape = Math.random() < repeatProb
          ? prev
          : (prev === 'circle' ? 'square' : 'circle')
      } else {
        shape = Math.random() < 0.5 ? 'circle' : 'square'
      }
    } else if (canCircle) {
      shape = 'circle'
    } else {
      shape = 'square'
    }
    if (shape === 'circle') lastCircleIdx = i
    else if (shape === 'square') lastSquareIdx = i
    prev = shape
    const colorIdx = Math.floor(Math.random() * 4)
    // Random lateral offset within a disc of radius MAX_SHAPE_OFFSET — sqrt
    // on the magnitude gives uniform area density so offsets don't bunch up
    // toward the centre. offsetU/offsetV are in the shape's local cross-
    // section frame; the renderer + threading check transform them to world.
    const offsetAngle = Math.random() * Math.PI * 2
    const offsetMag = Math.sqrt(Math.random()) * MAX_SHAPE_OFFSET
    const offsetU = Math.cos(offsetAngle) * offsetMag
    const offsetV = Math.sin(offsetAngle) * offsetMag
    events.push({ id: i, t, shape, colorIdx, offsetU, offsetV, threaded: null })
  }
  return events
}

// ── Audio plan ──────────────────────────────────────────────────────────────

// Returns the natural audio-T window for this candidate target — the window
// dictated by off-screen + same-shape + think-time constraints, IGNORING any
// already-scheduled cues. Returns null if no such window exists. Callers
// further intersect this with the "free" intervals around existing cues.
function naturalAudioWindow(events, targetIdx, params) {
  const target = events[targetIdx]
  const { minCueToTargetGapT } = params

  let prevSameShape = -1
  for (let k = targetIdx - 1; k >= 0; k--) {
    if (events[k].shape === target.shape) { prevSameShape = k; break }
  }

  const offscreenAnchorIdx = targetIdx - RENDERED_AHEAD - 1
  if (offscreenAnchorIdx < 0) return null
  if (prevSameShape !== -1 && prevSameShape >= offscreenAnchorIdx) return null

  const lower = Math.max(
    AUDIO_WARMUP_T,
    prevSameShape >= 0 ? events[prevSameShape].t + 0.002 : 0
  )
  const upper = Math.min(
    events[offscreenAnchorIdx].t - 0.002,
    target.t - minCueToTargetGapT
  )
  if (upper <= lower) return null
  return { lower, upper, targetT: target.t }
}

// Find an audioT that fits in the natural window AND doesn't overlap any
// already-scheduled avoid cue's active span [audioT, targetT + postGap]. The
// new cue may sit BEFORE or AFTER each existing one — that's what lets the
// top-up loop slot extra cues into gaps that the greedy primary pass left
// behind. Returns null if no valid audioT exists.
function findAudioTAroundExisting(window, candidateTargetT, existingCues, postTargetGapT) {
  const candidateEnd = candidateTargetT + postTargetGapT
  // Free intervals (so far) start as the entire natural window.
  let free = [{ start: window.lower, end: window.upper }]
  for (const c of existingCues) {
    const blockStart = c.audioT
    const blockEnd   = c.targetT + postTargetGapT
    // New cue ends before block starts → no conflict with this block, leave
    // the free intervals untouched.
    if (candidateEnd <= blockStart) continue
    // New cue's target sits inside/after block → audioT must start past
    // blockEnd, so trim each free interval to [max(start, blockEnd), end].
    const next = []
    for (const f of free) {
      if (f.end <= blockEnd) continue
      next.push({ start: Math.max(f.start, blockEnd), end: f.end })
    }
    free = next
    if (!free.length) return null
  }
  const usable = free.filter(f => f.end > f.start)
  if (!usable.length) return null
  // Pick one slot weighted by length, then a random audioT inside it.
  let total = 0
  for (const f of usable) total += f.end - f.start
  let pick = usable[0]
  let r = Math.random() * total
  for (const f of usable) {
    const len = f.end - f.start
    if (r < len) { pick = f; break }
    r -= len
  }
  return pick.start + Math.random() * (pick.end - pick.start)
}

// Build the per-round audio plan. Returns cues sorted by t.
// `memoryCode` is the 7-digit string for the final round; pass null elsewhere.
export function generateAudioPlan(events, roundCfg, userCallsign, roundIdx, curveLen, memoryCode = null) {
  const cues = []

  // Derived spacing in t-units.
  const safeCurveLen = Math.max(1, curveLen)
  const minCueToTargetGapT = ((MIN_THINK_TIME_S + AUDIO_DURATION_S_EST) * roundCfg.speed) / safeCurveLen
  const postTargetGapT = (POST_TARGET_GAP_S * roundCfg.speed) / safeCurveLen
  const params = { minCueToTargetGapT, postTargetGapT }

  // Tracks placed avoid cues so subsequent placements can slot between them.
  // The memory-code block rides in here too (isCode), so every later placement
  // pass routes around it for free — it is not an avoid and is filtered out
  // when avoids are committed to the cue list.
  const placed = []
  const placedIdxs = new Set()

  // Step 0: reserve the memory-code block (final round only) BEFORE anything
  // else is placed. Everything downstream treats it as occupied space.
  let codeBlock = null
  if (roundIdx === CODE_ROUND_IDX && memoryCode) {
    const codeSpanT = (CODE_AUDIO_DURATION_S_EST * roundCfg.speed) / safeCurveLen
    const jitter = (Math.random() * 2 - 1) * CODE_CUE_JITTER_T
    // Clamped so a short round can't schedule a readout that runs past the end
    // of the tunnel.
    const latest = Math.max(AUDIO_WARMUP_T, 1 - codeSpanT - postTargetGapT - 0.02)
    const startT = Math.min(Math.max(AUDIO_WARMUP_T, CODE_CUE_T + jitter), latest)
    codeBlock = { audioT: startT, targetT: startT + codeSpanT, shape: null, isCode: true }
    placed.push(codeBlock)
    cues.push({ t: startT, kind: 'code', code: String(memoryCode) })
  }

  // Span the code readout occupies, including its trailing gap. Null when the
  // round has no code.
  const codeSpan = codeBlock
    ? { start: codeBlock.audioT, end: codeBlock.targetT + postTargetGapT }
    : null

  function placeAvoid(i) {
    if (placedIdxs.has(i)) return false
    const win = naturalAudioWindow(events, i, params)
    if (!win) return false
    const audioT = findAudioTAroundExisting(win, win.targetT, placed, postTargetGapT)
    if (audioT == null) return false
    placed.push({ audioT, targetT: win.targetT, shape: events[i].shape })
    placedIdxs.add(i)
    return true
  }

  // Step 1: roll for avoid targets — circles/squares only.
  const rolled = []
  for (let i = 0; i < events.length; i++) {
    if (events[i].shape === 'triangle') continue
    if (Math.random() < roundCfg.avoidOdds) rolled.push(i)
  }
  // Cap at MAX_AVOID_CUES — randomly cull rather than truncating from the
  // tail, so the surviving cues stay spread across the round.
  if (rolled.length > MAX_AVOID_CUES) {
    for (let i = rolled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rolled[i], rolled[j]] = [rolled[j], rolled[i]]
    }
    rolled.length = MAX_AVOID_CUES
    rolled.sort((a, b) => a - b)
  }

  // How many AVOID cues are placed. `placed` also carries the memory-code
  // block, which must not count toward the per-round avoid floor or ceiling —
  // otherwise round 5 reads as "already has one" and skips its top-up passes.
  const avoidCount = () => placed.length - (codeBlock ? 1 : 0)

  // Step 2: place each rolled candidate. Slot-finder picks an audioT that
  // doesn't overlap any previously-placed cue's active span — so the order
  // of placement doesn't matter for correctness.
  for (const i of rolled) placeAvoid(i)

  // Step 2b: top up until we have MIN_AVOID_CUES. Try every remaining non-
  // triangle event in a randomised order so we don't always pull from the
  // start — late events have wider natural windows and are more likely to
  // succeed once the round is partly filled.
  if (avoidCount() < MIN_AVOID_CUES) {
    const remaining = []
    for (let i = 0; i < events.length; i++) {
      if (events[i].shape === 'triangle') continue
      if (placedIdxs.has(i)) continue
      remaining.push(i)
    }
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
    }
    for (const i of remaining) {
      if (avoidCount() >= MIN_AVOID_CUES) break
      if (avoidCount() >= MAX_AVOID_CUES) break
      placeAvoid(i)
    }
  }

  // Step 2c: brute-force pair fallback. When Step 2 happens to land a cue
  // in the middle of the round, its block can lock out every later event's
  // natural window (next-anchor sits inside the block). Step 2b then can't
  // top up. As a last resort, scan every (A, B) pair of eligible events
  // and adopt the first pair that fits — even if it means discarding what
  // we've placed so far. The floor is more important than preserving any
  // particular cue.
  if (avoidCount() < MIN_AVOID_CUES) {
    const eligible = []
    for (let i = 0; i < events.length; i++) {
      if (events[i].shape === 'triangle') continue
      const win = naturalAudioWindow(events, i, params)
      if (!win) continue
      eligible.push({ i, win, shape: events[i].shape })
    }
    for (let a = 0; a < eligible.length; a++) {
      for (let b = a + 1; b < eligible.length; b++) {
        const A = eligible[a]
        const B = eligible[b]
        // Fit the pair with the same slot-finder every other pass uses, seeded
        // with the memory-code block so the fallback can't buy its two cues by
        // talking over the readout. Nothing is committed until BOTH fit —
        // clearing `placed` first would throw away a working single cue (and
        // the code block) on a pair that turns out not to work.
        const trial = codeBlock ? [codeBlock] : []
        const audioA = findAudioTAroundExisting(A.win, A.win.targetT, trial, postTargetGapT)
        if (audioA == null) continue
        const blockA = { audioT: audioA, targetT: A.win.targetT, shape: A.shape }
        const audioB = findAudioTAroundExisting(B.win, B.win.targetT, [...trial, blockA], postTargetGapT)
        if (audioB == null) continue
        placed.length = 0
        placedIdxs.clear()
        if (codeBlock) placed.push(codeBlock)
        placed.push(blockA)
        placedIdxs.add(A.i)
        placed.push({ audioT: audioB, targetT: B.win.targetT, shape: B.shape })
        placedIdxs.add(B.i)
        a = eligible.length
        break
      }
    }
  }

  // Commit placed avoids into the cue list. The code block shares `placed` for
  // collision purposes only — it was already emitted in step 0.
  for (const p of placed) {
    if (p.isCode) continue
    cues.push({ t: p.audioT, kind: 'avoid', callsigns: userCallsign, shape: p.shape })
  }

  // Step 3: distractors — fire near non-target events with a non-matching
  // callsign. Distractors always use circle/square shape names since the
  // audio engine has no "avoid the next triangle" clip; saying it would
  // play just the callsigns and feel broken.
  //
  // Skip any distractor whose audio span [audioT, ev.t] overlaps a placed
  // avoid cue's span [audioT, targetT + postGap] — the runtime's exclusive
  // audio engine would silently drop whichever fires second, and losing the
  // avoid is the bad case (player misses an instruction they should obey).
  for (let i = 0; i < events.length; i++) {
    if (placedIdxs.has(i)) continue
    if (Math.random() >= roundCfg.distractorOdds) continue
    const distractorSet = generateDistractorCallsign(userCallsign)
    if (!distractorSet) continue
    const ev = events[i]
    const audioT = Math.max(AUDIO_WARMUP_T, ev.t - 0.06)
    if (audioT >= ev.t) continue
    let conflicts = false
    for (const p of placed) {
      const pEnd = p.targetT + postTargetGapT
      if (audioT < pEnd && ev.t > p.audioT) { conflicts = true; break }
    }
    if (conflicts) continue
    const distractorShape = Math.random() < 0.5 ? 'circle' : 'square'
    cues.push({ t: audioT, kind: 'distractor', callsigns: distractorSet, shape: distractorShape, targetId: null })
  }

  // Step 4: bleeps — stratified across the round so adjacent bleeps are
  // always ≥ 3 s apart in real time. Floor at 5 per round.
  const bleepCount = Math.max(5, Math.round(roundCfg.shapes * roundCfg.bleepOdds))
  const bleepRangeStart = AUDIO_WARMUP_T
  const bleepRangeEnd   = 0.95
  const bleepRange      = bleepRangeEnd - bleepRangeStart
  const slotWidth       = bleepRange / bleepCount
  const minGapT = Math.min(slotWidth, (3 * roundCfg.speed) / safeCurveLen)
  for (let i = 0; i < bleepCount; i++) {
    const slotStart = bleepRangeStart + i * slotWidth
    const slotEnd   = slotStart + slotWidth
    const subStart  = i === 0              ? slotStart : slotStart + minGapT / 2
    const subEnd    = i === bleepCount - 1 ? slotEnd   : slotEnd   - minGapT / 2
    let t = subStart + Math.random() * Math.max(0, subEnd - subStart)
    // A bleep landing mid-readout masks a digit. Slide it out of the block if
    // this slot has room either side; drop it if the block swallows the slot.
    if (codeSpan && t >= codeSpan.start && t < codeSpan.end) {
      const after  = codeSpan.end > subStart && codeSpan.end < subEnd  ? codeSpan.end   : null
      const before = codeSpan.start > subStart && codeSpan.start < subEnd ? subStart    : null
      if (after != null)       t = after + Math.random() * (subEnd - after)
      else if (before != null) t = before + Math.random() * (codeSpan.start - before)
      else continue
    }
    cues.push({ t, kind: 'bleep' })
  }

  cues.sort((a, b) => a.t - b.t)
  return cues
}

