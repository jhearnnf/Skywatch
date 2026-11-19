import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatDAD from '../CbatDAD'
import { submitCbatResult } from '../../lib/cbatOutbox'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockTheme = vi.hoisted(() => ({ cbat: false }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../hooks/useCbatTheme', () => ({
  useCbatTheme: () => mockTheme.cbat,
  default: () => mockTheme.cbat,
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))

function setup() {
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
  return apiFetch
}

const startBtn = () => screen.getByRole('button', { name: /^start$/i })
const routeText = () => screen.getByText('The Route').nextSibling.textContent

describe('DAD — difficulty selection on the instructions card', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mockTheme.cbat = false })
  afterEach(() => vi.useRealTimers())

  it('puts the Easier/Hard row under the title, Easier selected by default', () => {
    setup()
    render(<CbatDAD />)
    const title = screen.getAllByText('Directions & Distances').find(el => el.tagName === 'P')
    const easier = screen.getByRole('button', { name: /easier/i })
    expect(title.compareDocumentPosition(easier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(easier.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('points the leaderboard link and personal best at the selected board', async () => {
    const apiFetch = setup()
    render(<CbatDAD />)
    expect(screen.getByRole('link', { name: /view leaderboard/i }).getAttribute('href'))
      .toBe('/cbat/dad/leaderboard')
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.endsWith('/cbat/dad/personal-best'))).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    expect(screen.getByRole('link', { name: /view leaderboard/i }).getAttribute('href'))
      .toBe('/cbat/dad-hard/leaderboard')
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.endsWith('/cbat/dad-hard/personal-best'))).toBe(true)
    })
  })

  it('opens on Hard when the link says so (how the Mock Assessment sends players)', () => {
    setup()
    localStorage.setItem('sw_cbat_dad_difficulty', 'easier')
    window.history.pushState({}, '', '/cbat/dad?difficulty=hard')
    try {
      render(<CbatDAD />)
      expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('true')
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('remembers the last difficulty picked', () => {
    setup()
    const { unmount } = render(<CbatDAD />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    unmount()
    render(<CbatDAD />)
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('flashes the chosen difficulty for 1s, then plays an Easier route', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatDAD />)
    fireEvent.click(startBtn())
    expect(screen.queryByText('The Route')).toBeNull()
    expect(screen.getByRole('button', { name: /easier/i }).className).toContain('cbat-launch-flash')

    await act(async () => { vi.advanceTimersByTime(1100) })
    // Q1 on Easier SkyWatch is a two-leg, cardinal-only route.
    expect(routeText()).not.toMatch(/45°|north-east|north-west|south-east|south-west/)
    expect(routeText().match(/turns (left|right)/g) ?? []).toHaveLength(1)
  })

  it('submits a finished Hard run to the Hard board, untagged', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockTheme.cbat = true // no reveal step between questions
    setup()
    render(<CbatDAD />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    fireEvent.click(startBtn())
    await act(async () => { vi.advanceTimersByTime(1100) })
    for (let i = 0; i < 15; i++) {
      await act(async () => { vi.advanceTimersByTime(45_200) })
    }
    expect(submitCbatResult).toHaveBeenCalledTimes(1)
    expect(submitCbatResult.mock.calls[0][0]).toBe('dad-hard')
    expect(submitCbatResult.mock.calls[0][1].difficulty).toBeUndefined()
  })

  it('tags a finished Easier run so the report can tell it from an old Hard run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockTheme.cbat = true
    setup()
    render(<CbatDAD />)
    fireEvent.click(startBtn())
    await act(async () => { vi.advanceTimersByTime(1100) })
    for (let i = 0; i < 15; i++) {
      await act(async () => { vi.advanceTimersByTime(45_200) })
    }
    expect(submitCbatResult.mock.calls[0][0]).toBe('dad')
    expect(submitCbatResult.mock.calls[0][1].difficulty).toBe('easier')
  })
})
