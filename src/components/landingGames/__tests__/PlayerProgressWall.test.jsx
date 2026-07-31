import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import PlayerProgressWall from '../PlayerProgressWall'

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

let user = null
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user, API: '' }) }))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }) => <div {...rest}>{children}</div> }),
}))

// Recharts needs a measured container; stub the chart down to a marker carrying
// the point count so we can still assert the right series reached it.
vi.mock('../ImprovementChart', () => ({
  default: ({ series, game }) => <div data-testid="chart" data-points={series.length} data-game={game} />,
}))

// Mirrors the endpoint's minimised shape: an agent number, undated scores, and
// an elapsed-days figure. No display name, no timestamps.
const panel = (over = {}) => ({
  gameKey: 'target',
  name: 'Agent 1436194',
  attempts: 41,
  best: 320,
  lowerIsBetter: false,
  improvementPct: 64,
  firstAvg: 120,
  lastAvg: 197,
  spanDays: 42,
  series: [{ score: 120 }, { score: 197 }],
  ...over,
})

const respondWith = (panels) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { panels } }) })

describe('PlayerProgressWall', () => {
  beforeEach(() => { user = null })
  afterEach(() => vi.restoreAllMocks())

  it('renders one card per panel with the agent number and improvement', async () => {
    global.fetch = respondWith([panel(), panel({ gameKey: 'dpt', name: 'Agent 5674146', improvementPct: 22 })])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getAllByTestId('progress-card')).toHaveLength(2))
    expect(screen.getByText('Agent 1436194')).toBeDefined()
    expect(screen.getByText('+64%')).toBeDefined()
    expect(screen.getByText('64% better than when they started')).toBeDefined()
    expect(screen.getByText('Agent 5674146')).toBeDefined()
  })

  it('names the game on the chart axis rather than in the subtitle', async () => {
    global.fetch = respondWith([panel()])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByTestId('chart').dataset.game).toBe('Target'))
    // The subtitle carries the improvement alone — the axis says which game.
    expect(screen.getByText('64% better than when they started')).toBeDefined()
  })

  it('says the scores are real players — the claim the section rests on', async () => {
    global.fetch = respondWith([panel()])
    const { container } = render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByTestId('progress-card')).toBeDefined())
    expect(container.textContent).toMatch(/Real scores from real Skywatch players/i)
  })

  it('shows how many plays it took', async () => {
    global.fetch = respondWith([panel()])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByText(/41 runs/)).toBeDefined())
  })

  it('shows no raw scores — they mean nothing to someone who has not played', async () => {
    global.fetch = respondWith([panel({ firstAvg: 120, lastAvg: 197, best: 320 })])
    const { container } = render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByTestId('progress-card')).toBeDefined())
    for (const score of ['120', '197', '320']) {
      expect(container.textContent).not.toContain(score)
    }
  })

  it('states elapsed time in whole weeks, never as a date', async () => {
    global.fetch = respondWith([panel({ spanDays: 42 })])
    const { container } = render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByText(/over 6 weeks/)).toBeDefined())
    expect(container.textContent).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/)
  })

  it('rounds a long history to months and a short one to days', async () => {
    global.fetch = respondWith([panel({ spanDays: 180 }), panel({ gameKey: 'dpt', spanDays: 3 })])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByText(/over 6 months/)).toBeDefined())
    expect(screen.getByText(/over a few days/)).toBeDefined()
  })

  it('does not say "1 weeks"', async () => {
    global.fetch = respondWith([panel({ spanDays: 9 })])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByText(/over 1 week\b/)).toBeDefined())
  })

  it('discloses that the lines are averaged rather than raw runs', async () => {
    global.fetch = respondWith([panel()])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByText(/rolling average of that player's runs/)).toBeDefined())
  })

  it('keeps the averaging caption off the loading state', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<PlayerProgressWall />)

    expect(screen.queryByText(/rolling average/)).toBeNull()
  })

  it('passes the full series to the chart', async () => {
    global.fetch = respondWith([panel()])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByTestId('chart').dataset.points).toBe('2'))
  })

  it('renders nothing at all when no player qualifies', async () => {
    global.fetch = respondWith([])
    const { container } = render(<PlayerProgressWall />)

    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('renders nothing when the request fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    const { container } = render(<PlayerProgressWall />)

    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('holds a skeleton while loading so the page does not jump', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))   // never settles
    render(<PlayerProgressWall />)

    expect(screen.getByTestId('progress-skeleton')).toBeDefined()
  })

  // The closing card sits immediately below this section with the page's final
  // ask, so the wall carries no CTA of its own — logged in or out.
  it('carries no call to action of its own', async () => {
    global.fetch = respondWith([panel()])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByTestId('progress-card')).toBeDefined())
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows a signed-in player the same section', async () => {
    user = { _id: 'u1' }
    global.fetch = respondWith([panel()])
    render(<PlayerProgressWall />)

    await waitFor(() => expect(screen.getByTestId('progress-card')).toBeDefined())
    expect(screen.queryByRole('link')).toBeNull()
  })
})
