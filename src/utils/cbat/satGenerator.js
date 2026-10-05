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
// generateSatSituation({ unitRange, aircraftRange, questionCount, supportChance,
//                        aircraftFields, format }, rng)
//   → { format, clockStart, units, aircraft, comms, questions }
//   units    = [{ id, type, count, heading, allegiance, row, col, ref }]
//   aircraft = [{ callsign, waypointDir, waypointRef, waypointAt, altitude, channel }]
//   comms    = [{ callsign, kind, text, speech }]   (radio messages, audio-delivered)
//              kind 'support' also carries { supportRef, supportUnitType }
//   questions= [{ id, category, prompt, answer, options }]   (4-option MC)
//
// `format` is 'classic' (the default, the SkyWatch theme) or 'cbat' (the Real
// CBAT theme), which follows what a candidate who passed the real SAT described:
//   • headings and waypoint directions use all 8 compass points;
//   • altitude is in thousands of feet (23,000ft), not a flight level;
//   • "Next Waypoint At" is a time on the in-game clock (11:06:05), and the
//     situation carries `clockStart` (seconds since midnight) for that clock;
//   • multiple choice offers up to 8 options, listed in a fixed order (compass
//     order, ascending numbers) rather than shuffled;
//   • 40-60% of each situation's questions are TYPED, not chosen: altitude as
//     "__,000ft" and waypoint time as "11:__:__". A typed question is
//     { kind: 'typed', entry, answer, answerDigits } where `entry` lists the
//     fixed text and digit slots in order — see formatSatEntry / satTypedCorrect.

const COLS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] // x-axis, along the top
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] // y-axis, down the left

export const UNIT_TYPES = ['tank', 'helicopter', 'jet']
const TYPE_PLURAL = { tank: 'tanks', helicopter: 'helicopters', jet: 'jets' }
// Yellow = Friendly, Red = Hostile, White = Unknown (fixed legend meaning).
export const ALLEGIANCES = ['friendly', 'hostile', 'unknown']
const HEADINGS = ['N', 'S', 'E', 'W']
// Compass order — also the order the 8 heading options are listed in.
const HEADINGS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const HEADING_WORD = {
  N: 'North', NE: 'North East', E: 'East', SE: 'South East',
  S: 'South', SW: 'South West', W: 'West', NW: 'North West',
}
const CALLSIGNS = ['York', 'Leeds', 'Hull']
// The controller-aircraft panel's four fields. A difficulty may show a subset —
// see `aircraftFields` in satDifficulty.js.
export const ALL_AIRCRAFT_FIELDS = ['waypoint', 'waypointAt', 'altitude', 'channel']
const CHANNELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']
// Eight, so a channel question can offer the full 8 options.
const CHANNELS_8 = [...CHANNELS, 'Golf', 'Hotel']
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

// MC options: the answer plus `n - 1` distinct distractors drawn from `pool`
// (anything equal to the answer is filtered out first). Falls back gracefully
// if the pool is too small.
//
// Classic shuffles them. `ordered` (the cbat format) lists them in the pool's
// own order instead — with eight on screen, compass order and ascending numbers
// are how a real answer sheet reads, and searching a shuffled eight would test
// scanning rather than recall.
function buildOptions(answer, pool, rng, n = 4, ordered = false) {
  const candidates = shuffle(pool.filter(p => String(p) !== String(answer)), rng)
  const distractors = []
  for (const c of candidates) {
    if (distractors.length >= n - 1) break
    if (!distractors.some(d => String(d) === String(c))) distractors.push(c)
  }
  if (!ordered) return shuffle([answer, ...distractors], rng)
  const rank = (v) => pool.findIndex(p => String(p) === String(v))
  return [answer, ...distractors].sort((a, b) => rank(a) - rank(b))
}

const refOf = (row, col) => `${row}${col}`
const gridSpeech = (ref) => `${ROW_WORD[ref[0]]} ${DIGIT_WORD[Number(ref[1])]}`
const flWord = (fl) => String(fl).split('').map(d => DIGIT_WORD[Number(d)]).join(' ')

// ── Clock and altitude formatting (cbat format) ─────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0')

// Seconds since midnight → "HH:MM:SS".
export function formatSatClock(sec) {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`
}

// What a controller-aircraft field shows on screen, in either format.
export function formatSatAltitude(ac) {
  return ac.altitudeUnit === 'kft' ? `${ac.altitude},000ft` : `FL${ac.altitude}`
}
export function formatSatWaypointAt(ac) {
  return typeof ac.waypointAt === 'string' ? ac.waypointAt : `${ac.waypointAt}s`
}

// A typed question's entry line with `digits` filled into its slots in order,
// and an underscore for every slot not yet typed: "11:06:0_", "2_,000ft".
export function formatSatEntry(entry, digits = '') {
  let i = 0
  return entry.map(seg => {
    if (seg.text != null) return seg.text
    const part = digits.slice(i, i + seg.digits).padEnd(seg.digits, '_')
    i += seg.digits
    return part
  }).join('')
}

// How many digits a typed question takes in total.
export function satEntryLength(entry) {
  return entry.reduce((n, seg) => n + (seg.digits || 0), 0)
}

// All-or-nothing marking. A single number (altitude) is compared as a number,
// so "5" and "05" both answer 5,000ft. A multi-slot entry (a clock time) has to
// match digit for digit.
export function satTypedCorrect(question, digits) {
  if (!digits) return false
  const groups = question.entry.filter(seg => seg.digits)
  if (groups.length === 1) return Number(digits) === Number(question.answerDigits)
  return digits === question.answerDigits
}

function makeUnits(unitCount, rng, randInt, headings = HEADINGS) {
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
    heading: pick(headings, rng),
    allegiance: pick(ALLEGIANCES, rng),
    row: cell.row,
    col: cell.col,
    ref: cell.ref,
  }))
}

function makeAircraft(aircraftCount, rng, randInt, format = 'classic', clockStart = 0) {
  const callsigns = pickDistinct(CALLSIGNS, aircraftCount, rng)
  if (format === 'cbat') {
    return callsigns.map(callsign => ({
      callsign,
      waypointDir: pick(HEADINGS_8, rng),
      waypointRef: refOf(pick(ROWS, rng), pick(COLS, rng)),
      // A time on the in-game clock, 2-15 minutes ahead of where it starts, to
      // the second. Always past the end of the observe window, so it reads as
      // "the next waypoint" for the whole situation.
      waypointAt: formatSatClock(clockStart + randInt(120, 900)),
      altitude: randInt(5, 40),                // thousands of feet
      altitudeUnit: 'kft',
      channel: pick(CHANNELS_8, rng),
    }))
  }
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
//
// Beyond one instruction per aircraft, a situation *occasionally* carries a
// support request: a ground unit on the grid calls for support and one of the
// controller aircraft is tasked to respond. It's the only fact that ties the
// audio to the map, so it can't be answered from either alone.
function makeComms(aircraft, units, supportCall, fields, rng, format = 'classic') {
  // The radio only ever talks about fields the panel is actually showing —
  // otherwise a difficulty that hides the waypoint still has a voice reading it
  // out, which is harder than the full picture, not easier.
  const kinds = ['altitude', 'channel', 'waypoint'].filter(k => fields.includes(k))
  const comms = aircraft.map(ac => {
    const kind = pick(kinds, rng)
    if (kind === 'altitude') {
      if (format === 'cbat') return {
        callsign: ac.callsign, kind,
        text: `${ac.callsign}, climb and maintain ${formatSatAltitude(ac)}.`,
        speech: `${ac.callsign}, climb and maintain ${flWord(ac.altitude)} thousand feet.`,
      }
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

  if (!supportCall || !units.length || !aircraft.length) return comms

  // Friendly units call for support where possible — a hostile one asking for
  // help doesn't read right. Falls back to any unit if none are friendly.
  const friendly = units.filter(u => u.allegiance === 'friendly')
  const caller = pick(friendly.length ? friendly : units, rng)
  const responder = pick(aircraft, rng)
  const support = {
    callsign: responder.callsign,
    kind: 'support',
    supportRef: caller.ref,
    supportUnitType: caller.type,
    text: `${responder.callsign}, unit calling for support at grid ${caller.ref}. Respond.`,
    speech: `${responder.callsign}, unit calling for support at grid ${gridSpeech(caller.ref)}. Respond.`,
  }
  // Slot it anywhere in the sequence so it isn't always the last thing heard.
  comms.splice(Math.floor(rng() * (comms.length + 1)), 0, support)
  return comms
}

// Build the candidate question pool from the situation's facts, then sample
// `questionCount` of them. Each unit is referenced by its (unique) grid ref so
// prompts are never ambiguous.
function makeQuestions(units, aircraft, comms, questionCount, fields, rng, format = 'classic') {
  if (format === 'cbat') return makeCbatQuestions(units, aircraft, comms, questionCount, fields, rng)
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

  // One question per field the panel shows. A difficulty that hides a field must
  // never be asked about it — the answer was never on screen.
  aircraft.forEach(ac => {
    if (fields.includes('waypoint')) candidates.push({
      category: 'aircraft-waypoint',
      prompt: `Where is ${ac.callsign}'s next waypoint?`,
      answer: ac.waypointRef,
      options: buildOptions(ac.waypointRef, allRefs, rng),
    })
    if (fields.includes('waypointAt')) candidates.push({
      category: 'aircraft-seconds',
      prompt: `How many seconds until ${ac.callsign} reaches its next waypoint?`,
      answer: ac.waypointAt,
      options: buildOptions(ac.waypointAt, secPool, rng),
    })
    if (fields.includes('altitude')) candidates.push({
      category: 'aircraft-altitude',
      prompt: `What altitude (flight level) is ${ac.callsign} at?`,
      answer: ac.altitude,
      options: buildOptions(ac.altitude, altPool, rng),
    })
    if (fields.includes('channel')) candidates.push({
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
    else if (c.kind === 'support') what = `respond to the support request at grid ${c.supportRef}`
    else what = `proceed to waypoint grid ${commsAircraft(aircraft, c).waypointRef}`
    candidates.push({
      category: 'audio-callsign',
      prompt: `Over the radio, which aircraft was instructed to ${what}?`,
      answer: c.callsign,
      options: buildOptions(c.callsign, CALLSIGNS, rng),
    })
  })

  // Support requests — audio-only location, plus a cross-modal question that
  // needs the call (which cell) *and* the map (what was in it).
  comms.filter(c => c.kind === 'support').forEach(c => {
    candidates.push({
      category: 'audio-support-ref',
      prompt: `Over the radio, which grid cell called for support?`,
      answer: c.supportRef,
      options: buildOptions(c.supportRef, allRefs, rng),
    })
    candidates.push({
      category: 'audio-support-unit',
      prompt: `What type of unit called for support?`,
      answer: TYPE_PLURAL[c.supportUnitType],
      options: buildOptions(TYPE_PLURAL[c.supportUnitType], Object.values(TYPE_PLURAL), rng),
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

// The Real CBAT question set. Same facts as classic, asked the way the real SAT
// asks them: 8-option multiple choice in a fixed order, and altitude and
// waypoint time typed in rather than picked.
function makeCbatQuestions(units, aircraft, comms, questionCount, fields, rng) {
  const opts = (answer, pool) => buildOptions(answer, pool, rng, 8, true)
  const choice = []
  const typed = []
  const countPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const headingPool = HEADINGS_8.map(h => HEADING_WORD[h])
  const allRefs = []
  for (const r of ROWS) for (const c of COLS) allRefs.push(refOf(r, c))

  units.forEach(u => {
    const who = `the ${u.allegiance} ${TYPE_PLURAL[u.type]} at grid ${u.ref}`
    choice.push({
      category: 'unit-count',
      prompt: `How many ${TYPE_PLURAL[u.type]} were at grid ${u.ref}?`,
      answer: u.count,
      options: opts(u.count, countPool),
    })
    choice.push({
      category: 'unit-heading',
      prompt: `Which way was ${who} heading?`,
      answer: HEADING_WORD[u.heading],
      options: opts(HEADING_WORD[u.heading], headingPool),
    })
  })

  units.forEach(u => {
    const sameKind = units.filter(o => o.allegiance === u.allegiance && o.type === u.type)
    if (sameKind.length !== 1) return
    choice.push({
      category: 'unit-cell',
      prompt: `Which grid cell held the ${u.allegiance} ${TYPE_PLURAL[u.type]}?`,
      answer: u.ref,
      options: opts(u.ref, allRefs),
    })
  })

  aircraft.forEach(ac => {
    if (fields.includes('waypoint')) choice.push({
      category: 'aircraft-waypoint',
      prompt: `Where is ${ac.callsign}'s next waypoint?`,
      answer: ac.waypointRef,
      options: opts(ac.waypointRef, allRefs),
    })
    if (fields.includes('waypointAt')) {
      // The hour is given; the minutes and seconds are what has to be recalled.
      const [hh, mm, ss] = ac.waypointAt.split(':')
      typed.push({
        category: 'aircraft-seconds',
        kind: 'typed',
        prompt: `What time was ${ac.callsign}'s next waypoint at?`,
        entry: [{ text: `${hh}:` }, { digits: 2 }, { text: ':' }, { digits: 2 }],
        answer: ac.waypointAt,
        answerDigits: `${mm}${ss}`,
      })
    }
    if (fields.includes('altitude')) typed.push({
      category: 'aircraft-altitude',
      kind: 'typed',
      prompt: `What altitude was ${ac.callsign} flying at?`,
      entry: [{ digits: 2 }, { text: ',000ft' }],
      answer: formatSatAltitude(ac),
      answerDigits: String(ac.altitude),
    })
    if (fields.includes('channel')) choice.push({
      category: 'aircraft-channel',
      prompt: `What comms channel is ${ac.callsign} on?`,
      answer: ac.channel,
      options: opts(ac.channel, CHANNELS_8),
    })
  })

  comms.forEach(c => {
    let what
    if (c.kind === 'altitude') what = `climb and maintain ${formatSatAltitude(commsAircraft(aircraft, c))}`
    else if (c.kind === 'channel') what = `switch to comms channel ${commsAircraft(aircraft, c).channel}`
    else if (c.kind === 'support') what = `respond to the support request at grid ${c.supportRef}`
    else what = `proceed to waypoint grid ${commsAircraft(aircraft, c).waypointRef}`
    choice.push({
      category: 'audio-callsign',
      prompt: `Over the radio, which aircraft was instructed to ${what}?`,
      answer: c.callsign,
      options: opts(c.callsign, CALLSIGNS),
    })
  })

  comms.filter(c => c.kind === 'support').forEach(c => {
    choice.push({
      category: 'audio-support-ref',
      prompt: `Over the radio, which grid cell called for support?`,
      answer: c.supportRef,
      options: opts(c.supportRef, allRefs),
    })
    choice.push({
      category: 'audio-support-unit',
      prompt: `What type of unit called for support?`,
      answer: TYPE_PLURAL[c.supportUnitType],
      options: opts(TYPE_PLURAL[c.supportUnitType], Object.values(TYPE_PLURAL)),
    })
  })

  // 40-60% typed. The share is rolled per situation inside that band (so a run
  // never settles into a predictable rhythm), then capped by what this
  // situation actually has to ask.
  const lo = Math.ceil(questionCount * 0.4)
  const hi = Math.max(lo, Math.floor(questionCount * 0.6))
  const wantTyped = Math.min(typed.length, lo + Math.floor(rng() * (hi - lo + 1)))

  const seen = new Set()
  const takeDistinct = (list, count) => {
    const out = []
    for (const q of shuffle(list, rng)) {
      if (out.length >= count) break
      if (seen.has(q.prompt)) continue
      seen.add(q.prompt)
      out.push(q)
    }
    return out
  }
  const pickedTyped = takeDistinct(typed, wantTyped)
  const pickedChoice = takeDistinct(choice, questionCount - pickedTyped.length)
  // A situation short on multiple choice tops up with typed instead.
  const short = questionCount - pickedTyped.length - pickedChoice.length
  const topUp = short > 0 ? takeDistinct(typed, short) : []

  return shuffle([...pickedTyped, ...pickedChoice, ...topUp], rng)
    .map((q, i) => ({ id: `q${i}`, ...q }))
}

function commsAircraft(aircraft, comm) {
  return aircraft.find(a => a.callsign === comm.callsign) || {}
}

export function generateSatSituation(opts = {}, rng = Math.random) {
  const randInt = makeRandInt(rng)
  // Ranges (not fixed counts) are what a difficulty tunes — rolling them here
  // rather than in the caller keeps a seeded rng in charge of the whole
  // situation, so a seed still reproduces it exactly. An explicit unitCount /
  // aircraftCount / supportCall still wins, which is how the tutorial pins its
  // fixed practice picture.
  const [unitMin, unitMax] = opts.unitRange ?? [3, 5]
  const [acMin, acMax] = opts.aircraftRange ?? [2, 3]
  const unitCount = opts.unitCount ?? randInt(unitMin, unitMax)
  const aircraftCount = opts.aircraftCount ?? randInt(acMin, acMax)
  const questionCount = opts.questionCount ?? 6
  // Which of the four aircraft-panel fields are on screen. Gates both what the
  // radio talks about and what can be asked, so the two never drift from what
  // the player was actually shown.
  const fields = opts.aircraftFields ?? ALL_AIRCRAFT_FIELDS
  // Occasional by design — on Hard, roughly every other situation carries one.
  const supportCall = opts.supportCall ?? rng() < (opts.supportChance ?? 0.5)
  const format = opts.format === 'cbat' ? 'cbat' : 'classic'
  // The in-game clock's start, a working-day time to the second. Only the cbat
  // format has a clock, and rolling it only there keeps a classic seed's
  // sequence exactly what it always was.
  const clockStart = format === 'cbat' ? randInt(8 * 3600, 16 * 3600) : null

  const units = makeUnits(unitCount, rng, randInt, format === 'cbat' ? HEADINGS_8 : HEADINGS)
  const aircraft = makeAircraft(aircraftCount, rng, randInt, format, clockStart)
  const comms = makeComms(aircraft, units, supportCall, fields, rng, format)
  const questions = makeQuestions(units, aircraft, comms, questionCount, fields, rng, format)

  return { format, clockStart, units, aircraft, comms, questions }
}

export const SAT_GRID = { COLS, ROWS }
export const SAT_HEADING_WORD = HEADING_WORD
export const SAT_HEADINGS_8 = HEADINGS_8
