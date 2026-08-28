import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import CbatPassedBadge from '../CbatPassedBadge'
import LeaderboardRow from '../LeaderboardRow'

afterEach(cleanup)

const LABEL = 'Passed the CBAT'

describe('CbatPassedBadge', () => {
  // A green tick in the corner of an avatar is the verified-account convention,
  // and reads as "this is really them" rather than "they passed the test". The
  // word is the whole point of this component.
  it('spells the status out rather than leaving it to a symbol', () => {
    render(<CbatPassedBadge />)
    expect(screen.getByLabelText(LABEL).textContent.trim()).toBe('Passed')
  })

  it('says what was passed, for anyone who cannot see the context', () => {
    render(<CbatPassedBadge />)
    expect(screen.getByLabelText(LABEL).getAttribute('title')).toBe(LABEL)
  })

  it('never shrinks, so a long name cannot squeeze it out', () => {
    render(<CbatPassedBadge />)
    expect(screen.getByLabelText(LABEL).className).toContain('shrink-0')
  })
})

describe('the passed mark on a leaderboard row', () => {
  const entry = (extra = {}) => ({
    _id: 'e1', userId: 'u1', displayName: 'Falcon', bestScore: 120, bestTime: 42.5, ...extra,
  })
  const cfg = { hideTime: false }

  it('marks an agent who has passed', () => {
    render(<LeaderboardRow entry={entry({ cbatPassed: true })} variant="alltime" cfg={cfg} />)
    expect(screen.getByLabelText(LABEL)).toBeTruthy()
  })

  it('leaves an agent who has not unmarked', () => {
    render(<LeaderboardRow entry={entry({ cbatPassed: false })} variant="alltime" cfg={cfg} />)
    expect(screen.queryByLabelText(LABEL)).toBeNull()
  })

  // Logged-out viewers are never sent the field, and the demo rows the board is
  // padded with have no flag either. Both arrive here as undefined.
  it('marks nothing when the field was never sent', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    expect(screen.queryByLabelText(LABEL)).toBeNull()
  })

  it('keeps the name truncating rather than the mark', () => {
    render(<LeaderboardRow entry={entry({ cbatPassed: true })} variant="alltime" cfg={cfg} />)
    // The mark must not be inside the truncating element, or a long name would
    // clip it away — that is the whole reason the name has its own span.
    const name = screen.getByText('Falcon')
    expect(name.className).toContain('truncate')
    expect(name.querySelector('[aria-label]')).toBeNull()
  })

  it('marks a weekly row too', () => {
    render(
      <LeaderboardRow
        entry={entry({ cbatPassed: true, weekTotal: 500, plays: 4 })}
        variant="weekly"
        cfg={cfg}
      />,
    )
    expect(screen.getByLabelText(LABEL)).toBeTruthy()
  })
})
