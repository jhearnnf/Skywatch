import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatPlaneTurn from '../CbatPlaneTurn'

// Trace 1: a wrong arrow press used to show only a ✗, so the player never found
// out which turn the aircraft had actually made. The right key now lights up on
// the controls, on both themes.

const mockUseAuth = vi.hoisted(() => vi.fn())
const theme = vi.hoisted(() => ({ cbat: false }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: {} }) }))
vi.mock('../../hooks/useCbatTheme', () => ({ useCbatTheme: () => theme.cbat }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/PlaneTurn3DScene', () => ({ default: () => null }))
vi.mock('../../components/PlaneModel3D', () => ({ default: () => null }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../lib/offlineRoster', () => ({
  getAircraftRoster: vi.fn(async () => ({ data: [{ briefId: 'demo-hawk', title: 'Hawk T2', cutoutUrl: null }] })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
// Every scheduled turn is a right yaw, so the expected key is known.
vi.mock('../../utils/cbat/trace1Generator', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    buildTrace1Round: (states) => {
      const built = real.buildTrace1Round(states)
      return { ...built, schedules: built.schedules.map(s => s.map(() => 'yawR')) }
    },
  }
})
vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    p:      ({ children, className, style }) => <p className={className} style={style}>{children}</p>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const revealed = () => [...document.querySelectorAll('[data-reveal="true"]')]

async function startAndWaitForFirstTurn() {
  render(<CbatPlaneTurn />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  fireEvent.click(screen.getByRole('button', { name: /^start/i }))
  // 800ms settle, then the first turn after round 1's tick interval.
  await act(async () => { vi.advanceTimersByTime(800 + 1870) })
}

describe('Trace 1 — reveal the right key after a wrong press', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseAuth.mockReturnValue({
      user: { _id: 'u1' },
      API: '',
      apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    localStorage.clear()
    theme.cbat = false
  })

  for (const cbat of [false, true]) {
    const label = cbat ? 'Real CBAT' : 'SkyWatch'

    it(`${label}: lights the correct key after a wrong answer, then clears it`, async () => {
      theme.cbat = cbat
      await startAndWaitForFirstTurn()
      expect(revealed()).toHaveLength(0)

      await act(async () => { fireEvent.keyDown(window, { key: 'ArrowLeft' }) })
      const lit = revealed()
      expect(lit).toHaveLength(1)
      expect(lit[0].getAttribute('aria-label')).toMatch(cbat ? /^Right$/ : /yaw right/i)

      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(revealed()).toHaveLength(0)
    })

    it(`${label}: lights nothing after a right answer`, async () => {
      theme.cbat = cbat
      await startAndWaitForFirstTurn()
      await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }) })
      expect(revealed()).toHaveLength(0)
    })
  }
})
