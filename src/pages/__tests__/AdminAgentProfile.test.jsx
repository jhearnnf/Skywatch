import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The read-only agent profile an admin reaches from a name in Community.
//
// Two things earn their tests here. First the gate: a non-admin who guesses the
// URL must be sent away, not shown a stripped-down page. Second the trophy
// area, whose whole point is that "12 of 30" is only meaningful next to the 18
// they have not collected, so the locked half has to be reachable.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ current: { isAdmin: true } }))
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current, API: '', apiFetch: mockApiFetch }),
}))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ levels: [
    { levelNumber: 1, cumulativeAirstars: 0,   airstarsToNextLevel: 100 },
    { levelNumber: 2, cumulativeAirstars: 100, airstarsToNextLevel: 150 },
  ] }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/admin/UserCbatProgressModal', () => ({
  default: () => <div>progress modal</div>,
}))

import AdminAgentProfile from '../AdminAgentProfile'

const badge = (title) => ({
  briefId: `b-${title}`, title, cutoutUrl: `/cutouts/${title}.png`,
})

const payload = (over = {}) => ({
  status: 'success',
  data: {
    user: {
      _id: 'u2', displayName: 'Viper', agentNumber: '1000042', email: 'viper@test.com',
      isAdmin: false, isBot: false, isBanned: false, isTester: false, cbatPassed: true,
      chatBannedAt: null, createdAt: '2026-01-04T10:00:00.000Z', lastSeen: '2026-09-01T09:00:00.000Z',
      loginStreak: 6, totalAirstars: 1200, cycleAirstars: 150,
      difficultySetting: 'hard', subscriptionTier: 'gold',
      rank: { rankName: 'Sergeant', rankAbbreviation: 'Sgt', rankNumber: 4 },
      selectedBadge: badge('Typhoon'),
    },
    stats: {
      briefsRead: 7, quizzesPlayed: 2, booPlayed: 1, wtaPlayed: 0, wherePlayed: 0,
      flashcardsPlayed: 0, cbatFinished: 9, cbatStarted: 14, lastCbatAt: '2026-09-08T18:00:00.000Z',
    },
    badges: { earned: [badge('Typhoon')], locked: [badge('Hawk T2'), badge('Chinook')], pendingCount: 0 },
    medals: [
      { gameKey: 'flag', gameLabel: 'FLAG (Hard)', rank: 1 },
      { gameKey: 'angles', gameLabel: 'Angles', rank: 3 },
    ],
    cbatGames: [
      { gameKey: 'flag', label: 'FLAG (Hard)', attempts: 6, best: 386, boardRank: 1, lastPlayedAt: '2026-09-08T18:00:00.000Z' },
      { gameKey: 'angles', label: 'Angles', attempts: 3, best: 18, boardRank: 3, lastPlayedAt: '2026-09-01T18:00:00.000Z' },
      { gameKey: 'symbols', label: 'Symbols', attempts: 2, best: 9, boardRank: 7, lastPlayedAt: '2026-08-20T18:00:00.000Z' },
      { gameKey: 'target', label: 'Target', attempts: 1, best: 120, boardRank: null, lastPlayedAt: '2026-08-01T18:00:00.000Z' },
    ],
    ...over,
  },
})

const ok = (body) => ({ ok: true, json: () => Promise.resolve(body) })

const renderPage = (state) => render(
  <MemoryRouter initialEntries={[{ pathname: '/admin/agent/u2', state }]}>
    <Routes>
      <Route path="/admin/agent/:id" element={<AdminAgentProfile />} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  mockApiFetch.mockReset()
  mockNavigate.mockReset()
  mockUser.current = { isAdmin: true }
  mockApiFetch.mockResolvedValue(ok(payload()))
})
afterEach(() => cleanup())

describe('AdminAgentProfile — the gate', () => {
  it('sends a non-admin away rather than rendering anything', async () => {
    mockUser.current = { isAdmin: false }
    renderPage()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('says on the page that it is an admin view, not just on the button that opened it', async () => {
    renderPage()
    expect(await screen.findByText('Admin View')).toBeInTheDocument()
  })
})

describe('AdminAgentProfile — identity', () => {
  it('shows the name, agent number, rank and streak', async () => {
    renderPage()
    expect(await screen.findByText('Viper')).toBeInTheDocument()
    expect(screen.getByText('#1000042')).toBeInTheDocument()
    expect(screen.getByText('Sergeant (Sgt)')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('shows the account facts an agent never sees on their own card', async () => {
    renderPage()
    expect(await screen.findByText('viper@test.com')).toBeInTheDocument()
    expect(screen.getByText('gold')).toBeInTheDocument()
    expect(screen.getByText('hard')).toBeInTheDocument()
  })
})

describe('AdminAgentProfile — trophy area', () => {
  it('counts the collection against what can be collected', async () => {
    renderPage()
    await screen.findByText('Viper')
    expect(screen.getByText('of 3')).toBeInTheDocument()
  })

  it('shows only what they have collected until asked for the rest', async () => {
    renderPage()
    await screen.findByText('Viper')
    expect(screen.getByText('Typhoon')).toBeInTheDocument()
    expect(screen.queryByText('Hawk T2')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show the 2 not collected' }))
    expect(screen.getByText('Hawk T2')).toBeInTheDocument()
    expect(screen.getByText('Chinook')).toBeInTheDocument()
  })

  it('marks the badge they are actually wearing', async () => {
    renderPage()
    await screen.findByText('Viper')
    expect(screen.getByText('Worn')).toBeInTheDocument()
  })
})

describe('AdminAgentProfile — leaderboard medals', () => {
  it('names each podium place and the board it is held on', async () => {
    renderPage()
    await screen.findByText('Viper')
    expect(screen.getByText('Gold')).toBeInTheDocument()
    expect(screen.getByText('Bronze')).toBeInTheDocument()
    // The board is named, because a medal with no board is unreadable.
    expect(screen.getAllByText('FLAG (Hard)').length).toBeGreaterThan(0)
  })

  it('says plainly when they hold none rather than showing an empty card', async () => {
    mockApiFetch.mockResolvedValue(ok(payload({ medals: [] })))
    renderPage()
    expect(await screen.findByText('Not in the top three on any all time board right now.'))
      .toBeInTheDocument()
  })

  it('warns that a medal can be lost, so a stale screenshot is not read as permanent', async () => {
    renderPage()
    await screen.findByText('Viper')
    expect(screen.getByText(/lost the moment someone overtakes them/)).toBeInTheDocument()
  })
})

describe('AdminAgentProfile — board position on each record row', () => {
  it('shows a plain place for a score below the podium', async () => {
    renderPage()
    await screen.findByText('Viper')
    expect(screen.getByText('#7')).toBeInTheDocument()
  })

  it('draws nothing at all for a score outside the top 20', async () => {
    renderPage()
    await screen.findByText('Viper')
    // Target is on the record with no board position; there must be no chip
    // implying a rank we do not actually know.
    expect(screen.getByText('Target')).toBeInTheDocument()
    expect(screen.queryByText('#null')).not.toBeInTheDocument()
    expect(screen.queryByText(/^#2[0-9]/)).not.toBeInTheDocument()
  })
})

describe('AdminAgentProfile — CBAT record', () => {
  it('lists each test with the attempts and the personal best', async () => {
    renderPage()
    await screen.findByText('Viper')
    // Named twice now: once on its medal, once on this row.
    expect(screen.getAllByText('FLAG (Hard)')).toHaveLength(2)
    expect(screen.getByText('386')).toBeInTheDocument()
    expect(screen.getByText('18/20')).toBeInTheDocument()   // Angles formats out of 20
    expect(screen.getByText(/6 finished/)).toBeInTheDocument()
  })

  it('says so plainly when they have never finished one', async () => {
    mockApiFetch.mockResolvedValue(ok(payload({ cbatGames: [] })))
    renderPage()
    expect(await screen.findByText('They have never finished a CBAT test.')).toBeInTheDocument()
  })
})

describe('AdminAgentProfile — routes onward', () => {
  it('opens their CBAT history in admin mode, and tells it to come back here', async () => {
    renderPage()
    await screen.findByText('Viper')
    fireEvent.click(screen.getByRole('button', { name: 'CBAT game history' }))

    expect(mockNavigate).toHaveBeenCalledWith('/cbat-game-history', {
      state: expect.objectContaining({
        adminUserId: 'u2',
        adminUserName: 'Viper',
        backTo: '/admin/agent/u2',
        backLabel: 'Back to Profile',
      }),
    })
  })

  it('opens their brief and legacy game histories from the stat tiles', async () => {
    renderPage()
    await screen.findByText('Viper')

    fireEvent.click(screen.getByRole('button', { name: /Briefs read/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/intel-brief-history', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /Other games/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/game-history', expect.anything())
  })

  it('goes back to the conversation it was opened from, not to the admin panel', async () => {
    renderPage({ backTo: '/chat/c1', backLabel: 'Back to Community' })
    fireEvent.click(await screen.findByRole('button', { name: '← Back to Community' }))
    expect(mockNavigate).toHaveBeenCalledWith('/chat/c1', undefined)
  })

  it('falls back to Admin > Users when nothing said where it came from', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '← Back to Admin' }))
    expect(mockNavigate).toHaveBeenCalledWith('/admin', { state: { tab: 'users' } })
  })
})

// The CBAT record below says how much of the battery they have sat. This says
// what it would be worth, which is the question an admin opening a support
// thread actually has. It is the agent's own card, fetched for them: the one
// thing it must never do is show the reading admin their own numbers under
// somebody else's name.
describe('AdminAgentProfile — the aptitude report', () => {
  const REPORT = {
    targetBattery: 'pilot',
    batteries: [{ key: 'pilot', label: 'Pilot', cutoff: 112, score: 128, margin: 16, status: 'pass', coverage: 74 }],
    targetFocus: null,
    nearestUnlock: null,
    runsToCount: 3,
  }

  const routed = () => {
    mockApiFetch.mockImplementation((url) => Promise.resolve(
      url.includes('/api/games/cbat/report') ? ok({ data: REPORT }) : ok(payload()),
    ))
    return renderPage()
  }

  it('asks for that agent’s report and shows their estimate', async () => {
    routed()
    await screen.findByText('Viper')
    await waitFor(() => expect(screen.getByTestId('aptitude-card-score')).toHaveTextContent('128 / pass mark 112'))
    expect(mockApiFetch).toHaveBeenCalledWith('/api/games/cbat/report?userId=u2')
  })

  it('opens the full report as them', async () => {
    routed()
    await screen.findByText('Viper')
    await waitFor(() => expect(screen.getByTestId('aptitude-card-score')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Aptitude Report/ })).toHaveAttribute('href', '/cbat/report?as=u2')
  })
})
