import { describe, it, expect } from 'vitest'
import {
  DPT_PRACTICE_DRILLS, buildDrillAircraft, buildDrillGates, judgeCommand,
  headingSettled, gateCrossing, bearingSector, sweepExtent, onTrackForGate, pad3,
} from '../dptPractice'
import { moveAircraft, shortestTurnDirection, bearingBetween } from '../dptPhysics'

// The drills teach one thing each, and the thing they teach has to be TRUE on
// the arena they are flown on: the command the card asks for must complete
// the drill, and the command it warns against must not. These fly every drill
// with the real flight model and check exactly that.

const byKey = Object.fromEntries(DPT_PRACTICE_DRILLS.map(d => [d.key, d]))

// Fly the drill's first aircraft with one command until it settles, tracking
// whether it crossed each gate in order. Returns the final aircraft and the
// gate outcomes.
function fly(drill, { dir, bearing, aircraftId = 'CA-A', maxSeconds = 40 } = {}) {
  let list = buildDrillAircraft(drill, null)
  let gates = buildDrillGates(drill)
  const outcomes = []
  list = list.map(a => (a.id === aircraftId ? { ...a, targetHeadingDeg: bearing, turnDirection: dir } : a))
  for (let i = 0; i < maxSeconds * 30; i++) {
    list = list.map(a => {
      const { aircraft: m } = moveAircraft(a, 1 / 30)
      if (a.id === 'CA-A') {
        const nextIdx = gates.findIndex(g => !g.hit)
        if (nextIdx >= 0) {
          const c = gateCrossing(a.position, m.position, gates[nextIdx])
          if (c === 'hit') { gates = gates.map((g, j) => (j === nextIdx ? { ...g, hit: true } : g)); outcomes.push('hit') }
          else if (c === 'miss') outcomes.push('miss')
        }
      }
      return m
    })
    if (outcomes.includes('miss')) break
    if (gates.length && gates.every(g => g.hit)) break
    // A heading drill is over once the turn has settled; flying on would only
    // carry the aircraft into the boundary.
    if (drill.goal.type === 'heading' && list.find(a => a.id === aircraftId).targetHeadingDeg == null) break
  }
  return { list, gates, outcomes }
}

describe('drill roster', () => {
  it('is nine drills, each with a title, a body and a goal', () => {
    expect(DPT_PRACTICE_DRILLS).toHaveLength(9)
    for (const d of DPT_PRACTICE_DRILLS) {
      expect(d.title).toBeTruthy()
      expect(d.body.length).toBeGreaterThan(40)
      expect(['heading', 'gates', 'direction']).toContain(d.goal.type)
      expect(d.aircraft.length).toBeGreaterThan(0)
    }
  })

  it('opens on the side buttons, since every later drill starts with one', () => {
    expect(DPT_PRACTICE_DRILLS[0].goal.type).toBe('direction')
    expect(DPT_PRACTICE_DRILLS[0].body).toMatch(/arrow sweeping round the compass ring/)
  })

  it('never puts an em dash on screen', () => {
    for (const d of DPT_PRACTICE_DRILLS) {
      expect(d.title).not.toMatch(/—/)
      expect(d.body).not.toMatch(/—/)
    }
  })

  it('guides the digits it asks for, spelt as the card spells them', () => {
    for (const d of DPT_PRACTICE_DRILLS) {
      if (d.goal.type !== 'heading') continue
      expect(d.guide.digits).toBe(pad3(d.goal.target))
      // Every heading drill's body names the target it wants.
      expect(d.body).toContain(pad3(d.goal.target))
    }
  })

  it('points the direction arrow at the shorter side whenever it points at all', () => {
    for (const d of DPT_PRACTICE_DRILLS) {
      if (d.goal.type !== 'heading' || !d.guide.dir) continue
      const a = d.aircraft.find(x => x.id === d.goal.aircraftId)
      expect(d.guide.dir).toBe(shortestTurnDirection(a.headingDeg, d.goal.target))
    }
  })

  it('starts every aircraft well clear of the boundary buffer', () => {
    for (const d of DPT_PRACTICE_DRILLS) {
      for (const a of d.aircraft) {
        const { aircraft: m, edgeAuto } = moveAircraft(buildDrillAircraft(d, null).find(x => x.id === a.id), 1 / 30)
        expect(edgeAuto).toBeNull()
        expect(m.wasInEdgeBuffer).toBe(false)
      }
    }
  })
})

describe('judgeCommand', () => {
  it('accepts the command the card asks for', () => {
    const d = byKey.east
    const a = buildDrillAircraft(d, null)[0]
    const v = judgeCommand(d, a, 'CA-A', 90, 'R')
    expect(v.verdict).toBe('ok')
    expect(v.note).toBeNull()
  })

  it('accepts the long way round before it has been taught, with a note', () => {
    const d = byKey.east
    const a = buildDrillAircraft(d, null)[0]
    const v = judgeCommand(d, a, 'CA-A', 90, 'L')
    expect(v.verdict).toBe('ok')
    expect(v.note).toMatch(/270 degrees of turning instead of 90/)
  })

  it('has no long way on a dead 180', () => {
    const d = byKey.west
    const a = buildDrillAircraft(d, null)[0]
    expect(judgeCommand(d, a, 'CA-A', 270, 'L').note).toBeNull()
    expect(judgeCommand(d, a, 'CA-A', 270, 'R').note).toBeNull()
  })

  it('rejects the long way round once the drill is about it', () => {
    const d = byKey.shortest
    const a = buildDrillAircraft(d, null)[0]
    const v = judgeCommand(d, a, 'CA-A', 315, 'R')
    expect(v.verdict).toBe('longWay')
    expect(v.text).toMatch(/315 degrees of turning instead of 45/)
    expect(v.text).toMatch(/Press L, then 3 1 5/)
    expect(judgeCommand(d, a, 'CA-A', 315, 'L').verdict).toBe('ok')
  })

  it('knows 030 from 330 is right through north, not left', () => {
    const d = byKey['through-north']
    const a = buildDrillAircraft(d, null)[0]
    expect(judgeCommand(d, a, 'CA-A', 30, 'L').verdict).toBe('longWay')
    expect(judgeCommand(d, a, 'CA-A', 30, 'R').verdict).toBe('ok')
  })

  it('measures the shorter side from where the heading is NOW', () => {
    // Partway through a wrong right turn from 360 toward 315, at heading 200,
    // right is the shorter side. The verdict follows the aircraft, not the card.
    const d = byKey.shortest
    const a = { ...buildDrillAircraft(d, null)[0], headingDeg: 200 }
    expect(judgeCommand(d, a, 'CA-A', 315, 'R').verdict).toBe('ok')
  })

  it('names the wrong bearing and spells the right one', () => {
    const d = byKey.east
    const a = buildDrillAircraft(d, null)[0]
    const v = judgeCommand(d, a, 'CA-A', 80, 'R')
    expect(v.verdict).toBe('wrongBearing')
    expect(v.text).toMatch(/That was 080/)
    expect(v.text).toMatch(/type 0 9 0/)
  })

  it('catches a command sent to the wrong aircraft', () => {
    const d = byKey.select
    const a = buildDrillAircraft(d, null)[0]
    const v = judgeCommand(d, a, 'CA-A', 180, 'R')
    expect(v.verdict).toBe('wrongAircraft')
    expect(v.text).toMatch(/turned CA-A/)
    expect(v.text).toMatch(/Select CA-N first/)
    expect(v.text).toMatch(/the N key/)
    expect(judgeCommand(d, buildDrillAircraft(d, null)[1], 'CA-N', 180, 'R').verdict).toBe('ok')
  })

  it('accepts anything on a gate drill: the gate is the judge', () => {
    const d = byKey.gate
    const a = buildDrillAircraft(d, null)[0]
    expect(judgeCommand(d, a, 'CA-A', 200, 'L').verdict).toBe('ok')
  })
})

describe('every heading drill completes on the command its card asks for', () => {
  for (const d of DPT_PRACTICE_DRILLS.filter(x => x.goal.type === 'heading')) {
    it(d.key, () => {
      const start = d.aircraft.find(a => a.id === d.goal.aircraftId)
      const dir = d.guide.dir ?? (shortestTurnDirection(start.headingDeg, d.goal.target) === 'L' ? 'L' : 'R')
      const { list } = fly(d, { dir, bearing: d.goal.target, aircraftId: d.goal.aircraftId })
      expect(headingSettled(d, list)).toBe(true)
    })
  }

  it('is not settled before a command, even when a heading happens to match', () => {
    const d = byKey.east
    expect(headingSettled(d, buildDrillAircraft(d, null))).toBe(false)
  })
})

describe('gate placement', () => {
  it('lies each gate square across its approach bearing', () => {
    const gates = buildDrillGates(byKey.gate)
    expect(gates).toHaveLength(1)
    const g = gates[0]
    expect(g.kind).toBe('letter')
    expect(g.hit).toBe(false)
    const along = bearingBetween(g.p1, g.p2)
    // Perpendicular to 135 is 045 or 225.
    expect([45, 225]).toContain(Math.round(along))
  })

  it('places gate B relative to gate A', () => {
    const [a, b] = buildDrillGates(byKey['two-gates'])
    const ac = { x: (a.p1.x + a.p2.x) / 2, y: (a.p1.y + a.p2.y) / 2 }
    const bc = { x: (b.p1.x + b.p2.x) / 2, y: (b.p1.y + b.p2.y) / 2 }
    expect(Math.round(bearingBetween(ac, bc))).toBe(0)
    expect(Math.hypot(bc.x - ac.x, bc.y - ac.y)).toBeCloseTo(190, 5)
  })

  it('reads as roughly the bearing the card says from where the aircraft starts', () => {
    // The gate is placed from where the aircraft SETTLES after the turn, so
    // from its start it reads a few degrees off 135, still well between 090
    // and 180 and on the south-east diagonal to the eye.
    const d = byKey.gate
    const g = buildDrillGates(d)[0]
    const c = { x: (g.p1.x + g.p2.x) / 2, y: (g.p1.y + g.p2.y) / 2 }
    const b = bearingBetween(d.aircraft[0].position, c)
    expect(b).toBeGreaterThan(115)
    expect(b).toBeLessThan(145)
  })
})

describe('the gate drills fly as the card says', () => {
  it('R 135 goes through gate A dead centre', () => {
    const { outcomes } = fly(byKey.gate, { dir: 'R', bearing: 135 })
    expect(outcomes).toEqual(['hit'])
  })

  it('a reading ten degrees either side still goes through', () => {
    expect(fly(byKey.gate, { dir: 'R', bearing: 125 }).outcomes).toEqual(['hit'])
    expect(fly(byKey.gate, { dir: 'R', bearing: 145 }).outcomes).toEqual(['hit'])
  })

  it('a bearing well off the gate is reported as a miss when the line is crossed', () => {
    const { outcomes } = fly(byKey.gate, { dir: 'R', bearing: 170 })
    expect(outcomes).toEqual(['miss'])
  })

  it('R 090 then L 360 threads both gates in order', () => {
    const d = byKey['two-gates']
    let list = buildDrillAircraft(d, null)
    let gates = buildDrillGates(d)
    const outcomes = []
    list = list.map(a => ({ ...a, targetHeadingDeg: 90, turnDirection: 'R' }))
    let secondIssued = false
    for (let i = 0; i < 40 * 30; i++) {
      list = list.map(a => {
        const { aircraft: m } = moveAircraft(a, 1 / 30)
        const nextIdx = gates.findIndex(g => !g.hit)
        if (nextIdx >= 0) {
          const c = gateCrossing(a.position, m.position, gates[nextIdx])
          if (c === 'hit') { gates = gates.map((g, j) => (j === nextIdx ? { ...g, hit: true } : g)); outcomes.push(`hit ${gates[nextIdx].id}`) }
          else if (c === 'miss') outcomes.push('miss')
        }
        return m
      })
      // The next command goes in as soon as A is behind, mid-flight.
      if (!secondIssued && gates[0].hit) {
        list = list.map(a => ({ ...a, targetHeadingDeg: 0, turnDirection: 'L' }))
        secondIssued = true
      }
      if (gates.every(g => g.hit) || outcomes.includes('miss')) break
    }
    expect(outcomes).toEqual(['hit A', 'hit B'])
  })
})

describe('gateCrossing', () => {
  const gate = { p1: { x: 100, y: 0 }, p2: { x: 100, y: 100 } }
  it('is a hit through the gate, a miss past its end, nothing when the line is not crossed', () => {
    expect(gateCrossing({ x: 90, y: 50 }, { x: 110, y: 50 }, gate)).toBe('hit')
    expect(gateCrossing({ x: 90, y: 150 }, { x: 110, y: 150 }, gate)).toBe('miss')
    expect(gateCrossing({ x: 90, y: 50 }, { x: 95, y: 50 }, gate)).toBeNull()
    expect(gateCrossing({ x: 90, y: 50 }, { x: 90, y: 60 }, gate)).toBeNull()
  })
})

describe('pad3', () => {
  it('writes north as 360 and pads the rest', () => {
    expect(pad3(0)).toBe('360')
    expect(pad3(360)).toBe('360')
    expect(pad3(30)).toBe('030')
    expect(pad3(315)).toBe('315')
  })
})

describe('bearingSector', () => {
  it('is nothing before a digit and nothing once the command is complete', () => {
    expect(bearingSector('')).toBeNull()
    expect(bearingSector('090')).toBeNull()
  })

  it('narrows to 100 degrees on one digit, labelled every 10', () => {
    expect(bearingSector('0')).toEqual({ start: 0, end: 100, labels: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] })
  })

  it('narrows to 10 degrees on two digits, labelled at both edges', () => {
    expect(bearingSector('09')).toEqual({ start: 90, end: 100, labels: [90, 100] })
    expect(bearingSector('31')).toEqual({ start: 310, end: 320, labels: [310, 320] })
  })

  it('lets a first digit of 3 run past 360, the wrap the numpad applies', () => {
    const s = bearingSector('3')
    expect(s.start).toBe(300)
    expect(s.end).toBe(400)
    expect(s.labels.at(-1)).toBe(390)
  })
})

describe('sweepExtent', () => {
  it('runs the full arc when nothing is typed', () => {
    expect(sweepExtent(360, 'R', null)).toEqual({ lead: 28, rotation: 140 })
  })

  it('pulls the head up short of the band ahead', () => {
    // Heading north, "09" typed: the band is 090 to 100. Clockwise, the head
    // (28 ahead of the tail) must stop 3 short of 090.
    const e = sweepExtent(360, 'R', bearingSector('09'))
    expect(e.lead).toBe(28)
    expect(e.rotation + e.lead).toBe(87)
    // Anticlockwise the near edge is 100, which is 260 away: the full arc fits.
    expect(sweepExtent(360, 'L', bearingSector('09'))).toEqual({ lead: 28, rotation: 140 })
  })

  it('shrinks the arrow itself when the band is closer than a full head', () => {
    // Heading 080, band 090 to 100, clockwise: only 7 degrees of room. Too
    // little for an arrow at all.
    expect(sweepExtent(80, 'R', bearingSector('09'))).toBeNull()
    // Heading 070: 17 degrees of room, so a shortened arrow that does not move.
    expect(sweepExtent(70, 'R', bearingSector('09'))).toEqual({ lead: 17, rotation: 0 })
  })

  it('runs to the far edge when the nose is already inside the band', () => {
    // Heading north with "0" typed lights 360 to 090 from the nose onward.
    const e = sweepExtent(360, 'R', bearingSector('0'))
    expect(e.rotation + e.lead).toBe(97)
    // Anticlockwise from inside, the far edge is the band's start, at the nose.
    expect(sweepExtent(360, 'L', bearingSector('0'))).toBeNull()
  })

  it('handles a band that wraps through north', () => {
    // Heading 270, "3" typed lights 300 round to 040. Clockwise the near edge
    // is 300, 30 away.
    const e = sweepExtent(270, 'R', bearingSector('3'))
    expect(e.rotation + e.lead).toBe(27)
  })
})

describe('onTrackForGate', () => {
  const gate = { p1: { x: 700, y: 450 }, p2: { x: 700, y: 550 }, hit: false }
  const at = (headingDeg) => ({ position: { x: 500, y: 500 }, headingDeg })

  it('is true when the current heading carries the aircraft through the gate', () => {
    expect(onTrackForGate(at(90), gate)).toBe(true)
    // A shade off still crosses the gate's 100-unit span from 200 away.
    expect(onTrackForGate(at(80), gate)).toBe(true)
  })

  it('is false when the line misses, points away, or the gate is already done', () => {
    expect(onTrackForGate(at(60), gate)).toBe(false)
    expect(onTrackForGate(at(270), gate)).toBe(false)
    expect(onTrackForGate(at(90), { ...gate, hit: true })).toBe(false)
    expect(onTrackForGate(at(90), undefined)).toBe(false)
  })

  it('holds for the gate drill flown as its card says', () => {
    const d = byKey.gate
    const { list } = fly(d, { dir: 'R', bearing: 135, maxSeconds: 4 })
    // Turn settled (4s > 135/35), gate still ahead: lined up.
    expect(onTrackForGate(list[0], buildDrillGates(d)[0])).toBe(true)
  })
})
