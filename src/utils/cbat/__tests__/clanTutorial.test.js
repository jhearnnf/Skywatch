import { describe, it, expect } from 'vitest'
import {
  CLAN_TUTORIAL_GOALS, SLOW_SCALE, EASE_IN_MS, EASE_OUT_MS, CODE_FOCUS_DELAY_MS,
  tutorialProgress, tutorialFocus, tutorialLighting, targetTimeScale, nextTimeScale,
  zoomOrigin, eventPopup, tutorialInstruction, CLAN_TUTORIAL_TUNING, CLAN_TUTORIAL_DURATION_MS,
} from '../clanTutorial'
import { createClanSim, CLAN_BANDS, blankClanStats } from '../clanSim'
import { seededRng } from '../clanGenerator'
import { CLAN_KEY_LAYOUT_DEFS } from '../../../pages/CbatClan/keys'

// CLAN's tutorial: slow motion whenever the player is needed, zoomed in on it,
// with everything else dimmed and the key to press lit.

const snap = (over = {}) => ({
  t: 1000,
  diamonds: [],
  letters: { phase: 'idle', correctIndex: -1 },
  maths: { question: null, entered: '' },
  ...over,
})
const inBand = (colour, frac) => {
  const [lo, hi] = CLAN_BANDS[colour]
  return lo + (hi - lo) * frac
}
const grouped = CLAN_KEY_LAYOUT_DEFS.grouped

describe('tutorialFocus', () => {
  const asking = (askingMs, correctIndex = 2) => ({ phase: 'asking', correctIndex, askingMs })

  it('is empty when nothing needs the player', () => {
    expect(tutorialFocus(null, snap())).toBeNull()
    // A diamond still on its way, or in someone else's band, needs nothing yet.
    expect(tutorialFocus(null, snap({ diamonds: [
      { id: 1, colour: 'red', x: 0.2, state: 'live' },
      { id: 2, colour: 'green', x: inBand('red', 0.5), state: 'live' },
    ] }))).toBeNull()
  })

  it('starts the moment a diamond enters its band, not before', () => {
    const lo = CLAN_BANDS.yellow[0]
    expect(tutorialFocus(null, snap({ diamonds: [{ id: 1, colour: 'yellow', x: lo - 0.005, state: 'live' }] }))).toBeNull()
    expect(tutorialFocus(null, snap({ diamonds: [{ id: 1, colour: 'yellow', x: lo, state: 'live' }] })))
      .toEqual({ kind: 'colour', colour: 'yellow', id: 1 })
  })

  it('picks the diamond furthest through its band', () => {
    const f = tutorialFocus(null, snap({ diamonds: [
      { id: 1, colour: 'yellow', x: inBand('yellow', 0.2), state: 'live' },
      { id: 2, colour: 'red', x: inBand('red', 0.8), state: 'live' },
      { id: 3, colour: 'green', x: inBand('green', 0.95), state: 'hit' },
    ] }))
    expect(f).toEqual({ kind: 'colour', colour: 'red', id: 2 })
  })

  it('lets the code options run a moment before pointing out the right one', () => {
    expect(tutorialFocus(null, snap({ letters: asking(CODE_FOCUS_DELAY_MS - 1) }))).toBeNull()
    expect(tutorialFocus(null, snap({ letters: asking(CODE_FOCUS_DELAY_MS) }))).toEqual({ kind: 'code', index: 2 })
  })

  it('when free, takes a diamond before the code and the code before the sum', () => {
    const letters = asking(CODE_FOCUS_DELAY_MS)
    const maths = { question: '4 + 5', entered: '' }
    const diamonds = [{ id: 1, colour: 'green', x: inBand('green', 0.5), state: 'live' }]
    expect(tutorialFocus(null, snap({ diamonds, letters, maths })).kind).toBe('colour')
    expect(tutorialFocus(null, snap({ letters, maths }))).toEqual({ kind: 'code', index: 2 })
    expect(tutorialFocus(null, snap({ maths }))).toEqual({ kind: 'sum' })
  })

  it('never lets a diamond take over from a sum it is holding', () => {
    const maths = { question: '4 + 5', entered: '' }
    const held = tutorialFocus(null, snap({ maths }))
    const diamonds = [{ id: 7, colour: 'red', x: inBand('red', 0.5), state: 'live' }]
    // Same object back: the focus stands.
    expect(tutorialFocus(held, snap({ diamonds, maths }))).toBe(held)
    // Once the sum is answered the diamond gets its turn, if it is still there.
    expect(tutorialFocus(held, snap({ diamonds }))).toEqual({ kind: 'colour', colour: 'red', id: 7 })
    // And if it has already left its band it is just a miss: nothing to focus.
    expect(tutorialFocus(held, snap({ diamonds: [{ id: 7, colour: 'red', x: CLAN_BANDS.red[1] + 0.01, state: 'live' }] }))).toBeNull()
  })

  it('never lets the code or a sum take over from a diamond', () => {
    const d = (x, state = 'live') => [{ id: 4, colour: 'yellow', x, state }]
    const held = tutorialFocus(null, snap({ diamonds: d(inBand('yellow', 0.1)) }))
    const busy = { letters: asking(CODE_FOCUS_DELAY_MS * 3), maths: { question: '2 + 2', entered: '' } }
    expect(tutorialFocus(held, snap({ ...busy, diamonds: d(inBand('yellow', 0.6)) }))).toBe(held)
    // Caught: the focus moves on.
    expect(tutorialFocus(held, snap({ ...busy, diamonds: d(inBand('yellow', 0.6), 'hit') }))).toEqual({ kind: 'code', index: 2 })
  })

  it('follows its own diamond, not another of the same colour', () => {
    const held = tutorialFocus(null, snap({ diamonds: [{ id: 1, colour: 'red', x: inBand('red', 0.5), state: 'live' }] }))
    // Its diamond is gone; a different red one is in the band. That is a new focus.
    const next = tutorialFocus(held, snap({ diamonds: [{ id: 2, colour: 'red', x: inBand('red', 0.1), state: 'live' }] }))
    expect(next).not.toBe(held)
    expect(next).toEqual({ kind: 'colour', colour: 'red', id: 2 })
  })

  it('holds the code until it is answered or runs out', () => {
    const held = tutorialFocus(null, snap({ letters: asking(CODE_FOCUS_DELAY_MS) }))
    expect(tutorialFocus(held, snap({ letters: asking(CODE_FOCUS_DELAY_MS + 4000) }))).toBe(held)
    expect(tutorialFocus(held, snap({ letters: { phase: 'gap', correctIndex: -1, askingMs: 0 } }))).toBeNull()
  })
})

describe('tutorialLighting', () => {
  it('lights only what is in focus', () => {
    const s = snap({ maths: { question: '4 + 5', entered: '9' } })
    expect(tutorialLighting({ kind: 'colour', colour: 'yellow' }, s)).toEqual({ colours: ['yellow'], option: -1, enter: false })
    expect(tutorialLighting({ kind: 'code', index: 3 }, s)).toEqual({ colours: [], option: 3, enter: false })
    expect(tutorialLighting({ kind: 'sum' }, s)).toEqual({ colours: [], option: -1, enter: true })
    expect(tutorialLighting({ kind: 'sum' }, snap({ maths: { question: '4 + 5', entered: '' } })).enter).toBe(false)
    expect(tutorialLighting(null, s)).toEqual({ colours: [], option: -1, enter: false })
  })
})

describe('slow motion', () => {
  it('gives a diamond entering its band well over twenty real seconds there', () => {
    // Fly one diamond at full speed until it enters the band, then run the
    // slow-motion clock frame by frame, as the page does.
    const { crossMs } = CLAN_TUTORIAL_TUNING.colours
    const [lo, hi] = CLAN_BANDS.red
    let x = lo, scale = 1, realMs = 0
    while (x <= hi) {
      scale = nextTimeScale(scale, SLOW_SCALE, 16)
      x += (16 * scale) / crossMs
      realMs += 16
    }
    expect(realMs).toBeGreaterThan(20_000)
  })

  it('crawls while the player is needed and runs at full speed otherwise', () => {
    expect(targetTimeScale({ kind: 'sum' })).toBe(SLOW_SCALE)
    expect(targetTimeScale(null)).toBe(1)
    expect(SLOW_SCALE).toBeLessThan(0.1)
  })

  it('eases between the two rather than cutting', () => {
    const oneFrame = nextTimeScale(1, SLOW_SCALE, 16)
    expect(oneFrame).toBeLessThan(1)
    expect(oneFrame).toBeGreaterThan(0.9)
    // Most of the way there after a few ease lengths, and settles exactly.
    let s = 1
    for (let t = 0; t < EASE_OUT_MS * 10; t += 16) s = nextTimeScale(s, SLOW_SCALE, 16)
    expect(s).toBe(SLOW_SCALE)
    // Down is quicker than back up.
    expect(EASE_IN_MS).toBeLessThan(EASE_OUT_MS)
    expect(1 - nextTimeScale(1, SLOW_SCALE, 50)).toBeGreaterThan(nextTimeScale(SLOW_SCALE, 1, 50) - SLOW_SCALE)
    // A zero-length frame changes nothing.
    expect(nextTimeScale(0.5, 1, 0)).toBe(0.5)
  })
})

describe('zoomOrigin', () => {
  it('points at the middle of the colour band, the right box\'s corner, or the sum', () => {
    expect(zoomOrigin({ kind: 'colour', colour: 'red' })).toBe('54% 50%')
    expect(zoomOrigin({ kind: 'colour', colour: 'green' })).toBe('86% 50%')
    expect(zoomOrigin({ kind: 'code', index: 0 })).toBe('0% 0%')
    expect(zoomOrigin({ kind: 'code', index: 3 })).toBe('100% 100%')
    expect(zoomOrigin({ kind: 'sum' })).toBe('50% 100%')
    expect(zoomOrigin(null)).toBe('50% 50%')
    // Zooming around the grid's own corner keeps a corner box wholly on the
    // board: a point at the origin stays put and the box lies inward of it.
    expect(zoomOrigin({ kind: 'code', index: 1 })).toBe('100% 0%')
    expect(zoomOrigin({ kind: 'code', index: 2 })).toBe('0% 100%')
  })
})

describe('eventPopup', () => {
  it('shows a right answer as a plus and a wrong one as a minus', () => {
    expect(eventPopup({ kind: 'colourHits', task: 'colour', points: 10 })).toMatchObject({ text: 'Correct', points: '+10', tone: 'good' })
    expect(eventPopup({ kind: 'colourWrong', task: 'colour', points: -5 })).toMatchObject({ text: 'Wrong key', points: '-5', tone: 'bad' })
    expect(eventPopup({ kind: 'letterCorrect', task: 'letter', points: 20 })).toMatchObject({ points: '+20', tone: 'good' })
    expect(eventPopup({ kind: 'mathTimeout', task: 'math', points: -5 })).toMatchObject({ text: 'Too slow', tone: 'bad' })
    expect(eventPopup(null)).toBeNull()
  })

  it('has a pop-up for every event kind the sim can award', () => {
    // The sim's event kinds are its stats counters (everything but the scores).
    // A kind missing here is a right or wrong answer that shows nothing.
    const kinds = Object.keys(blankClanStats()).filter(k => !/Score$/.test(k))
    expect(kinds).toHaveLength(9)
    for (const kind of kinds) {
      const task = kind.startsWith('colour') ? 'colour' : kind.startsWith('letter') ? 'letter' : 'math'
      expect([kind, eventPopup({ kind, task, points: 5 })]).toEqual([kind, expect.objectContaining({ text: expect.any(String) })])
    }
    expect(eventPopup({ kind: 'nonsense', task: 'colour', points: 0 })).toBeNull()
  })
})

describe('tutorialInstruction', () => {
  it('names the key to press in the player\'s own layout', () => {
    expect(tutorialInstruction({ kind: 'colour', colour: 'red' }, snap(), grouped)).toBe('Press J now. The red diamond is in the red band.')
    expect(tutorialInstruction({ kind: 'code', index: 1 }, snap(), grouped)).toBe('Press W. That box holds the code you memorised.')
    expect(tutorialInstruction({ kind: 'code', index: 1 }, snap(), CLAN_KEY_LAYOUT_DEFS.letters)).toBe('Press B. That box holds the code you memorised.')
  })

  it('walks the sum through typing then Enter, and says what to do between presses', () => {
    expect(tutorialInstruction({ kind: 'sum' }, snap({ maths: { question: '2 + 2', entered: '' } }), grouped)).toMatch(/Type the answer/)
    expect(tutorialInstruction({ kind: 'sum' }, snap({ maths: { question: '2 + 2', entered: '4' } }), grouped)).toBe('Press Enter to answer.')
    expect(tutorialInstruction(null, snap({ letters: { phase: 'showing', correctIndex: -1 } }), grouped)).toMatch(/Memorise the code/)
    expect(tutorialInstruction(null, snap(), grouped)).toMatch(/Watch for diamonds/)
    // The moment before the right box is pointed out.
    expect(tutorialInstruction(null, snap({ letters: { phase: 'asking', correctIndex: 1, askingMs: 0 } }), grouped))
      .toBe('Which of the four is the code you memorised?')
  })

  it('never uses an em dash', () => {
    const lines = [
      tutorialInstruction({ kind: 'colour', colour: 'green' }, snap(), grouped),
      tutorialInstruction({ kind: 'code', index: 0 }, snap(), grouped),
      tutorialInstruction({ kind: 'sum' }, snap({ maths: { question: '1', entered: '' } }), grouped),
      tutorialInstruction(null, snap(), grouped),
    ]
    for (const l of lines) expect(l).not.toMatch(/—/)
  })
})

describe('tutorialProgress', () => {
  it('counts right answers of each task up to its goal and is done when all three are met', () => {
    const stats = { ...blankClanStats(), colourHits: 9, letterCorrect: 1, mathCorrect: 2 }
    expect(tutorialProgress(stats)).toEqual({ colours: CLAN_TUTORIAL_GOALS.colours, codes: 1, sums: 2, met: 2, done: false })
    expect(tutorialProgress({ ...stats, letterCorrect: 2 }).done).toBe(true)
    expect(tutorialProgress(blankClanStats())).toMatchObject({ met: 0, done: false })
  })
})

describe('the tutorial tuning', () => {
  it('teaches a diamond first: the first code and sum come after the first diamond reaches its band', () => {
    const t = CLAN_TUTORIAL_TUNING
    const firstDiamondInBand = 1000 + CLAN_BANDS.red[0] * t.colours.crossMs
    expect(t.letters.firstMs).toBeGreaterThan(firstDiamondInBand)
    expect(t.maths.firstMs).toBeGreaterThan(t.letters.firstMs)
    expect(t.maths.weights).toEqual({ easy: 1, medium: 0, hard: 0 })
  })

  it('serves more than enough of each task to meet the goals', () => {
    const sim = createClanSim({ tuning: CLAN_TUTORIAL_TUNING, rng: seededRng(3), durationMs: CLAN_TUTORIAL_DURATION_MS })
    const seenCodes = new Set()
    let sums = 0
    let lastQ = null
    for (let t = 0; t <= CLAN_TUTORIAL_DURATION_MS; t += 50) {
      sim.tick(t)
      const s = sim.snapshot()
      if (s.letters.code) seenCodes.add(s.letters.code)
      if (s.maths.question && s.maths.question !== lastQ) sums++
      lastQ = s.maths.question
    }
    expect(seenCodes.size).toBeGreaterThanOrEqual(CLAN_TUTORIAL_GOALS.codes * 3)
    expect(sums).toBeGreaterThanOrEqual(CLAN_TUTORIAL_GOALS.sums * 3)
  })
})
