import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: {},
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, ...r }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled, ...r }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const MOCK_SETTINGS = {
  trialDurationDays: 7,
  guestCategories: ['News'],
  freeCategories: ['News'],
  silverCategories: [],
  ammoFree: 3,
  ammoSilver: 10,
  easyAnswerCount: 4,
  mediumAnswerCount: 5,
  passThresholdEasy: 60,
  passThresholdMedium: 60,
  airstarsPerWinEasy: 10,
  airstarsPerWinMedium: 20,
  airstarsPerBriefRead: 5,
  airstarsFirstLogin: 5,
  airstarsStreakBonus: 2,
  airstars100Percent: 10,
  airstarsOrderOfBattleEasy: 8,
  airstarsOrderOfBattleMedium: 18,
  useLiveLeaderboard: false,
  disableLoadingBar: false,
  pathwayUnlocks: [
    { category: 'Bases',       levelRequired: 1, rankRequired: 1 },
    { category: 'Terminology', levelRequired: 1, rankRequired: 1 },
    { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1 },
    { category: 'Heritage',    levelRequired: 2, rankRequired: 1 },
    { category: 'Ranks',       levelRequired: 2, rankRequired: 1 },
    { category: 'Squadrons',   levelRequired: 3, rankRequired: 2 },
    { category: 'Allies',      levelRequired: 3, rankRequired: 2 },
    { category: 'Training',    levelRequired: 4, rankRequired: 2 },
    { category: 'AOR',         levelRequired: 4, rankRequired: 2 },
    { category: 'Roles',       levelRequired: 5, rankRequired: 3 },
    { category: 'Tech',        levelRequired: 5, rankRequired: 3 },
    { category: 'Threats',     levelRequired: 6, rankRequired: 3 },
    { category: 'Missions',    levelRequired: 7, rankRequired: 4 },
    { category: 'Treaties',    levelRequired: 8, rankRequired: 4 },
  ],
}

const MOCK_STATS = {
  users:  { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, totalLogins: 0, combinedStreaks: 0 },
  games:  { totalGamesPlayed: 0, totalGamesCompleted: 0, totalGamesAbandoned: 0, quizTotalSeconds: 0, boo: { totalGames: 0, totalSeconds: 0 } },
  briefs: { totalBriefs: 0, totalReads: 0, totalKeywordTaps: 0, avgKeywordsPerBrief: 0 },
  tutorials: {},
}

function setupFetch() {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/api/admin/stats'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_STATS }) })
    if (url.includes('/api/admin/problems/count'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings') && (!opts?.method || opts.method === 'GET'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: MOCK_SETTINGS } }) })
    if (url.includes('/api/admin/settings') && opts?.method === 'PATCH')
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function renderAndOpenPathwaySection() {
  global.fetch = setupFetch()
  global.Audio = class { constructor() { this.play = vi.fn().mockResolvedValue(undefined) } }
  render(<Admin />)

  const settingsTab = await screen.findByRole('button', { name: /settings/i })
  fireEvent.click(settingsTab)

  // Expand the Pathway Unlock Requirements section
  await waitFor(() => screen.getByText('Pathway Access & Unlock Requirements'))
  fireEvent.click(screen.getByText('Pathway Access & Unlock Requirements'))

  await waitFor(() => screen.getByText('Bases'))
}

const ALL_PATHWAY_CATEGORIES = [
  'Bases', 'Terminology', 'Aircrafts', 'Heritage', 'Ranks',
  'Squadrons', 'Allies', 'Training', 'AOR', 'Roles',
  'Tech', 'Threats', 'Missions', 'Treaties',
]

describe('Admin — Pathway Unlock Requirements', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders a row for all 14 pathway categories', async () => {
    await renderAndOpenPathwaySection()

    for (const cat of ALL_PATHWAY_CATEGORIES) {
      expect(screen.getByText(cat)).toBeDefined()
    }
  })

  it('does not render a Tier Required column header', async () => {
    await renderAndOpenPathwaySection()
    expect(screen.queryByText(/tier required/i)).toBeNull()
  })

  it('each row has a tier select and a rank select', async () => {
    await renderAndOpenPathwaySection()

    const basesCell = screen.getByText('Bases')
    const row = basesCell.closest('tr')
    const selects = row.querySelectorAll('select')
    expect(selects).toHaveLength(2) // tier select + rank select
    // First select is tier (guest/free/silver/gold)
    expect(['guest', 'free', 'silver', 'gold']).toContain(selects[0].value)
  })

  it('shows the correct level for Treaties (8)', async () => {
    await renderAndOpenPathwaySection()

    const treatiesCell = screen.getByText('Treaties')
    const row = treatiesCell.closest('tr')
    const input = row.querySelector('input[type="number"]')
    expect(input.value).toBe('8')
  })

  it('shows the correct level for Bases (1)', async () => {
    await renderAndOpenPathwaySection()

    const basesCell = screen.getByText('Bases')
    const row = basesCell.closest('tr')
    const input = row.querySelector('input[type="number"]')
    expect(input.value).toBe('1')
  })

  it('changing level for Terminology updates the input', async () => {
    await renderAndOpenPathwaySection()

    const cell = screen.getByText('Terminology')
    const row = cell.closest('tr')
    const input = row.querySelector('input[type="number"]')

    fireEvent.change(input, { target: { value: '3' } })

    await waitFor(() => expect(input.value).toBe('3'))
  })

  it('setting tier to "free" cascades into silverCategories (and strips from guest)', async () => {
    const fetchSpy = setupFetch()
    global.fetch = fetchSpy
    global.Audio = class { constructor() { this.play = vi.fn().mockResolvedValue(undefined) } }
    render(<Admin />)

    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Pathway Access & Unlock Requirements'))
    fireEvent.click(screen.getByText('Pathway Access & Unlock Requirements'))
    await waitFor(() => screen.getByText('Aircrafts'))

    // Aircrafts starts in nothing → tier=gold. Change to free.
    const row    = screen.getByText('Aircrafts').closest('tr')
    const select = row.querySelector('select')
    fireEvent.change(select, { target: { value: 'free' } })

    // Save the section
    const saveBtns = screen.getAllByRole('button', { name: /^save$/i })
    fireEvent.click(saveBtns[0])
    const confirmBtn = await screen.findByRole('button', { name: /save changes/i })
    fireEvent.click(confirmBtn)

    // Find the PATCH body
    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        ([url, opts]) => url.includes('/api/admin/settings') && opts?.method === 'PATCH'
      )
      expect(patchCall).toBeDefined()
    })
    const patchCall = fetchSpy.mock.calls.find(
      ([url, opts]) => url.includes('/api/admin/settings') && opts?.method === 'PATCH'
    )
    const body = JSON.parse(patchCall[1].body)

    expect(body.freeCategories).toContain('Aircrafts')
    expect(body.silverCategories).toContain('Aircrafts')
    expect(body.guestCategories ?? []).not.toContain('Aircrafts')
  })

  it('setting tier to "guest" cascades into all three arrays', async () => {
    const fetchSpy = setupFetch()
    global.fetch = fetchSpy
    global.Audio = class { constructor() { this.play = vi.fn().mockResolvedValue(undefined) } }
    render(<Admin />)

    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Pathway Access & Unlock Requirements'))
    fireEvent.click(screen.getByText('Pathway Access & Unlock Requirements'))
    await waitFor(() => screen.getByText('Bases'))

    const row    = screen.getByText('Bases').closest('tr')
    const select = row.querySelector('select')
    fireEvent.change(select, { target: { value: 'guest' } })

    const saveBtns = screen.getAllByRole('button', { name: /^save$/i })
    fireEvent.click(saveBtns[0])
    const confirmBtn = await screen.findByRole('button', { name: /save changes/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        ([url, opts]) => url.includes('/api/admin/settings') && opts?.method === 'PATCH'
      )
      expect(patchCall).toBeDefined()
    })
    const patchCall = fetchSpy.mock.calls.find(
      ([url, opts]) => url.includes('/api/admin/settings') && opts?.method === 'PATCH'
    )
    const body = JSON.parse(patchCall[1].body)

    expect(body.guestCategories).toContain('Bases')
    expect(body.freeCategories).toContain('Bases')
    expect(body.silverCategories).toContain('Bases')
  })
})
