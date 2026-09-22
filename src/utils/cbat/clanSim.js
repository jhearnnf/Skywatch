// The CLAN run as a pure simulation: no React, no timers, no DOM. The page
// drives it from one rAF loop (`tick(elapsedMs)`) and renders whatever
// `snapshot()` says; the tests drive it with a seeded rng and hand-picked
// times and check the scoring. Same simRef + snapshot pattern as CUT.
//
// Three tasks share the clock:
//
//   Colours  a diamond is launched from the left edge every spawn interval
//            and crosses to the right edge in `crossMs`. On the right sit
//            three colour bands (red, yellow, green — see CLAN_BANDS). The
//            diamond has to be pressed (R / Y / G) while it is INSIDE the band
//            of its own colour: pressed there it scores, pressed with nothing
//            of that colour in its band it costs, and a diamond that leaves
//            its band untouched costs once and carries on to the edge.
//   Letters  a code is shown top-centre for `showMs`, the box goes blank for
//            `holdMs`, then four options appear in the corners (A–D) for
//            `answerMs`. One is the code; the other three differ from it in
//            exactly one letter.
//   Numbers  sums come up bottom-centre on a schedule and are typed on the
//            number keys. A sum submits itself once the expected number of
//            digits is in, or on Enter; it times out after `timeoutMs`.

import { CLAN_COLOURS, CLAN_POINTS, CLAN_DURATION_MS } from './clanDifficulty'
import {
  generateLetterCode, buildLetterOptions, generateClanMath, pickMathBand,
  buildMathSchedule,
} from './clanGenerator'

// Where each band sits along the arena, as fractions of its width. The left
// half is open track; the bands take the right half in the real screen's
// order, with a strip of black past the last one so a green diamond still
// has somewhere to be "past its band".
export const CLAN_BANDS = {
  red:    [0.46, 0.62],
  yellow: [0.62, 0.78],
  green:  [0.78, 0.94],
}
// Past this a diamond is off the arena and is dropped.
const TRACK_END = 1.06
// How long a hit or missed diamond stays drawn in its new state before it is
// dropped (a hit flashes; a miss dims and drifts on).
const HIT_LINGER_MS = 320
// A sum that has just been answered rests this long before the next one can
// come up, however overdue the schedule says it is.
const MATH_MIN_GAP_MS = 1500
// How long a task's right/wrong feedback stays in the snapshot. The SkyWatch
// theme paints it; the Real CBAT theme ignores it (no mid-test feedback).
const FEEDBACK_MS = 600
// Digits a sum will accept. Nothing here has a five-digit answer.
const MAX_ENTRY = 4

const pickColour = (rng) => CLAN_COLOURS[Math.floor(rng() * CLAN_COLOURS.length)]
const pickFrom = (arr, rng) => arr[Math.floor(rng() * arr.length)]

export function blankClanStats() {
  return {
    totalScore: 0,
    colourScore: 0, colourHits: 0,    colourWrong: 0,  colourMissed: 0,
    letterScore: 0, letterCorrect: 0, letterWrong: 0,  letterTimeout: 0,
    mathScore: 0,   mathCorrect: 0,   mathWrong: 0,    mathTimeout: 0,
  }
}

export function createClanSim({ tuning, rng = Math.random, durationMs = CLAN_DURATION_MS }) {
  const { colours, letters: letterCfg, maths: mathCfg } = tuning
  const stats = blankClanStats()

  let t = 0
  let finished = false
  let nextId = 1

  // ── Colours ──
  const diamonds = []
  let nextSpawnAt = 1000
  let lastColour = null

  // ── Letters ──
  const letters = {
    phase: 'idle',      // idle | showing | hold | asking | gap
    code: null,
    options: [],
    correctIndex: -1,
    phaseUntil: letterCfg.firstMs,
    feedback: null,     // { correct, pickedIndex, until } after an answer
  }

  // ── Numbers ──
  const maths = {
    phase: 'idle',      // idle | asking | gap
    question: null,
    entered: '',
    askedAt: 0,
    until: 0,
    schedule: buildMathSchedule(mathCfg.count, mathCfg.firstMs, durationMs - mathCfg.timeoutMs, rng),
    idx: 0,
    lastEndedAt: -Infinity,
    feedback: null,     // { correct, until }
  }

  let lastEvent = null  // { kind, task, at, points } — the most recent scoring event, for sounds

  function award(task, kind, points) {
    stats.totalScore += points
    stats[`${task}Score`] += points
    stats[kind] += 1
    lastEvent = { kind, task, at: t, points }
  }

  // ── Colours ──
  function spawnDiamond() {
    // Never the same colour twice running: two reds nose-to-tail would let one
    // R press feel like it hit the wrong one.
    let colour = pickColour(rng)
    if (colour === lastColour) colour = CLAN_COLOURS[(CLAN_COLOURS.indexOf(colour) + 1) % CLAN_COLOURS.length]
    lastColour = colour
    // `y` is the lane it flies in, as a fraction of the arena's height — the
    // real screen scatters them so two diamonds never sit on one line.
    const y = 0.15 + rng() * 0.7
    diamonds.push({ id: nextId++, colour, y, spawnedAt: t, state: 'live', stateAt: null })
    const jitter = (rng() - 0.5) * 2 * colours.spawnJitterMs
    nextSpawnAt = t + colours.spawnMs + jitter
  }

  const diamondX = (d) => (t - d.spawnedAt) / colours.crossMs

  function inOwnBand(d) {
    const x = diamondX(d)
    const [lo, hi] = CLAN_BANDS[d.colour]
    return x >= lo && x <= hi
  }

  function tickColours() {
    // Launch everything that is due — a long frame can owe more than one.
    let guard = 0
    while (nextSpawnAt <= t && !finished && guard++ < 8) spawnDiamond()

    for (const d of diamonds) {
      const x = diamondX(d)
      if (d.state === 'live' && x > CLAN_BANDS[d.colour][1]) {
        d.state = 'missed'
        d.stateAt = t
        award('colour', 'colourMissed', CLAN_POINTS.colourMissed)
      }
    }
    // Drop what has left the arena, and hits once their flash is done.
    for (let i = diamonds.length - 1; i >= 0; i--) {
      const d = diamonds[i]
      const x = diamondX(d)
      if (x > TRACK_END || (d.state === 'hit' && t - d.stateAt > HIT_LINGER_MS)) diamonds.splice(i, 1)
    }
  }

  function pressColour(colour) {
    if (finished || !CLAN_BANDS[colour]) return null
    // The diamond furthest along its band is the one about to be lost, so a
    // press takes that one when two of a colour overlap.
    let target = null
    for (const d of diamonds) {
      if (d.state === 'live' && d.colour === colour && inOwnBand(d)) {
        if (!target || diamondX(d) > diamondX(target)) target = d
      }
    }
    if (target) {
      target.state = 'hit'
      target.stateAt = t
      award('colour', 'colourHits', CLAN_POINTS.colourHit)
      return 'hit'
    }
    award('colour', 'colourWrong', CLAN_POINTS.colourWrong)
    return 'wrong'
  }

  // ── Letters ──
  function tickLetters() {
    // Walk the phases forward; a long frame may cross more than one boundary.
    let guard = 0
    while (t >= letters.phaseUntil && guard++ < 6) {
      switch (letters.phase) {
        case 'idle':
        case 'gap': {
          if (finished) return
          // Don't start a code the run can't finish asking.
          const cycleMs = letterCfg.showMs + letterCfg.holdMs
          if (t + cycleMs >= durationMs) { letters.phaseUntil = Infinity; return }
          letters.code = generateLetterCode(pickFrom(letterCfg.lengths, rng), rng)
          const built = buildLetterOptions(letters.code, rng)
          letters.options = built.options
          letters.correctIndex = built.correctIndex
          letters.phase = 'showing'
          letters.phaseUntil = t + letterCfg.showMs
          break
        }
        case 'showing':
          letters.phase = 'hold'
          letters.phaseUntil = t + letterCfg.holdMs
          break
        case 'hold':
          letters.phase = 'asking'
          letters.phaseUntil = t + letterCfg.answerMs
          break
        case 'asking':
          // Ran out of time with the options up.
          award('letter', 'letterTimeout', CLAN_POINTS.letterTimeout)
          letters.feedback = { correct: false, pickedIndex: null, until: t + FEEDBACK_MS }
          letters.phase = 'gap'
          letters.phaseUntil = t + letterCfg.gapMs
          break
        default:
          return
      }
    }
    if (letters.feedback && t >= letters.feedback.until) letters.feedback = null
  }

  function pickLetterOption(i) {
    if (finished || letters.phase !== 'asking') return null
    if (i < 0 || i >= letters.options.length) return null
    const correct = i === letters.correctIndex
    if (correct) award('letter', 'letterCorrect', CLAN_POINTS.letterCorrect)
    else award('letter', 'letterWrong', CLAN_POINTS.letterWrong)
    letters.feedback = { correct, pickedIndex: i, until: t + FEEDBACK_MS }
    letters.phase = 'gap'
    letters.phaseUntil = t + letterCfg.gapMs
    return correct ? 'correct' : 'wrong'
  }

  // ── Numbers ──
  function endMath(kind, correct) {
    award('math', kind, CLAN_POINTS[kind])
    maths.feedback = { correct, until: t + FEEDBACK_MS }
    maths.phase = 'gap'
    maths.question = null
    maths.entered = ''
    maths.lastEndedAt = t
    maths.until = t + FEEDBACK_MS
  }

  function tickMaths() {
    if (maths.phase === 'asking' && t >= maths.until) {
      endMath('mathTimeout', false)
    }
    if (maths.phase === 'gap' && t >= maths.until) {
      maths.phase = 'idle'
    }
    if (maths.feedback && t >= maths.feedback.until) maths.feedback = null
    if (
      maths.phase === 'idle' && !finished &&
      maths.idx < maths.schedule.length &&
      t >= maths.schedule[maths.idx] &&
      t >= maths.lastEndedAt + MATH_MIN_GAP_MS
    ) {
      maths.idx += 1
      maths.question = generateClanMath(pickMathBand(mathCfg.weights, rng), rng)
      maths.entered = ''
      maths.askedAt = t
      maths.until = t + mathCfg.timeoutMs
      maths.phase = 'asking'
    }
  }

  function submitMath() {
    if (finished || maths.phase !== 'asking' || maths.entered === '') return null
    const correct = Number(maths.entered) === maths.question.answer
    endMath(correct ? 'mathCorrect' : 'mathWrong', correct)
    return correct ? 'correct' : 'wrong'
  }

  function pressDigit(d) {
    if (finished || maths.phase !== 'asking') return null
    if (!/^[0-9]$/.test(String(d))) return null
    if (maths.entered.length >= MAX_ENTRY) return null
    maths.entered += String(d)
    // The real screen wants Enter; FLAG's numpad submits on the last expected
    // digit and players know it, so both work. A longer wrong answer is
    // caught by Enter or the timeout.
    if (maths.entered.length === maths.question.expectedDigits) return submitMath()
    return 'typed'
  }

  function backspace() {
    if (finished || maths.phase !== 'asking') return
    maths.entered = maths.entered.slice(0, -1)
  }

  // ── Clock ──
  function tick(elapsedMs) {
    if (finished) return
    t = Math.max(t, elapsedMs)
    if (t >= durationMs) {
      t = durationMs
      finished = true
      // Whatever is still up when the clock stops is neither right nor wrong.
      // The diamonds already past their band were charged as they passed.
    }
    tickColours()
    tickLetters()
    tickMaths()
  }

  function snapshot() {
    return {
      t,
      remainingMs: Math.max(0, durationMs - t),
      durationMs,
      finished,
      score: stats.totalScore,
      stats: { ...stats },
      diamonds: diamonds.map(d => ({ id: d.id, colour: d.colour, x: diamondX(d), y: d.y, state: d.state })),
      letters: {
        phase: letters.phase,
        code: letters.phase === 'showing' ? letters.code : null,
        options: letters.phase === 'asking' ? letters.options : [],
        feedback: letters.feedback ? { correct: letters.feedback.correct, pickedIndex: letters.feedback.pickedIndex } : null,
      },
      maths: {
        phase: maths.phase,
        question: maths.phase === 'asking' ? maths.question.question : null,
        entered: maths.entered,
        remainingFrac: maths.phase === 'asking' ? Math.max(0, (maths.until - t) / mathCfg.timeoutMs) : 0,
        feedback: maths.feedback ? { correct: maths.feedback.correct } : null,
      },
      lastEvent,
    }
  }

  return {
    tick, snapshot,
    pressColour, pickLetterOption, pressDigit, backspace, submitMath,
    // Test seams.
    get finished() { return finished },
    get stats() { return { ...stats } },
    _letters: letters,
    _maths: maths,
  }
}
