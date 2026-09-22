import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import MatfPrintoutRail from '../MatfPrintoutRail'

// The shelf of sheets the player has already printed, beside the Table Reading
// Test's instructions. Loading one replays the exact tables on the paper in
// front of them — which is also why those runs are not ranked.

const sheets = [
  { seed: 0xABCDEF, difficulty: 'hard', printedAt: Date.parse('2026-09-14T10:00:00Z') },
  { seed: 0x123456, difficulty: 'easier', printedAt: Date.parse('2026-09-01T10:00:00Z') },
]

describe('MatfPrintoutRail', () => {
  it('renders nothing at all before the player has printed anything', () => {
    // A first-time player should not see an empty shelf and wonder what they
    // missed. Null also keeps the layout's left track empty, which is what
    // holds the instructions card dead centre.
    const { container } = render(<MatfPrintoutRail printouts={[]} onReplay={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each sheet by the code printed on it, and by its board', () => {
    render(<MatfPrintoutRail printouts={sheets} onReplay={() => {}} />)
    expect(screen.getByText('ABCDEF')).toBeInTheDocument()
    expect(screen.getByText('123456')).toBeInTheDocument()
    expect(screen.getByText(/Hard · ±17 grid · 5 tables/)).toBeInTheDocument()
    expect(screen.getByText(/Easier · ±8 grid · 3 tables/)).toBeInTheDocument()
  })

  it('says the run will not be ranked BEFORE the player picks a sheet', () => {
    // Not on the results screen. Someone who has just spent three minutes on a
    // speeded test should not find out then that it did not count.
    render(<MatfPrintoutRail printouts={sheets} onReplay={() => {}} />)
    expect(screen.getByText(/not submitted to the leaderboard/i)).toBeInTheDocument()
  })

  it('hands back the whole entry, seed and difficulty together', () => {
    // The seed alone cannot rebuild a run — the grid extent and the sheet shape
    // come from the board. See buildMatfRun.
    const onReplay = vi.fn()
    render(<MatfPrintoutRail printouts={sheets} onReplay={onReplay} />)
    return userEvent.click(screen.getByText('ABCDEF')).then(() => {
      expect(onReplay).toHaveBeenCalledWith(sheets[0])
    })
  })

  it('offers Forget only when there is something to forget it with', () => {
    const onClear = vi.fn()
    const { rerender } = render(<MatfPrintoutRail printouts={sheets} onReplay={() => {}} />)
    expect(screen.queryByText(/forget these sheets/i)).not.toBeInTheDocument()
    rerender(<MatfPrintoutRail printouts={sheets} onReplay={() => {}} onClear={onClear} />)
    expect(screen.getByText(/forget these sheets/i)).toBeInTheDocument()
  })

  it('is a cabinet, but it is not blinking at anyone', () => {
    // The joystick panel blinks because it is answering a question the player
    // is actively asking. This is a shelf of the player's own paper.
    const { container } = render(<MatfPrintoutRail printouts={sheets} onReplay={() => {}} />)
    expect(container.firstChild.className).toContain('cbat-arcade-panel')
    expect(container.firstChild.className).not.toContain('attract')
  })
})
