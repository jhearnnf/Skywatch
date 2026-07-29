import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { CUT_TUNING, DEFAULT_CUT_DIFFICULTY, cutTuning, cutGameKey, readStoredCutDifficulty, storeCutDifficulty } from '../../utils/cbat/cutDifficulty'

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

function setup() {
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
  return apiFetch
}

const startBtn = () => screen.getByRole('button', { name: /^start$/i })

describe('CUT — difficulty tuning', () => {
  it('defaults to easier and sends each difficulty to its own leaderboard', () => {
    expect(DEFAULT_CUT_DIFFICULTY).toBe('easier')
    expect(cutGameKey('easier')).toBe('cut-easier')
    expect(cutGameKey('hard')).toBe('cut')
    expect(cutTuning('nonsense')).toBe(CUT_TUNING.easier)
  })

  // Easier is the same test at a lower load — slower drift on the three systems
  // that wander on their own, and a thinner task/message cadence. Nothing about
  // the tolerances, the scoring or the 180s length changes.
  it('slows only the drift rates and the task cadence', () => {
    const e = CUT_TUNING.easier
    const h = CUT_TUNING.hard

    expect(e.fuelDrainPerSec).toBeLessThan(h.fuelDrainPerSec)
    expect(e.pressRisePerSec).toBeLessThan(h.pressRisePerSec)
    expect(e.pressDropPerSec).toBeLessThan(h.pressDropPerSec)
    expect(e.speedDriftPerSec).toBeLessThan(h.speedDriftPerSec)

    // Every one of these announces itself in Message, so longer gaps = fewer
    // messages, which is the other half of what Easier means.
    for (const key of ['speedChangeMs', 'cameraFirstMs', 'cameraNextMs', 'loadGapMs', 'codeGapMs']) {
      expect(e[key][0]).toBeGreaterThan(h[key][0])
      expect(e[key][1]).toBeGreaterThan(h[key][1])
    }
    expect(e.firstLoadMs).toBeGreaterThan(h.firstLoadMs)
    expect(e.firstCodeMs).toBeGreaterThan(h.firstCodeMs)
  })

  it('carries no knobs beyond drift, cadence and the derived grade bands', () => {
    const allowed = [
      'key', 'label', 'gameKey', 'bars', 'blurb',
      'fuelDrainPerSec', 'speedDriftPerSec', 'pressRisePerSec', 'pressDropPerSec',
      'speedChangeMs', 'cameraFirstMs', 'cameraNextMs', 'loadGapMs',
      'firstLoadMs', 'firstCodeMs', 'codeGapMs', 'grades',
    ]
    for (const t of [CUT_TUNING.easier, CUT_TUNING.hard]) {
      expect(Object.keys(t).sort()).toEqual([...allowed].sort())
    }
  })

  it('hard keeps the original constants (unchanged for existing scores)', () => {
    expect(CUT_TUNING.hard).toMatchObject({
      fuelDrainPerSec: 4.5, speedDriftPerSec: 0.5,
      pressRisePerSec: 0.7, pressDropPerSec: 0.5,
      grades: { outstanding: 1100, good: 700, needsWork: 350 },
    })
  })

  describe('persistence', () => {
    beforeEach(() => localStorage.clear())

    it('falls back to the default when nothing is stored', () => {
      expect(readStoredCutDifficulty()).toBe('easier')
    })

    it('round-trips the most recent choice and rejects a stale one', () => {
      storeCutDifficulty('hard')
      expect(readStoredCutDifficulty()).toBe('hard')
      storeCutDifficulty('impossible')
      expect(readStoredCutDifficulty()).toBe('easier')
    })
  })
})

describe('CUT — difficulty selection on the instructions card', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
  afterEach(() => vi.useRealTimers())

  it('opens on Easier with it marked as selected', () => {
    setup()
    render(<CbatCut />)
    expect(screen.getByRole('button', { name: /easier/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('switching to Hard repoints the leaderboard link and is remembered', () => {
    setup()
    const { unmount } = render(<CbatCut />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))

    expect(screen.getByRole('link', { name: /view leaderboard/i }).getAttribute('href')).toBe('/cbat/cut/leaderboard')

    unmount()
    render(<CbatCut />)
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reads the personal best from the selected difficulty board', async () => {
    const apiFetch = setup()
    render(<CbatCut />)
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.includes('/cbat/cut-easier/personal-best'))).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.endsWith('/cbat/cut/personal-best'))).toBe(true)
    })
  })

  it('flashes the selected difficulty for 1s before the game starts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatCut />)
    fireEvent.click(startBtn())

    // Still on the instructions card: chosen button flashing, the other greyed.
    expect(screen.queryByText('Warning')).toBeNull()
    expect(screen.getByRole('button', { name: /easier/i }).className).toContain('cbat-launch-flash')
    expect(screen.getByRole('button', { name: /hard/i }).className).toContain('cbat-launch-dim')

    await act(async () => { vi.advanceTimersByTime(900) })
    expect(screen.queryByText('Warning')).toBeNull()

    await act(async () => { vi.advanceTimersByTime(200) })
    expect(screen.getByText('Warning')).toBeDefined()
  })

  it('names the difficulty in play beside the page title', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatCut />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    fireEvent.click(startBtn())
    await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })

    const marker = document.querySelector('[data-difficulty-marker]')
    expect(marker.getAttribute('data-difficulty-marker')).toBe('hard')
    expect(marker.textContent).toContain('Hard')
  })

  it('submits a finished run to the board it was played on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { submitCbatResult } = await import('../../lib/cbatOutbox')
    setup()
    render(<CbatCut />)
    fireEvent.click(startBtn())
    await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })
    // Run the full 180s.
    await act(async () => { vi.advanceTimersByTime(181_000) })

    await waitFor(() => expect(submitCbatResult).toHaveBeenCalled())
    expect(submitCbatResult.mock.calls[0][0]).toBe('cut-easier')
  })
})
