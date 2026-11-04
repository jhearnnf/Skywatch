// Real CBAT "Directions and Distances" question set.
//
// The SkyWatch theme keeps `dadGenerator.js` (relative turns, 45° diagonals,
// "which direction from the start"). This module is the Real CBAT theme's set,
// built from what passers told us in the outcome questionnaire:
//
//   - The questions vary: direction AND distance, not just "where from the
//     start after some turns".
//   - Named landmarks placed relative to each other ("Puffin Island is north-
//     west of Eagle Island, which is west of Pecan Island..."), with similar-
//     sounding names, then "where is X from Y?", "how far is X from Y?" and
//     "which two are closest?".
//   - Journeys given as absolute headings ("500 miles north west, then 600
//     miles south west, then 700 miles south east...").
//   - "Not Pythagoras, all based off square angles ... the distances created
//     rectangles." Every leg and every statement here is at a right angle to
//     the others, and a distance is only ever asked along a straight line, so
//     no answer needs a square root.
//   - "The above kind of questions got joined together": a journey that sets
//     off from one of the landmarks.
//
// Geometry: each question lives in one FRAME. Frame 0 is the N/E/S/W grid;
// frame 1 is the same grid turned 45° (NE/SE/SW/NW), which is how a journey
// of north-west, south-west, south-east, north-east legs still draws a
// rectangle. Points are integer (a, b) where `a` runs along the frame's first
// axis (N or NE) and `b` along its second (E or SE). A distance is units ×
// the set's `step`, so every stated figure is a round number.
//
// Pure and deterministic given `rng`. Every generator retries until its
// question has exactly one correct answer, and throws if it never finds one
// (the tests sweep many seeds to prove it always does).

import { COMPASS, DIR_WORD, buildOptions, shuffle } from './dadGenerator'

const MAX_ATTEMPTS = 500

// Compass index of frame axis k (0:+a, 1:+b, 2:-a, 3:-b).
const axisDir = (frame, k) => (2 * k + frame) % 8
const dirWord = (i) => DIR_WORD[COMPASS[i]].toLowerCase()
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// 8-point compass index of a frame vector, or null when it is not clean
// (only axis-aligned and perfect-diagonal vectors have an 8-point answer).
function frameCompass(frame, a, b) {
  if (a === 0 && b === 0) return null
  if (a !== 0 && b !== 0 && Math.abs(a) !== Math.abs(b)) return null
  // In frame terms +a is "up" and +b is "right", the same as N and E.
  const key = `${Math.sign(b)},${Math.sign(a)}`
  const map = { '0,1': 0, '1,1': 1, '1,0': 2, '1,-1': 3, '0,-1': 4, '-1,-1': 5, '-1,0': 6, '-1,1': 7 }
  return (map[key] + frame) % 8
}

const isAxisAligned = (a, b) => (a === 0) !== (b === 0)

// Four consecutive distances in steps of `step`, ascending, with the answer at
// a random position. A window centred on the answer would give it away; a
// random position means the option list says nothing on its own.
function distanceOptions(answer, step, unit, rng) {
  let k = Math.floor(rng() * 4)
  while (answer - k * step <= 0) k--
  const base = answer - k * step
  return [0, 1, 2, 3].map(i => `${base + i * step} ${unit}`)
}

// ── Landmark sets ────────────────────────────────────────────────────────────
// Each group holds deliberately similar names: passers found the look-alike
// names ("Puffin", "Pigeon", "Pecan") part of what made the real test hard.
const SETS = [
  {
    key: 'islands', noun: 'islands', unit: 'miles', step: 10,
    full: (n) => `${n} Island`, short: (n) => n,
    traveller: { subject: 'a boat', obj: 'the boat', verb: 'sails' },
    groups: [
      ['Puffin', 'Pigeon', 'Pelican', 'Penguin', 'Petrel', 'Plover'],
      ['Swan', 'Swift', 'Stork', 'Skua', 'Snipe', 'Shag'],
      ['Gull', 'Grebe', 'Goose', 'Gannet', 'Grouse', 'Godwit'],
    ],
  },
  {
    key: 'mountains', noun: 'mountains', unit: 'km', step: 5,
    full: (n) => `Mount ${n}`, short: (n) => n,
    traveller: { subject: 'a walker', obj: 'the walker', verb: 'walks' },
    groups: [
      ['Carran', 'Corran', 'Carrow', 'Callow', 'Cairn', 'Carden'],
      ['Brack', 'Brent', 'Brock', 'Brin', 'Brede', 'Bray'],
    ],
  },
  {
    key: 'shops', noun: 'shops', unit: 'metres', step: 50,
    full: (n) => `the ${n.toLowerCase()}`, short: (n) => n,
    traveller: { subject: 'a courier', obj: 'the courier', verb: 'walks' },
    groups: [
      ['Bakery', 'Butcher', 'Barber', 'Bookshop', 'Bike shop', 'Boutique'],
      ['Chemist', 'Cafe', 'Chip shop', 'Cobbler', 'Card shop', 'Crafts shop'],
    ],
  },
]

// ── Journeys ─────────────────────────────────────────────────────────────────
const JOURNEY_SUBJECTS = [
  { subject: 'A ship', obj: 'the ship', origin: 'the harbour', verb: 'sails' },
  { subject: 'A patrol aircraft', obj: 'the aircraft', origin: 'the airfield', verb: 'flies' },
  { subject: 'A convoy', obj: 'the convoy', origin: 'the depot', verb: 'drives' },
  { subject: 'A survey vessel', obj: 'the vessel', origin: 'port', verb: 'sails' },
]

// Lay out `legCount` right-angled legs from (0,0) in `frame`, alternating
// axes so consecutive legs are always at 90°. The final leg is chosen to land
// on a point that answers `ask` cleanly:
//   'direction' — an 8-point direction from the start
//   'distance'  — a straight line from the start (axis-aligned)
// Returns { legs: [{ dir, units }], end: [a, b] } or null to retry.
function layLegs(legCount, frame, ask, rng, { minUnits = 1, maxUnits = 7 } = {}) {
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const sum = [0, 0]
  const legs = []
  let axis = randInt(0, 1)
  const push = (ax, signed) => {
    sum[ax] += signed
    // axis 0 → k 0 (+a) / 2 (-a); axis 1 → k 1 (+b) / 3 (-b)
    const k = ax + (signed > 0 ? 0 : 2)
    legs.push({ dir: axisDir(frame, k), units: Math.abs(signed) })
  }
  for (let i = 0; i < legCount - 1; i++) {
    push(axis, randInt(minUnits, maxUnits) * (rng() < 0.5 ? 1 : -1))
    axis = 1 - axis
  }
  // Final leg runs along `axis`; the other coordinate is now fixed.
  const other = sum[1 - axis]
  let targets
  if (ask === 'distance') {
    if (other === 0) return null
    targets = [0]
  } else {
    targets = other !== 0 ? [0, other, -other] : [randInt(1, 5), -randInt(1, 5)]
  }
  const viable = targets
    .map(t => t - sum[axis])
    .filter(d => d !== 0 && Math.abs(d) <= 9)
  if (!viable.length) return null
  push(axis, viable[randInt(0, viable.length - 1)])
  return { legs, end: [sum[0], sum[1]] }
}

// "A ship leaves the harbour and sails north-west for 500 miles, then 600
// miles south-west, ..." (absolute headings) or the turns wording "...heading
// north for 500 miles, turns right and travels 800 miles, ...".
function journeyProse(who, from, legs, wording, step, unit) {
  const dist = (l) => `${l.units * step} ${unit}`
  const first = `${cap(who.subject)} leaves ${from} and ${who.verb} ${dirWord(legs[0].dir)} for ${dist(legs[0])}`
  const rest = legs.slice(1).map((l, i) => {
    if (wording === 'turns') {
      const prev = legs[i].dir
      const turn = (l.dir - prev + 8) % 8 === 2 ? 'right' : 'left'
      return `turns ${turn} and travels ${dist(l)}`
    }
    return `then ${dist(l)} ${dirWord(l.dir)}`
  })
  if (rest.length) rest[rest.length - 1] = `and finally ${rest[rest.length - 1].replace(/^then /, '')}`
  return [first, ...rest].join(', ') + '.'
}

// A journey from a named start, asking where it ends up from that start.
export function generateJourneyQuestion(legCount, rng = Math.random, opts = {}) {
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const ask = opts.ask || (rng() < 0.5 ? 'direction' : 'distance')
  const wording = opts.wording || (rng() < 0.5 ? 'headings' : 'turns')
  const who = JOURNEY_SUBJECTS[randInt(0, JOURNEY_SUBJECTS.length - 1)]
  const step = 100, unit = 'miles'

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const frame = randInt(0, 1)
    const laid = layLegs(Math.max(2, legCount), frame, ask, rng)
    if (!laid) continue
    const [a, b] = laid.end
    const prose = journeyProse(who, who.origin, laid.legs, wording, step, unit)
    if (ask === 'direction') {
      const dir = frameCompass(frame, a, b)
      if (dir == null) continue
      const answer = COMPASS[dir]
      return {
        kind: 'journey', ask, wording, frame, prose, legs: laid.legs, end: laid.end,
        question: `In which direction is ${who.obj} from ${who.origin}?`,
        answer, options: buildOptions(answer, rng),
      }
    }
    if (!isAxisAligned(a, b)) continue
    const miles = Math.abs(a || b) * step
    return {
      kind: 'journey', ask, wording, frame, prose, legs: laid.legs, end: laid.end,
      question: `How far is ${who.obj} from ${who.origin}?`,
      answer: `${miles} ${unit}`, options: distanceOptions(miles, step, unit, rng),
    }
  }
  throw new Error('generateJourneyQuestion: no valid layout found')
}

// ── Landmark chains ──────────────────────────────────────────────────────────

// Place `count` landmarks as a chain, each one a right-angled offset from the
// last, and word the links as statements. A link is stated in either direction
// ("A is north of B" / "B is south of A") and the statements come in chain
// order, reverse order or shuffled, so the player has to build the picture
// rather than read it off top to bottom.
function layChain(count, frame, set, rng) {
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const group = set.groups[randInt(0, set.groups.length - 1)]
  const names = shuffle(group, rng).slice(0, count)
  const points = [[0, 0]]
  const links = []
  for (let i = 1; i < count; i++) {
    const [pa, pb] = points[i - 1]
    let placed = null
    for (let t = 0; t < 40 && !placed; t++) {
      const k = randInt(0, 3)
      const units = randInt(1, 6)
      const da = k === 0 ? units : k === 2 ? -units : 0
      const db = k === 1 ? units : k === 3 ? -units : 0
      const p = [pa + da, pb + db]
      if (!points.some(q => q[0] === p[0] && q[1] === p[1])) placed = { p, k, units }
    }
    if (!placed) return null
    points.push(placed.p)
    links.push({ from: i - 1, to: i, k: placed.k, units: placed.units })
  }
  const statements = links.map(l => {
    const flip = rng() < 0.5
    const subj = flip ? l.from : l.to
    const ref = flip ? l.to : l.from
    const dir = axisDir(frame, flip ? (l.k + 2) % 4 : l.k)
    return `${cap(set.full(names[subj]))} is ${l.units * set.step} ${set.unit} ${dirWord(dir)} of ${set.full(names[ref])}.`
  })
  const order = rng() < 1 / 3 ? statements : rng() < 0.5 ? [...statements].reverse() : shuffle(statements, rng)
  return { names, points, links, prose: order.join(' ') }
}

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]]
const d2 = ([a, b]) => a * a + b * b
const adjacent = (links, i, j) => links.some(l => (l.from === i && l.to === j) || (l.from === j && l.to === i))

function pairOptions(answerPair, allPairs, label, rng) {
  const others = shuffle(allPairs.filter(p => p !== answerPair), rng).slice(0, 3)
  const opts = shuffle([answerPair, ...others], rng).map(label)
  return { answer: label(answerPair), options: opts }
}

// Landmarks placed relative to each other, then one of:
//   'direction' — "In which direction is X from Y?"
//   'distance'  — "How far is X from Y?" (always a straight line)
//   'closest' / 'furthest' — "Which two islands are closest together?"
// The asked-about pair is never one stated directly, so it always has to be
// worked out.
export function generateLandmarkQuestion(count, ask, rng = Math.random) {
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const set = SETS[randInt(0, SETS.length - 1)]
    const frame = randInt(0, 1)
    const chain = layChain(count, frame, set, rng)
    if (!chain) continue
    const { names, points, links } = chain
    const pairs = []
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) pairs.push([i, j])
    const base = { kind: 'landmarks', ask, set: set.key, frame, names, points, prose: chain.prose }

    if (ask === 'direction' || ask === 'distance') {
      const fits = pairs.filter(([i, j]) => {
        if (adjacent(links, i, j)) return false
        const [a, b] = sub(points[i], points[j])
        return ask === 'direction' ? frameCompass(frame, a, b) != null : isAxisAligned(a, b)
      })
      if (!fits.length) continue
      // Either way round: X from Y or Y from X.
      const [i0, j0] = fits[randInt(0, fits.length - 1)]
      const [x, y] = rng() < 0.5 ? [i0, j0] : [j0, i0]
      const [a, b] = sub(points[x], points[y])
      if (ask === 'direction') {
        const answer = COMPASS[frameCompass(frame, a, b)]
        return {
          ...base, pair: [x, y],
          question: `In which direction is ${set.full(names[x])} from ${set.full(names[y])}?`,
          answer, options: buildOptions(answer, rng),
        }
      }
      const dist = Math.abs(a || b) * set.step
      return {
        ...base, pair: [x, y],
        question: `How far is ${set.full(names[x])} from ${set.full(names[y])}?`,
        answer: `${dist} ${set.unit}`, options: distanceOptions(dist, set.step, set.unit, rng),
      }
    }

    // closest / furthest — the winning pair must beat the runner-up clearly
    // (no near-ties to argue over) and, for closest, must not simply be the
    // smallest number in the text.
    const ranked = pairs
      .map(p => ({ p, d: d2(sub(points[p[0]], points[p[1]])) }))
      .sort((m, n) => (ask === 'closest' ? m.d - n.d : n.d - m.d))
    const [best, next] = ranked
    const clear = ask === 'closest' ? best.d * 1.5 <= next.d : best.d >= next.d * 1.5
    if (!clear) continue
    if (ask === 'closest' && adjacent(links, best.p[0], best.p[1])) continue
    const label = ([i, j]) => `${set.short(names[i])} and ${set.short(names[j])}`
    const { answer, options } = pairOptions(best.p, pairs, label, rng)
    return {
      ...base, pair: best.p,
      question: ask === 'closest'
        ? `Which two ${set.noun} are closest together?`
        : `Which two ${set.noun} are furthest apart?`,
      answer, options,
    }
  }
  throw new Error(`generateLandmarkQuestion(${count}, ${ask}): no valid layout found`)
}

// ── Combined: landmarks + a journey from one of them ─────────────────────────
//   'nearest'   — "Which island is the boat now closest to?"
//   'direction' — "In which direction is the boat from Pigeon Island?"
//   'distance'  — "How far is the boat from Pigeon Island?"
export function generateCombinedQuestion(count, legCount, ask, rng = Math.random) {
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const set = SETS[randInt(0, SETS.length - 1)]
    const frame = randInt(0, 1)
    const chain = layChain(count, frame, set, rng)
    if (!chain) continue
    const { names, points } = chain
    const from = randInt(0, count - 1)
    // Free legs; the question is checked against the landmarks afterwards.
    const sum = [...points[from]]
    const legs = []
    let axis = randInt(0, 1)
    for (let i = 0; i < legCount; i++) {
      const signed = randInt(1, 6) * (rng() < 0.5 ? 1 : -1)
      sum[axis] += signed
      legs.push({ dir: axisDir(frame, axis + (signed > 0 ? 0 : 2)), units: Math.abs(signed) })
      axis = 1 - axis
    }
    const end = sum
    if (points.some(p => p[0] === end[0] && p[1] === end[1])) continue
    const who = set.traveller
    const prose = `${chain.prose} ${journeyProse(who, set.full(names[from]), legs, 'headings', set.step, set.unit)}`
    const base = { kind: 'combined', ask, set: set.key, frame, names, points, from, legs, end, prose }

    if (ask === 'nearest') {
      const ranked = points.map((p, i) => ({ i, d: d2(sub(end, p)) })).sort((m, n) => m.d - n.d)
      if (ranked[0].d * 1.5 > ranked[1].d) continue
      if (ranked[0].i === from) continue // "where it started" is too easy a catch
      const label = (i) => set.short(names[i])
      const others = shuffle(points.map((_, i) => i).filter(i => i !== ranked[0].i), rng).slice(0, 3)
      const singular = set.noun.replace(/s$/, '')
      return {
        ...base, target: ranked[0].i,
        question: `Which ${singular} is ${who.obj} now closest to?`,
        answer: label(ranked[0].i), options: shuffle([ranked[0].i, ...others], rng).map(label),
      }
    }

    const fits = points.map((p, i) => i).filter(i => {
      if (i === from) return false
      const [a, b] = sub(end, points[i])
      return ask === 'direction' ? frameCompass(frame, a, b) != null : isAxisAligned(a, b)
    })
    if (!fits.length) continue
    const z = fits[randInt(0, fits.length - 1)]
    const [a, b] = sub(end, points[z])
    if (ask === 'direction') {
      const answer = COMPASS[frameCompass(frame, a, b)]
      return {
        ...base, target: z,
        question: `In which direction is ${who.obj} from ${set.full(names[z])}?`,
        answer, options: buildOptions(answer, rng),
      }
    }
    const dist = Math.abs(a || b) * set.step
    return {
      ...base, target: z,
      question: `How far is ${who.obj} from ${set.full(names[z])}?`,
      answer: `${dist} ${set.unit}`, options: distanceOptions(dist, set.step, set.unit, rng),
    }
  }
  throw new Error(`generateCombinedQuestion(${count}, ${legCount}, ${ask}): no valid layout found`)
}

// ── The 15-question run ──────────────────────────────────────────────────────
// Four stages, each a mix (shuffled within the stage) so kinds never come in
// a predictable block:
//   Q1–3   journeys (headings or turns wording, direction or distance)
//   Q4–7   four landmarks: direction, distance, closest/furthest + a journey
//   Q8–11  five landmarks: the same mix, longer journey
//   Q12–15 landmarks + a journey from one of them, plus one five-landmark pair
export function buildRealDadQuestions(rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)]
  const extreme = () => pick(['closest', 'furthest'])
  const dirOrDist = () => pick(['direction', 'distance'])
  const stages = [
    [() => generateJourneyQuestion(4, rng), () => generateJourneyQuestion(4, rng), () => generateJourneyQuestion(5, rng)],
    shuffle([
      () => generateLandmarkQuestion(4, 'direction', rng),
      () => generateLandmarkQuestion(4, 'distance', rng),
      () => generateLandmarkQuestion(4, extreme(), rng),
      () => generateJourneyQuestion(5, rng),
    ], rng),
    shuffle([
      () => generateLandmarkQuestion(5, 'direction', rng),
      () => generateLandmarkQuestion(5, 'distance', rng),
      () => generateLandmarkQuestion(5, extreme(), rng),
      () => generateJourneyQuestion(6, rng),
    ], rng),
    shuffle([
      () => generateCombinedQuestion(4, 2, 'nearest', rng),
      () => generateCombinedQuestion(4, 3, dirOrDist(), rng),
      () => generateCombinedQuestion(5, 3, pick(['nearest', 'direction', 'distance']), rng),
      () => generateLandmarkQuestion(5, extreme(), rng),
    ], rng),
  ]
  return stages.flat().map(make => make())
}
