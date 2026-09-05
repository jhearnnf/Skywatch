import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CbatPersonalBest from '../CbatPersonalBest'

// Flipping a mode used to make the instructions card jump: every page wrote
// `{personalBest && (…)}`, so the panel unmounted while the new board's best
// was in flight and came back a moment later. Three lines of card vanished and
// returned, which reads as the layout breaking rather than as data loading.
//
// The fix is that the panel is always rendered and always the same height. What
// is pinned here is that height, in all three states.

const heightOf = (container) => {
  const el = container.querySelector('.h-7')
  expect(el).toBeTruthy()
  return el.className
}

const best = { bestScore: 420, bestTime: 91.5, attempts: 7 }

describe('CbatPersonalBest', () => {
  it('renders in every state, so a mode flip never unmounts it', () => {
    for (const props of [
      { loading: true },
      { best: null },
      { best },
    ]) {
      const { container } = render(<CbatPersonalBest {...props}>{b => b.bestScore}</CbatPersonalBest>)
      expect(container.textContent).toContain('Personal Best')
    }
  })

  // The value line is the one that changes, so it is the one that has to be a
  // fixed height. Same class in all three states means the card cannot resize.
  it('keeps the value line the same height whatever it is showing', () => {
    const loading = render(<CbatPersonalBest loading>{b => b.bestScore}</CbatPersonalBest>)
    const empty = render(<CbatPersonalBest best={null}>{b => b.bestScore}</CbatPersonalBest>)
    const filled = render(<CbatPersonalBest best={best}>{b => b.bestScore}</CbatPersonalBest>)

    expect(heightOf(loading.container)).toBe(heightOf(empty.container))
    expect(heightOf(empty.container)).toBe(heightOf(filled.container))
  })

  it('shows a placeholder while the board is still being asked', () => {
    const { container } = render(<CbatPersonalBest loading>{b => b.bestScore}</CbatPersonalBest>)
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
    expect(container.textContent).not.toContain('No runs yet')
  })

  // A board known to be empty is not loading, it is empty, and says so rather
  // than sitting on a placeholder forever.
  it('says so when the board has no runs', () => {
    const { container } = render(<CbatPersonalBest best={null}>{b => b.bestScore}</CbatPersonalBest>)
    expect(container.textContent).toContain('No runs yet')
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders the value and the attempt count once it has one', () => {
    const { container } = render(<CbatPersonalBest best={best}>{b => b.bestScore}</CbatPersonalBest>)
    expect(container.textContent).toContain('420')
    expect(container.textContent).toContain('7 attempts')
    expect(container.textContent).not.toContain('No runs yet')
  })

  it('says "1 attempt", not "1 attempts"', () => {
    const { container } = render(
      <CbatPersonalBest best={{ ...best, attempts: 1 }}>{b => b.bestScore}</CbatPersonalBest>,
    )
    expect(container.textContent).toContain('1 attempt')
    expect(container.textContent).not.toContain('1 attempts')
  })

  // The label is what stops a score being read as the wrong board's.
  it('names the board when it is given one, and stays bare when it is not', () => {
    const withLabel = render(<CbatPersonalBest label="Hard" best={best}>{b => b.bestScore}</CbatPersonalBest>)
    expect(withLabel.container.textContent).toContain('Personal Best · Hard')

    const without = render(<CbatPersonalBest best={best}>{b => b.bestScore}</CbatPersonalBest>)
    expect(without.container.textContent).toContain('Personal Best')
    expect(without.container.textContent).not.toContain('·')
  })

  it('accepts plain children as well as a render function', () => {
    const { container } = render(<CbatPersonalBest best={best}>hello</CbatPersonalBest>)
    expect(container.textContent).toContain('hello')
  })
})
