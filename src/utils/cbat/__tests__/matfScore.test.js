import { describe, it, expect } from 'vitest'
import { matfScore, computeMatfGrade, MATF_TUNING } from '../matfDifficulty'

describe('matfScore', () => {
  it('takes a point off per wrong answer, never below zero', () => {
    expect(matfScore(24, 30)).toBe(18)
    expect(matfScore(40, 200)).toBe(0)
    expect(matfScore(0, 0)).toBe(0)
  })

  it('grades a mashed run as Failed however many landed', () => {
    const spam = matfScore(60, 300)
    expect(computeMatfGrade(spam, MATF_TUNING.hard)).toBe('Failed')
  })
})
