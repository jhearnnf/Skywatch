import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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
// The gain badges and the pulsing numbers are motion.spans (see LeaderboardRow's GainCell), so
// the mock has to cover span as well as div or the rows render nothing.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    span: ({ children, className }) => <span className={className}>{children}</span>,
  },
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

// `plays: 7` (not 2) so the pre-run figure the replay holds — 6 — is a string that appears
// nowhere else in the panel. Same reason the neighbours' totals stay clear of 180 (= 300 − 120,
// the pre-run points): these tests read the numbers straight out of the rendered rows.
const weeklyData = (over = {}) => ({
  played: true, rank: 3, weekTotal: 300, plays: 7, lastRunPoints: 120, prevRank: 5,
  resetsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  neighbors: [
    { rank: 2, weekTotal: 420, plays: 3, name: 'Maverick', isMe: false },
    { rank: 3, weekTotal: 300, plays: 7, name: 'Agent A001', isMe: true },
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

  it('names both boards in the action row, alongside any extra tertiary actions', () => {
    setup()
    const onExtra = vi.fn()
    render(
      <CbatGameOver {...baseProps} extraActions={[{ label: 'Change Aircraft', onClick: onExtra }]}>
        <div />
      </CbatGameOver>
    )
    // One ambiguous "View Leaderboard" left users unsure which board they were being sent to.
    expect(screen.getByRole('link', { name: /weekly board/i })).toBeDefined()
    expect(screen.getByRole('link', { name: /all-time board/i })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /change aircraft/i }))
    expect(onExtra).toHaveBeenCalled()
  })

  it('the Weekly Board link carries fromGame state so the destination can play the rank-move slide', () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    const link = screen.getByRole('link', { name: /weekly board/i })
    expect(link.getAttribute('data-state')).toBe(JSON.stringify({ fromGame: true }))
  })

  // The slide only runs on the weekly tab, so the all-time link must NOT request it — and it
  // needs the ?period= deep-link or it would land on This Week, the board the user just left.
  it('the All-Time Board link deep-links to the all-time period without the slide', () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    const link = screen.getByRole('link', { name: /all-time board/i })
    expect(link.getAttribute('href')).toBe('/cbat/target/leaderboard?period=all-time')
    expect(link.getAttribute('data-state')).toBeNull()
  })

  it('flags a personal best when the run beats the previous best', async () => {
    // Series' last run (300) is the new high; personal-best endpoint reflects it as the record.
    setup({ progress: progressData([200, 250, 300]) })
    render(<CbatGameOver {...baseProps} score={300} personalBest={{ bestScore: 300 }}><div /></CbatGameOver>)
    await waitFor(() => expect(screen.getByText(/personal best/i)).toBeDefined())
  })

  it('shows the previous best (not a PB) when the run is lower', async () => {
    // Last run (100) trails the record (250) — not a PB.
    setup({ progress: progressData([250, 180, 100]) })
    render(<CbatGameOver {...baseProps} score={100} personalBest={{ bestScore: 250 }}><div /></CbatGameOver>)
    await waitFor(() => expect(screen.getByText(/Best\s*250/i)).toBeDefined())
    expect(screen.queryByText(/personal best/i)).toBeNull()
  })

  // Score-ceiling games (e.g. Angles /20) let a player max out repeatedly. The first max is a PB;
  // a later max is only a PB if it beat the previous time, otherwise it's just a tie.
  describe('personal best on a maxed-out score', () => {
    // A run that hits the ceiling for the first time — record score, and it sets the best time.
    const firstMax = () => progressData([18, 20], {
      series: [
        { score: 18, time: 25, at: new Date(Date.now() - 2 * 86400000).toISOString() },
        { score: 20, time: 18, at: new Date(Date.now() - 1 * 86400000).toISOString() },
      ],
    })

    it('celebrates the first time the player hits the max score', async () => {
      setup({ progress: firstMax() })
      render(
        <CbatGameOver {...baseProps} gameKey="angles" score={20}
          personalBest={{ bestScore: 20, bestTime: 18 }}><div /></CbatGameOver>
      )
      await waitFor(() => expect(screen.getByText(/personal best/i)).toBeDefined())
    })

    it('does NOT re-celebrate a later max that was slower than the best time', async () => {
      // Best time on record is 18s; this max run took 22s, so it is not a new best. Three runs so
      // the chart renders and its "N attempts" marker gives a signal the series has loaded.
      const prog = progressData([18, 20, 20], {
        series: [
          { score: 18, time: 25, at: new Date(Date.now() - 3 * 86400000).toISOString() },
          { score: 20, time: 18, at: new Date(Date.now() - 2 * 86400000).toISOString() },
          { score: 20, time: 22, at: new Date(Date.now() - 1 * 86400000).toISOString() },
        ],
      })
      setup({ progress: prog })
      render(
        <CbatGameOver {...baseProps} gameKey="angles" score={20}
          personalBest={{ bestScore: 20, bestTime: 18 }}><div /></CbatGameOver>
      )
      await waitFor(() => expect(screen.getByText(/3 attempts/i)).toBeDefined())
      expect(screen.queryByText(/personal best/i)).toBeNull()
    })

    it('celebrates again when a later max beats the previous best time', async () => {
      // New best time (15s) beats the old record (18s), even though the score is the same max.
      const prog = progressData([18, 20, 20], {
        series: [
          { score: 18, time: 25, at: new Date(Date.now() - 3 * 86400000).toISOString() },
          { score: 20, time: 18, at: new Date(Date.now() - 2 * 86400000).toISOString() },
          { score: 20, time: 15, at: new Date(Date.now() - 1 * 86400000).toISOString() },
        ],
      })
      setup({ progress: prog })
      render(
        <CbatGameOver {...baseProps} gameKey="angles" score={20}
          personalBest={{ bestScore: 20, bestTime: 15 }}><div /></CbatGameOver>
      )
      await waitFor(() => expect(screen.getByText(/personal best/i)).toBeDefined())
    })
  })

  it('renders the weekly chase window with a "pts to pass" target', async () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    // 420 (Maverick, rank above) - 300 (me) = 120 pts to pass
    await waitFor(() => expect(screen.getByText(/120 pts to pass/i)).toBeDefined())
    expect(screen.getAllByText(/Maverick/).length).toBeGreaterThan(0) // appears in row + chase line
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })

  // The window shows weekTotal (every run summed), which will not equal the score just posted —
  // users read that mismatch as an all-time total unless the panel says otherwise, loudly.
  describe('weekly window is unmistakably the weekly board', () => {
    it('labels the period and explains that points accumulate', async () => {
      setup()
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText('Weekly')).toBeDefined())
      expect(screen.getByText('Leaderboard')).toBeDefined()
      expect(screen.getByText(/Points add up across every run this week/i)).toBeDefined()
    })

    it('names the columns, so the number beside your name is not mistaken for your score', async () => {
      setup()
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByText('Points')).toBeDefined())
      expect(screen.getByText('Plays')).toBeDefined()
      expect(screen.getByText('Rank')).toBeDefined()
      expect(screen.getByText('Agent')).toBeDefined()
    })

    // The increment replay: hold the pre-run figures, illuminate, then count up. It exists to
    // SHOW the accumulation the copy above can only assert, so the pre-run state actually being
    // on screen first is the whole feature — not a detail of the animation.
    //
    // Timers here are real (the stubbed rAF settles the count-up instantly, but the phase
    // schedule is setTimeout), so these tests assert the pre-run frame synchronously and then
    // wait for the settled one.
    describe('increment replay', () => {
      // The ordering is the feature: pulse first, change second. If both happen on one frame,
      // the user only sees whichever figure they were already looking at move.
      //
      // Fake timers here rather than waitFor — the flash window is a few hundred ms wide, and a
      // test that has to poll into it to catch the pre-run figures still lit would be a flake.
      it('flashes the figures BEFORE they change, not as they change', async () => {
        setup()
        vi.useFakeTimers()
        try {
          render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
          await act(async () => {})   // let the weekly fetch resolve (promises, not timers)

          // Each advance lands mid-phase rather than just past a boundary, so retuning the
          // REPLAY_* constants by a hundred ms or two doesn't break this. Phase windows as
          // written: hold 0-300, flash 300-1000, count 1000-1600, settled from 1600.
          const cell = () => screen.getByText('6').parentElement

          // Hold: pre-run figures, no illumination yet.
          expect(cell().className).not.toMatch(/emerald/)

          // Flash: lit up, and STILL showing 6 — the cue precedes the change.
          await act(async () => { vi.advanceTimersByTime(500) })
          expect(cell().className).toMatch(/text-emerald-300/)
          expect(screen.queryByText('7')).toBeNull()

          // Change: only now does it tick, and it stays lit while it does.
          await act(async () => { vi.advanceTimersByTime(800) })
          expect(screen.getByText('7')).toBeDefined()
          expect(screen.getByText('7').parentElement.className).toMatch(/text-emerald-300/)

          // Settled: illumination returns to the normal cell colour.
          await act(async () => { vi.advanceTimersByTime(500) })
          expect(screen.getByText('7').parentElement.className).not.toMatch(/emerald/)
        } finally {
          vi.useRealTimers()
        }
      })

      it('holds the pre-run play count, then ticks it up by one', async () => {
        setup()
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

        // 7 plays after this run, so the board opens on 6 — the state the user last saw.
        await waitFor(() => expect(screen.getByText('6')).toBeDefined())
        expect(screen.queryByText('7')).toBeNull()

        await waitFor(() => expect(screen.getByText('7')).toBeDefined())
        expect(screen.queryByText('6')).toBeNull()
      })

      it('badges what the run added to both figures', async () => {
        setup()
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

        await waitFor(() => expect(screen.getByText('+120')).toBeDefined())  // points gained
        expect(screen.getByText('+1')).toBeDefined()                        // one more play
      })

      it('shows the rank climb once the numbers have landed', async () => {
        setup()
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
        // prevRank 5 → rank 3. The climb is a badge, never a counting number.
        await waitFor(() => expect(screen.getByText('▲2')).toBeDefined())
        expect(screen.queryByText('#5')).toBeNull()
      })

      it('drops the badges after they have had time to be read', async () => {
        setup()
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

        await waitFor(() => expect(screen.getByText('+120')).toBeDefined())
        // A flash alone is missed by anyone still reading their score, so the badges outlive the
        // pulse by over a second before clearing out.
        await waitFor(() => expect(screen.queryByText('+120')).toBeNull(), { timeout: 4000 })
        expect(screen.queryByText('+1')).toBeNull()
        expect(screen.getByText('▲2')).toBeDefined()   // the climb stays put
      })

      it('does not replay anything on the first run of the week', async () => {
        // plays: 1 → there is no previous state to count from, and prevRank is null.
        setup({ weekly: weeklyData({ plays: 1, prevRank: null, lastRunPoints: 300,
          neighbors: [
            { rank: 2, weekTotal: 420, plays: 3, name: 'Maverick', isMe: false },
            { rank: 3, weekTotal: 300, plays: 1, name: 'Agent A001', isMe: true },
          ] }) })
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

        await waitFor(() => expect(screen.getByText('Agent A001 (you)')).toBeDefined())
        expect(screen.queryByText('+300')).toBeNull()
        expect(screen.queryByText('+1')).toBeNull()
        expect(screen.queryByText('0')).toBeNull()      // never counts up from a phantom zero
      })

      // A negative run's weekly contribution is floored to 0 by the board, so the total really
      // does not move. Animating a gain there would be the panel lying to the user.
      it('badges only the play when the run added no points', async () => {
        setup({ weekly: weeklyData({ lastRunPoints: 0, prevRank: 3 }) })
        render(<CbatGameOver {...baseProps} score={-50}><div /></CbatGameOver>)

        await waitFor(() => expect(screen.getByText('+1')).toBeDefined())
        expect(screen.queryByText('+0')).toBeNull()
        expect(screen.queryByText('▲0')).toBeNull()     // rank did not move either
      })

      // Old clients and cached payloads predate lastRunPoints; the play count still ticks.
      it('survives a payload with no lastRunPoints', async () => {
        const { lastRunPoints, ...noGain } = weeklyData()   // eslint-disable-line no-unused-vars
        setup({ weekly: noGain })
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)

        await waitFor(() => expect(screen.getByText('+1')).toBeDefined())
        // Points sit at the settled total rather than counting from a guessed starting figure,
        // and no points badge is invented — only the play tick, which is always knowable.
        expect(screen.queryByText('180')).toBeNull()
        expect(screen.queryByText('+120')).toBeNull()
      })

      it('closes the chase gap in step with the count-up rather than disagreeing with it', async () => {
        setup()
        render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
        // Both the row and the gap are derived from the same tweened figure, so once it settles
        // the gap is 420 − 300, never 420 − 180.
        await waitFor(() => expect(screen.getByText(/120 pts to pass/i)).toBeDefined())
        expect(screen.queryByText(/240 pts to pass/i)).toBeNull()
      })
    })

    it('keeps the reset countdown on the same line as the explainer', async () => {
      setup()
      render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
      // Loose on the digits: resetsAt is 2 days out, which has already ticked down to
      // "1d 23h" by the time this renders.
      await waitFor(() => expect(
        screen.getByText(/Points add up across every run this week · resets in \d+d \d+h/i)
      ).toBeDefined())
    })
  })

  it('waits for the score to save before asking for the weekly standing (closes the post-game race)', async () => {
    const apiFetch = vi.fn().mockImplementation((url) => {
      const data = String(url).includes('/progress') ? null : weeklyData()
      return Promise.resolve({ ok: true, json: async () => ({ data }) })
    })
    setup({ apiFetch })
    const { rerender } = render(<CbatGameOver {...baseProps} scoreSaved={false}><div /></CbatGameOver>)

    // Save still in flight → the board must not be queried yet, or it could read
    // our rank before the just-played score has landed and hide the panel.
    expect(apiFetch.mock.calls.filter(([url]) => String(url).includes('/weekly/me'))).toHaveLength(0)

    // Save confirms → now it asks, once, and the chase window appears.
    rerender(<CbatGameOver {...baseProps} scoreSaved={true}><div /></CbatGameOver>)
    await waitFor(() => expect(screen.getByText(/120 pts to pass/i)).toBeDefined())
    expect(apiFetch.mock.calls.filter(([url]) => String(url).includes('/weekly/me'))).toHaveLength(1)
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
