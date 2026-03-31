import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    awardAircoins: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
}))

vi.mock('../../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(),
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
  aircoinsPerWinEasy: 10,
  aircoinsPerWinMedium: 20,
  aircoinsPerBriefRead: 5,
  aircoinsFirstLogin: 5,
  aircoinsStreakBonus: 2,
  aircoins100Percent: 10,
  aircoinsOrderOfBattleEasy: 8,
  aircoinsOrderOfBattleMedium: 18,
  useLiveLeaderboard: false,
  disableLoadingBar: false,
  pathwayUnlocks: [
    { category: 'Bases',       levelRequired: 1, rankRequired: 1, tierRequired: 'free'   },
    { category: 'Terminology', levelRequired: 1, rankRequired: 1, tierRequired: 'free'   },
    { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1, tierRequired: 'free'   },
    { category: 'Heritage',    levelRequired: 2, rankRequired: 1, tierRequired: 'free'   },
    { category: 'Ranks',       levelRequired: 2, rankRequired: 1, tierRequired: 'silver' },
    { category: 'Squadrons',   levelRequired: 3, rankRequired: 2, tierRequired: 'silver' },
    { category: 'Allies',      levelRequired: 3, rankRequired: 2, tierRequired: 'free'   },
    { category: 'Training',    levelRequired: 4, rankRequired: 2, tierRequired: 'silver' },
    { category: 'AOR',         levelRequired: 4, rankRequired: 2, tierRequired: 'silver' },
    { category: 'Roles',       levelRequired: 5, rankRequired: 3, tierRequired: 'silver' },
    { category: 'Tech',        levelRequired: 5, rankRequired: 3, tierRequired: 'silver' },
    { category: 'Threats',     levelRequired: 6, rankRequired: 3, tierRequired: 'gold'   },
    { category: 'Missions',    levelRequired: 7, rankRequired: 4, tierRequired: 'gold'   },
    { category: 'Treaties',    levelRequired: 8, rankRequired: 4, tierRequired: 'gold'   },
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
  await waitFor(() => screen.getByText('Pathway Unlock Requirements'))
  fireEvent.click(screen.getByText('Pathway Unlock Requirements'))

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

  it('shows the correct tier for Treaties (gold)', async () => {
    await renderAndOpenPathwaySection()

    // Find the Treaties row — it should have a tier select displaying 'gold'
    const treatiesCell = screen.getByText('Treaties')
    const row = treatiesCell.closest('tr')
    const selects = row.querySelectorAll('select')
    const tierSelect = selects[selects.length - 1]
    expect(tierSelect.value).toBe('gold')
  })

  it('shows the correct tier for Allies (free)', async () => {
    await renderAndOpenPathwaySection()

    const alliesCell = screen.getByText('Allies')
    const row = alliesCell.closest('tr')
    const selects = row.querySelectorAll('select')
    const tierSelect = selects[selects.length - 1]
    expect(tierSelect.value).toBe('free')
  })

  it('changing tier for Terminology updates the select', async () => {
    await renderAndOpenPathwaySection()

    const cell = screen.getByText('Terminology')
    const row = cell.closest('tr')
    const selects = row.querySelectorAll('select')
    const tierSelect = selects[selects.length - 1]

    fireEvent.change(tierSelect, { target: { value: 'silver' } })

    await waitFor(() => expect(tierSelect.value).toBe('silver'))
  })
})
