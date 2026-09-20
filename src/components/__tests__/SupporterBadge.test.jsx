import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import SupporterBadge from '../SupporterBadge'
import LeaderboardRow from '../LeaderboardRow'

afterEach(cleanup)

const LABEL = 'SkyWatch supporter'

describe('SupporterBadge', () => {
  // A heart or a coin beside a name could mean anything. The word is the point.
  it('spells the status out rather than leaving it to a symbol', () => {
    render(<SupporterBadge />)
    expect(screen.getByLabelText(LABEL).textContent.trim()).toBe('Supporter')
  })

  it('says what was supported, for anyone who cannot see the context', () => {
    render(<SupporterBadge />)
    expect(screen.getByLabelText(LABEL).getAttribute('title')).toBe(LABEL)
  })

  it('never shrinks, so a long name cannot squeeze it out', () => {
    render(<SupporterBadge />)
    expect(screen.getByLabelText(LABEL).className).toContain('shrink-0')
  })
})

describe('the supporter mark on a leaderboard row', () => {
  const entry = (extra = {}) => ({
    _id: 'e1', userId: 'u1', displayName: 'Falcon', bestScore: 120, bestTime: 42.5, ...extra,
  })
  const cfg = { hideTime: false }

  it('marks an agent who has donated', () => {
    render(<LeaderboardRow entry={entry({ supporter: true })} variant="alltime" cfg={cfg} />)
    expect(screen.getByLabelText(LABEL)).toBeTruthy()
  })

  it('leaves an agent who has not unmarked', () => {
    render(<LeaderboardRow entry={entry({ supporter: false })} variant="alltime" cfg={cfg} />)
    expect(screen.queryByLabelText(LABEL)).toBeNull()
  })

  // Logged-out viewers are never sent the field, and demo rows have none.
  it('marks nothing when the field was never sent', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    expect(screen.queryByLabelText(LABEL)).toBeNull()
  })

  // Both marks on one row: the two facts are independent and both must show.
  it('sits beside the passed mark rather than replacing it', () => {
    render(<LeaderboardRow entry={entry({ supporter: true, cbatPassed: true })} variant="alltime" cfg={cfg} />)
    expect(screen.getByLabelText(LABEL)).toBeTruthy()
    expect(screen.getByLabelText('Passed the CBAT')).toBeTruthy()
  })
})
