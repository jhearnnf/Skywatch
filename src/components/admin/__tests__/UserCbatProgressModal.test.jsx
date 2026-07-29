import { cloneElement } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import UserCbatProgressModal from '../UserCbatProgressModal'

// ResponsiveContainer measures its parent, which is 0×0 in jsdom, so the chart renders nothing.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => cloneElement(children, { width: 600, height: 240 }),
  }
})

const DAY = 86400000
const user = { _id: 'u1', displayName: 'Agent Smith', agentNumber: '1000042', email: 'a@b.com' }

const series = (scores, times = []) =>
  scores.map((score, i) => ({
    score,
    time: times.length ? times[i] : 30,
    at: new Date(Date.now() - (scores.length - i) * DAY).toISOString(),
  }))

// Shapes a GET /api/admin/users/:id/cbat-progress response.
const payload = (over = {}) => ({
  status: 'success',
  data: {
    user,
    games: [
      { gameKey: 'symbols', label: 'Symbols', attempts: 4, chartable: true,  firstPlayedAt: new Date(Date.now() - 30 * DAY).toISOString() },
      { gameKey: 'angles',  label: 'Angles',  attempts: 3, chartable: true,  firstPlayedAt: new Date(Date.now() - 10 * DAY).toISOString() },
      { gameKey: 'target',  label: 'Target',  attempts: 1, chartable: false, firstPlayedAt: new Date(Date.now() - 5 * DAY).toISOString() },
    ],
    gameKey: 'symbols',
    label: 'Symbols',
    lowerIsBetter: false,
    attempts: 4,
    // One off-pace run then three at the ceiling. The quickest run overall (15s) is the LOW
    // scoring one, so the best-score-only default and the "all runs" toggle disagree — which is
    // exactly the confusion the toggle exists to prevent.
    series: series([5, 14, 14, 14], [15, 34, 28, 22]),
    best: 14,
    firstAvg: null,
    lastAvg: null,
    ...over,
  },
})

let apiFetch

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

// The modal portals to document.body, so render()'s own container never holds it.
const dots = () => document.body.querySelectorAll('circle.recharts-line-dot').length
// The "Best" stat tile — scoped rather than matched on its value, since the y-axis renders the
// same formatted score as a tick label.
const bestTile = async () => (await screen.findByText('Best')).closest('div')

const renderModal = (onClose = vi.fn()) =>
  render(<UserCbatProgressModal user={user} API="" apiFetch={apiFetch} onClose={onClose} />)

beforeEach(() => {
  apiFetch = vi.fn(() => ok(payload()))
})

describe('UserCbatProgressModal', () => {
  it('opens without a gameKey so the server picks the first game played', async () => {
    renderModal()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe('/api/admin/users/u1/cbat-progress')
  })

  it('shows the agent, the played games and their run counts', async () => {
    renderModal()
    expect(await screen.findByText(/Agent Smith/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^Symbols —/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Angles —/ })).toBeInTheDocument()
    // The open game is the pressed pill — a native <select> was unreadable against the theme.
    expect(screen.getByRole('button', { name: /^Symbols —/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Angles —/ })).toHaveAttribute('aria-pressed', 'false')
  })

  // Selecting a game with one or two runs would only ever land on "not enough to chart yet".
  it('lists a game with too few runs to chart but will not let it be selected', async () => {
    renderModal()
    const target = await screen.findByRole('button', { name: /^Target —/ })
    expect(target).toBeDisabled()
    expect(target).toHaveAccessibleName(/too few to chart/)

    fireEvent.click(target)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))   // still only the initial load
    expect(screen.getByRole('button', { name: /^Symbols —/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('formats the best score with the game score format and charts the series', async () => {
    renderModal()
    // Symbols is a 15-question game, so the board config renders its best as "14/15".
    expect(await bestTile()).toHaveTextContent('14/15')
    await waitFor(() => expect(dots()).toBeGreaterThan(0))
  })

  it('refetches with the chosen gameKey when the game is switched', async () => {
    renderModal()
    await screen.findByRole('button', { name: /^Angles —/ })
    apiFetch.mockImplementation(() => ok(payload({
      gameKey: 'angles', label: 'Angles', attempts: 1, series: series([6]), best: 6,
    })))

    fireEvent.click(screen.getByRole('button', { name: /^Angles —/ }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/users/u1/cbat-progress?gameKey=angles', expect.anything()))
    expect(await bestTile()).toHaveTextContent('6/20')
  })

  // Reachable when the agent has played several games but none of them three times — the server
  // still opens on the first one rather than showing an empty modal.
  it('says so rather than charting a two-point line', async () => {
    apiFetch = vi.fn(() => ok(payload({
      games: [{ gameKey: 'symbols', label: 'Symbols', attempts: 2, chartable: false, firstPlayedAt: new Date().toISOString() }],
      attempts: 2, series: series([5, 8]), best: 8,
    })))
    renderModal()
    expect(await screen.findByText(/not enough to chart yet/)).toBeInTheDocument()
    expect(dots()).toBe(0)
  })

  it('shows an empty state when the agent has never finished a run', async () => {
    apiFetch = vi.fn(() => ok(payload({ games: [], gameKey: null, label: null, attempts: 0, series: [], best: null })))
    renderModal()
    expect(await screen.findByText(/No finished CBAT games yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Symbols/ })).not.toBeInTheDocument()
  })

  it('reports a failed load instead of rendering an empty chart', async () => {
    apiFetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Nope' }) }))
    renderModal()
    expect(await screen.findByText('Nope')).toBeInTheDocument()
  })

  describe('trend badge', () => {
    it('reads rising scores as an improvement on a higher-is-better game', async () => {
      apiFetch = vi.fn(() => ok(payload({ firstAvg: 6, lastAvg: 12 })))
      renderModal()
      expect(await screen.findByText('+100%')).toBeInTheDocument()
      expect(screen.getByText(/average improvement/)).toBeInTheDocument()
    })

    it('reads a falling score as an improvement on a lower-is-better game', async () => {
      apiFetch = vi.fn(() => ok(payload({
        gameKey: 'plane-turn-2d', label: 'Trace Practise 2D', lowerIsBetter: true,
        series: series([80, 70, 60, 50]), best: 50, firstAvg: 80, lastAvg: 40,
      })))
      renderModal()
      expect(await screen.findByText('+50%')).toBeInTheDocument()
      expect(screen.getByText(/average improvement/)).toBeInTheDocument()
    })

    it('names a decline rather than dressing it up as a gain', async () => {
      apiFetch = vi.fn(() => ok(payload({ firstAvg: 12, lastAvg: 6 })))
      renderModal()
      expect(await screen.findByText('-50%')).toBeInTheDocument()
      expect(screen.getByText(/average decline/)).toBeInTheDocument()
    })

    // A bare percentage invites the reader to assume it's first run vs last run.
    it('explains the arithmetic on hover, in the game score format', async () => {
      apiFetch = vi.fn(() => ok(payload({ firstAvg: 6, lastAvg: 12 })))
      renderModal()
      const badge = (await screen.findByText('+100%')).closest('span[title]')
      expect(badge).toHaveAttribute('title', expect.stringContaining('First 5 runs on this chart averaged 6/15'))
      expect(badge).toHaveAttribute('title', expect.stringContaining('last 5 averaged 12/15'))
      expect(badge).toHaveAttribute('title', expect.stringMatching(/hidden below 6 runs/))
    })

    it('says nothing at all below six runs', async () => {
      renderModal()   // default payload has four runs and no averages
      await screen.findByText('Score')
      expect(screen.queryByText(/average improvement|average decline|No overall change/)).not.toBeInTheDocument()
    })
  })

  // Symbols has a score ceiling, so once an agent maxes out only the clock still shows movement.
  describe('time chart', () => {
    const toggle = () => screen.getByLabelText('Show times for all runs')

    it('charts time alongside score on a game that ranks on time', async () => {
      renderModal()
      expect(await screen.findByText('Score')).toBeInTheDocument()
      expect(screen.getByText('Time')).toBeInTheDocument()
      // 4 score dots + the 3 best-score time dots.
      await waitFor(() => expect(dots()).toBe(7))
    })

    it('charts only best-score runs until the toggle is ticked', async () => {
      renderModal()
      expect(await screen.findByText(/best runs \(14\/15\)/)).toBeInTheDocument()
      expect(toggle()).not.toBeChecked()
      // 22s is the quickest of the three 14/15 runs; the 15s run only scored 5/15.
      expect(screen.getByText('Quickest').closest('div')).toHaveTextContent('22s')

      fireEvent.click(toggle())

      expect(await screen.findByText(/every run/)).toBeInTheDocument()
      expect(screen.getByText('Quickest').closest('div')).toHaveTextContent('15s')
      await waitFor(() => expect(dots()).toBe(8))
    })

    it('offers the toggle rather than a chart when too few runs hit the best score', async () => {
      apiFetch = vi.fn(() => ok(payload({ series: series([5, 8, 11, 14], [40, 34, 28, 22]), best: 14 })))
      renderModal()
      expect(await screen.findByText(/Only 1 run at 14\/15 so far/)).toBeInTheDocument()
      expect(dots()).toBe(4)   // score chart only

      fireEvent.click(toggle())
      await waitFor(() => expect(dots()).toBe(8))
    })

    // The time chart's contents depend on the toggle, so its trend has to be read off whichever
    // runs are actually plotted — not off the whole history.
    it('recomputes its own trend from the runs currently plotted', async () => {
      apiFetch = vi.fn(() => ok(payload({
        attempts: 8,
        // Two quick low-score runs at the start, then six at the ceiling getting steadily quicker.
        series: series([5, 5, 14, 14, 14, 14, 14, 14], [10, 12, 40, 38, 36, 30, 26, 22]),
        best: 14,
        firstAvg: null, lastAvg: null,   // no score trend, so the only badge is the time one
      })))
      renderModal()

      // Across the six 14/15 runs they are getting quicker.
      expect(await screen.findByText('+11%')).toBeInTheDocument()
      expect(screen.getByText(/average improvement/)).toBeInTheDocument()

      // Fold the two fast 5/15 runs back in and the same agent reads as slowing down.
      fireEvent.click(toggle())
      expect(await screen.findByText('-12%')).toBeInTheDocument()
      expect(screen.getByText(/average decline/)).toBeInTheDocument()
    })

    it('omits the time chart on a game where time is not ranked', async () => {
      // Target hides time on its leaderboard — it's scored purely on points.
      apiFetch = vi.fn(() => ok(payload({ gameKey: 'target', label: 'Target', best: 320 })))
      renderModal()
      expect(await screen.findByText('Score')).toBeInTheDocument()
      expect(screen.queryByText('Time')).not.toBeInTheDocument()
      expect(screen.queryByText('Quickest')).not.toBeInTheDocument()
      await waitFor(() => expect(dots()).toBe(4))
    })

    it('omits the time chart when the runs carry no times', async () => {
      apiFetch = vi.fn(() => ok(payload({
        series: series([5, 8, 11, 14]).map(p => ({ ...p, time: null })),
      })))
      renderModal()
      expect(await screen.findByText('Score')).toBeInTheDocument()
      expect(screen.queryByText('Time')).not.toBeInTheDocument()
    })
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await screen.findByRole('button', { name: /^Symbols —/ })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
