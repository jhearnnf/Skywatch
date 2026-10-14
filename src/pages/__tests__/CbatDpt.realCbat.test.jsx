import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatDpt from '../CbatDpt'

// DPT under the Real CBAT theme draws the real test screen: no aircraft to
// pick, radar symbols instead of 3D models, the key down the left and the
// black strip with the heading and height boxes along the bottom.

const mockUseAuth = vi.hoisted(() => vi.fn())
const env = vi.hoisted(() => ({ realCbat: true }))
const layer = vi.hoisted(() => vi.fn(() => null))
const submit = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../hooks/useCbatTheme', () => ({
  useCbatTheme: () => env.realCbat,
  default: () => env.realCbat,
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../components/DptAircraftLayer', () => ({ default: layer }))
vi.mock('@react-three/drei', () => ({ useGLTF: { preload: vi.fn() } }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: submit }))
vi.mock('../../lib/offlineRoster', () => ({
  // An empty roster: a Real CBAT run must still start.
  getAircraftRoster: vi.fn(() => Promise.resolve({ data: [] })),
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

async function start(container) {
  const btn = container.querySelector('[data-demo-start]')
  await waitFor(() => expect(btn.disabled).toBe(false))
  await act(async () => { fireEvent.click(btn) })
}

const key = (k) => fireEvent.keyDown(window, { key: k })

describe('CbatDpt under the Real CBAT theme', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    env.realCbat = true
  })

  it('has no aircraft to pick, and Start works with no roster', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-demo-start]')).toBeTruthy())
    expect(container.querySelector('[data-dpt-aircraft-panel]')).toBeNull()
    await start(container)
    expect(container.querySelector('[data-dpt-cbat-stage]')).toBeTruthy()
  })

  it('draws the radar, the key and the strip, and no 3D models', async () => {
    const { container } = renderPage()
    await start(container)
    expect(container.querySelector('[data-dpt-cbat-radar]')).toBeTruthy()
    expect(container.querySelector('[data-dpt-cbat-legend]')).toBeTruthy()
    expect(container.querySelector('[data-dpt-cbat-strip]').textContent).toContain('Round 1 of 4')
    expect(container.querySelector('[data-dpt-cbat-aircraft="CA-A"]')).toBeTruthy()
    expect(layer).not.toHaveBeenCalled()
    // The run's own score is not on screen: the real test shows none.
    expect(container.textContent).not.toMatch(/SCORE/)
  })

  it('types a bearing into the heading box and projects it green', async () => {
    const { container } = renderPage()
    await start(container)
    const strip = () => container.querySelector('[data-dpt-cbat-strip]')
    key('ArrowLeft')
    expect(strip().querySelector('[data-dpt-cbat-turn]').dataset.dptCbatTurn).toBe('L')
    key('0'); key('9')
    const digits = [...strip().querySelectorAll('.dpt-cbat-field.is-active b')].map(b => b.textContent)
    expect(digits).toEqual(['0', '9', ''])
    key('0')
    await waitFor(() => expect(container.querySelector('[data-dpt-cbat-projection="command"]')).toBeTruthy())
    expect(container.querySelector('[data-dpt-cbat-projection="command"]').textContent).toBe('090')
  })

  it('switches to the height box on the down arrow', async () => {
    const { container } = renderPage()
    await start(container)
    key('ArrowDown')
    const active = container.querySelector('[data-dpt-cbat-strip] .dpt-cbat-field.is-active')
    expect(active.textContent).toContain('↑')
  })

  it('stays SkyWatch under the default theme', async () => {
    env.realCbat = false
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-dpt-aircraft-panel]')).toBeTruthy())
    expect(container.querySelector('[data-dpt-cbat-stage]')).toBeNull()
  })
})
