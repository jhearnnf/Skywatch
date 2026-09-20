// The Agent name scrolls sideways rather than truncating, and the marks beside
// it (Passed, Supporter) take priority: they sit outside the scroller and never
// shrink, so they always show in full and the name gives way.
//
// On a phone the column is ~19 characters and a Passed + Supporter pair takes
// half of that, so an ellipsis left names like "James_Sk..." with no way to
// read the rest. The hint that the name scrolls is a fade on the clipped edge,
// which follows the scroll position so the tail is fully legible once you have
// swiped to it.

import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import LeaderboardRow from '../LeaderboardRow'

afterEach(cleanup)

const entry = (extra = {}) => ({
  _id: 'e1', userId: 'u1', displayName: 'A_Very_Long_Display_Name_Indeed', bestScore: 120, bestTime: 42.5, ...extra,
})
const cfg = { hideTime: false }

// jsdom does no layout, so give the scroller a geometry by hand and let the
// component re-measure on the scroll event it already listens for.
const layOut = (el, { scrollWidth, clientWidth, scrollLeft }) => {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft })
  act(() => { fireEvent.scroll(el) })
}

describe('leaderboard Agent name', () => {
  it('scrolls sideways instead of truncating', () => {
    render(<LeaderboardRow entry={entry({ cbatPassed: true, supporter: true })} variant="alltime" cfg={cfg} />)
    const name = screen.getByTestId('agent-name')
    expect(name.className).toContain('overflow-x-auto')
    expect(name.className).toContain('scrollbar-none')
    expect(name.className).toContain('whitespace-nowrap')
    expect(name.className).not.toContain('truncate')
    expect(name.textContent).toBe('A_Very_Long_Display_Name_Indeed')
  })

  it('keeps the marks outside the name scroller, in a wrapping row that never shrinks', () => {
    render(<LeaderboardRow entry={entry({ cbatPassed: true, supporter: true })} variant="alltime" cfg={cfg} />)
    const name = screen.getByTestId('agent-name')
    const marks = screen.getByTestId('agent-marks')
    const passed = screen.getByLabelText('Passed the CBAT')
    const supporter = screen.getByLabelText('SkyWatch supporter')
    expect(name.contains(passed)).toBe(false)
    expect(marks.contains(passed)).toBe(true)
    expect(marks.contains(supporter)).toBe(true)
    expect(marks.className).toContain('flex-wrap')
    expect(passed.className).toContain('shrink-0')
    expect(supporter.className).toContain('shrink-0')
  })

  // On a phone the column can be 6rem, where a name and two words cannot share
  // a line, so the marks go under the name; from sm up they sit inline.
  it('stacks the marks under the name on a phone and inlines them from sm', () => {
    render(<LeaderboardRow entry={entry({ cbatPassed: true })} variant="alltime" cfg={cfg} />)
    const cell = screen.getByTestId('agent-cell')
    expect(cell.className).toContain('flex-col')
    expect(cell.className).toContain('sm:flex-row')
    expect(screen.getByTestId('agent-marks').className).toContain('sm:contents')
    const name = screen.getByTestId('agent-name')
    expect(name.className).toContain('max-w-full')
    expect(name.className).toContain('sm:flex-1')
  })

  it('renders no marks row for a plain name, so nothing stacks under it', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    expect(screen.queryByTestId('agent-marks')).toBeNull()
  })

  it('keeps the swipe inside the name rather than the browser back gesture', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    expect(screen.getByTestId('agent-name').className).toContain('overscroll-x-contain')
  })

  it('shows no fade when the name fits', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    const name = screen.getByTestId('agent-name')
    layOut(name, { scrollWidth: 100, clientWidth: 100, scrollLeft: 0 })
    expect(name.dataset.fade).toBe('none')
    expect(name.className).not.toMatch(/scroll-fade/)
  })

  it('fades the clipped right edge of a name that overflows', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    const name = screen.getByTestId('agent-name')
    layOut(name, { scrollWidth: 200, clientWidth: 100, scrollLeft: 0 })
    expect(name.dataset.fade).toBe('right')
    expect(name.className).toContain('scroll-fade-r')
  })

  it('moves the fade with the scroll so the revealed end reads clearly', () => {
    render(<LeaderboardRow entry={entry()} variant="alltime" cfg={cfg} />)
    const name = screen.getByTestId('agent-name')
    layOut(name, { scrollWidth: 200, clientWidth: 100, scrollLeft: 50 })
    expect(name.dataset.fade).toBe('both')
    expect(name.className).toContain('scroll-fade-x')
    layOut(name, { scrollWidth: 200, clientWidth: 100, scrollLeft: 100 })
    expect(name.dataset.fade).toBe('left')
    expect(name.className).toContain('scroll-fade-l')
    expect(name.className).not.toContain('scroll-fade-r')
  })

  it('does the same on the compact post-game variant', () => {
    render(<LeaderboardRow entry={entry({ weekTotal: 300, plays: 3 })} variant="weekly" cfg={cfg} compact />)
    expect(screen.getByTestId('agent-name').className).toContain('overflow-x-auto')
  })
})

describe('leaderboard Rank cell', () => {
  it('steps down for a three-digit rank so it still fits the 2rem track', () => {
    render(<LeaderboardRow entry={entry({ rank: 143 })} variant="alltime" cfg={cfg} isMe />)
    expect(screen.getByText('#143').className).toContain('text-xs')
  })

  it('keeps the normal size for the top 20', () => {
    render(<LeaderboardRow entry={entry({ rank: 20 })} variant="alltime" cfg={cfg} />)
    expect(screen.getByText('#20').className).not.toContain('text-xs')
  })
})
