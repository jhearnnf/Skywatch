import { render, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatPlaneTurn from '../CbatPlaneTurn'

// /cbat/trace hosts four modes and opens on whichever was played last, with
// Trace 1 as the first-visit default. The landing wall has a tile per mode, so
// without ?mode= a visitor tapping "Trace Practise 3D" landed in Trace 1.

const mockUseAuth = vi.hoisted(() => vi.fn())
const search = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useSearchParams: () => [search.params, vi.fn()],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: {} }) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/SkywatchLogoIntro', () => ({ default: () => null }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../lib/offlineRoster', () => ({
  getAircraftRoster: vi.fn(async () => ({
    data: [
      { briefId: 'demo-typhoon', title: 'Eurofighter Typhoon FGR4', cutoutUrl: null },
      // Trace 1 filters the roster down to this one, which is the whole reason
      // it no longer asks you to choose.
      { briefId: 'demo-hawk', title: 'Hawk T2', cutoutUrl: null },
    ],
  })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const heading = () => document.querySelector('h1')?.textContent ?? ''

describe('Trace — per-mode links', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { _id: 'u1' },
      API: '',
      apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    })
  })
  afterEach(() => {
    vi.clearAllMocks()
    search.params = new URLSearchParams()
    localStorage.clear()
  })

  it('opens Trace 1 by default, as a first-time visitor gets', () => {
    render(<CbatPlaneTurn />)
    expect(heading()).toBe('Trace 1')
  })

  it('opens Practise 3D when the link named it', async () => {
    search.params = new URLSearchParams('mode=3d')
    render(<CbatPlaneTurn />)
    await waitFor(() => expect(heading()).toBe('Trace Practise 3D'))
  })

  it('opens Practise 2D when the link named it', async () => {
    search.params = new URLSearchParams('mode=2d')
    render(<CbatPlaneTurn />)
    await waitFor(() => expect(heading()).toBe('Trace Practise 2D'))
  })

  it('remembers the mode a link chose, the same as picking it by hand', async () => {
    search.params = new URLSearchParams('mode=3d')
    const { unmount } = render(<CbatPlaneTurn />)
    await waitFor(() => expect(heading()).toBe('Trace Practise 3D'))
    unmount()

    search.params = new URLSearchParams()
    render(<CbatPlaneTurn />)
    expect(heading()).toBe('Trace Practise 3D')
  })

  it('leaves a stored mode alone when the link names nonsense', () => {
    localStorage.setItem('cbat:trace:mode', '2d')
    search.params = new URLSearchParams('mode=banana')
    render(<CbatPlaneTurn />)
    expect(heading()).toBe('Trace Practise 2D')
  })

  it('ignores ?mode= entirely when the mode is pinned by prop (a demo tile)', () => {
    search.params = new URLSearchParams('mode=trace1')
    render(<CbatPlaneTurn forcedMode="2d" />)
    expect(heading()).toBe('Trace Practise 2D')
    // and the visitor's own stored preference is untouched
    expect(localStorage.getItem('cbat:trace:mode')).toBeNull()
  })
})

// Trace 1 flies the Hawk T2 and nothing else. It used to render a one-aircraft
// grid under a "Choose Your Aircraft" heading, which asked the player to make a
// decision that had exactly one answer. It now starts like Trace 2 does.
describe('Trace 1 does not ask you to pick an aircraft', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { _id: 'u1' },
      API: '',
      apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    })
  })
  afterEach(() => {
    vi.clearAllMocks()
    search.params = new URLSearchParams()
    localStorage.clear()
  })

  it('offers one Start button and no aircraft grid', async () => {
    const { container } = render(<CbatPlaneTurn />)
    expect(heading()).toBe('Trace 1')

    await waitFor(() => {
      expect(container.querySelector('[data-demo-start]')).toBeTruthy()
    })
    const starts = container.querySelectorAll('[data-demo-start]')
    expect(starts).toHaveLength(1)
    expect(starts[0].textContent).toBe('Start')
    expect(container.textContent).not.toContain('Choose Your Aircraft')
  })

  it('still lets the practice modes choose, where there is a real choice', async () => {
    search.params = new URLSearchParams('mode=2d')
    const { container } = render(<CbatPlaneTurn />)

    await waitFor(() => {
      expect(container.textContent).toContain('Choose Your Aircraft')
    })
    // One card per aircraft on the roster, not a single Start button.
    expect(container.querySelectorAll('img').length).toBeGreaterThan(1)
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Start')).toBe(false)
  })
})
