import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    awardAircoins: vi.fn(),
    setUser: vi.fn(),
    refreshUser: vi.fn(),
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
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_BRIEF = {
  _id:                 'brief1',
  title:               'Eurofighter Typhoon',
  subtitle:            'Multi-role combat aircraft',
  category:            'Aircrafts',
  subcategory:         '',
  historic:            false,
  isPublished:         true,
  descriptionSections: ['The Typhoon is a fast jet.', 'It is based at RAF Coningsby.'],
  keywords:            [{ keyword: 'Typhoon', generatedDescription: 'A fast jet' }],
  sources:             [],
  media:               [],
  quizQuestionsEasy:   [],
  quizQuestionsMedium: [],
}

const CASCADE_SUCCESS = { status: 'success', data: { coinsReversed: 30, usersAffected: 2, quizQuestionsDeleted: 5, briefReadsDeleted: 2, booGamesDeleted: 1, aircoinLogsDeleted: 3 } }
const REGEN_RESPONSE  = {
  status: 'success',
  data: {
    descriptionSections: ['Freshly generated section one.', 'Freshly generated section two.'],
    keywords:            [{ keyword: 'Freshly', generatedDescription: 'New keyword' }],
    easyQuestions:   Array.from({ length: 10 }, (_, i) => ({
      question:           `Easy Q${i}?`,
      answers:            Array.from({ length: 10 }, (_, j) => ({ title: `Easy option ${j}` })),
      correctAnswerIndex: 0,
    })),
    mediumQuestions: Array.from({ length: 10 }, (_, i) => ({
      question:           `Medium Q${i}?`,
      answers:            Array.from({ length: 10 }, (_, j) => ({ title: `Medium option ${j}` })),
      correctAnswerIndex: 0,
    })),
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function baseHandlers() {
  return (url, opts) => {
    if (url.includes('/api/admin/stats'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {
        users: { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, totalLogins: 0, combinedStreaks: 0 },
        games: { totalGamesPlayed: 0, totalGamesCompleted: 0, totalGamesAbandoned: 0, quizTotalSeconds: 0, boo: { totalSeconds: 0 } },
        briefs: { totalBrifsRead: 0, totalBrifsOpened: 0, totalReadSeconds: 0 },
        tutorials: { viewed: 0, skipped: 0 },
      }}) })
    if (url.includes('/api/admin/problems/count'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/briefs/brief1') && (!opts || opts.method !== 'POST'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { brief: MOCK_BRIEF } }) })
    if (url.includes('/api/admin/briefs') && !url.includes('brief1'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { briefs: [MOCK_BRIEF], total: 1 } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

async function navigateToBriefsTab() {
  const tab = await screen.findByRole('button', { name: /briefs/i })
  fireEvent.click(tab)
}

async function openBriefEditor() {
  await navigateToBriefsTab()
  const briefBtn = await screen.findByText('Eurofighter Typhoon')
  fireEvent.click(briefBtn)
  await screen.findByRole('button', { name: /regenerate all/i })
}

/** Click "Regenerate All", type a reason, and click "Confirm & Regenerate". */
async function confirmRegenModal() {
  fireEvent.click(screen.getByRole('button', { name: /regenerate all/i }))
  // Modal must appear
  await screen.findByText(/confirm & regenerate/i)
  const textarea = screen.getByPlaceholderText(/briefly describe why/i)
  fireEvent.change(textarea, { target: { value: 'Test reason' } })
  fireEvent.click(screen.getByRole('button', { name: /confirm & regenerate/i }))
}

// ── Tests: button visibility ───────────────────────────────────────────────

describe('Admin Briefs — Regenerate All button visibility', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows "Regenerate All" button when a brief is open', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()
    expect(screen.getByRole('button', { name: /regenerate all/i })).toBeDefined()
  })

  it('does not show "Regenerate All" button in new-brief mode', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await navigateToBriefsTab()
    fireEvent.click(await screen.findByRole('button', { name: /new brief/i }))
    await screen.findByRole('button', { name: /save brief/i })
    expect(screen.queryByRole('button', { name: /regenerate all/i })).toBeNull()
  })
})

// ── Tests: confirmation modal ──────────────────────────────────────────────

describe('Admin Briefs — Regenerate All confirmation modal', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('opens a confirmation modal instead of calling the API directly', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /regenerate all/i }))

    // Modal warning text must be visible
    await screen.findByText(/delete all read history/i)
    // No cascade or AI fetch should have been called yet
    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('confirm-regeneration'))).toBe(false)
    expect(calls.some(u => u.includes('regenerate-brief'))).toBe(false)
  })

  it('confirm button is disabled until reason is typed', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /regenerate all/i }))
    await screen.findByText(/confirm & regenerate/i)

    const confirmBtn = screen.getByRole('button', { name: /confirm & regenerate/i })
    expect(confirmBtn.disabled).toBe(true)
  })

  it('confirm button becomes enabled after typing a reason', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /regenerate all/i }))
    await screen.findByText(/confirm & regenerate/i)

    fireEvent.change(screen.getByPlaceholderText(/briefly describe why/i), { target: { value: 'reason here' } })
    expect(screen.getByRole('button', { name: /confirm & regenerate/i }).disabled).toBe(false)
  })

  it('cancelling the modal hides it and makes no API calls', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()

    const callsBefore = global.fetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /regenerate all/i }))
    await screen.findByText(/confirm & regenerate/i)

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText(/confirm & regenerate/i)).toBeNull()
    expect(global.fetch.mock.calls.length).toBe(callsBefore)
  })
})

// ── Tests: two-step flow ───────────────────────────────────────────────────

describe('Admin Briefs — Regenerate All two-step flow', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('calls confirm-regeneration before regenerate-brief', async () => {
    const callOrder = []
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) { callOrder.push('cascade'); return Promise.resolve({ ok: true, json: async () => CASCADE_SUCCESS }) }
      if (url.includes('regenerate-brief'))     { callOrder.push('regen');   return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE }) }
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await openBriefEditor()
    await confirmRegenModal()

    await waitFor(() => screen.getByText(/regenerated — review and save/i))
    expect(callOrder[0]).toBe('cascade')
    expect(callOrder[1]).toBe('regen')
  })

  it('shows "Regenerating…" label while in flight', async () => {
    let resolveCascade
    const cascadePromise = new Promise(resolve => { resolveCascade = resolve })

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) return cascadePromise
      if (url.includes('regenerate-brief'))     return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE })
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await openBriefEditor()
    await confirmRegenModal()

    await waitFor(() => screen.getByText(/regenerating…/i))
    resolveCascade({ ok: true, json: async () => CASCADE_SUCCESS })
  })

  it('if cascade fails, does NOT call regenerate-brief and shows error toast', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) return Promise.resolve({ ok: false, json: async () => ({ status: 'error', message: 'DB error' }) })
      if (url.includes('regenerate-brief'))     return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE })
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await openBriefEditor()
    await confirmRegenModal()

    await waitFor(() => screen.getByText(/regenerate failed/i))
    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('regenerate-brief'))).toBe(false)
  })

  it('updates description sections and shows success toast on full success', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) return Promise.resolve({ ok: true, json: async () => CASCADE_SUCCESS })
      if (url.includes('regenerate-brief'))     return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE })
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await openBriefEditor()
    await confirmRegenModal()

    await waitFor(() => screen.getByText(/regenerated — review and save/i))
    expect(screen.getByDisplayValue('Freshly generated section one.')).toBeDefined()
  })

  it('disables Save Brief button while regenerating', async () => {
    let resolveCascade
    const cascadePromise = new Promise(resolve => { resolveCascade = resolve })

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) return cascadePromise
      if (url.includes('regenerate-brief'))     return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE })
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await openBriefEditor()
    await confirmRegenModal()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save brief/i }).disabled).toBe(true)
    })

    resolveCascade({ ok: true, json: async () => CASCADE_SUCCESS })
  })

  it('populates easy and medium questions after successful regeneration', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) return Promise.resolve({ ok: true, json: async () => CASCADE_SUCCESS })
      if (url.includes('regenerate-brief'))     return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE })
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await openBriefEditor()
    await confirmRegenModal()

    await waitFor(() => screen.getByText(/regenerated — review and save/i))
    expect(screen.getByText(/easy.*10|10.*easy/i) ?? screen.queryByText('10')).toBeDefined()
  })
})
