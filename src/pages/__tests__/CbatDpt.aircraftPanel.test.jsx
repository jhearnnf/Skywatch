import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatDpt from '../CbatDpt'

// DPT's aircraft are picked in a panel of their own beside the instructions
// (styled like ACT's joystick cabinet), with Random first and selected by
// default, and the card has a Start button. Picking an aircraft used to start
// the run, so there was no Start button and no way to say "any aircraft".

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../components/DptAircraftLayer', () => ({ default: () => null }))
vi.mock('@react-three/drei', () => ({ useGLTF: { preload: vi.fn() } }))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../lib/offlineRoster', () => ({
  getAircraftRoster: vi.fn((kind) => Promise.resolve({ data: kind === 'aircraft-cutouts' ? [
    { briefId: 'b1', title: 'Hawk T2', cutoutUrl: '/h.png' },
    { briefId: 'b2', title: 'Typhoon', cutoutUrl: '/t.png' },
  ] : [] })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../utils/cbat/useAdminRoundParam', () => ({ useAdminRoundParam: vi.fn() }))
vi.mock('../../hooks/useGameBodyClass', () => ({ useGameBodyClass: vi.fn() }))
vi.mock('../../data/aircraftModels', () => ({
  has3DModel: () => true,
  getModelUrl: () => '/models/x.glb',
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick }) => (
      <button className={className} onClick={onClick}>{children}</button>
    ),
    g: ({ children }) => <g>{children}</g>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatDpt />)
}

describe('CbatDpt aircraft panel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('offers Random first, picked by default', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-dpt-aircraft="b1"]')).toBeTruthy())
    // One panel per layout (the column from lg up, the card below it).
    const panel = container.querySelector('[data-dpt-aircraft-panel]')
    const tiles = [...panel.querySelectorAll('[data-dpt-aircraft]')]
    expect(tiles.map(t => t.dataset.dptAircraft)).toEqual(['random', 'b1', 'b2'])
    expect(tiles[0].getAttribute('aria-pressed')).toBe('true')
    expect(tiles[1].getAttribute('aria-pressed')).toBe('false')
  })

  it('picking an aircraft selects it without starting the run', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-dpt-aircraft="b1"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-dpt-aircraft="b2"]'))
    for (const tile of container.querySelectorAll('[data-dpt-aircraft="b2"]')) {
      expect(tile.getAttribute('aria-pressed')).toBe('true')
    }
    expect(screen.getByText('Dynamic Projection Test')).toBeTruthy()
  })

  it('has a Start button, the one control the demos press to begin', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-dpt-aircraft="b1"]')).toBeTruthy())
    const starts = container.querySelectorAll('[data-demo-start]')
    expect(starts).toHaveLength(1)
    expect(starts[0].textContent).toBe('Start')
    expect(starts[0].disabled).toBe(false)
  })
})
