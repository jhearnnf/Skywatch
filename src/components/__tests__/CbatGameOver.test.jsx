import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatGameOver from '../CbatGameOver'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockChrome = vi.hoisted(() => ({ enterGameOver: vi.fn(), exitGameOver: vi.fn() }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, state }) => (
    <a href={to} data-state={state ? JSON.stringify(state) : undefined}>{children}</a>
  ),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({ useGameChrome: () => mockChrome }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
}))
// Recharts' ResponsiveContainer measures its parent, which is 0×0 in jsdom, so it renders
// nothing. Swap it for a plain box so the sparkline's marks are actually in the tree.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div data-testid="progress-chart">{children}</div>,
  }
})

// Drive the score count-up (a requestAnimationFrame loop) to its final frame
// synchronously so the displayed score settles within a single render pass.
beforeEach(() => {
  let t = 0
  vi.stubGlobal('requestAnimationFrame', (cb) => { t += 800; cb(t); return t })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

const weeklyData = (over = {}) => ({
  played: true, rank: 3, weekTotal: 300, plays: 2,
  resetsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  neighbors: [
    { rank: 2, weekTotal: 420, plays: 3, name: 'Maverick', isMe: false },
    { rank: 3, weekTotal: 300, plays: 2, name: 'Agent A001', isMe: true },
    { rank: 4, weekTotal: 240, plays: 1, name: 'Goose', isMe: false },
  ],
  ...over,
})

// series of scores → the shape GET /cbat/:gameKey/progress returns.
const progressData = (scores, over = {}) => ({
  gameKey: 'target',
  attempts: scores.length,
  series: scores.map((score, i) => ({
    score, time: 30,
    at: new Date(Date.now() - (scores.length - i) * 86400000).toISOString(),
  })),
  best: Math.max(...scores),
  firstAvg: null,
  lastAvg: null,
  ...over,
})

// The screen fires two independent requests (weekly standing + own progress), so the mock
// dispatches on URL. `progress` defaults to null — the trend block is additive, and leaving it
// off by default keeps each test to the one thing it's asserting.
function setup({ apiFetch, weekly = weeklyData(), progress = null } = {}) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' }, API: '',
    apiFetch: apiFetch || vi.fn().mockImplementation((url) => {
      const data = String(url).includes('/progress') ? progress : weekly
      return Promise.resolve({ ok: true, json: async () => ({ data }) })
    }),
  })
}

const baseProps = {
  gameKey: 'target', score: 300, scoreSaved: true, queued: false,
  personalBest: { bestScore: 250, attempts: 4 }, onPlayAgain: vi.fn(),
}

describe('CbatGameOver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the score and the breakdown inline on one screen (no View Results step)', () => {
    setup()
    render(<CbatGameOver {...baseProps}><div>BREAKDOWN_PANEL</div></CbatGameOver>)

    expect(screen.getByText('300')).toBeDefined()              // personal beat score
    expect(screen.getByText('BREAKDOWN_PANEL')).toBeDefined()  // breakdown always visible
    expect(screen.queryByRole('button', { name: /view results/i })).toBeNull()
  })

  it('renders a View Leaderboard link and any extra tertiary actions', () => {
    setup()
    const onExtra = vi.fn()
    render(
      <CbatGameOver {...baseProps} extraActions={[{ label: 'Change Aircraft', onClick: onExtra }]}>
        <div />
      </CbatGameOver>
    )
    expect(screen.getByRole('link', { name: /view leaderboard/i })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /change aircraft/i }))
    expect(onExtra).toHaveBeenCalled()
  })

  it('the View Leaderboard link carries fromGame state so the destination can play the rank-move slide', () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    const link = screen.getByRole('link', { name: /view leaderboard/i })
    expect(link.getAttribute('data-state')).toBe(JSON.stringify({ fromGame: true }))
  })

  it('flags a personal best when the run beats the previous best', () => {
    setup()
    render(<CbatGameOver {...baseProps} score={300} personalBest={{ bestScore: 250 }}><div /></CbatGameOver>)
    expect(screen.getByText(/personal best/i)).toBeDefined()
  })

  it('shows the previous best (not a PB) when the run is lower', () => {
    setup()
    render(<CbatGameOver {...baseProps} score={100} personalBest={{ bestScore: 250 }}><div /></CbatGameOver>)
    expect(screen.getByText(/Best\s*250/i)).toBeDefined()
    expect(screen.queryByText(/personal best/i)).toBeNull()
  })

  it('renders the weekly chase window with a "pts to pass" target', async () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    // 420 (Maverick, rank above) - 300 (me) = 120 pts to pass
    await waitFor(() => expect(screen.getByText(/120 pts to pass/i)).toBeDefined())
    expect(screen.getAllByText(/Maverick/).length).toBeGreaterThan(0) // appears in row + chase line
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })

  it('skips the weekly fetch and shows an offline notice when queued', async () => {
    const apiFetch = vi.fn()
    setup({ apiFetch })
    render(<CbatGameOver {...baseProps} queued={true} scoreSaved={false}><div /></CbatGameOver>)

    await waitFor(() => expect(screen.getByText(/updates when you reconnect/i)).toBeDefined())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('calls onPlayAgain from the reveal', () => {
    setup()
    const onPlayAgain = vi.fn()
    render(<CbatGameOver {...baseProps} onPlayAgain={onPlayAgain}><div /></CbatGameOver>)
    fireEvent.click(screen.getByRole('button', { name: /play again/i }))
    expect(onPlayAgain).toHaveBeenCalled()
  })

  describe('progress trend', () => {
    it('charts the run history once there are enough attempts', async () => {
      setup({ progress: progressData([100, 150, 200, 300]) })
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByTestId('progress-chart')).toBeDefined())
      expect(screen.getByText('4 attempts')).toBeDefined()
    })

    it('nudges the user onward instead of charting a single point', async () => {
      setup({ progress: progressData([300]) })
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/2 more runs and your progress chart/i)).toBeDefined())
      expect(screen.queryByTestId('progress-chart')).toBeNull()
    })

    // Two points draw a line, which implies a trend that isn't there yet.
    it('holds the chart back at two attempts, counting down rather than going silent', async () => {
      setup({ progress: progressData([100, 200]) })
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/1 more run and your progress chart/i)).toBeDefined())
      expect(screen.queryByTestId('progress-chart')).toBeNull()
    })

    it('reads an improving trend as positive for a higher-is-better game', async () => {
      setup({ progress: progressData([100, 120, 140, 200, 220, 240], { firstAvg: 100, lastAvg: 120 }) })
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/20% better than your first 5/i)).toBeDefined())
    })

    // Trace Practise scores rotations, where fewer is better — a falling score is an improving
    // player, and the copy has to say so.
    it('reads a falling score as improving for a lower-is-better game', async () => {
      setup({ progress: progressData([40, 38, 34, 30, 28, 20], { firstAvg: 40, lastAvg: 30 }) })
      render(<CbatGameOver {...baseProps} gameKey="plane-turn-2d" score={20} personalBest={{ bestScore: 20 }}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/25% better than your first 5/i)).toBeDefined())
    })

    it('calls a flat run steady rather than inventing a trend', async () => {
      setup({ progress: progressData([200, 200, 200, 200, 200, 200], { firstAvg: 200, lastAvg: 200 }) })
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/holding steady/i)).toBeDefined())
    })

    it('skips the progress fetch when the score is only queued offline', async () => {
      const apiFetch = vi.fn()
      setup({ apiFetch })
      render(<CbatGameOver {...baseProps} queued={true} scoreSaved={false}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/updates when you reconnect/i)).toBeDefined())
      expect(apiFetch.mock.calls.filter(([url]) => String(url).includes('/progress'))).toHaveLength(0)
    })

    it('leaves the rest of the screen intact when the progress fetch fails', async () => {
      const apiFetch = vi.fn().mockImplementation((url) => (
        String(url).includes('/progress')
          ? Promise.reject(new Error('network'))
          : Promise.resolve({ ok: true, json: async () => ({ data: weeklyData() }) })
      ))
      setup({ apiFetch })
      render(<CbatGameOver {...baseProps}><div>BREAKDOWN_PANEL</div></CbatGameOver>)

      await waitFor(() => expect(screen.getByText(/120 pts to pass/i)).toBeDefined())
      expect(screen.getByText('BREAKDOWN_PANEL')).toBeDefined()
      expect(screen.queryByTestId('progress-chart')).toBeNull()
    })
  })

  it('signals game-over chrome while mounted (so the menu music returns to full volume)', () => {
    setup()
    const { unmount } = render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    expect(mockChrome.enterGameOver).toHaveBeenCalled()
    expect(mockChrome.exitGameOver).not.toHaveBeenCalled()
    unmount()
    expect(mockChrome.exitGameOver).toHaveBeenCalled()
  })
})
