import { render, act } from '@testing-library/react'
import { useRef } from 'react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useFixedColumn } from '../useFixedColumn'

// What this is for: the CBAT hub's side column must not move when the page
// scrolls — only the game grid does. Sticky could not do that (it travels until
// it reaches its offset, and gets dragged away again when its row runs out), so
// the column is fixed and takes its geometry from the spacer left in the flow.

function Probe() {
  const ref = useRef(null)
  const box = useFixedColumn(ref, { bottom: 16, min: 100 })
  return (
    <div ref={ref} data-testid="spacer" data-box={box ? JSON.stringify(box) : ''} />
  )
}

// jsdom lays nothing out, so the spacer's position is stated.
const spacerAt = ({ top, left = 900, width = 340 }) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top, left, width, height: 0, right: left + width, bottom: top, x: left, y: top,
  })
}

const boxOf = (el) => (el.dataset.box ? JSON.parse(el.dataset.box) : null)

beforeEach(() => {
  vi.restoreAllMocks()
  window.innerHeight = 900
  window.scrollY = 0
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

describe('useFixedColumn', () => {
  it('pins the column where it sits on an unscrolled page', () => {
    spacerAt({ top: 200 })
    const { getByTestId } = render(<Probe />)

    expect(boxOf(getByTestId('spacer'))).toEqual({
      top: 200, left: 900, width: 340, height: 900 - 200 - 16,
    })
  })

  // The whole point. Scrolled 500px down, the spacer has moved up the screen
  // and the fixed panel must not have.
  it('reports the same position however far the page has scrolled', () => {
    spacerAt({ top: 200 })
    const { getByTestId } = render(<Probe />)
    const before = boxOf(getByTestId('spacer'))

    window.scrollY = 500
    spacerAt({ top: -300 })
    act(() => { window.dispatchEvent(new Event('scroll')) })

    expect(boxOf(getByTestId('spacer'))).toEqual(before)
  })

  it('follows the column when a resize moves or narrows it', () => {
    spacerAt({ top: 200 })
    const { getByTestId } = render(<Probe />)

    window.innerHeight = 600
    spacerAt({ top: 200, left: 700, width: 300 })
    act(() => { window.dispatchEvent(new Event('resize')) })

    expect(boxOf(getByTestId('spacer'))).toEqual({
      top: 200, left: 700, width: 300, height: 600 - 200 - 16,
    })
  })

  it('keeps a floor, so a short window cannot collapse the column to nothing', () => {
    window.innerHeight = 120
    spacerAt({ top: 100 })
    const { getByTestId } = render(<Probe />)
    expect(boxOf(getByTestId('spacer')).height).toBe(100)
  })

  // Below the breakpoint the column is display:none. Publishing zeroes would
  // paint a fixed panel in the top-left corner of a phone screen.
  it('reports nothing at all for a column that is not being rendered', () => {
    spacerAt({ top: 0, left: 0, width: 0 })
    const { getByTestId } = render(<Probe />)
    expect(boxOf(getByTestId('spacer'))).toBeNull()
  })
})
