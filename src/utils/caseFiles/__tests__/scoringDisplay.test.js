import { describe, it, expect } from 'vitest'
import {
  formatScore,
  formatPct,
  stageTypeLabel,
  gradeForPct,
} from '../scoringDisplay'

// ── formatScore ───────────────────────────────────────────────────────────────

describe('formatScore', () => {
  it('formats whole numbers as "score / maxScore"', () => {
    expect(formatScore(250, 500)).toBe('250 / 500')
  })

  it('returns "0 / 0" when both args are 0', () => {
    expect(formatScore(0, 0)).toBe('0 / 0')
  })

  it('rounds fractional values', () => {
    expect(formatScore(99.6, 100)).toBe('100 / 100')
  })

  it('handles maxScore equal to score (perfect score)', () => {
    expect(formatScore(250, 250)).toBe('250 / 250')
  })
})

// ── formatPct ─────────────────────────────────────────────────────────────────

describe('formatPct', () => {
  it('returns "100%" for a perfect score', () => {
    expect(formatPct(250, 250)).toBe('100%')
  })

  it('returns "0%" when maxScore is 0 (no divide-by-zero)', () => {
    expect(formatPct(0, 0)).toBe('0%')
  })

  it('rounds to nearest integer', () => {
    // 1 / 3 = 33.33... → 33%
    expect(formatPct(1, 3)).toBe('33%')
  })

  it('returns "50%" for half score', () => {
    expect(formatPct(50, 100)).toBe('50%')
  })
})

// ── stageTypeLabel ────────────────────────────────────────────────────────────

describe('stageTypeLabel', () => {
  it('maps cold_open to Briefing', () => {
    expect(stageTypeLabel('cold_open')).toBe('Briefing')
  })

  it('maps evidence_wall to Evidence Wall', () => {
    expect(stageTypeLabel('evidence_wall')).toBe('Evidence Wall')
  })

  it('maps map_live to Live Map', () => {
    expect(stageTypeLabel('map_live')).toBe('Live Map')
  })

  it('maps debrief to Debrief', () => {
    expect(stageTypeLabel('debrief')).toBe('Debrief')
  })

  it('returns the raw type string for unknown stage types', () => {
    expect(stageTypeLabel('custom_unknown')).toBe('custom_unknown')
  })
})

// ── gradeForPct ───────────────────────────────────────────────────────────────

describe('gradeForPct', () => {
  it('returns S at exactly 95', () => {
    expect(gradeForPct(95)).toBe('S')
  })

  it('returns S at 100', () => {
    expect(gradeForPct(100)).toBe('S')
  })

  it('returns A at 80', () => {
    expect(gradeForPct(80)).toBe('A')
  })

  it('returns A at 94', () => {
    expect(gradeForPct(94)).toBe('A')
  })

  it('returns B at 60', () => {
    expect(gradeForPct(60)).toBe('B')
  })

  it('returns B at 79', () => {
    expect(gradeForPct(79)).toBe('B')
  })

  it('returns C at 40', () => {
    expect(gradeForPct(40)).toBe('C')
  })

  it('returns C at 59', () => {
    expect(gradeForPct(59)).toBe('C')
  })

  it('returns D at 1', () => {
    expect(gradeForPct(1)).toBe('D')
  })

  it('returns D at 39', () => {
    expect(gradeForPct(39)).toBe('D')
  })

  it('returns – at exactly 0', () => {
    expect(gradeForPct(0)).toBe('–')
  })
})
