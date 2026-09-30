import { describe, it, expect } from 'vitest'
import { createClanSim } from '../clanSim'
import { createClanDemoPilot } from '../clanDemoPilot'
import { CLAN_DIFFICULTIES } from '../clanDifficulty'

function seededRng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

// A whole run at ~60fps, the pilot acting on every frame the way CbatClan's
// loop drives it.
function playRun(tuning, seed, pilotOpts = {}) {
  const sim = createClanSim({ tuning, rng: seededRng(seed) })
  const pilot = createClanDemoPilot({ rng: seededRng(seed + 1000), ...pilotOpts })
  for (let t = 0; !sim.finished; t += 16) {
    sim.tick(t)
    for (const a of pilot.step(sim.snapshot())) {
      if (a.kind === 'colour')      sim.pressColour(a.value)
      else if (a.kind === 'option') sim.pickLetterOption(a.value)
      else if (a.kind === 'digit')  sim.pressDigit(a.value)
      else if (a.kind === 'enter')  sim.submitMath()
    }
  }
  return sim.stats
}

describe('clanDemoPilot', () => {
  it.each(CLAN_DIFFICULTIES.map((t) => [t.key, t]))('plays %s like a decent candidate', (_, tuning) => {
    for (const seed of [1, 2, 3]) {
      const s = playRun(tuning, seed)
      expect(s.totalScore).toBeGreaterThan(0)
      // Works all three tasks, not just one.
      expect(s.colourHits).toBeGreaterThan(10)
      expect(s.letterCorrect).toBeGreaterThan(0)
      expect(s.mathCorrect).toBeGreaterThan(0)
      // Never presses a colour with nothing in its band.
      expect(s.colourWrong).toBe(0)
      // Answers what it is asked rather than letting it time out.
      expect(s.letterTimeout).toBe(0)
      expect(s.mathTimeout).toBe(0)
      // Mostly right.
      expect(s.colourHits).toBeGreaterThan(s.colourMissed * 3)
    }
  })

  it('is not perfect, so the demo does not make the test look easy', () => {
    let slips = 0
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = playRun(CLAN_DIFFICULTIES[0], seed)
      slips += s.colourMissed + s.letterWrong + s.mathWrong
    }
    expect(slips).toBeGreaterThan(0)
  })

  it('catches everything when told never to slip', () => {
    const perfect = { colourHitRate: 1, letterHitRate: 1, mathHitRate: 1,
      letterDelayMs: [1200, 2800], mathDelayMs: [900, 2000], digitGapMs: [180, 320] }
    const s = playRun(CLAN_DIFFICULTIES[1], 7, { tuning: perfect })
    expect(s.colourMissed).toBe(0)
    expect(s.letterWrong).toBe(0)
    expect(s.mathWrong).toBe(0)
  })

  it('does nothing once the run is over', () => {
    const pilot = createClanDemoPilot({ rng: seededRng(1) })
    expect(pilot.step({ finished: true })).toEqual([])
    expect(pilot.step(null)).toEqual([])
  })
})
