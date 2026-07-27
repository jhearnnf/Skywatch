import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LiveGameGrid from '../LiveGameGrid'

// Stub the card so the grid can be tested without mounting ten real games.
vi.mock('../DemoGameCard', () => ({
  default: ({ entry, stage }) => (
    <div data-testid="card" data-id={entry.id} data-heavy={String(!!entry.heavy)} data-stage-w={stage.w} />
  ),
}))
vi.mock('../gameDemoRegistry', () => ({ componentForDemo: () => () => null }))

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))

let settings = { cbatGameEnabled: {} }
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings }),
}))

function setViewport(isMobile) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

const ids = () => screen.getAllByTestId('card').map((el) => el.dataset.id)

describe('LiveGameGrid', () => {
  beforeEach(() => {
    settings = { cbatGameEnabled: {} }
    setViewport(false)
  })

  it('fills a 3×3 wall on desktop with nine distinct games', () => {
    render(<LiveGameGrid />)
    const shown = ids()
    expect(shown).toHaveLength(9)
    expect(new Set(shown).size).toBe(9)
  })

  it('drops to six cards on a phone', () => {
    setViewport(true)
    render(<LiveGameGrid />)
    expect(ids()).toHaveLength(6)
  })

  it('prefers the lighter games on a phone', () => {
    setViewport(true)
    render(<LiveGameGrid />)
    const heavy = screen.getAllByTestId('card').filter((el) => el.dataset.heavy === 'true')
    expect(heavy.length).toBeLessThanOrEqual(2)
  })

  it('gives phones a phone-shaped stage', () => {
    setViewport(true)
    render(<LiveGameGrid />)
    expect(screen.getAllByTestId('card')[0].dataset.stageW).toBe('430')
  })

  it('never shows a game an admin has disabled', () => {
    settings = { cbatGameEnabled: { sat: false, dpt: false } }
    render(<LiveGameGrid />)
    expect(ids()).not.toContain('sat')
    expect(ids()).not.toContain('dpt')
  })

  it('renders nothing when every game is disabled', () => {
    settings = {
      cbatGameEnabled: {
        'trace-2': false, 'plane-turn-3d': false, 'plane-turn-2d': false,
        'visualisation-2d': false, sat: false, cut: false, symbols: false,
        dpt: false, flag: false, target: false, act: false, instruments: false,
      },
    }
    const { container } = render(<LiveGameGrid />)
    expect(container.querySelector('[data-testid="live-game-grid"]')).toBeNull()
  })

  it('keeps the same wall across re-renders', () => {
    const { rerender } = render(<LiveGameGrid />)
    const first = ids()
    rerender(<LiveGameGrid />)
    expect(ids()).toEqual(first)
  })
})
