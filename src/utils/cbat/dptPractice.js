// Dynamic Projection Test practice drills.
//
// DPT's controls are two presses and three digits, and that is exactly what
// trips people up: the digits are an absolute compass bearing, the press before
// them decides which way round the aircraft turns to reach it, and nothing on
// the arena says so until a round is already running. These drills teach that
// one idea at a time on the real arena, with the real numpad and the real
// flight model, so the first scored run is spent on the test and not on the
// controls.
//
// Everything here is pure data and pure functions. The page (pages/CbatDpt.jsx)
// owns the loop and the rendering; this module owns what each drill asks for,
// how a command is judged against it, and where its gates go.

import {
  SCOPE_HALF, moveAircraft, turnDistance, shortestTurnDirection, bearingToVec,
  segmentsIntersect, normalizeDeg,
} from './dptPhysics'

const CENTRE = { x: SCOPE_HALF, y: SCOPE_HALF }
const GATE_HALF_LEN = 50   // matches the live game's gates

export const pad3 = (n) => String(n === 0 ? 360 : n).padStart(3, '0')
const spaced = (digits) => digits.split('').join(' ')

// One entry per drill. Fields:
//   aircraft   the aircraft on the arena at the start (and after a reset)
//   gates      gate specs, resolved by buildDrillGates (see below)
//   goal       what completes the drill:
//                { type: 'heading', target, aircraftId, shortest }
//                  the named aircraft has settled on `target` after a correct
//                  command. `shortest` rejects the long way round.
//                { type: 'gates' }
//                  every gate has been flown through, in order
//                { type: 'direction' }
//                  both L and R have been pressed; nothing is flown
//   guide      what the arrows point at: `aircraft` until it is selected, then
//              `dir` until it is chosen, then each of `digits` in turn. A
//              'direction' drill points at whichever side is still unpressed.
export const DPT_PRACTICE_DRILLS = [
  {
    key: 'direction',
    title: 'Left or right',
    body: 'Every turn starts with a side. The L and R buttons either side of the numpad choose which way round the aircraft turns to reach the bearing you type next. The arrow sweeping round the compass ring shows the way the selected side would take it. Press L, then R, and watch it change.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 360 }],
    gates: [],
    goal: { type: 'direction' },
    guide: { dir: null, digits: null },
  },
  {
    key: 'east',
    title: 'Turn east',
    body: 'Your aircraft is in the middle of the arena, heading north. That is 360 on the compass ring around the edge. Turn it to face east, which is 090. Press R, then type 0 9 0. The turn starts the moment the third digit goes in.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 360 }],
    gates: [],
    goal: { type: 'heading', target: 90, aircraftId: 'CA-A', shortest: false },
    guide: { dir: 'R', digits: '090' },
  },
  {
    key: 'west',
    title: 'Turn west',
    body: 'Now turn to face west, 270. From east that is a half turn, so left and right are the same distance and either will do. Press L or R, then type 2 7 0.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 90 }],
    gates: [],
    goal: { type: 'heading', target: 270, aircraftId: 'CA-A', shortest: false },
    guide: { dir: null, digits: '270' },
  },
  {
    key: 'anywhere',
    title: 'The compass moves with the aircraft',
    body: 'The aircraft is now in the bottom left of the arena, heading north again. Its compass has not changed: 090 is still east, whichever part of the arena it is in. A bearing is never measured from the middle of the screen. Turn to 090 as before: R, then 0 9 0.',
    aircraft: [{ id: 'CA-A', position: { x: 250, y: 750 }, headingDeg: 360 }],
    gates: [],
    goal: { type: 'heading', target: 90, aircraftId: 'CA-A', shortest: false },
    guide: { dir: 'R', digits: '090' },
  },
  {
    key: 'shortest',
    title: 'Take the shorter way round',
    body: 'Turn to 315, north west. From north, R gets there after 315 degrees of turning and L after only 45. Time is short in a run, so always pick the side with the smaller turn. Press L, then 3 1 5.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 360 }],
    gates: [],
    goal: { type: 'heading', target: 315, aircraftId: 'CA-A', shortest: true },
    guide: { dir: 'L', digits: '315' },
  },
  {
    key: 'through-north',
    title: 'Straight through north',
    body: 'The aircraft is heading 330. Turn to 030. It looks like the smaller number, so L seems right, but the compass runs 359, 360, 001, 002 and carries on. 030 is only 60 degrees to the right of 330, straight through north. L would be 300 degrees. Press R, then 0 3 0.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 330 }],
    gates: [],
    goal: { type: 'heading', target: 30, aircraftId: 'CA-A', shortest: true },
    guide: { dir: 'R', digits: '030' },
  },
  {
    key: 'gate',
    title: 'Fly through a gate',
    body: 'In a run you score by flying through gates. Gate A is south east of the aircraft, between 090 and 180 on the ring. Judge its bearing, pick the shorter side, and turn onto it. About 135 will do it. If you miss, the drill starts again.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 360 }],
    gates: [{ id: 'A', fromTurn: 135, bearing: 135, dist: 170 }],
    goal: { type: 'gates' },
    guide: { dir: null, digits: null },
  },
  {
    key: 'select',
    title: 'Select the aircraft first',
    body: 'Later rounds give you more than one aircraft. A command only goes to the one that is selected, and the buttons under the arena show which that is. CA-A is selected now. Select CA-N, with its button or the N key, then turn it to 180.',
    aircraft: [
      { id: 'CA-A', position: { x: 300, y: 500 }, headingDeg: 360 },
      { id: 'CA-N', position: { x: 700, y: 500 }, headingDeg: 360 },
    ],
    gates: [],
    goal: { type: 'heading', target: 180, aircraftId: 'CA-N', shortest: false },
    guide: { aircraft: 'CA-N', dir: null, digits: '180' },
  },
  {
    key: 'two-gates',
    title: 'Two gates, one after the other',
    body: 'Gates come in order, A then B. Turn onto A, and while the aircraft is still on its way work out the bearing for B. You can type the next command at any time, even before the current turn has finished. Fly through both.',
    aircraft: [{ id: 'CA-A', position: CENTRE, headingDeg: 360 }],
    gates: [
      { id: 'A', fromTurn: 90, bearing: 90, dist: 170 },
      { id: 'B', fromGate: 'A', bearing: 360, dist: 190 },
    ],
    goal: { type: 'gates' },
    guide: { dir: null, digits: null },
  },
]

// Where the first aircraft ends up after turning onto `heading` from its start
// pose, by flying the real flight model until the turn settles. An aircraft
// drifts sideways by about its turn radius while it comes round, so a gate
// placed on a bearing from where it STARTS would be missed by the exact
// command the drill asks for. Measuring from here is what makes "about 135"
// true.
function settledAfterTurn(start, heading) {
  let a = {
    ...start,
    targetHeadingDeg: heading,
    turnDirection:    shortestTurnDirection(start.headingDeg, heading) === 'L' ? 'L' : 'R',
    altitudeFt:       5000,
    targetAltitudeFt: null,
    wasInEdgeBuffer:  false,
  }
  // 1/30s steps, the live loop's cadence. A 180 at 35°/s settles inside 200.
  for (let i = 0; i < 400 && a.targetHeadingDeg != null; i++) {
    a = moveAircraft(a, 1 / 30).aircraft
  }
  return a.position
}

// Resolve a drill's gate specs into the { id, index, kind, p1, p2, hit } shape
// the arena renders and the live game hit-tests. Each gate lies across the
// bearing it is reached on, so a correct command crosses it square.
//   fromTurn  measured from where the first aircraft settles after that turn
//   fromGate  measured from an earlier gate's centre
//   neither   measured from the first aircraft's start position
export function buildDrillGates(drill) {
  const start = drill.aircraft[0]
  const centres = {}
  return drill.gates.map((spec, index) => {
    const origin = spec.fromTurn != null ? settledAfterTurn(start, spec.fromTurn)
      : spec.fromGate ? centres[spec.fromGate]
      : start.position
    const { dx, dy } = bearingToVec(spec.bearing)
    const cx = origin.x + dx * spec.dist
    const cy = origin.y + dy * spec.dist
    centres[spec.id] = { x: cx, y: cy }
    // Perpendicular to the approach bearing.
    const px = -dy * GATE_HALF_LEN
    const py =  dx * GATE_HALF_LEN
    return {
      id:    spec.id,
      index,
      kind:  'letter',
      p1:    { x: cx + px, y: cy + py },
      p2:    { x: cx - px, y: cy - py },
      hit:   false,
    }
  })
}

// The aircraft list for a drill, in the shape the arena and flight model use.
// Altitudes are spaced so two aircraft never sit inside each other's ring; the
// practice never scores, but the ring is drawn and the overlap would look wrong.
export function buildDrillAircraft(drill, modelUrl) {
  return drill.aircraft.map((a, i) => ({
    id:               a.id,
    kind:             a.id,
    modelUrl,
    position:         { ...a.position },
    altitudeFt:       5000 + i * 3000,
    targetAltitudeFt: null,
    headingDeg:       a.headingDeg,
    targetHeadingDeg: null,
    turnDirection:    null,
    wasInEdgeBuffer:  false,
  }))
}

// Judge a committed bearing against the drill. `aircraft` is the one the
// command went to (the selected one), read at commit time so "the shorter way"
// is measured from where the heading is now, not where the drill began.
//
// Returns { verdict, text }. Any verdict other than 'ok' means the drill should
// put the aircraft back to its start once the player has seen what the command
// did. 'ok' may carry a `note` for a command that works but was the long way
// round, on drills that do not yet insist on the short one.
export function judgeCommand(drill, aircraft, activeId, bearing, dir) {
  const goal = drill.goal
  if (goal.type !== 'heading') return { verdict: 'ok', text: `${dir} ${pad3(bearing)}.` }

  if (activeId !== goal.aircraftId) {
    return {
      verdict: 'wrongAircraft',
      text: `That turned ${activeId}. Select ${goal.aircraftId} first, with its button under the arena or the ${goal.aircraftId.slice(-1)} key, then give the command again.`,
    }
  }
  if (bearing !== goal.target) {
    return {
      verdict: 'wrongBearing',
      text: `That was ${pad3(bearing)}. This drill wants ${pad3(goal.target)}: type ${spaced(pad3(goal.target))}.`,
    }
  }
  const shortest = shortestTurnDirection(aircraft.headingDeg, goal.target)
  const longWay  = shortest !== 'either' && dir !== shortest
  const chosen   = turnDistance(aircraft.headingDeg, goal.target, dir)
  const other    = turnDistance(aircraft.headingDeg, goal.target, dir === 'L' ? 'R' : 'L')
  if (longWay && goal.shortest) {
    return {
      verdict: 'longWay',
      text: `${dir} gets there, but it is the long way round: ${Math.round(chosen)} degrees of turning instead of ${Math.round(other)}. Press ${shortest}, then ${spaced(pad3(goal.target))}.`,
    }
  }
  return {
    verdict: 'ok',
    text: `${dir} ${pad3(goal.target)}. Watch it come round.`,
    note: longWay
      ? `That works, though it is the long way round: ${Math.round(chosen)} degrees of turning instead of ${Math.round(other)}.`
      : null,
  }
}

// The slice of the compass a partly typed bearing can still land in, for the
// mini compass drawn around the aircraft. One digit narrows it to 100 degrees
// with a label every 10; two digits to 10 degrees with a label at each edge.
// Values are raw (a first digit of 3 gives 300 to 400) so the wrap past 360
// is drawn and labelled as the wrap it is, the same way the numpad reads it.
// Null when nothing is typed or the command is complete.
export function bearingSector(input) {
  if (!input || input.length === 0 || input.length >= 3) return null
  const n = parseInt(input, 10)
  if (input.length === 1) {
    const start = n * 100
    return { start, end: start + 100, labels: Array.from({ length: 10 }, (_, i) => start + i * 10) }
  }
  const start = n * 10
  return { start, end: start + 10, labels: [start, start + 10] }
}

// How far the turn-direction arrow may sweep from the nose. With nothing typed
// it runs a fixed `full` arc. With a band lit it must stop short of entering
// it: the head (which sits `lead` degrees ahead of the tail) pulls up `gap`
// degrees before the band's near edge in the direction of travel. When the
// nose is already inside the band the arrow runs to the band's far edge
// instead, since it cannot enter what it is already in. Returns { lead,
// rotation } in degrees (the tail rotates by `rotation`; the head is `lead`
// further on), or null when there is no room for an arrow at all.
export function sweepExtent(headingDeg, dir, sector, { lead = 28, gap = 3, full = 140 } = {}) {
  if (!sector) return { lead, rotation: full }
  const heading = normalizeDeg(headingDeg)
  const start   = normalizeDeg(sector.start)
  const end     = normalizeDeg(sector.end)
  const width   = normalizeDeg(sector.end - sector.start) || 360
  const inside  = turnDistance(start, heading, 'R') < width
  const near    = dir === 'R' ? start : end
  const far     = dir === 'R' ? end : start
  const room    = turnDistance(heading, inside ? far : near, dir) - gap
  if (room < 8) return null
  const l = Math.min(lead, room)
  return { lead: l, rotation: Math.min(full, room - l) }
}

// Will the aircraft, holding its current heading, fly through this gate? A
// straight ray from the nose against the gate segment. Used to take the
// turn-direction arrow down once a gate drill is lined up: an arrow still
// sweeping says "you have to turn", and at that point they do not.
export function onTrackForGate(aircraft, gate) {
  if (!gate || gate.hit) return false
  const { dx, dy } = bearingToVec(aircraft.headingDeg)
  const far = { x: aircraft.position.x + dx * 4000, y: aircraft.position.y + dy * 4000 }
  return segmentsIntersect(aircraft.position, far, gate.p1, gate.p2)
}

// Has the drill's aircraft finished the commanded turn onto the goal heading?
export function headingSettled(drill, aircraftList) {
  const goal = drill.goal
  if (goal.type !== 'heading') return false
  const a = aircraftList.find(x => x.id === goal.aircraftId)
  return !!a && a.targetHeadingDeg == null && a.headingDeg === goal.target
}

// What one frame of movement did to a gate: 'hit' if the aircraft flew through
// it, 'miss' if it crossed the gate's line but outside the gate, null if it did
// neither. A miss is what makes the gate drills restart, so the player is told
// straight away rather than left flying on to the far edge.
export function gateCrossing(prev, next, gate) {
  if (segmentsIntersect(prev, next, gate.p1, gate.p2)) return 'hit'
  const lx = gate.p2.x - gate.p1.x
  const ly = gate.p2.y - gate.p1.y
  const side = (p) => lx * (p.y - gate.p1.y) - ly * (p.x - gate.p1.x)
  const s0 = side(prev)
  const s1 = side(next)
  if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) return 'miss'
  return null
}
