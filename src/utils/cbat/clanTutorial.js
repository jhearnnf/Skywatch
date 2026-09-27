// CLAN's tutorial: the real game in slow motion, stopping for every press.
//
// It runs the ordinary sim (clanSim.js) on a clock of its own. Whenever
// something needs the player's input (a diamond inside its own band, the four
// code options, a sum waiting for an answer) the clock eases down to a crawl,
// the board zooms slowly in on that part and everything else blurs and loses
// its colour, with the key to press lit up. Once the player answers, the thing
// that needed them is gone, so the clock eases back to full speed and the zoom
// comes back out. Every answer still scores, shown as a big plus or minus.
//
// It ends once the player has done each task a few times (CLAN_TUTORIAL_GOALS),
// or when its clock runs out. Unranked: nothing here is submitted as a score.
//
// Pure: the page owns the loop and the DOM. Everything that decides what the
// tutorial does frame to frame is in here and tested on its own.

import { CLAN_BANDS } from './clanSim'

// The sim's tuning for the tutorial. A gentler pace than Easier, the first code
// and sum held back so the first thing taught is a diamond on its own, and only
// easy sums. Enough sums that the goal is reachable even after a few misses.
export const CLAN_TUTORIAL_TUNING = {
  colours: {
    crossMs: 6500,
    spawnMs: 3200,
    spawnJitterMs: 600,
  },
  letters: {
    lengths: [4],
    showMs: 4000,
    holdMs: 1000,
    answerMs: 8000,
    gapMs: 3000,
    firstMs: 7000,
  },
  maths: {
    count: 12,
    timeoutMs: 9000,
    firstMs: 14000,
    weights: { easy: 1, medium: 0, hard: 0 },
  },
}

// Game time, not wall time: slow motion stretches it a long way.
export const CLAN_TUTORIAL_DURATION_MS = 180_000

// Right answers needed of each task before the tutorial is done.
export const CLAN_TUTORIAL_GOALS = { colours: 4, codes: 2, sums: 2 }

// Slow motion. The clock runs at SLOW_SCALE of real time while something is
// waiting on the player, starting the moment an answer would count (a diamond
// entering its band, not before). It eases down over roughly EASE_IN_MS, short
// so a diamond has barely moved into its band before it is crawling, and back
// up over the gentler EASE_OUT_MS once the player has answered.
export const SLOW_SCALE = 0.04
export const EASE_IN_MS = 150
export const EASE_OUT_MS = 350

// How far the board zooms in on whatever is in focus.
export const ZOOM_SCALE = 1.14

// How long a points pop-up stays up.
export const POPUP_MS = 1300

// ── Goals ────────────────────────────────────────────────────────────────────

export function tutorialProgress(stats) {
  const colours = Math.min(stats.colourHits, CLAN_TUTORIAL_GOALS.colours)
  const codes = Math.min(stats.letterCorrect, CLAN_TUTORIAL_GOALS.codes)
  const sums = Math.min(stats.mathCorrect, CLAN_TUTORIAL_GOALS.sums)
  const met = (colours === CLAN_TUTORIAL_GOALS.colours ? 1 : 0)
    + (codes === CLAN_TUTORIAL_GOALS.codes ? 1 : 0)
    + (sums === CLAN_TUTORIAL_GOALS.sums ? 1 : 0)
  return { colours, codes, sums, met, done: met === 3 }
}

// ── Focus ────────────────────────────────────────────────────────────────────

// The four code options run at full speed for this long (game time) before
// the tutorial slows down and points out the right one, so the player gets a
// moment to find it for themselves first.
export const CODE_FOCUS_DELAY_MS = 1500

// Whether a held focus is still waiting on the player. A diamond is followed by
// its id, so the focus ends when THAT diamond is caught or leaves its band, not
// when some other diamond does.
function stillNeeded(focus, snapshot) {
  if (focus.kind === 'colour') {
    const d = snapshot.diamonds.find(x => x.id === focus.id)
    if (!d || d.state !== 'live') return false
    const [lo, hi] = CLAN_BANDS[d.colour]
    return d.x >= lo && d.x <= hi
  }
  if (focus.kind === 'code') return snapshot.letters.phase === 'asking' && snapshot.letters.correctIndex === focus.index
  return !!snapshot.maths.question
}

// What the tutorial is slowed down for: `held` (last frame's focus) for as
// long as it is still waiting on the player, and nothing ever takes over from
// it. A diamond that reaches its band while a sum has the focus just carries
// on at the crawl; if it is still in its band once the sum is answered it gets
// the focus next, and if it has gone it is simply a miss.
//
// When nothing is held: a live diamond inside its own band (the one furthest
// through, since it is the one about to be missed), then the code once its
// options have been up CODE_FOCUS_DELAY_MS, then a sum. Returns `held` itself
// when it stands, so a caller can tell a change by identity.
export function tutorialFocus(held, snapshot) {
  if (held && stillNeeded(held, snapshot)) return held

  let diamond = null
  for (const d of snapshot.diamonds) {
    if (d.state !== 'live') continue
    const [lo, hi] = CLAN_BANDS[d.colour]
    if (d.x < lo || d.x > hi) continue
    const through = (d.x - lo) / (hi - lo)
    if (!diamond || through > diamond.through) diamond = { id: d.id, colour: d.colour, through }
  }
  if (diamond) return { kind: 'colour', colour: diamond.colour, id: diamond.id }

  const { letters, maths } = snapshot
  if (letters.phase === 'asking' && letters.correctIndex >= 0 && letters.askingMs >= CODE_FOCUS_DELAY_MS) {
    return { kind: 'code', index: letters.correctIndex }
  }
  if (maths.question) return { kind: 'sum' }
  return null
}

// What the board lights for a focus: the colour's key (on its band and on the
// on-screen keys), the right box, and Enter once a sum has something typed.
export function tutorialLighting(focus, snapshot) {
  return {
    colours: focus?.kind === 'colour' ? [focus.colour] : [],
    option: focus?.kind === 'code' ? focus.index : -1,
    enter: focus?.kind === 'sum' && snapshot.maths.entered !== '',
  }
}

// ── Slow motion ──────────────────────────────────────────────────────────────

export function targetTimeScale(focus) {
  return focus ? SLOW_SCALE : 1
}

// One frame's step of the clock's speed toward its target: quick on the way
// down, gentler on the way back up.
export function nextTimeScale(current, target, dtMs) {
  const easeMs = target < current ? EASE_IN_MS : EASE_OUT_MS
  const k = 1 - Math.exp(-Math.max(0, dtMs) / easeMs)
  const next = current + (target - current) * k
  return Math.abs(next - target) < 0.001 ? target : next
}

// ── Zoom ─────────────────────────────────────────────────────────────────────

// The grid is three columns (option, code or sum, option) over a full-width
// arena, so each focus has a fixed spot to zoom toward: the middle of its
// colour's band, the corner the right box sits in, or the sum at the bottom.
// A box on the edge is zoomed around the grid's own corner or edge, never a
// point inside the box: scaling pushes everything away from the origin, so an
// origin inside the box pushes its outer edges off the board and crops them.
const CORNERS = ['0% 0%', '100% 0%', '0% 100%', '100% 100%']

export function zoomOrigin(focus) {
  if (!focus) return '50% 50%'
  if (focus.kind === 'colour') {
    const [lo, hi] = CLAN_BANDS[focus.colour]
    return `${Math.round(((lo + hi) / 2) * 100)}% 50%`
  }
  if (focus.kind === 'code') return CORNERS[focus.index] ?? '50% 50%'
  return '50% 100%'
}

// ── Points pop-ups ───────────────────────────────────────────────────────────

// Keyed by the sim's event kinds, which are its stats keys (clanSim.js award()).
const POPUPS = {
  colourHits:    { text: 'Correct', tone: 'good' },
  colourWrong:   { text: 'Wrong key', tone: 'bad' },
  colourMissed:  { text: 'Missed', tone: 'bad' },
  letterCorrect: { text: 'Correct', tone: 'good' },
  letterWrong:   { text: 'Wrong code', tone: 'bad' },
  letterTimeout: { text: 'Too slow', tone: 'bad' },
  mathCorrect:   { text: 'Correct', tone: 'good' },
  mathWrong:     { text: 'Wrong answer', tone: 'bad' },
  mathTimeout:   { text: 'Too slow', tone: 'bad' },
}

// Where each task's pop-up rises from, as a spot on the grid.
const POPUP_AT = {
  colour: { left: '70%', top: '42%' },
  letter: { left: '50%', top: '14%' },
  math:   { left: '50%', top: '82%' },
}

// A sim scoring event as the pop-up it shows, or null for one it doesn't know.
export function eventPopup(event) {
  const p = event && POPUPS[event.kind]
  if (!p) return null
  const sign = event.points > 0 ? '+' : ''
  return { text: p.text, points: `${sign}${event.points}`, tone: p.tone, at: POPUP_AT[event.task] ?? POPUP_AT.colour }
}

// ── Instruction line ─────────────────────────────────────────────────────────

// The one line above the board saying what to do now, in the player's keys.
export function tutorialInstruction(focus, snapshot, layout) {
  if (focus?.kind === 'colour') {
    return `Press ${layout.colours[focus.colour]} now. The ${focus.colour} diamond is in the ${focus.colour} band.`
  }
  if (focus?.kind === 'code') {
    return `Press ${layout.options[focus.index]}. That box holds the code you memorised.`
  }
  if (focus?.kind === 'sum') {
    return snapshot.maths.entered === ''
      ? 'Type the answer to the sum on the number keys.'
      : 'Press Enter to answer.'
  }
  if (snapshot.letters.phase === 'showing') return 'Memorise the code at the top. You will need to pick it out later.'
  if (snapshot.letters.phase === 'asking') return 'Which of the four is the code you memorised?'
  return 'Watch for diamonds heading into the coloured bands.'
}
