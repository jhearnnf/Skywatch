import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatInstruments from '../CbatInstruments'
import { ORIENTATION_QUESTIONS, ORIENTATION_OPTIONS } from '../../utils/cbat/instrumentsOrientation'

// The Instruments tile holds two boards, Reading and Orientation, picked in
// the one mode row under the title (the Visualisation 2D/3D arrangement).
// Pinned here: the row's placement, that flipping it follows the leaderboard
// link and the personal best, and that an Orientation run files under
// `instruments-orientation` and never under Reading's key.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSettings = vi.hoisted(() => vi.fn())
const mockSubmit = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))
const mockStart = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useSearchParams: () => [new URLSearchParams('')],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => mockSettings() }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-testid="game-over" data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmit }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: mockStart, setRound: vi.fn(), markCompleted: vi.fn() }),
}))
// The SkyWatch theme's pictures are WebGL canvases; jsdom has none.
vi.mock('../../components/cbat/OrientationAircraft3D', () => ({
  default: ({ attitude }) => <div data-testid="typhoon" data-heading={attitude.heading} />,
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, 'data-testid': testId }) => <div className={className} data-testid={testId}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => (
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>
    ),
    p: ({ children, className }) => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage(props = {}) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) })),
  })
  return render(<CbatInstruments {...props} />)
}

const modeButton = (container, key) => container.querySelector(`[data-mode="${key}"]`)
const title = container => [...container.querySelectorAll('p')].find(p => p.textContent === 'Instruments')
const leaderboardLink = () => screen.getByText(/View Leaderboard/).closest('a')

describe('CbatInstruments mode row', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: {} } })
  })

  it('offers Reading and Orientation under the title, with the blurb below', () => {
    const { container } = renderPage()
    const reading = modeButton(container, 'reading')
    const orientation = modeButton(container, 'orientation')
    expect(reading).toBeTruthy()
    expect(orientation).toBeTruthy()
    // Title first, then the row, then the blurb.
    const t = title(container)
    expect(t.compareDocumentPosition(reading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(reading.compareDocumentPosition(orientation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Neither is a difficulty of the other, so neither carries bars.
    expect(container.querySelector('[data-mode] span[aria-hidden="true"]')).toBeNull()
  })

  it('opens on Reading, on the original board', () => {
    const { container } = renderPage()
    expect(modeButton(container, 'reading').getAttribute('aria-pressed')).toBe('true')
    expect(leaderboardLink().getAttribute('href')).toBe('/cbat/instruments/leaderboard')
  })

  it('flipping to Orientation follows the leaderboard link and the personal best label', () => {
    const { container } = renderPage()
    fireEvent.click(modeButton(container, 'orientation'))
    expect(modeButton(container, 'orientation').getAttribute('aria-pressed')).toBe('true')
    expect(leaderboardLink().getAttribute('href')).toBe('/cbat/instruments-orientation/leaderboard')
    expect(screen.getByText(/Personal Best · Orientation/)).toBeTruthy()
    // Remembered for next time.
    expect(localStorage.getItem('cbat:instruments:mode')).toBe('orientation')
  })

  it('remembers the last board across mounts', () => {
    localStorage.setItem('cbat:instruments:mode', 'orientation')
    const { container } = renderPage()
    expect(modeButton(container, 'orientation').getAttribute('aria-pressed')).toBe('true')
  })

  it('pins the board when forcedMode is given (the landing page demo)', () => {
    localStorage.setItem('cbat:instruments:mode', 'orientation')
    const { container } = renderPage({ forcedMode: 'reading' })
    expect(modeButton(container, 'reading').getAttribute('aria-pressed')).toBe('true')
  })

  it('hides a board an admin has switched off and shows the other', () => {
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: { 'instruments-orientation': false } } })
    localStorage.setItem('cbat:instruments:mode', 'orientation')
    const { container } = renderPage()
    // One board left: no row, and the page reads as Reading.
    expect(modeButton(container, 'orientation')).toBeNull()
    expect(leaderboardLink().getAttribute('href')).toBe('/cbat/instruments/leaderboard')
  })
})

describe('CbatInstruments orientation run', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: {} } })
  })

  it('plays ten picture questions and files the run under instruments-orientation', async () => {
    vi.useFakeTimers()
    try {
      const { container } = renderPage()
      fireEvent.click(modeButton(container, 'orientation'))
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

      expect(mockStart).toHaveBeenCalledWith('instruments-orientation')
      expect(screen.getByTestId('orientation-run')).toBeTruthy()
      expect(screen.getByTestId('orientation-attitude')).toBeTruthy()
      expect(screen.getByTestId('orientation-compass')).toBeTruthy()
      expect(container.querySelectorAll('[data-option]')).toHaveLength(ORIENTATION_OPTIONS)

      for (let q = 0; q < ORIENTATION_QUESTIONS; q++) {
        // The instruments name the answer through the pictures' data attributes.
        const att = screen.getByTestId('orientation-attitude')
        const compass = screen.getByTestId('orientation-compass')
        const pics = [...container.querySelectorAll('[data-testid="orientation-aircraft"]')]
        const correct = pics.findIndex(p =>
          p.dataset.heading === compass.dataset.heading &&
          p.dataset.pitch === att.dataset.pitch &&
          p.dataset.bank === att.dataset.bank)
        expect(correct).toBeGreaterThanOrEqual(0)
        // Answer wrong on the odd questions so the score is provable.
        const pick = q % 2 === 0 ? correct : (correct + 1) % ORIENTATION_OPTIONS
        fireEvent.click(container.querySelector(`[data-option="${pick}"]`))
        // The answer stays up until Next; the last one offers the results.
        const next = screen.getByTestId('orientation-next')
        expect(next.textContent).toBe(q === ORIENTATION_QUESTIONS - 1 ? 'See results' : 'Next')
        expect(screen.getByTestId('orientation-feedback').textContent)
          .toMatch(q % 2 === 0 ? /Correct/ : /Wrong/)
        await act(async () => { vi.advanceTimersByTime(3000) })
        expect(screen.getByTestId('orientation-next')).toBeTruthy()
        fireEvent.click(next)
      }

      expect(screen.getByTestId('game-over').dataset.gameKey).toBe('instruments-orientation')
      expect(mockSubmit).toHaveBeenCalledTimes(1)
      const [key, payload] = mockSubmit.mock.calls[0]
      expect(key).toBe('instruments-orientation')
      expect(payload.correctCount).toBe(5)
      expect(payload.roundsPlayed).toBe(ORIENTATION_QUESTIONS)
      expect(payload.grade).toBe('Needs Work')
      expect(screen.getByText('Instrument Orientation Complete')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends the run at the clock and files whatever was answered', async () => {
    vi.useFakeTimers()
    try {
      const { container } = renderPage()
      fireEvent.click(modeButton(container, 'orientation'))
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
      fireEvent.click(container.querySelector('[data-option="0"]'))
      fireEvent.click(screen.getByTestId('orientation-next'))
      await act(async () => { vi.advanceTimersByTime(121_000) })
      expect(screen.getByTestId('game-over').dataset.gameKey).toBe('instruments-orientation')
      const [, payload] = mockSubmit.mock.calls[0]
      expect(payload.roundsPlayed).toBe(1)
      expect(payload.totalTime).toBe(120)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the clock while the answer is on screen', async () => {
    vi.useFakeTimers()
    try {
      const { container } = renderPage()
      fireEvent.click(modeButton(container, 'orientation'))
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
      await act(async () => { vi.advanceTimersByTime(10_000) })
      fireEvent.click(container.querySelector('[data-option="0"]'))
      // Sit on the feedback for longer than the whole clock: no timeout.
      await act(async () => { vi.advanceTimersByTime(200_000) })
      expect(container.querySelector('[data-testid="game-over"]')).toBeNull()
      expect(screen.getByTestId('orientation-next')).toBeTruthy()
      // Enter moves on, and the clock resumes from where it stopped.
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(screen.queryByTestId('orientation-next')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(105_000) })
      expect(container.querySelector('[data-testid="game-over"]')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(6_000) })
      expect(screen.getByTestId('game-over')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the Reading run on the original key', async () => {
    const { container } = renderPage()
    expect(modeButton(container, 'reading').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    expect(mockStart).toHaveBeenCalledWith('instruments')
    await waitFor(() => expect(container.querySelector('[data-testid="orientation-run"]')).toBeNull())
  })
})
