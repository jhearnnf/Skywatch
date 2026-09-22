import { describe, it, expect } from 'vitest'
import { cohortCopy, formatCohortDate } from '../cohortCopy'

describe('cohortCopy', () => {
  it('names the test the applicant will actually sit', () => {
    expect(cohortCopy('CBAT').label).toBe('Upcoming CBAT date')
    expect(cohortCopy('CFAST').label).toBe('Upcoming CFAST date')
    expect(cohortCopy('MACTS').intro).toContain('sitting the MACTS on the same day')
    expect(cohortCopy('CFAST').railHint).toBe('Enter your upcoming CFAST date to join')
  })

  it('falls back to a plain phrase where no single name fits', () => {
    const copy = cohortCopy(null)
    expect(copy.label).toBe('Upcoming test date')
    expect(copy.eyebrow).toBe('Private test-day group')
    expect(copy.intro).toContain('sitting their aptitude test')
    expect(JSON.stringify(copy)).not.toContain('CBAT')
  })

  it('never uses an em dash anywhere on screen', () => {
    for (const name of ['CBAT', 'CFAST', 'MACTS', null]) {
      expect(JSON.stringify(cohortCopy(name))).not.toMatch(/[—–]/)
    }
  })

  it('formats the server date key without a timezone shift', () => {
    expect(formatCohortDate('2099-10-14')).toBe('14 October 2099')
    expect(formatCohortDate('2099-10-14', 'medium')).toBe('14 Oct 2099')
  })
})
