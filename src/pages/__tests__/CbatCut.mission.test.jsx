import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'

// The Mission drop is the memory-updating task: Message announces "drop Station N
// at HH:MM:SS" and nothing else ever repeats it. A readiness cue on the panel
// itself — filling lights, a button that lit up when the window opened — turned
// that into a reaction task you could pass without reading Message at all. The
// panel must stay visually identical either side of the scheduled time.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const LAUNCH_MS = 1000

// Start a run at `difficulty` with the first display showing Mission.
async function missionPanel(difficulty) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' }, API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) })),
  })
  render(<CbatCut />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${difficulty}$`, 'i') }))
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })
  // Both display stacks carry the index; put the first one on Mission.
  fireEvent.click(screen.getAllByRole('button', { name: 'Mission' })[0])
}

const stationButtons = () =>
  screen.getAllByRole('button', { name: /^Station \d$/ }).map(b => b.className)

// The Mission panel body — scoped so the Engine/System gauges on the other
// display stack (which are legitimately green) don't answer for it.
const missionBody = () => screen.getByText(/^Release the/).closest('div')

describe.each(['Easier', 'Hard'])('CUT Mission panel — %s', (difficulty) => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => vi.useRealTimers())

  it('shows no dispenser lights in the lead-in to a drop', async () => {
    await missionPanel(difficulty)
    const firstLoadMs = CUT_TUNING[difficulty.toLowerCase()].firstLoadMs

    // Well inside the old 9s fill window, when the lights used to be filling.
    await act(async () => { vi.advanceTimersByTime(firstLoadMs - 4_000) })

    // The panel holds its blurb and the three stations, and nothing else.
    const body = missionBody()
    expect(body.querySelectorAll('[style*="rgb(34, 197, 94)"]')).toHaveLength(0)
    expect(body.querySelectorAll('span')).toHaveLength(0)
  })

  it('leaves the station buttons unchanged when the release window opens', async () => {
    await missionPanel(difficulty)
    const firstLoadMs = CUT_TUNING[difficulty.toLowerCase()].firstLoadMs

    await act(async () => { vi.advanceTimersByTime(firstLoadMs - 2_000) })
    const before = stationButtons()
    expect(before).toHaveLength(3)

    // Past the scheduled drop time — the window is open and the release scores.
    await act(async () => { vi.advanceTimersByTime(3_000) })

    expect(stationButtons()).toEqual(before)
    expect(before.some(c => c.includes('cbat-btn-flash'))).toBe(false)
  })
})
