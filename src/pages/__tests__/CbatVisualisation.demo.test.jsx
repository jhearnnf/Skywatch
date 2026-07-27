import { render, act, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatVisualisation from '../CbatVisualisation'
import { press, START_SELECTOR, ANSWER_SELECTOR } from '../../components/landingGames/demoDriver'
import { CbatDemoContext } from '../../utils/cbat/demoMode'

// Answering a round drops the game into feedback, where every answer tile is
// disabled and the only live control is Next Round. Leave that control off the
// driver's map and a demo card locks on round 1 for its whole run — which is
// exactly what the landing page's Visualisation tile was doing.

const mockUseAuth = vi.hoisted(() => vi.fn())
// Mutable so a test can act as though the visitor arrived on a per-mode link.
const search = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  // The page reads ?mode= to honour a per-mode link; a demo tile pins its mode
  // by prop and never consults it.
  useSearchParams: () => [search.params, vi.fn()],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: {} }) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/VisualisationModeSelector', () => ({ default: () => null }))
// Pulls in @react-three/fiber, and 2D rounds never render it.
vi.mock('../../components/cbat/Visualisation3DShape', () => ({
  default: () => null,
  VisualisationShapeCanvas: () => null,
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const roundLabel = (container) => container.querySelector('.font-mono')?.textContent ?? ''

describe('Visualisation 2D — driveable by the demo wall', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // jsdom has no SVG geometry; the assembly animation bails out on a null CTM.
    window.SVGElement.prototype.getScreenCTM = () => null
    mockUseAuth.mockReturnValue({
      user: { _id: 'u1' },
      API: '',
      apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    search.params = new URLSearchParams()
    localStorage.clear()
  })

  it('advances to the next round when the driver keeps pressing', () => {
    const { container } = render(<CbatVisualisation forcedMode="2d" />)
    act(() => { press(container.querySelector(START_SELECTOR)) })
    expect(roundLabel(container)).toContain('1')

    // Answer the round — every tile is disabled from here.
    act(() => { press(container.querySelector(ANSWER_SELECTOR)) })
    const live = [...container.querySelectorAll(ANSWER_SELECTOR)].filter(b => !b.disabled)
    expect(live.map(b => b.textContent)).toEqual(['Next Round'])

    act(() => { press(live[0]) })
    expect(roundLabel(container)).toContain('2')
  })

  // body.cbat-vis2d-locked is `overflow: hidden` + `touch-action: pan-x` under
  // 600px. A tile setting it on the real page left mobile visitors unable to
  // scroll the landing page at all.
  it('does not pin the page it is a tile on', () => {
    const { container } = render(
      <CbatDemoContext.Provider value={{ portalTarget: null }}>
        <CbatVisualisation forcedMode="2d" />
      </CbatDemoContext.Provider>,
    )
    act(() => { press(container.querySelector(START_SELECTOR)) })
    expect(document.body.classList.contains('cbat-vis2d-locked')).toBe(false)
  })

  it('still pins the page for a real player', () => {
    const { container } = render(<CbatVisualisation forcedMode="2d" />)
    act(() => { press(container.querySelector(START_SELECTOR)) })
    expect(document.body.classList.contains('cbat-vis2d-locked')).toBe(true)
  })

  // The landing wall links per mode; this page otherwise opens on whichever
  // mode was played last.
  it('opens the mode the link named', () => {
    search.params = new URLSearchParams('mode=3d')
    render(<CbatVisualisation />)
    expect(screen.getAllByText('Visualisation 3D').length).toBeGreaterThan(0)
  })

  it('falls back to the stored mode when no link named one', () => {
    localStorage.setItem('cbat:visualisation:mode', '3d')
    render(<CbatVisualisation />)
    expect(screen.getAllByText('Visualisation 3D').length).toBeGreaterThan(0)
  })

  it('ignores a mode it does not recognise rather than resetting the stored one', () => {
    localStorage.setItem('cbat:visualisation:mode', '3d')
    search.params = new URLSearchParams('mode=banana')
    render(<CbatVisualisation />)
    expect(screen.getAllByText('Visualisation 3D').length).toBeGreaterThan(0)
  })
})
