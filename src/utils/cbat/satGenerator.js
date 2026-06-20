// CBAT "Situational Awareness Test" (SAT) situation generator.
//
// Mirrors the real RAF SAT: the candidate OBSERVES a tactical picture — a grid
// of military units plus controller-aircraft data, with some facts delivered
// over the radio — it then DISAPPEARS and they answer multiple-choice recall
// questions about what they saw and heard.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a
// situation in tests. Defaults to Math.random for live play.
//
// generateSatSituation({ unitCount, aircraftCount, questionCount }, rng)
//   → { units, aircraft, comms, questions }
//   units    = [{ id, type, count, heading, allegiance, row, col, ref }]
//   aircraft = [{ callsign, waypointDir, waypointRef, waypointAt, altitude, channel }]
//   comms    = [{ callsign, kind, text, speech }]   (radio messages, audio-delivered)
//   questions= [{ id, category, prompt, answer, options }]   (4-option MC)

const COLS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] // x-axis, along the top
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] // y-axis, down the left

export const UNIT_TYPES = ['tank', 'helicopter', 'jet']
const TYPE_PLURAL = { tank: 'tanks', helicopter: 'helicopters', jet: 'jets' }
// Yellow = Friendly, Red = Hostile, White = Unknown (fixed legend meaning).
export const ALLEGIANCES = ['friendly', 'hostile', 'unknown']
const HEADINGS = ['N', 'S', 'E', 'W']
const HEADING_WORD = { N: 'North', S: 'South', E: 'East', W: 'West' }
const CALLSIGNS = ['York', 'Leeds', 'Hull']
const CHANNELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']
// Spoken phonetic for grid columns / flight levels so speechSynthesis reads
// "Charlie four" not "C4", and "two five zero" not "250".
const DIGIT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const ROW_WORD = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet' }

function makeRandInt(rng) {
  return (min, max) => min + Math.floor(rng() * (max - min + 1))
}

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)]
}

// Pick `n` distinct items from `arr` (n ≤ arr.length).
function pickDistinct(arr, n, rng) {
  return shuffle(arr, rng).slice(0, n)
}

// 4-option MC: the answer plus 3 distinct distractors drawn from `pool`
// (anything equal to the answer is filtered out first), then shuffled. Falls
// back gracefully if the pool is too small.
function buildOptions(answer, pool, rng) {
  const candidates = shuffle(pool.filter(p => String(p) !== String(answer)), rng)
  const distractors = []
  for (const c of candidates) {
    if (distractors.length >= 3) break
    if (!distractors.some(d => String(d) === String(c))) distractors.push(c)
  }
  return shuffle([answer, ...distractors], rng)
}

const refOf = (row, col) => `${row}${col}`
const gridSpeech = (ref) => `${ROW_WORD[ref[0]]} ${DIGIT_WORD[Number(ref[1])]}`
const flWord = (fl) => String(fl).split('').map(d => DIGIT_WORD[Number(d)]).join(' ')

function makeUnits(unitCount, rng, randInt) {
  // Distinct cells so every unit has a unique grid reference.
  const cells = []
  const seen = new Set()
  while (cells.length < unitCount) {
    const row = pick(ROWS, rng)
    const col = pick(COLS, rng)
    const ref = refOf(row, col)
    if (seen.has(ref)) continue
    seen.add(ref)
    cells.push({ row, col, ref })
  }
  return cells.map((cell, i) => ({
    id: `u${i}`,
    type: pick(UNIT_TYPES, rng),
    count: randInt(1, 9),
    heading: pick(HEADINGS, rng),
    allegiance: pick(ALLEGIANCES, rng),
    row: cell.row,
    col: cell.col,
    ref: cell.ref,
  }))
}

function makeAircraft(aircraftCount, rng, randInt) {
  const callsigns = pickDistinct(CALLSIGNS, aircraftCount, rng)
  return callsigns.map(callsign => ({
    callsign,
    waypointDir: pick(HEADINGS, rng),
    waypointRef: refOf(pick(ROWS, rng), pick(COLS, rng)),
    waypointAt: randInt(3, 18) * 5,          // seconds, multiples of 5 (15–90)
    altitude: randInt(15, 35) * 10,          // flight level FL150–FL350, step 10
    channel: pick(CHANNELS, rng),
  }))
}

// Radio messages — facts delivered over the headphones during the observe
// phase. Each carries a `speech` variant phrased for text-to-speech.
function makeComms(aircraft, rng) {
  const kinds = ['altitude', 'channel', 'waypoint']
  return aircraft.map(ac => {
    const kind = pick(kinds, rng)
    if (kind === 'altitude') {
      return {
        callsign: ac.callsign, kind,
        text: `${ac.callsign}, climb and maintain flight level ${ac.altitude}.`,
        speech: `${ac.callsign}, climb and maintain flight level ${flWord(ac.altitude)}.`,
      }
    }
    if (kind === 'channel') {
      return {
        callsign: ac.callsign, kind,
        text: `${ac.callsign}, switch to comms channel ${ac.channel}.`,
        speech: `${ac.callsign}, switch to comms channel ${ac.channel}.`,
      }
    }
    return {
      callsign: ac.callsign, kind,
      text: `${ac.callsign}, your next waypoint is grid ${ac.waypointRef}.`,
      speech: `${ac.callsign}, your next waypoint is grid ${gridSpeech(ac.waypointRef)}.`,
    }
  })
}

// Build the candidate question pool from the situation's facts, then sample
// `questionCount` of them. Each unit is referenced by its (unique) grid ref so
// prompts are never ambiguous.
function makeQuestions(units, aircraft, comms, questionCount, rng) {
  const candidates = []
  const countPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const headingPool = Object.values(HEADING_WORD)
  const altPool = [150, 180, 200, 220, 250, 280, 300, 320, 350]
  const secPool = [15, 20, 30, 45, 60, 75, 90]
  const allRefs = []
  for (const r of ROWS) for (const c of COLS) allRefs.push(refOf(r, c))

  units.forEach(u => {
    const who = `the ${u.allegiance} ${TYPE_PLURAL[u.type]} at grid ${u.ref}`
    candidates.push({
      category: 'unit-count',
      prompt: `How many ${TYPE_PLURAL[u.type]} were at grid ${u.ref}?`,
      answer: u.count,
      options: buildOptions(u.count, countPool, rng),
    })
    candidates.push({
      category: 'unit-heading',
      prompt: `Which way was ${who} heading?`,
      answer: HEADING_WORD[u.heading],
      options: buildOptions(HEADING_WORD[u.heading], headingPool, rng),
    })
  })

  // "Which cell" — only when the (allegiance, type) pair is unique, so the
  // answer is unambiguous.
  units.forEach(u => {
    const sameKind = units.filter(o => o.allegiance === u.allegiance && o.type === u.type)
    if (sameKind.length !== 1) return
    candidates.push({
      category: 'unit-cell',
      prompt: `Which grid cell held the ${u.allegiance} ${TYPE_PLURAL[u.type]}?`,
      answer: u.ref,
      options: buildOptions(u.ref, allRefs, rng),
    })
  })

  aircraft.forEach(ac => {
    candidates.push({
      category: 'aircraft-waypoint',
      prompt: `Where is ${ac.callsign}'s next waypoint?`,
      answer: ac.waypointRef,
      options: buildOptions(ac.waypointRef, allRefs, rng),
    })
    candidates.push({
      category: 'aircraft-seconds',
      prompt: `How many seconds until ${ac.callsign} reaches its next waypoint?`,
      answer: ac.waypointAt,
      options: buildOptions(ac.waypointAt, secPool, rng),
    })
    candidates.push({
      category: 'aircraft-altitude',
      prompt: `What altitude (flight level) is ${ac.callsign} at?`,
      answer: ac.altitude,
      options: buildOptions(ac.altitude, altPool, rng),
    })
    candidates.push({
      category: 'aircraft-channel',
      prompt: `What comms channel is ${ac.callsign} on?`,
      answer: ac.channel,
      options: buildOptions(ac.channel, CHANNELS, rng),
    })
  })

  // Audio-recall — which callsign received a given radio instruction.
  comms.forEach(c => {
    let what
    if (c.kind === 'altitude') what = `climb and maintain flight level ${commsAircraft(aircraft, c).altitude}`
    else if (c.kind === 'channel') what = `switch to comms channel ${commsAircraft(aircraft, c).channel}`
    else what = `proceed to waypoint grid ${commsAircraft(aircraft, c).waypointRef}`
    candidates.push({
      category: 'audio-callsign',
      prompt: `Over the radio, which aircraft was instructed to ${what}?`,
      answer: c.callsign,
      options: buildOptions(c.callsign, CALLSIGNS, rng),
    })
  })

  // Sample the requested number (or all, if fewer exist), keeping it
  // deterministic and avoiding duplicate prompts.
  const seenPrompts = new Set()
  const sampled = []
  for (const q of shuffle(candidates, rng)) {
    if (seenPrompts.has(q.prompt)) continue
    seenPrompts.add(q.prompt)
    sampled.push(q)
    if (sampled.length >= questionCount) break
  }
  return sampled.map((q, i) => ({ id: `q${i}`, ...q }))
}

function commsAircraft(aircraft, comm) {
  return aircraft.find(a => a.callsign === comm.callsign) || {}
}

export function generateSatSituation(opts = {}, rng = Math.random) {
  const randInt = makeRandInt(rng)
  const unitCount = opts.unitCount ?? randInt(3, 5)
  const aircraftCount = opts.aircraftCount ?? randInt(2, 3)
  const questionCount = opts.questionCount ?? 6

  const units = makeUnits(unitCount, rng, randInt)
  const aircraft = makeAircraft(aircraftCount, rng, randInt)
  const comms = makeComms(aircraft, rng)
  const questions = makeQuestions(units, aircraft, comms, questionCount, rng)

  return { units, aircraft, comms, questions }
}

export const SAT_GRID = { COLS, ROWS }
export const SAT_HEADING_WORD = HEADING_WORD
