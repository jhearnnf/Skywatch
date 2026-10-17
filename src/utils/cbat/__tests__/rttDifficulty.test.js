import { describe, it, expect, beforeEach } from 'vitest'
import {
  RTT_TUNING, RTT_DIFFICULTIES, DEFAULT_RTT_DIFFICULTY,
  rttTuning, rttGameKey, computeGrade,
  readStoredRttDifficulty, storeRttDifficulty,
  readStoredSensitivity, storeSensitivity,
  MIN_SENSITIVITY, MAX_SENSITIVITY, DEFAULT_SENSITIVITY,
} from '../rttDifficulty'
import { RTT_KINDS, maxRttScore } from '../rttSim'

// The allowed key set is pinned, exactly as FLAG's, CUT's, Numerical Ops' and
// SAT's are: a difficulty is a narrow, stated set of changes, and a new key
// appearing here means one difficulty has quietly started changing something
// outside that scope.
const ALLOWED_KEYS = new Set([
  'key', 'label', 'gameKey', 'bars', 'blurb',
  'targets', 'speedScale', 'kinds', 'maxOcclusions', 'occlusionScale',
  'captureScale', 'airframeScale', 'zoom', 'grades',
])

describe('RTT difficulty table', () => {
  it('only tunes the agreed keys', () => {
    for (const tuning of Object.values(RTT_TUNING)) {
      for (const key of Object.keys(tuning)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true)
      }
    }
  })

  it('has both difficulties on their own leaderboard keys', () => {
    expect(rttGameKey('easier')).toBe('rtt-easier')
    expect(rttGameKey('hard')).toBe('rtt')
    expect(RTT_TUNING.easier.gameKey).not.toBe(RTT_TUNING.hard.gameKey)
  })

  it('orders the pair easier-then-hard for the intro card', () => {
    expect(RTT_DIFFICULTIES.map(d => d.key)).toEqual(['easier', 'hard'])
  })

  it('defaults to easier, and falls back to it for an unknown key', () => {
    expect(DEFAULT_RTT_DIFFICULTY).toBe('easier')
    expect(rttTuning('nonsense').key).toBe('easier')
    expect(rttTuning(undefined).key).toBe('easier')
  })

  it('makes Easier strictly gentler on every axis it touches', () => {
    const e = RTT_TUNING.easier
    const h = RTT_TUNING.hard
    expect(e.targets).toBeLessThan(h.targets)
    expect(e.speedScale).toBeLessThan(h.speedScale)
    expect(e.maxOcclusions).toBeLessThan(h.maxOcclusions)
    expect(e.occlusionScale).toBeLessThan(h.occlusionScale)
    expect(e.captureScale).toBeGreaterThan(h.captureScale)
    expect(e.airframeScale).toBeLessThan(h.airframeScale)
  })

  it('drops fast air from Easier and nothing else', () => {
    expect(RTT_TUNING.hard.kinds).toContain('jet')
    expect(RTT_TUNING.easier.kinds).not.toContain('jet')
    const dropped = RTT_TUNING.hard.kinds.filter(k => !RTT_TUNING.easier.kinds.includes(k))
    expect(dropped).toEqual(['jet'])
  })

  it('only names kinds the sim actually knows about', () => {
    for (const tuning of Object.values(RTT_TUNING)) {
      for (const kind of tuning.kinds) expect(RTT_KINDS[kind]).toBeTruthy()
    }
  })

  // Unlike Numerical Operations and SAT (percentage / fixed question count,
  // shared ceiling), RTT accumulates. Easier's achievable total is lower, so its
  // bands must come DOWN — the FLAG/CUT rule.
  it('scales the grade bands down on Easier', () => {
    for (const band of ['outstanding', 'good', 'needsWork']) {
      expect(RTT_TUNING.easier.grades[band]).toBeLessThan(RTT_TUNING.hard.grades[band])
    }
  })

  it('grades on the played difficulty s bands', () => {
    expect(computeGrade(1900, RTT_TUNING.hard)).toBe('Outstanding')
    expect(computeGrade(1700, RTT_TUNING.hard)).toBe('Good')
    expect(computeGrade(1300, RTT_TUNING.hard)).toBe('Needs Work')
    expect(computeGrade(500, RTT_TUNING.hard)).toBe('Failed')
    // The same score is a better grade on Easier's lower bands.
    expect(computeGrade(1250, RTT_TUNING.easier)).toBe('Outstanding')
    expect(computeGrade(1250, RTT_TUNING.hard)).toBe('Needs Work')
  })

  // Reseated on real runs (2026-10-17): the old bands had Outstanding at about
  // half a perfect run, and the median run was over 85% of one.
  it('puts Outstanding near the top of what real players score', () => {
    for (const t of RTT_DIFFICULTIES) {
      expect(t.grades.outstanding / maxRttScore(t)).toBeGreaterThan(0.85)
    }
  })

  // Real CBAT adds the three-photo limit and a rougher flight on top, so the
  // same score is worth a little more there.
  it('gives Real CBAT its own, slightly lower bands and its extra rules', () => {
    for (const key of ['easier', 'hard']) {
      const sw = rttTuning(key)
      const cbat = rttTuning(key, true)
      expect(cbat.gameKey).toBe(sw.gameKey)
      expect(cbat.photoLimit).toBe(true)
      expect(cbat.terrain).toBe(true)
      expect(cbat.flight.speedMps[1]).toBeGreaterThan(cbat.flight.speedMps[0])
      expect(sw.photoLimit).toBeUndefined()
      expect(sw.flight).toBeUndefined()
      for (const band of ['outstanding', 'good', 'needsWork']) {
        expect(cbat.grades[band]).toBeLessThan(sw.grades[band])
      }
    }
    expect(rttTuning('easier', true).airframeScale).toBeLessThan(rttTuning('hard', true).airframeScale)
  })

  it('keeps every band reachable — Outstanding is under a perfect run', () => {
    for (const t of [...RTT_DIFFICULTIES, rttTuning('easier', true), rttTuning('hard', true)]) {
      expect(t.grades.outstanding).toBeLessThan(maxRttScore(t))
      expect(t.grades.outstanding).toBeGreaterThan(t.grades.good)
      expect(t.grades.good).toBeGreaterThan(t.grades.needsWork)
      expect(t.grades.needsWork).toBeGreaterThan(0)
    }
  })
})

describe('RTT persistence', () => {
  beforeEach(() => localStorage.clear())

  it('remembers the last difficulty chosen', () => {
    expect(readStoredRttDifficulty()).toBe('easier')
    storeRttDifficulty('hard')
    expect(readStoredRttDifficulty()).toBe('hard')
  })

  it('ignores a stored difficulty that is no longer a real one', () => {
    localStorage.setItem('sw_cbat_rtt_difficulty', 'impossible')
    expect(readStoredRttDifficulty()).toBe('easier')
  })

  it('remembers slew sensitivity and rejects out-of-range values', () => {
    expect(readStoredSensitivity()).toBe(DEFAULT_SENSITIVITY)
    storeSensitivity(1.6)
    expect(readStoredSensitivity()).toBe(1.6)

    localStorage.setItem('sw_cbat_rtt_sensitivity', String(MAX_SENSITIVITY + 5))
    expect(readStoredSensitivity()).toBe(DEFAULT_SENSITIVITY)
    localStorage.setItem('sw_cbat_rtt_sensitivity', String(MIN_SENSITIVITY - 0.2))
    expect(readStoredSensitivity()).toBe(DEFAULT_SENSITIVITY)
    localStorage.setItem('sw_cbat_rtt_sensitivity', 'fast')
    expect(readStoredSensitivity()).toBe(DEFAULT_SENSITIVITY)
  })
})

// Real CBAT adds realism on top of each difficulty, from a player's account of
// the real test. It must never change which board a run is posted to.
describe('Real CBAT tuning', () => {
  it('keeps the difficulty and the board, and switches the realism on', () => {
    for (const key of ['easier', 'hard']) {
      const plain = rttTuning(key)
      const real = rttTuning(key, true)
      expect(real.gameKey).toBe(plain.gameKey)
      expect(real.targets).toBe(plain.targets)
      expect(real.kinds).toEqual(plain.kinds)
      expect(real.realCbat).toBe(true)
      expect(real.trackScoring).toBe(true)
      expect(real.manoeuvres).toHaveLength(2)
      expect(real.decoyGapMs).toHaveLength(2)
      expect(plain.trackScoring).toBeUndefined()
      // The zoom is the one thing both themes share (2026-10-17).
      expect(plain.zoom).toBe(true)
      expect(real.zoom).toBe(true)
    }
  })

  it('turns harder on Hard: more manoeuvres and more traffic', () => {
    const e = rttTuning('easier', true)
    const h = rttTuning('hard', true)
    expect(h.manoeuvres[1]).toBeGreaterThan(e.manoeuvres[1])
    expect(h.decoyGapMs[0]).toBeLessThan(e.decoyGapMs[0])
  })

  it('grades on sane bands, a little below SkyWatch s for the harder task', () => {
    for (const key of ['easier', 'hard']) {
      const t = rttTuning(key, true)
      expect(t.grades.outstanding).toBeLessThan(maxRttScore(t))
      expect(t.grades.outstanding).toBeGreaterThan(t.grades.good)
      expect(t.grades.good).toBeGreaterThan(t.grades.needsWork)
      expect(t.grades.needsWork).toBeGreaterThan(0)
      expect(t.grades.outstanding).toBeLessThan(rttTuning(key).grades.outstanding)
    }
  })
})
