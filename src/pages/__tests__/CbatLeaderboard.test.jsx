import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatLeaderboard from '../CbatLeaderboard'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth   = vi.hoisted(() => vi.fn())
const mockUseParams = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useParams: () => mockUseParams(),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/cbat/x/leaderboard', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

// The arrival flourish is exercised on its own; here it would just overlay the
// board, so stub it out (still supplying the pill layout id the page imports).
vi.mock('../../components/LeaderboardIntro', () => ({
  default: () => null,
  INTRO_PILL_LAYOUT_ID: 'cbat-weekly-pill',
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────

// URL-aware: the component requests ?period=weekly first, ?period=all-time on switch.
function mockApi({ weekly = {}, allTime = {} } = {}) {
  return vi.fn((url) => {
    const isWeekly = String(url).includes('period=weekly')
    const data = isWeekly
      ? { period: 'weekly', resetsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
          leaderboard: weekly.leaderboard || [], myBest: weekly.myBest || null }
      : { period: 'all-time', leaderboard: allTime.leaderboard || [], myBest: allTime.myBest || null }
    return Promise.resolve({ ok: true, json: async () => ({ data }) })
  })
}

function setupAuth(apiFetch = mockApi()) {
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
}

const selectAllTime = async () => {
  fireEvent.click(screen.getByRole('tab', { name: /all time/i }))
  await waitFor(() => expect(screen.getByRole('tab', { name: /all time/i }).getAttribute('aria-selected')).toBe('true'))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatLeaderboard — unknown game', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "Unknown game" for an unrecognised gameKey', () => {
    setupAuth()
    mockUseParams.mockReturnValue({ gameKey: 'nonsense' })
    render(<CbatLeaderboard />)
    expect(screen.getByText('Unknown game')).toBeDefined()
  })
})

describe('CbatLeaderboard — weekly (default) tab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to the weekly board and shows Points + Plays', async () => {
    setupAuth(mockApi({
      weekly: { leaderboard: [
        { _id: 'w1', userId: 'u2', rank: 1, weekTotal: 540, plays: 3, agentNumber: 'A002' },
        { _id: 'w2', userId: 'u1', rank: 2, weekTotal: 300, plays: 2, agentNumber: 'A001' },
      ] },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'target' })
    render(<CbatLeaderboard />)

    expect(screen.getByRole('tab', { name: /this week/i }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(screen.getByText('Agent A001 (you)')).toBeDefined())
    expect(screen.getByText('540')).toBeDefined()  // weekTotal
    expect(screen.getByText('300')).toBeDefined()
    expect(screen.getByText('🥇')).toBeDefined()
  })

  it('shows an empty weekly state', async () => {
    setupAuth(mockApi({ weekly: { leaderboard: [] } }))
    mockUseParams.mockReturnValue({ gameKey: 'target' })
    render(<CbatLeaderboard />)
    await waitFor(() => expect(screen.getByText('No scores yet this week')).toBeDefined())
  })

  it('renders the weekly myBest row when the user is outside the top list', async () => {
    setupAuth(mockApi({
      weekly: {
        leaderboard: [{ _id: 'w1', userId: 'other', rank: 1, weekTotal: 900, plays: 3, agentNumber: 'A101' }],
        myBest: { _id: 'me', userId: 'u1', rank: 38, weekTotal: 120, plays: 1, agentNumber: 'A001' },
      },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'target' })
    render(<CbatLeaderboard />)
    await waitFor(() => expect(screen.getByText('#38')).toBeDefined())
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })
})

describe('CbatLeaderboard — all-time tab', () => {
  beforeEach(() => vi.clearAllMocks())

  const allTimeRows = (rows) => mockApi({ allTime: { leaderboard: rows } })

  it('renders medals for top 3 and # for the rest', async () => {
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'u1', rank: 1, bestScore: 15, bestTime: 30.5, agentNumber: 'A001' },
      { _id: 'e2', userId: 'u2', rank: 2, bestScore: 14, bestTime: 31.0, agentNumber: 'A002' },
      { _id: 'e3', userId: 'u3', rank: 3, bestScore: 13, bestTime: 32.0, agentNumber: 'A003' },
      { _id: 'e4', userId: 'u4', rank: 4, bestScore: 12, bestTime: 33.0, agentNumber: 'A004' },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('Agent A001 (you)')).toBeDefined())
    expect(screen.getByText('🥇')).toBeDefined()
    expect(screen.getByText('🥈')).toBeDefined()
    expect(screen.getByText('🥉')).toBeDefined()
    expect(screen.getByText('#4')).toBeDefined()
  })

  it('formats the score per game config (e.g. "15/15" for Symbols) with time', async () => {
    setupAuth(allTimeRows([{ _id: 'e1', userId: 'u1', rank: 1, bestScore: 15, bestTime: 42.5, agentNumber: 'A001' }]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('15/15')).toBeDefined())
    expect(screen.getByText('42.5s')).toBeDefined()
  })

  it('renders email instead of agent number for admin rows', async () => {
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test' },
      { _id: 'e2', userId: 'u1',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A001', email: 'me@skywatch.test' },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('ace@skywatch.test')).toBeDefined())
    expect(screen.getByText('me@skywatch.test (you)')).toBeDefined()
  })

  it('renders displayName with precedence over email', async () => {
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', displayName: 'Maverick', email: 'ace@skywatch.test' },
      { _id: 'e2', userId: 'u1',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A001', displayName: 'Goose' },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('Maverick')).toBeDefined())
    expect(screen.getByText('Goose (you)')).toBeDefined()
    expect(screen.queryByText('ace@skywatch.test')).toBeNull()
  })

  it('renders a hover tooltip with formatted achievedAt on admin rows, none on fakes', async () => {
    const achievedAt = '2026-04-29T13:45:00.000Z'
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test', achievedAt },
      { _id: 'e2', userId: 'u2',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A998', email: 'demo', isFake: true },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    const realCell = await waitFor(() => screen.getByText('ace@skywatch.test'))
    expect(realCell.getAttribute('title')).toBe(new Date(achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))
    expect(screen.getByText('demo').getAttribute('title')).toBeNull()
  })

  it('shows the all-time myBest row when the user is outside the top list', async () => {
    setupAuth(mockApi({
      allTime: {
        leaderboard: [{ _id: 'e1', userId: 'other1', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A101' }],
        myBest: { _id: 'me', userId: 'u1', rank: 47, bestScore: 10, bestTime: 55.0, agentNumber: 'A001' },
      },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('#47')).toBeDefined())
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })
})

describe('CbatLeaderboard — "You" progress tab', () => {
  beforeEach(() => vi.clearAllMocks())

  // Unlike the two boards, this tab reads /progress (no ?period=), so it needs its own mock.
  const mockProgressApi = (progress) => vi.fn((url) => {
    const data = String(url).includes('/progress')
      ? progress
      : { period: 'weekly', leaderboard: [], myBest: null }
    return Promise.resolve({ ok: true, json: async () => ({ data }) })
  })

  const progressData = (scores, over = {}) => ({
    attempts: scores.length,
    series: scores.map((score, i) => ({
      score, time: 30,
      at: new Date(Date.now() - (scores.length - i) * 86400000).toISOString(),
    })),
    best: Math.max(...scores),
    firstAvg: null, lastAvg: null,
    ...over,
  })

  const selectYou = async () => {
    fireEvent.click(screen.getByRole('tab', { name: /^you$/i }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /^you$/i }).getAttribute('aria-selected')).toBe('true'))
  }

  it('charts the user\'s own run history and headline stats', async () => {
    setupAuth(mockProgressApi(progressData([10, 12, 14, 15], { firstAvg: null, lastAvg: null })))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectYou()

    await waitFor(() => expect(screen.getByText('Attempts')).toBeDefined())
    expect(screen.getByText('4')).toBeDefined()          // attempts tile
    expect(screen.getByText('15/15')).toBeDefined()      // best tile, formatted per the game's cfg
  })

  it('hits /progress rather than /leaderboard for this tab, asking for the percentile', async () => {
    const api = mockProgressApi(progressData([10, 12, 14]))
    setupAuth(api)
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectYou()

    await waitFor(() => {
      const urls = api.mock.calls.map(([u]) => String(u))
      expect(urls.some(u => u.includes('/cbat/symbols/progress?percentile=1'))).toBe(true)
    })
  })

  describe('current-form percentile', () => {
    const withForm = (over = {}) => progressData([10, 12, 14, 15], {
      form: {
        form: 12.8, formTime: 24.3, percentile: 72, cohort: 34, window: 5,
        aheadOf: 24, tiedWith: 0, betterThanMe: 9, ...over,
      },
    })

    it('states where the user\'s recent form sits against the field', async () => {
      setupAuth(mockProgressApi(withForm()))
      mockUseParams.mockReturnValue({ gameKey: 'symbols' })
      render(<CbatLeaderboard />)
      await selectYou()

      // Ahead of 72% => in the best 28% of the field.
      await waitFor(() => expect(screen.getByText('28%')).toBeDefined())
      expect(screen.getByText(/you're in the top/i)).toBeDefined()
      expect(screen.getByText(/last 5 runs avg/i)).toBeDefined()
    })

    // Most CBAT games have a scoring ceiling, so a chunk of the field shares a perfect recent-form
    // average. A real user maxing Symbols five times running saw "ahead of 65%" and reported it as
    // broken — being level with the rest of the ceiling has to be said out loud.
    describe('at a scoring ceiling', () => {
      it('celebrates instead of showing a deflating percentage when nobody is ahead', async () => {
        setupAuth(mockProgressApi(withForm({
          form: 15, percentile: 65, aheadOf: 22, tiedWith: 11, betterThanMe: 0,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/joint best form/i)).toBeDefined())
        expect(screen.getByText(/level with 11 other agents/i)).toBeDefined()
        // A tie at the ceiling would render as a deflating "top 35%" — celebrate instead.
        expect(screen.queryByText(/top \d+%/i)).toBeNull()
        expect(screen.queryByText('35%')).toBeNull()
      })

      it('names a lone perfect agent outright', async () => {
        setupAuth(mockProgressApi(withForm({
          form: 15, percentile: 97, aheadOf: 33, tiedWith: 0, betterThanMe: 0,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/best form of any agent/i)).toBeDefined())
        expect(screen.queryByText(/level with/i)).toBeNull()
      })

      // Mid-table with ties: the percentage stays, but the ties are explained so it adds up.
      // "Top X%" absorbs ties on its own, so mid-table needs no tie caveat to add up.
      it('keeps the percentage when agents are still ahead', async () => {
        setupAuth(mockProgressApi(withForm({
          percentile: 60, cohort: 10, aheadOf: 6, tiedWith: 2, betterThanMe: 1,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        // Ahead of 60% => the best 40% of the field.
        await waitFor(() => expect(screen.getByText('40%')).toBeDefined())
        expect(screen.getByText(/you're in the top/i)).toBeDefined()
      })

      // Ranking breaks score ties on speed, so at a ceiling the time IS the ranking. Showing it
      // makes "top 8%" on a perfect average self-explaining rather than baffling.
      it('shows the average time the ranking is broken on', async () => {
        setupAuth(mockProgressApi(withForm({ form: 15, formTime: 18.6, percentile: 92 })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/last 5 runs avg 15\/15 · 18\.6s/i)).toBeDefined())
      })

      // Target runs a fixed 60 seconds — its time is a constant, not an achievement, so it would be
      // noise on screen even though it still silently breaks ties.
      it('hides the time on games with no meaningful clock', async () => {
        setupAuth(mockProgressApi(withForm({ form: 240, formTime: 60 })))
        mockUseParams.mockReturnValue({ gameKey: 'target' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/last 5 runs avg 240/i)).toBeDefined())
        expect(screen.queryByText(/60s/i)).toBeNull()
      })

      it('omits the time when the game records none at all', async () => {
        setupAuth(mockProgressApi(withForm({ formTime: null })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/last 5 runs avg 13\/15$/i)).toBeDefined())
      })
    })

    describe('down the field', () => {
      it('still names the exact percentage well below halfway', async () => {
        setupAuth(mockProgressApi(withForm({
          percentile: 30, cohort: 20, aheadOf: 6, tiedWith: 0, betterThanMe: 13,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText('70%')).toBeDefined())
        expect(screen.getByText(/you're in the top/i)).toBeDefined()
      })

      it('keeps naming it right up to the 75% boundary', async () => {
        setupAuth(mockProgressApi(withForm({
          percentile: 25, cohort: 20, aheadOf: 5, tiedWith: 0, betterThanMe: 14,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText('75%')).toBeDefined())
        expect(screen.getByText(/you're in the top/i)).toBeDefined()
      })

      // Past 75 the number stops being useful: the foot of the field computes to "top 100%".
      it('says "outside the top 75%" rather than naming a useless number', async () => {
        setupAuth(mockProgressApi(withForm({
          percentile: 20, cohort: 20, aheadOf: 4, tiedWith: 0, betterThanMe: 15,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/outside the top/i)).toBeDefined())
        expect(screen.getByText('75%')).toBeDefined()
        expect(screen.getByText(/keep practising/i)).toBeDefined()
        expect(screen.queryByText(/in the top/i)).toBeNull()   // not "top 80%"
      })

      it('never says "top 100%" when the user is ahead of nobody', async () => {
        setupAuth(mockProgressApi(withForm({
          percentile: 0, cohort: 10, aheadOf: 0, tiedWith: 0, betterThanMe: 9,
        })))
        mockUseParams.mockReturnValue({ gameKey: 'symbols' })
        render(<CbatLeaderboard />)
        await selectYou()

        await waitFor(() => expect(screen.getByText(/outside the top/i)).toBeDefined())
        expect(screen.queryByText(/100%/)).toBeNull()
        // 99% would be the old fudge — a flattering number that isn't true.
        expect(screen.queryByText('99%')).toBeNull()
      })
    })

    it('says nothing at all when the cohort was too small to rank', async () => {
      setupAuth(mockProgressApi(progressData([10, 12, 14, 15], { form: null })))
      mockUseParams.mockReturnValue({ gameKey: 'symbols' })
      render(<CbatLeaderboard />)
      await selectYou()

      await waitFor(() => expect(screen.getByText('Attempts')).toBeDefined())
      expect(screen.queryByText(/Ahead of/i)).toBeNull()
      expect(screen.queryByText(/Current Form/i)).toBeNull()
    })
  })

  it('invites a first run when the user has never played', async () => {
    setupAuth(mockProgressApi({ attempts: 0, series: [], best: null, firstAvg: null, lastAvg: null }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectYou()

    await waitFor(() => expect(screen.getByText('No runs yet')).toBeDefined())
  })

  it('asks for more runs instead of charting one or two points', async () => {
    setupAuth(mockProgressApi(progressData([10, 12])))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectYou()

    await waitFor(() => expect(screen.getByText('2 runs logged')).toBeDefined())
    expect(screen.getByText(/Play 1 more/i)).toBeDefined()
  })

  // The page already renders a persistent "Play {game}" action below the panel, so an empty state
  // must not add a second one.
  it.each([
    ['no runs at all', []],
    ['too few runs to chart', [10, 12]],
  ])('offers exactly one play button with %s', async (_label, scores) => {
    setupAuth(mockProgressApi(
      scores.length ? progressData(scores) : { attempts: 0, series: [], best: null, firstAvg: null, lastAvg: null }
    ))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectYou()

    await waitFor(() => expect(screen.getByText(/📈/)).toBeDefined())
    expect(screen.getAllByRole('link', { name: /^play/i })).toHaveLength(1)
  })

  // The tile's heading states the verdict so the user never has to decode a sign to find out
  // whether their own number is good news.
  describe('trend tile', () => {
    it('says "Improved" when recent runs beat early ones', async () => {
      setupAuth(mockProgressApi(progressData([5, 6, 7, 10, 11, 12], { firstAvg: 6, lastAvg: 9 })))
      mockUseParams.mockReturnValue({ gameKey: 'symbols' })
      render(<CbatLeaderboard />)
      await selectYou()

      await waitFor(() => expect(screen.getByText('Improved')).toBeDefined())
      expect(screen.getByText('+50%')).toBeDefined()
    })

    // A tile headed "Improved" over a NEGATIVE number would be a straight lie — the heading has to
    // move with the sign.
    it('says "Declined" rather than calling a drop an improvement', async () => {
      setupAuth(mockProgressApi(progressData([12, 11, 10, 7, 6, 5], { firstAvg: 12, lastAvg: 6 })))
      mockUseParams.mockReturnValue({ gameKey: 'symbols' })
      render(<CbatLeaderboard />)
      await selectYou()

      await waitFor(() => expect(screen.getByText('Declined')).toBeDefined())
      expect(screen.getByText('-50%')).toBeDefined()
      expect(screen.queryByText('Improved')).toBeNull()
    })

    it('stays neutral when nothing has really moved', async () => {
      setupAuth(mockProgressApi(progressData([10, 10, 10, 10, 10, 10], { firstAvg: 10, lastAvg: 10 })))
      mockUseParams.mockReturnValue({ gameKey: 'symbols' })
      render(<CbatLeaderboard />)
      await selectYou()

      await waitFor(() => expect(screen.getByText('Steady')).toBeDefined())
      expect(screen.queryByText('Improved')).toBeNull()
      expect(screen.queryByText('Declined')).toBeNull()
    })

    // Trace Practise scores rotations — fewer is better, so a FALLING average is an improving
    // player and the tile must say "Improved", not "Declined".
    it('calls a falling score an improvement on a lower-is-better game', async () => {
      setupAuth(mockProgressApi(progressData([40, 38, 34, 30, 28, 20], { firstAvg: 40, lastAvg: 30 })))
      mockUseParams.mockReturnValue({ gameKey: 'plane-turn-2d' })
      render(<CbatLeaderboard />)
      await selectYou()

      await waitFor(() => expect(screen.getByText('Improved')).toBeDefined())
      expect(screen.getByText('+25%')).toBeDefined()
      expect(screen.queryByText('Declined')).toBeNull()
    })

    // ... and the mirror image: more rotations than before is a decline, however you score it.
    it('calls a rising score a decline on a lower-is-better game', async () => {
      setupAuth(mockProgressApi(progressData([20, 24, 28, 32, 36, 40], { firstAvg: 20, lastAvg: 40 })))
      mockUseParams.mockReturnValue({ gameKey: 'plane-turn-2d' })
      render(<CbatLeaderboard />)
      await selectYou()

      await waitFor(() => expect(screen.getByText('Declined')).toBeDefined())
      expect(screen.queryByText('Improved')).toBeNull()
    })
  })
})
