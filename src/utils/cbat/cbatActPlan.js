// ACT audio plan + shape stream generation.
//
// Extracted from CbatAct.jsx so the planner can be unit-tested without pulling
// in three.js / R3F. The planner is pure JS — pass `curveLen` (world units)
// instead of a curve object.

import { generateDistractorCallsign } from './actAudio'
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

// Shape mix in the stream. Triangles dominate so there's always plenty of
// inert filler between any two circles or any two squares.
export const TRIANGLE_FRACTION = 0.5

// Floor on per-round avoid cue count — the player must hear their callsign
// at least this many times so they can train recognition under stress.
export const MIN_AVOID_CUES = 2

// Ceiling on per-round avoid cue count — even when avoidOdds rolls high, no
// round should ship more than this many avoids. Keeps round duration honest
// and prevents pile-ups when the same-shape stream happens to be dense.
export const MAX_AVOID_CUES = 5

// ── Shape stream ────────────────────────────────────────────────────────────

// Produce the in-tunnel shape sequence for one round. Returns events in
// strict t-order with ids 0..count-1.
export function generateShapeEvents(curveLen, count, roundIdx) {
  const startMarginT = Math.min(0.45, START_BUFFER_WORLD_UNITS / curveLen)
  const repeatProb = SHAPE_REPEAT_PROB[Math.min(roundIdx, 4)]
  const events = []
  let prev = null
  for (let i = 0; i < count; i++) {
    const t = startMarginT + (1 - END_MARGIN_T - startMarginT) * (i / Math.max(1, count - 1))
    let shape
    if (Math.random() < TRIANGLE_FRACTION) {
      shape = 'triangle'
    } else if (prev === 'circle' || prev === 'square') {
      // Repeat-bias only applies when the previous shape was a circle/square.
      // After a triangle, we always pick a fresh circle/square at 50/50 so
      // the avoid-target pool stays balanced.
      shape = Math.random() < repeatProb
        ? prev
        : (prev === 'circle' ? 'square' : 'circle')
    } else {
      shape = Math.random() < 0.5 ? 'circle' : 'square'
    }
    prev = shape
    const colorIdx = Math.floor(Math.random() * 4)
    events.push({ id: i, t, shape, colorIdx, threaded: null })
  }
  return events
}

// ── Audio plan ──────────────────────────────────────────────────────────────

// Returns null if no valid audioT exists for this candidate target under the
// off-screen / think-time / no-overlap constraints, else { audioT,
// newActiveWindowEnd }. Pure function — caller decides whether to commit the
// cue.
function tryScheduleAvoidCue(events, targetIdx, activeWindowEndT, params) {
  const target = events[targetIdx]
  const { minCueToTargetGapT, postTargetGapT } = params

  // Find the previous same-shape event index (largest k < targetIdx with
  // matching shape). The earliest the avoid audio can start is just after
  // this event — any earlier and the player would see a same-shape that
  // isn't the target.
  let prevSameShape = -1
  for (let k = targetIdx - 1; k >= 0; k--) {
    if (events[k].shape === target.shape) { prevSameShape = k; break }
  }

  // The target's off-screen entry point is events[targetIdx - RENDERED_AHEAD - 1].
  // If audioT < that t, the target is still beyond the render horizon at audio
  // start. Need at least RENDERED_AHEAD + 1 events between firstUpcoming and target.
  const offscreenAnchorIdx = targetIdx - RENDERED_AHEAD - 1
  if (offscreenAnchorIdx < 0) return null
  if (prevSameShape !== -1 && prevSameShape >= offscreenAnchorIdx) {
    // A same-shape sits inside what would otherwise be the off-screen buffer.
    // Can't schedule without violating "first same-shape player sees IS the
    // target".
    return null
  }

  const lower = Math.max(
    AUDIO_WARMUP_T,
    activeWindowEndT,
    prevSameShape >= 0 ? events[prevSameShape].t + 0.002 : 0
  )
  const upperByOffscreen = events[offscreenAnchorIdx].t - 0.002
  const upperByGap = target.t - minCueToTargetGapT
  const upper = Math.min(upperByOffscreen, upperByGap)

  if (upper <= lower) return null

  // Place audioT randomly inside the valid window. Random placement keeps the
  // game from feeling metronomic.
  const audioT = lower + Math.random() * (upper - lower)
  return { audioT, newActiveWindowEnd: target.t + postTargetGapT }
}

// Build the per-round audio plan. Returns cues sorted by t.
export function generateAudioPlan(events, roundCfg, userCallsign, roundIdx, curveLen) {
  const cues = []

  // Step 1: roll for avoid targets — circles/squares only.
  const avoidIdxs = new Set()
  for (let i = 0; i < events.length; i++) {
    if (events[i].shape === 'triangle') continue
    if (Math.random() < roundCfg.avoidOdds) avoidIdxs.add(i)
  }
  // Cap at MAX_AVOID_CUES — randomly cull rather than truncating from the
  // tail, so the surviving cues stay spread across the round instead of all
  // clustering early.
  if (avoidIdxs.size > MAX_AVOID_CUES) {
    const arr = [...avoidIdxs]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    avoidIdxs.clear()
    for (let i = 0; i < MAX_AVOID_CUES; i++) avoidIdxs.add(arr[i])
  }

  // Derived spacing in t-units.
  const safeCurveLen = Math.max(1, curveLen)
  const minCueToTargetGapT = ((MIN_THINK_TIME_S + AUDIO_DURATION_S_EST) * roundCfg.speed) / safeCurveLen
  const postTargetGapT = (POST_TARGET_GAP_S * roundCfg.speed) / safeCurveLen
  const params = { minCueToTargetGapT, postTargetGapT }

  // Step 2: schedule each rolled-avoid cue. Drop any that can't satisfy the
  // off-screen + think-time invariants — better to lose a cue than to ship
  // one that's ambiguous to the player.
  let activeWindowEndT = AUDIO_WARMUP_T
  for (let i = 0; i < events.length; i++) {
    if (!avoidIdxs.has(i)) continue
    const result = tryScheduleAvoidCue(events, i, activeWindowEndT, params)
    if (!result) continue
    cues.push({ t: result.audioT, kind: 'avoid', callsigns: userCallsign, shape: events[i].shape })
    activeWindowEndT = result.newActiveWindowEnd
  }

  // Step 2b: top up until we have MIN_AVOID_CUES. Iterate over non-triangle
  // events that weren't already used. The picked event is purely for timing
  // anchoring; the runtime resolver re-binds the actual target to whatever
  // the player will see first.
  let avoidCueCount = cues.filter(c => c.kind === 'avoid').length
  const usedAnchorIds = new Set()
  for (let i = 0; i < events.length && avoidCueCount < MIN_AVOID_CUES; i++) {
    const ev = events[i]
    if (ev.shape === 'triangle') continue
    if (avoidIdxs.has(i)) continue
    if (usedAnchorIds.has(ev.id)) continue
    const result = tryScheduleAvoidCue(events, i, activeWindowEndT, params)
    if (!result) continue
    cues.push({ t: result.audioT, kind: 'avoid', callsigns: userCallsign, shape: ev.shape })
    usedAnchorIds.add(ev.id)
    avoidCueCount += 1
    activeWindowEndT = result.newActiveWindowEnd
  }

  // Step 3: distractors — fire near non-target events with a non-matching
  // callsign. Distractors always use circle/square shape names since the
  // audio engine has no "avoid the next triangle" clip; saying it would
  // play just the callsigns and feel broken.
  for (let i = 0; i < events.length; i++) {
    if (avoidIdxs.has(i)) continue
    if (Math.random() >= roundCfg.distractorOdds) continue
    const distractorSet = generateDistractorCallsign(userCallsign)
    if (!distractorSet) continue
    const ev = events[i]
    const audioT = Math.max(AUDIO_WARMUP_T, ev.t - 0.06)
    if (audioT >= ev.t) continue
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
    const t = subStart + Math.random() * Math.max(0, subEnd - subStart)
    cues.push({ t, kind: 'bleep' })
  }

  cues.sort((a, b) => a.t - b.t)
  return cues
}

