import { describe, it, expect } from 'vitest'
import {
  buildPractiseRun,
  practiseQuestion,
  practiseSolution,
  practiseGrade,
  PRACTISE_PER_TYPE,
  PRACTISE_QUESTION_COUNT,
  PRACTISE_MAX_SCORE,
} from '../antPractise'
import { QUESTION_TYPES, scoreAnswer, formatHHMM, gradeForScore } from '../../antGenerator'

// Every question type, several runs each — the rounds are random, so one pass
// proves nothing.
const RUNS = 25

describe('buildPractiseRun', () => {
  it('is a sheet of eight, two of each calculation', () => {
    // Short enough to take in at a glance, and still an even sample of all four.
    expect(PRACTISE_PER_TYPE).toBe(2)
    expect(PRACTISE_QUESTION_COUNT).toBe(8)
  })

  it('deals an even number of every question type', () => {
    for (let i = 0; i < RUNS; i++) {
      const run = buildPractiseRun()
      expect(run).toHaveLength(PRACTISE_QUESTION_COUNT)
      QUESTION_TYPES.forEach(type => {
        expect(run.filter(r => r.type === type)).toHaveLength(PRACTISE_PER_TYPE)
      })
    }
  })

  it('shuffles, so the types are not dealt in blocks', () => {
    // The unshuffled order would be all arrivals, then all distances, and so on.
    // Across 25 runs at least one must break that grouping.
    const runs = Array.from({ length: RUNS }, () => buildPractiseRun().map(r => r.type))
    const grouped = runs.every(types =>
      types.every((t, i) => i === 0 || t === types[i - 1] || !types.slice(0, i - 1).includes(t)))
    expect(grouped).toBe(false)
  })

  it('takes a random source, so an order can be pinned', () => {
    const fixed = buildPractiseRun(() => 0).map(r => r.type)
    expect(buildPractiseRun(() => 0).map(r => r.type)).toEqual(fixed)
  })

  it('only ever asks for whole-number answers', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        expect(Number.isInteger(round.correctAnswer)).toBe(true)
      })
    }
  })
})

describe('practiseQuestion', () => {
  it('states the figures its answer needs and never the answer itself', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        const { text } = practiseQuestion(round)
        const now = formatHHMM(round.timeNowMin)
        const arrive = formatHHMM(round.arrivalMin)

        if (round.type === 'arrival') {
          // Given the distance and the pace; must not hand over the arrival.
          expect(text).toContain(`${round.totalDistance} miles`)
          expect(text).toContain(`${round.mpm} miles per minute`)
          expect(text).toContain(now)
          expect(text).not.toContain(arrive)
        } else if (round.type === 'distance') {
          expect(text).toContain(now)
          expect(text).toContain(arrive)
          expect(text).toContain(`${round.mpm} miles per minute`)
          expect(text).not.toContain(`${round.totalDistance} miles`)
        } else if (round.type === 'fuel') {
          expect(text).toContain(`${round.totalDistance} miles`)
          expect(text).toContain(`${round.gph} gallons per hour`)
        } else {
          // Speed: distance and both clock times, but never the pace it asks for.
          expect(text).toContain(`${round.totalDistance} miles`)
          expect(text).toContain(now)
          expect(text).toContain(arrive)
          expect(text).not.toContain(`${round.mpm} miles per minute`)
        }
      })
    }
  })

  it('never names a map node — the drill has no board', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        const { text } = practiseQuestion(round)
        expect(text).not.toMatch(/Victor|Xray|Yankee|Zulu|Whiskey|Tango|Romeo|Papa/)
      })
    }
  })

  it('marks every figure as a value so the screen can set it apart', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        const { parts, text } = practiseQuestion(round)
        // The parts flatten back to exactly the plain sentence.
        expect(parts.map(p => (typeof p === 'string' ? p : p.v)).join('')).toBe(text)
        // Every number lives in a value; none is stranded in the prose around it.
        parts.filter(p => typeof p === 'string').forEach(word => {
          expect(word).not.toMatch(/[0-9]/)
        })
        expect(parts.filter(p => typeof p === 'object')).toHaveLength(3)
      })
    }
  })

  it('ends every question with the question, so the sheet scans', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        expect(practiseQuestion(round).text.trimEnd()).toMatch(/\?$/)
      })
    }
  })

  it('labels the answer in the unit the question asks for', () => {
    const units = { arrival: 'HHMM', distance: 'miles', fuel: 'gallons', speed: 'mph' }
    QUESTION_TYPES.forEach(type => {
      const round = buildPractiseRun().find(r => r.type === type)
      expect(practiseQuestion(round).unit).toBe(units[type])
    })
  })
})

describe('practiseSolution', () => {
  it('finishes on the round\'s correct answer', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        const steps = practiseSolution(round)
        const last = steps[steps.length - 1]
        const expected = round.type === 'arrival'
          ? formatHHMM(round.correctAnswer)
          : String(round.correctAnswer)
        expect(last.result).toContain(expected)
      })
    }
  })

  it('numbers its steps from 1', () => {
    buildPractiseRun().forEach(round => {
      expect(practiseSolution(round).map(s => s.n)).toEqual([1, 2])
    })
  })

  it('refers to nothing that is not on screen', () => {
    // The game's own solutionSteps() talks about the Timings panel, the map and
    // the parcel table. None of those exist in the drill.
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        const blob = practiseSolution(round).map(s => `${s.label} ${s.expr} ${s.result}`).join(' ')
        expect(blob).not.toMatch(/panel|map|table|parcel/i)
      })
    }
  })
})

describe('scoring', () => {
  it('accepts the solution\'s own answer as exact', () => {
    for (let i = 0; i < RUNS; i++) {
      buildPractiseRun().forEach(round => {
        const answer = round.type === 'arrival'
          ? formatHHMM(round.correctAnswer)
          : String(round.correctAnswer)
        expect(scoreAnswer(round, answer)).toMatchObject({ points: 10, exact: true })
      })
    }
  })

  it('tops out at 10 points a question', () => {
    expect(PRACTISE_MAX_SCORE).toBe(PRACTISE_QUESTION_COUNT * 10)
  })
})

describe('practiseGrade', () => {
  it('reuses the game grade curve — eight questions is the same 80-point run', () => {
    expect(PRACTISE_MAX_SCORE).toBe(80)
    expect(practiseGrade).toBe(gradeForScore)
    expect(practiseGrade(80)).toBe('Outstanding')
    expect(practiseGrade(70)).toBe('Outstanding')
    expect(practiseGrade(69)).toBe('Good')
    expect(practiseGrade(45)).toBe('Good')
    expect(practiseGrade(44)).toBe('Needs Work')
    expect(practiseGrade(20)).toBe('Needs Work')
    expect(practiseGrade(19)).toBe('Failed')
    expect(practiseGrade(0)).toBe('Failed')
  })
})
