import { describe, it, expect } from 'vitest'
import {
  ANT_HARD_AIRCRAFT,
  ANT_HARD_FUEL,
  ANT_HARD_QUESTIONS,
  ANT_HARD_STAGES,
  ANT_HARD_ROUNDS,
  ANT_HARD_MAX_SCORE,
  ANT_HARD_GRADES,
  ANT_HARD_CLOSE_BAND,
  ANT_ADJ,
  buildRound,
  solutionSteps,
  scoreAnswer,
  gradeForScore,
  nearestLoadRow,
  legDistances,
  mpgFor,
  formatHHMM,
  formatAnswer,
} from '../antHardGenerator'

// Seedable rng so a failure names a reproducible round rather than "sometimes".
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Every round of every stage over a wide seed sweep. Pure generator, so this is
// cheap and catches the whole-number invariants that the whole board rests on.
function everyRound(seeds = 60) {
  const out = []
  for (let s = 0; s < seeds; s++) {
    const rng = mulberry32(s * 7919 + 13)
    for (let r = 1; r <= ANT_HARD_ROUNDS; r++) out.push({ seed: s, round: buildRound(r, rng) })
  }
  return out
}

const ALL = everyRound()

describe('ANT Hard — round shape', () => {
  it('covers rounds 1..12 with a known question type each', () => {
    expect(ANT_HARD_STAGES.map(s => s.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    ANT_HARD_STAGES.forEach(s => {
      expect(s.types.length).toBeGreaterThan(0)
      s.types.forEach(t => expect(ANT_HARD_QUESTIONS[t]).toBeTruthy())
    })
    expect(ANT_HARD_MAX_SCORE).toBe(120)
  })

  it('ramps: weather only after round 3, fuel from 7, two aircraft from 10', () => {
    const stageOf = n => ANT_HARD_STAGES.find(s => s.round === n)
    expect([1, 2, 3].every(n => !stageOf(n).weather)).toBe(true)
    const fuelTypes = new Set(['fuel', 'fuelRemaining'])
    const pairTypes = new Set(['pairDeparture', 'pairGap'])
    ANT_HARD_STAGES.forEach(s => {
      if (s.types.some(t => fuelTypes.has(t))) expect(s.round).toBeGreaterThanOrEqual(7)
      if (s.types.some(t => pairTypes.has(t))) expect(s.round).toBeGreaterThanOrEqual(10)
    })
    // The map gets busier late on, never earlier.
    expect(stageOf(1).legs).toBe(2)
    expect(ANT_HARD_STAGES.some(s => s.legs === 3)).toBe(true)
  })

  it('every answer is a whole number', () => {
    ALL.forEach(({ seed, round }) => {
      expect(Number.isInteger(round.correctAnswer), `seed ${seed} round ${round.roundNumber} ${round.type}`).toBe(true)
      expect(round.correctAnswer).toBeGreaterThanOrEqual(0)
    })
  })

  it('every leg takes whole minutes, and whole gallons on a fuel round', () => {
    ALL.forEach(({ round }) => {
      const flights = [round.flight, round.partner].filter(Boolean)
      flights.forEach(f => {
        f.legs.forEach(l => {
          expect(Number.isInteger(l.minutes)).toBe(true)
          expect(l.miles % l.mpm).toBe(0)
        })
        expect(Number.isInteger(f.totalMinutes)).toBe(true)
      })
      if (round.type === 'fuel' || round.type === 'fuelRemaining') {
        round.flight.legs.forEach(l => expect(Number.isInteger(l.gallons)).toBe(true))
        expect(Number.isInteger(round.flight.fuelUsed)).toBe(true)
      }
    })
  })

  it('routes are simple paths along real edges', () => {
    ALL.forEach(({ round }) => {
      const flights = [round.flight, round.partner].filter(Boolean)
      flights.forEach(f => {
        expect(new Set(f.route).size).toBe(f.route.length)
        f.legs.forEach(l => expect(ANT_ADJ[l.from]).toContain(l.to))
        expect(f.legs.length).toBe(f.route.length - 1)
      })
    })
  })
})

describe('ANT Hard — the objective box', () => {
  it('always ends on the ask', () => {
    ALL.forEach(({ round }) => {
      const last = round.objective[round.objective.length - 1]
      expect(round.objective.length).toBeGreaterThanOrEqual(2)
      expect(last.startsWith('Give') || last.endsWith('?')).toBe(true)
    })
  })

  it('names the route and the parcel weight in prose', () => {
    ALL.forEach(({ round }) => {
      const text = round.objective.join(' ')
      expect(text).toContain(round.flight.route[0].toUpperCase())
      if (round.show.weight) expect(text).toContain(`${round.flight.weightStated} kg`)
    })
  })

  it('flags every weather leg it flies, and no others', () => {
    ALL.forEach(({ round }) => {
      const text = round.objective.join(' ')
      const flagged = round.flight.legs.filter(l => l.weather !== 'clear')
      expect(text.includes('storm')).toBe(flagged.some(l => l.weather === 'storm'))
      expect(text.includes('tailwind')).toBe(flagged.some(l => l.weather === 'tailwind'))
    })
  })

  // The distance quoted for a closed route is a real edge on the map, not an
  // invented number, so the trap is "read which route you are flying" rather
  // than "the question lied to you".
  it('only ever quotes a closed route that genuinely exists', () => {
    ALL.forEach(({ round }) => {
      if (!round.distractor) return
      expect(ANT_ADJ[round.distractor.from]).toContain(round.distractor.to)
      const onRoute = round.flight.legs.some(l =>
        (l.from === round.distractor.from && l.to === round.distractor.to)
        || (l.to === round.distractor.from && l.from === round.distractor.to))
      expect(onRoute).toBe(false)
    })
  })
})

describe('ANT Hard — the two lookups', () => {
  it('an untidy weight always rounds to exactly one chart row', () => {
    ALL.forEach(({ round }) => {
      const flights = [round.flight, round.partner].filter(Boolean)
      flights.forEach(f => {
        const aircraft = ANT_HARD_AIRCRAFT[f.aircraftId]
        const row = nearestLoadRow(aircraft, f.weightStated)
        expect(row.weight).toBe(f.weightRow)
        expect(row.mpm).toBe(f.mpm)
        // Never an exact halfway case, which would make "nearest" a coin toss.
        const gaps = aircraft.loads.map(l => Math.abs(l.weight - f.weightStated)).sort((a, b) => a - b)
        expect(gaps[0]).not.toBe(gaps[1])
      })
    })
  })

  it('economy comes off speed, not off weight', () => {
    ALL.forEach(({ round }) => {
      round.flight.legs.forEach(l => {
        expect(l.mpg).toBe(mpgFor(l.mpm))
        expect(l.gallons).toBe(l.miles / l.mpg)
      })
    })
    // Faster is thirstier across the whole chart — the direction the accounts
    // describe, and the reason a storm leg is also the thrifty one.
    for (let i = 1; i < ANT_HARD_FUEL.length; i++) {
      expect(ANT_HARD_FUEL[i].mpm).toBeGreaterThan(ANT_HARD_FUEL[i - 1].mpm)
      expect(ANT_HARD_FUEL[i].mpg).toBeLessThan(ANT_HARD_FUEL[i - 1].mpg)
    }
  })

  it('heavier is slower on both load charts', () => {
    Object.values(ANT_HARD_AIRCRAFT).forEach(a => {
      for (let i = 1; i < a.loads.length; i++) {
        expect(a.loads[i].weight).toBeGreaterThan(a.loads[i - 1].weight)
        expect(a.loads[i].mpm).toBeLessThanOrEqual(a.loads[i - 1].mpm)
        expect(mpgFor(a.loads[i].mpm)).toBeTruthy()
      }
    })
  })

  it('legDistances stays inside the leg range and divides cleanly', () => {
    ANT_HARD_FUEL.forEach(({ mpm }) => {
      ;[false, true].forEach(needFuel => {
        const ds = legDistances(mpm, needFuel)
        expect(ds.length).toBeGreaterThan(0)
        ds.forEach(d => {
          expect(d).toBeGreaterThanOrEqual(30)
          expect(d).toBeLessThanOrEqual(120)
          expect(d % mpm).toBe(0)
          if (needFuel) expect(d % mpgFor(mpm)).toBe(0)
        })
      })
    })
  })
})

describe('ANT Hard — per-type answers are derivable from the board', () => {
  it('a distance or speed round never flies weather', () => {
    ALL.filter(({ round }) => round.type === 'distance' || round.type === 'speed')
      .forEach(({ round }) => {
        expect(round.flight.uniformSpeed).toBe(true)
        round.flight.legs.forEach(l => expect(l.weather).toBe('clear'))
      })
  })

  it('hides exactly the figure it is asking for', () => {
    const hidden = {
      arrival: 'arriveTime',
      departure: 'departTime',
      distance: 'legMiles',
      pairDeparture: 'partnerDepart',
    }
    ALL.forEach(({ round }) => {
      const key = hidden[round.type]
      if (key) expect(round.show[key]).toBe(false)
      if (round.type === 'speed') {
        expect(round.show.weight).toBe(false)
        expect(round.show.legSpeed).toBe(false)
      }
    })
  })

  it('answers reconcile with the flight they came from', () => {
    ALL.forEach(({ round }) => {
      const f = round.flight
      if (round.type === 'arrival') expect(round.correctAnswer).toBe(f.departMin + f.totalMinutes)
      if (round.type === 'departure') expect(round.correctAnswer).toBe(f.arriveMin - f.totalMinutes)
      if (round.type === 'distance') expect(round.correctAnswer).toBe(f.totalMinutes * f.mpm)
      if (round.type === 'speed') expect(round.correctAnswer).toBe(f.mpm * 60)
      if (round.type === 'fuel') expect(round.correctAnswer).toBe(f.fuelUsed)
      if (round.type === 'fuelRemaining') {
        expect(round.correctAnswer).toBe(f.fuelOnBoard - f.fuelUsed)
        expect(round.correctAnswer).toBeGreaterThan(0)
        expect(round.show.fuelOnBoard).toBe(true)
      }
      if (round.type === 'legTime') {
        expect(round.correctAnswer).toBeGreaterThan(0)
        expect(round.correctAnswer).toBeLessThanOrEqual(f.totalMinutes)
      }
    })
  })

  it('a two-aircraft round converges on one destination from two starts', () => {
    const pairs = ALL.filter(({ round }) => round.partner)
    expect(pairs.length).toBeGreaterThan(0)
    pairs.forEach(({ round }) => {
      const f = round.flight
      const p = round.partner
      expect(p.route[p.route.length - 1]).toBe(f.route[f.route.length - 1])
      expect(p.route[0]).not.toBe(f.route[0])
      // Two charts, so the whole question is reading the right one.
      expect(f.aircraftId).not.toBe(p.aircraftId)
      if (round.type === 'pairGap') {
        expect(round.correctAnswer).toBe(Math.abs(p.totalMinutes - f.totalMinutes))
      } else {
        expect(p.departMin + p.totalMinutes).toBe(f.arriveMin)
        expect(round.correctAnswer).toBe(p.departMin)
      }
    })
  })
})

describe('ANT Hard — worked solution', () => {
  it('every round explains itself, ending on the answer it is grading', () => {
    ALL.forEach(({ round }) => {
      const steps = solutionSteps(round)
      expect(steps.length).toBeGreaterThan(0)
      steps.forEach((s, i) => {
        expect(s.n).toBe(i + 1)
        expect(s.label).toBeTruthy()
        expect(s.note).toBeTruthy()
        expect(s.tokens.length).toBeGreaterThan(0)
      })
      const last = steps[steps.length - 1].result
      const answer = ANT_HARD_QUESTIONS[round.type].time
        ? formatHHMM(round.correctAnswer)
        : String(round.correctAnswer)
      expect(last).toContain(answer)
    })
  })
})

describe('ANT Hard — scoring', () => {
  it('grades an exact answer 10 and an empty one 0', () => {
    ALL.forEach(({ round }) => {
      const exact = ANT_HARD_QUESTIONS[round.type].time
        ? formatHHMM(round.correctAnswer)
        : String(round.correctAnswer)
      expect(scoreAnswer(round, exact)).toEqual({ points: 10, exact: true, partial: false })
      expect(scoreAnswer(round, '').points).toBe(0)
      expect(scoreAnswer(round, '   ').points).toBe(0)
      expect(scoreAnswer(round, 'abc').points).toBe(0)
    })
  })

  it('gives partial credit inside the band and nothing outside it', () => {
    ALL.forEach(({ round }) => {
      const band = ANT_HARD_CLOSE_BAND[round.type]
      const isTime = ANT_HARD_QUESTIONS[round.type].time
      const fmt = v => (isTime ? formatHHMM(v) : String(v))
      const near = round.correctAnswer + band.within
      const far = round.correctAnswer + band.within + 1
      expect(scoreAnswer(round, fmt(near)).points).toBe(5)
      expect(scoreAnswer(round, fmt(far)).points).toBe(0)
    })
  })

  // Every band is wider than the original board's equivalent, and fuel has one
  // at all — the real test marks far more kindly than a practice app does.
  it('every question type has a partial-credit band', () => {
    Object.keys(ANT_HARD_QUESTIONS).forEach(type => {
      expect(ANT_HARD_CLOSE_BAND[type]).toBeTruthy()
      expect(ANT_HARD_CLOSE_BAND[type].within).toBeGreaterThan(0)
    })
  })

  it('grades a run against the 120 ceiling', () => {
    expect(gradeForScore(120)).toBe('Outstanding')
    expect(gradeForScore(ANT_HARD_GRADES.outstanding)).toBe('Outstanding')
    expect(gradeForScore(ANT_HARD_GRADES.outstanding - 1)).toBe('Good')
    expect(gradeForScore(ANT_HARD_GRADES.good)).toBe('Good')
    expect(gradeForScore(ANT_HARD_GRADES.needsWork)).toBe('Needs Work')
    expect(gradeForScore(ANT_HARD_GRADES.needsWork - 1)).toBe('Failed')
    expect(gradeForScore(0)).toBe('Failed')
    // A run of all-partials must not read as a pass.
    expect(gradeForScore(ANT_HARD_ROUNDS * 5)).toBe('Needs Work')
  })

  it('formats a time answer as HHMM and everything else with its unit', () => {
    ALL.forEach(({ round }) => {
      const text = formatAnswer(round)
      if (ANT_HARD_QUESTIONS[round.type].time) expect(text).toMatch(/^\d{4}$/)
      else expect(text).toContain(ANT_HARD_QUESTIONS[round.type].unit)
    })
  })
})
