import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

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
    awardAircoins: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
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

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_SETTINGS = {
  trialDurationDays: 7,
  guestCategories: ['News'],
  freeCategories: ['News'],
  silverCategories: [],
  ammoFree: 0,
  ammoSilver: 3,
  easyAnswerCount: 4,
  mediumAnswerCount: 4,
  passThresholdEasy: 60,
  passThresholdMedium: 60,
  aircoinsPerWinEasy: 5,
  aircoinsPerWinMedium: 10,
  aircoinsPerBriefRead: 5,
  aircoinsFirstLogin: 5,
  aircoinsStreakBonus: 2,
  aircoins100Percent: 10,
  aircoinsOrderOfBattleEasy: 10,
  aircoinsOrderOfBattleMedium: 20,
  aircoinsWhereAircraftRound1: 5,
  aircoinsWhereAircraftRound2: 10,
  aircoinsWhereAircraftBonus: 5,
  aircoinsFlashcardPerCard: 3,
  aircoinsFlashcardPerfectBonus: 5,
  useLiveLeaderboard: false,
  disableLoadingBar: false,
  // Sounds — targeting engaged at 80% to distinguish from default 100
  volumeTargetLocked: 80,        soundEnabledTargetLocked: true,
  volumeStandDown: 100,          soundEnabledStandDown: true,
  volumeTargetLockedKeyword: 100, soundEnabledTargetLockedKeyword: true,
  volumeFire: 100,               soundEnabledFire: true,
  volumeOutOfAmmo: 100,          soundEnabledOutOfAmmo: true,
  volumeIntelBriefOpened: 100,   soundEnabledIntelBriefOpened: true,
  volumeAircoin: 100,            soundEnabledAircoin: true,
  volumeLevelUp: 100,            soundEnabledLevelUp: true,
  volumeRankPromotion: 100,      soundEnabledRankPromotion: true,
  volumeQuizCompleteWin: 100,    soundEnabledQuizCompleteWin: true,
  volumeQuizCompleteLose: 100,   soundEnabledQuizCompleteLose: true,
  volumeBattleOfOrderSelection: 100, soundEnabledBattleOfOrderSelection: true,
  volumeBattleOfOrderWon: 100,   soundEnabledBattleOfOrderWon: true,
  volumeBattleOfOrderLost: 100,  soundEnabledBattleOfOrderLost: true,
  // Pathway unlock rows (rendered by the Pathway Access section)
  pathwayUnlocks: [
    { category: 'Bases',     levelRequired: 1, rankRequired: 1 },
    { category: 'Aircrafts', levelRequired: 2, rankRequired: 1 },
    { category: 'Ranks',     levelRequired: 2, rankRequired: 1 },
  ],
}

// Mock returned by /api/admin/economy-viability — drives the AircoinsEconomy section
const MOCK_ECONOMY = {
  status: 'success',
  data: {
    rates: {
      aircoinsPerBriefRead:           5,
      aircoinsFirstLogin:             5,
      aircoinsStreakBonus:            2,
      aircoinsPerWinEasy:             5,
      aircoinsPerWinMedium:           10,
      aircoins100Percent:             10,
      aircoinsOrderOfBattleEasy:      10,
      aircoinsOrderOfBattleMedium:    20,
      aircoinsWhereAircraftRound1:    5,
      aircoinsWhereAircraftRound2:    10,
      aircoinsWhereAircraftBonus:     5,
      aircoinsFlashcardPerCard:       3,
      aircoinsFlashcardPerfectBonus:  6,
    },
    cycleThreshold:           100,
    totalRanks:                19,
    ranks:                    [],
    levels:                   [{ levelNumber: 1, aircoinsToNextLevel: 100 }],
    content:                  { totalBriefs: 0, wtaBriefs: 0, booEligibleBriefs: 0 },
    aiQuestionsPerDifficulty: 7,
  },
}

const MOCK_STATS = {
  users: { totalUsers: 10, freeUsers: 5, trialUsers: 2, subscribedUsers: 3, easyPlayers: 6, mediumPlayers: 4, totalLogins: 100, combinedStreaks: 20 },
  games: { totalGamesPlayed: 50, totalGamesCompleted: 40, totalGamesAbandoned: 10, quizTotalSeconds: 3600, boo: { totalGames: 5, totalSeconds: 600 } },
  briefs: { totalBriefs: 20, totalReads: 80, totalKeywordTaps: 200, avgKeywordsPerBrief: 5 },
  tutorials: {},
}

function setupFetch({ patchStatus = 'success' } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_STATS }) })
    }
    if (url.includes('/api/admin/problems/count')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    }
    if (url.includes('/api/admin/economy-viability')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_ECONOMY })
    }
    if (url.includes('/api/users/me/wta-spawn')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    }
    if (url.includes('/api/admin/settings') && (!opts?.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: MOCK_SETTINGS } }) })
    }
    if (url.includes('/api/admin/settings') && opts?.method === 'PATCH') {
      return Promise.resolve({ ok: true, json: async () => ({ status: patchStatus }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Audio mock ────────────────────────────────────────────────────────────

let audioInstances = []

class MockAudio {
  constructor(src) {
    this.src = src
    this.volume = 1
    this.play = vi.fn().mockResolvedValue(undefined)
    audioInstances.push(this)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function renderAndOpenSettings() {
  global.fetch = setupFetch()
  render(<Admin />)

  // Navigate to Settings tab
  const settingsTab = await screen.findByRole('button', { name: /settings/i })
  fireEvent.click(settingsTab)

  // Wait for settings to load then expand the Sound Effects collapsible section
  await waitFor(() => screen.getByText('Sound Effects'))
  fireEvent.click(screen.getByText('Sound Effects'))
  await waitFor(() => screen.getByText('Targeting Engaged'))
  return screen
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Settings tab: Sound Effects', () => {
  beforeEach(() => {
    audioInstances = []
    global.Audio = MockAudio
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── Preview button plays the correct file ────────────────────────────

  it('▶ for "Targeting Engaged" plays target_locked.mp3 (not targeting_engaged.mp3)', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Targeting Engaged').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    expect(audioInstances.length).toBeGreaterThan(0)
    const last = audioInstances.at(-1)
    expect(last.src).toBe('/sounds/target_locked.mp3')
    expect(last.play).toHaveBeenCalled()
  })

  it('▶ for "Out of Ammo" plays an out_of_ammo variant (not out_of_ammo.mp3)', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Out of Ammo').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    const last = audioInstances.at(-1)
    expect(last.src).toMatch(/^\/sounds\/out_of_ammo_[123]\.mp3$/)
    expect(last.play).toHaveBeenCalled()
  })

  it('▶ for "Brief Opened" plays intel_brief_opened.mp3', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Brief Opened').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    const last = audioInstances.at(-1)
    expect(last.src).toBe('/sounds/intel_brief_opened.mp3')
    expect(last.play).toHaveBeenCalled()
  })

  it('▶ for "Quiz Won" plays quiz_complete_win.mp3', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Quiz Won').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    const last = audioInstances.at(-1)
    expect(last.src).toBe('/sounds/quiz_complete_win.mp3')
    expect(last.play).toHaveBeenCalled()
  })

  it('▶ for "Quiz Fail" plays quiz_complete_lose.mp3', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Quiz Fail').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    const last = audioInstances.at(-1)
    expect(last.src).toBe('/sounds/quiz_complete_lose.mp3')
    expect(last.play).toHaveBeenCalled()
  })

  it('▶ for "Keyword Scan" plays target_locked_keyword.mp3', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Keyword Scan').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    const last = audioInstances.at(-1)
    expect(last.src).toBe('/sounds/target_locked_keyword.mp3')
    expect(last.play).toHaveBeenCalled()
  })

  it('preview uses the volume from settings (80% → 0.8)', async () => {
    await renderAndOpenSettings()

    // "Targeting Engaged" has volumeTargetLocked: 80 in MOCK_SETTINGS
    const row = screen.getByText('Targeting Engaged').closest('div')
    fireEvent.click(within(row).getByTitle('Preview'))

    const last = audioInstances.at(-1)
    expect(last.volume).toBeCloseTo(0.8)
  })

  // ── Toggle enable / disable ───────────────────────────────────────────

  it('sound row becomes dimmed when its toggle is clicked off', async () => {
    await renderAndOpenSettings()

    // SoundRowV2 wraps an inner flex row in an outer div that carries the opacity-50 class
    const row = screen.getByText('Brief Opened').closest('div').parentElement

    // Initially enabled — no opacity-50 class on the row
    expect(row.className).not.toContain('opacity-50')

    // Click the toggle button (first button inside the row)
    fireEvent.click(within(row).getAllByRole('button')[0])

    // Now the row should be dimmed
    await waitFor(() => expect(row.className).toContain('opacity-50'))
  })

  it('sound row can be re-enabled after toggling off', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Brief Opened').closest('div').parentElement
    const toggle = within(row).getAllByRole('button')[0]

    // Toggle off then back on
    fireEvent.click(toggle)
    await waitFor(() => expect(row.className).toContain('opacity-50'))

    fireEvent.click(toggle)
    await waitFor(() => expect(row.className).not.toContain('opacity-50'))
  })

  // ── Volume slider ────────────────────────────────────────────────────

  it('volume slider updates the % label when dragged', async () => {
    await renderAndOpenSettings()

    const row = screen.getByText('Brief Opened').closest('div')
    const slider = within(row).getByRole('slider')

    // Starts at 100%
    expect(within(row).getByText('100%')).toBeDefined()

    // Change to 50
    fireEvent.change(slider, { target: { value: '50' } })

    await waitFor(() => expect(within(row).getByText('50%')).toBeDefined())
  })

  // ── Save flow ────────────────────────────────────────────────────────

  it('clicking "Save" on Sound Effects opens a confirm modal', async () => {
    await renderAndOpenSettings()

    // Find the Sound Effects section's Save button
    const soundSection = screen.getByText('Sound Effects').closest('div').parentElement
    const saveBtn = within(soundSection).getByText('Save')
    fireEvent.click(saveBtn)

    await waitFor(() => screen.getByText('Save Changes'))
  })

  it('confirming save calls PATCH /api/admin/settings', async () => {
    global.fetch = setupFetch()
    render(<Admin />)

    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Sound Effects'))
    fireEvent.click(screen.getByText('Sound Effects'))
    await waitFor(() => screen.getByText('Targeting Engaged'))

    const soundSection = screen.getByText('Sound Effects').closest('div').parentElement
    const saveBtn = within(soundSection).getByText('Save')
    fireEvent.click(saveBtn)

    // Confirm modal requires a reason before the confirm button is enabled
    await waitFor(() => screen.getByPlaceholderText(/briefly describe why/i))
    fireEvent.change(screen.getByPlaceholderText(/briefly describe why/i), {
      target: { value: 'Test save' },
    })

    const confirmBtn = screen.getByRole('button', { name: /save changes/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find(
        ([url, opts]) => url.includes('/api/admin/settings') && opts?.method === 'PATCH'
      )
      expect(patchCall).toBeTruthy()
    })
  })
})

describe('Admin — Settings tab: Pathway Access (trial duration + tier access)', () => {
  beforeEach(() => {
    global.Audio = MockAudio
    audioInstances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openPathwaySection() {
    global.fetch = setupFetch()
    render(<Admin />)
    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Pathway Access & Unlock Requirements'))
    fireEvent.click(screen.getByText('Pathway Access & Unlock Requirements'))
    await waitFor(() => screen.getByText('Aircrafts'))
  }

  it('shows trial duration from settings', async () => {
    await openPathwaySection()
    expect(screen.getByDisplayValue('7')).toBeDefined()
  })

  it('changing a category tier select to "free" updates the row', async () => {
    await openPathwaySection()

    // Aircrafts is not in any tier list — defaults to 'gold'
    const row  = screen.getByText('Aircrafts').closest('tr')
    const tier = row.querySelector('select') // first <select> is the tier select
    expect(tier.value).toBe('gold')

    fireEvent.change(tier, { target: { value: 'free' } })

    await waitFor(() => {
      const updatedTier = screen.getByText('Aircrafts').closest('tr').querySelector('select')
      expect(updatedTier.value).toBe('free')
    })
  })

  it('changing a category tier select back to "gold" updates the row', async () => {
    await openPathwaySection()

    const row  = screen.getByText('Bases').closest('tr')
    const tier = row.querySelector('select')

    // First switch to free, then back to gold to confirm both transitions
    fireEvent.change(tier, { target: { value: 'free' } })
    await waitFor(() => {
      expect(screen.getByText('Bases').closest('tr').querySelector('select').value).toBe('free')
    })

    fireEvent.change(screen.getByText('Bases').closest('tr').querySelector('select'), { target: { value: 'gold' } })
    await waitFor(() => {
      expect(screen.getByText('Bases').closest('tr').querySelector('select').value).toBe('gold')
    })
  })
})

describe('Admin — Settings tab: Feature Flags', () => {
  beforeEach(() => {
    global.Audio = MockAudio
    audioInstances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Live Leaderboard toggle starts off and can be toggled on', async () => {
    global.fetch = setupFetch()
    render(<Admin />)

    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Feature Flags'))
    fireEvent.click(screen.getByText('Feature Flags'))
    await waitFor(() => screen.getByText('Live Leaderboard'))

    // Initial state: useLiveLeaderboard is false → toggle is bg-slate-200
    const row = screen.getByText('Live Leaderboard').closest('div').parentElement
    const toggle = within(row).getByRole('button')
    expect(toggle.className).toContain('bg-slate-200')

    fireEvent.click(toggle)

    await waitFor(() => expect(toggle.className).toContain('bg-brand-500'))
  })

  it('Live Leaderboard toggle starts off and cannot be found alongside a removed Disable Loading Bar', async () => {
    global.fetch = setupFetch()
    render(<Admin />)

    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Feature Flags'))
    fireEvent.click(screen.getByText('Feature Flags'))
    await waitFor(() => screen.getByText('Live Leaderboard'))

    // "Disable Loading Bar" was removed from the Admin UI — should not appear
    expect(screen.queryByText('Disable Loading Bar')).toBeNull()
  })
})

describe('Admin — Settings tab: Aircoins Economy & Game options', () => {
  beforeEach(() => {
    global.Audio = MockAudio
    audioInstances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openAircoinsEconomy() {
    global.fetch = setupFetch()
    render(<Admin />)
    const settingsTab = await screen.findByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)
    await waitFor(() => screen.getByText('Aircoins Economy Settings'))
    fireEvent.click(screen.getByText('Aircoins Economy Settings'))
    // Wait for the simulation panel to render once economy-viability resolves
    await waitFor(() => screen.getByText('Streak bonus'))
  }

  it('shows correct aircoins streak bonus value from settings', async () => {
    await openAircoinsEconomy()
    // aircoinsStreakBonus = 2 (unique rate value in MOCK_ECONOMY)
    expect(screen.getByDisplayValue('2')).toBeDefined()
  })

  it('changing an aircoin rate input updates the value', async () => {
    await openAircoinsEconomy()

    // aircoinsStreakBonus = 2 is unique among the rate inputs
    const input = screen.getByDisplayValue('2')
    fireEvent.change(input, { target: { value: '5' } })

    await waitFor(() => expect(input.value).toBe('5'))
  })
})
