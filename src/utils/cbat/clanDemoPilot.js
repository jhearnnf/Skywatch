import { CLAN_BANDS } from './clanSim'

// The player behind a demo-mounted CLAN (the country guides' embed).
//
// The shared demo driver (landingGames/demoDriver.js) can only press random
// `data-demo-answer` controls, which is fine for a game that asks one thing at a
// time and hopeless for CLAN: three tasks run at once, and random presses score
// deep into the negative. So CLAN reads its own sim and plays it like a decent
// candidate would, through the same pressColour / pickLetterOption / pressDigit
// calls the keyboard uses.
//
// Deliberately not perfect. A bot that never misses reads as a recording, and
// a demo that shows every diamond caught tells a reader the test is easy. So it
// reacts late, lets the odd diamond go, and gets the occasional code or sum
// wrong.
//
// Pure apart from the rng: step(snapshot) returns the actions due at the
// snapshot's time, and the caller applies them.

export const PILOT = {
  colourHitRate:  0.9,
  letterHitRate:  0.85,
  mathHitRate:    0.85,
  letterDelayMs:  [1200, 2800],  // options up → pick
  mathDelayMs:    [900, 2000],   // sum up → first digit
  digitGapMs:     [180, 320],    // between digits
}

const between = (rng, [lo, hi]) => lo + rng() * (hi - lo)

// A believable wrong answer: near the right one, never negative. Same number of
// digits where it can be, so the entry auto-submits like a real slip would.
function nearMiss(answer, rng) {
  const deltas = [1, -1, 2, -2, 10, -10]
  const start = Math.floor(rng() * deltas.length)
  for (let i = 0; i < deltas.length; i++) {
    const guess = answer + deltas[(start + i) % deltas.length]
    if (guess >= 0 && String(guess).length === String(answer).length) return guess
  }
  return answer + 1
}

export function createClanDemoPilot({ rng = Math.random, tuning = PILOT } = {}) {
  // Per diamond: where along its band it gets pressed, or null to let it go.
  const diamondPlans = new Map()
  let letterPlan = null   // { dueAt, index } for the options currently up
  let mathPlan = null     // { question, digits, nextAt, needsEnter }

  function planDiamond(d) {
    if (rng() >= tuning.colourHitRate) return null
    const [lo, hi] = CLAN_BANDS[d.colour]
    // Somewhere in the middle of the band: late enough to look like a
    // reaction, early enough that a slow frame can't carry it past the edge.
    return lo + (hi - lo) * (0.2 + rng() * 0.55)
  }

  function step(snap) {
    const actions = []
    if (!snap || snap.finished) return actions
    const t = snap.t

    // ── Colours ──
    const seen = new Set()
    for (const d of snap.diamonds) {
      seen.add(d.id)
      if (d.state !== 'live') continue
      if (!diamondPlans.has(d.id)) diamondPlans.set(d.id, planDiamond(d))
      const pressAt = diamondPlans.get(d.id)
      if (pressAt != null && d.x >= pressAt) {
        actions.push({ kind: 'colour', value: d.colour })
        diamondPlans.set(d.id, null)
      }
    }
    for (const id of diamondPlans.keys()) if (!seen.has(id)) diamondPlans.delete(id)

    // ── Letters ──
    const L = snap.letters
    if (L.phase === 'asking' && L.options.length) {
      if (!letterPlan) {
        const right = rng() < tuning.letterHitRate
        const others = L.options.map((_, i) => i).filter((i) => i !== L.correctIndex)
        letterPlan = {
          dueAt: t - L.askingMs + between(rng, tuning.letterDelayMs),
          index: right || !others.length ? L.correctIndex : others[Math.floor(rng() * others.length)],
          done: false,
        }
      }
      if (!letterPlan.done && t >= letterPlan.dueAt) {
        actions.push({ kind: 'option', value: letterPlan.index })
        letterPlan.done = true
      }
    } else {
      letterPlan = null
    }

    // ── Numbers ──
    const M = snap.maths
    if (M.phase === 'asking' && M.question != null && M.answer != null) {
      if (!mathPlan || mathPlan.question !== M.question) {
        const value = rng() < tuning.mathHitRate ? M.answer : nearMiss(M.answer, rng)
        const digits = String(value).split('')
        mathPlan = {
          question: M.question,
          digits,
          // The sim submits on its own once the expected number of digits is
          // in; anything shorter needs Enter.
          needsEnter: digits.length !== String(M.answer).length,
          nextAt: t + between(rng, tuning.mathDelayMs),
        }
      }
      if (t >= mathPlan.nextAt) {
        if (mathPlan.digits.length) {
          actions.push({ kind: 'digit', value: mathPlan.digits.shift() })
          mathPlan.nextAt = t + between(rng, tuning.digitGapMs)
        } else if (mathPlan.needsEnter) {
          actions.push({ kind: 'enter' })
          mathPlan.needsEnter = false
        }
      }
    } else {
      mathPlan = null
    }

    return actions
  }

  return { step }
}
