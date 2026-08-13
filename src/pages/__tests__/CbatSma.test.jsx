import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatSma from '../CbatSma'
import { press } from '../../components/landingGames/demoDriver'
import { submitCbatResult } from '../../lib/cbatOutbox'
import { SMA_TUNING, SMA_LAUNCH_MS } from '../../utils/cbat/smaDifficulty'
import { LEAD_IN_MS, maxSmaScore } from '../../utils/cbat/smaSim'

// Page-level wiring for SMA. Two things are worth pinning here that the sim and
// input unit tests cannot reach: that a run only ever reaches the board
// belonging to the difficulty it was actually played at, and that the touch pad
// is rendered for a finger to steer from — the pad is the whole of touch
// support, and a page that quietly stopped rendering it would leave phones
// unable to play at all while every other test still passed.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey, score }) => <div data-game-key={gameKey} data-score={score}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatSma />)
}

const difficultyButton = (container, key) => container.querySelector(`[data-difficulty="${key}"]`)

// jsdom never fires rAF on its own, so a run is driven by hand: enter the game,
// then feed frames until the sim says it is finished.
function beginRun(container, difficulty) {
  if (difficulty) act(() => { press(difficultyButton(container, difficulty)) })
  act(() => { press(screen.getByText('Start')) })
  act(() => { vi.advanceTimersByTime(SMA_LAUNCH_MS) })
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // A stationary pointer that never entered the arena, so the control sits
  // centred and a driven run scores whatever the drift leaves it with.
  navigator.getGamepads = () => []
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  delete navigator.getGamepads
})

describe('SMA — difficulty wiring', () => {
  it('opens on Easier with both difficulties offered', () => {
    const { container } = renderPage()
    expect(difficultyButton(container, 'easier').getAttribute('aria-pressed')).toBe('true')
    expect(difficultyButton(container, 'hard').getAttribute('aria-pressed')).toBe('false')
  })

  it('points the leaderboard link at the selected difficulty\'s board', () => {
    const { container } = renderPage()
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe('/cbat/sma-easier/leaderboard')

    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe('/cbat/sma/leaderboard')
  })

  it('remembers the last difficulty chosen', () => {
    const { container, unmount } = renderPage()
    act(() => { press(difficultyButton(container, 'hard')) })
    unmount()

    const second = renderPage()
    expect(difficultyButton(second.container, 'hard').getAttribute('aria-pressed')).toBe('true')
  })

  // Arriving from the Aptitude Report, which scores Hard runs and nothing else.
  // The card has to open on Hard or the report's advice quietly fails: the
  // player follows the link, plays the remembered Easier, and the score they
  // clicked to raise does not move.
  it('opens on Hard when the link asked for it', () => {
    const original = window.location.href
    window.history.replaceState({}, '', '/cbat/sma?difficulty=hard')
    try {
      const { container } = renderPage()
      expect(difficultyButton(container, 'hard').getAttribute('aria-pressed')).toBe('true')
      expect(difficultyButton(container, 'easier').getAttribute('aria-pressed')).toBe('false')
      // A link is not a preference. Leaving without pressing anything must leave
      // the remembered choice as it was.
      expect(localStorage.getItem('sw_cbat_sma_difficulty')).toBeNull()
    } finally {
      window.history.replaceState({}, '', original)
    }
  })

  it('puts the difficulty pair BELOW the title, where every other split game has it', () => {
    const { container } = renderPage()
    const title = container.querySelector('.text-xl.font-extrabold')
    expect(title.textContent).toBe('Sensory Motor Apparatus Test')
    const pair = difficultyButton(container, 'easier')
    expect(title.compareDocumentPosition(pair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('states the run length of whichever difficulty is selected', () => {
    // Scoped to the timing line — "30 seconds" also appears in the Easier
    // blurb, which is deliberate (the run length is now the headline difference
    // between the two) but makes a bare duration match ambiguous.
    const timingLine = (t) => new RegExp(`${t.durationMs / 1000} seconds, after`)
    const { container } = renderPage()
    expect(screen.getByText(timingLine(SMA_TUNING.easier))).toBeTruthy()
    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(timingLine(SMA_TUNING.hard))).toBeTruthy()
  })

  it('puts the run length in each difficulty blurb', () => {
    // The blurb is what a player reads before choosing, and length is now the
    // first thing that differs between the two.
    for (const t of Object.values(SMA_TUNING)) {
      expect([t.key, t.blurb.includes(`${t.durationMs / 1000} second`)]).toEqual([t.key, true])
    }
  })

  it('names the perfect score for the difficulty on screen', () => {
    const { container } = renderPage()
    expect(screen.getByText(new RegExp(`perfect run is ${maxSmaScore(SMA_TUNING.easier)}`))).toBeTruthy()
    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(new RegExp(`perfect run is ${maxSmaScore(SMA_TUNING.hard)}`))).toBeTruthy()
  })
})

describe('SMA — the controls a player actually has', () => {
  it('renders the touch pad during a run', () => {
    // The pad is the whole of touch support. It is CSS-hidden on fine-pointer
    // devices (see .sma-pad in main.css) rather than conditionally rendered, so
    // it must be in the tree on every device.
    const { container } = renderPage()
    expect(container.querySelector('[data-testid="sma-pad"]')).toBeNull()
    beginRun(container)
    expect(container.querySelector('[data-testid="sma-pad"]')).toBeTruthy()
  })

  it('renders the face, the tolerance ring and the dot', () => {
    const { container } = renderPage()
    beginRun(container)
    expect(container.querySelector('[data-testid="sma-face"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="sma-dot"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="sma-ring"]')).toBeTruthy()
  })

  it('draws the Easier ring wider than the Hard one', () => {
    // The ring is the difference between the two boards — it is why they cannot
    // share a scale — so a player should be able to see which one they picked.
    const easier = renderPage()
    beginRun(easier.container)
    const easierWidth = easier.container.querySelector('[data-testid="sma-ring"]').style.width
    easier.unmount()

    const hard = renderPage()
    beginRun(hard.container, 'hard')
    const hardWidth = hard.container.querySelector('[data-testid="sma-ring"]').style.width

    expect(parseFloat(easierWidth)).toBeGreaterThan(parseFloat(hardWidth))
    expect(parseFloat(hardWidth)).toBeCloseTo(SMA_TUNING.hard.ringRadius * 200, 6)
  })

  it('accepts a pad gesture without throwing', () => {
    // The pad's handlers reach into the live input layer, which only exists
    // while a run is on screen — a stale ref here would crash the page on the
    // first touch of the first mobile run.
    const { container } = renderPage()
    beginRun(container)
    const pad = container.querySelector('[data-testid="sma-pad"]')
    pad.setPointerCapture = () => {}
    pad.releasePointerCapture = () => {}
    pad.getBoundingClientRect = () => ({ left: 0, top: 500, width: 300, height: 160, right: 300, bottom: 660 })

    expect(() => {
      fireEvent.pointerDown(pad, { pointerId: 1, clientX: 150, clientY: 580 })
      fireEvent.pointerMove(pad, { pointerId: 1, clientX: 220, clientY: 610 })
      fireEvent.pointerUp(pad, { pointerId: 1 })
    }).not.toThrow()
  })
})

describe('SMA — submitting a run', () => {
  // Drives the frame loop by hand. rAF is stubbed to a queue the test drains,
  // which is the only way to run 100 seconds of simulation in a unit test.
  function driveToFinish() {
    let frame = null
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frame = cb; return 1 })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    return {
      restore: () => raf.mockRestore(),
      run(totalMs, stepMs = 100) {
        for (let t = 0; t <= totalMs && frame; t += stepMs) {
          const cb = frame
          frame = null
          act(() => cb(t))
        }
      },
    }
  }

  it.each([
    ['easier', 'sma-easier'],
    ['hard', 'sma'],
  ])('sends a %s run to the %s board and nowhere else', (difficulty, gameKey) => {
    const driver = driveToFinish()
    try {
      const { container } = renderPage()
      beginRun(container, difficulty === 'easier' ? null : difficulty)
      driver.run(LEAD_IN_MS + SMA_TUNING[difficulty].durationMs + 500)

      expect(submitCbatResult).toHaveBeenCalledTimes(1)
      const [sentKey, payload] = submitCbatResult.mock.calls[0]
      expect(sentKey).toBe(gameKey)
      // Everything the model stores, and nothing left undefined — a missing
      // percentage would save as null and quietly break the results screen.
      for (const field of ['totalScore', 'onTargetPct', 'rmsErrorPct', 'worstErrorPct', 'totalTime']) {
        expect([field, typeof payload[field]]).toEqual([field, 'number'])
      }
      expect(payload.totalTime).toBeCloseTo((LEAD_IN_MS + SMA_TUNING[difficulty].durationMs) / 1000, 3)
      // Untouched controls, so the drift wins — a real score, but not a good one.
      expect(payload.totalScore).toBeGreaterThanOrEqual(0)
      expect(payload.totalScore).toBeLessThan(maxSmaScore(SMA_TUNING[difficulty]))

      // And the results screen is filed under the same board.
      expect(container.querySelector(`[data-game-key="${gameKey}"]`)).toBeTruthy()
    } finally {
      driver.restore()
    }
  })
})
