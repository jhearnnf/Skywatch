import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    refreshUser: vi.fn(),
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
}))

vi.mock('../../utils/sound', () => ({
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

    // Clear the pre-populated reason so the button is disabled
    fireEvent.change(screen.getByPlaceholderText(/briefly describe why/i), { target: { value: '' } })
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
    // Quiz Questions section is collapsed by default — expand it to see the tab counts
    fireEvent.click(screen.getByText('Quiz Questions'))
    await waitFor(() => expect(screen.getByText(/easy.*10|10.*easy/i)).toBeDefined())
  })
})

// ── Tests: Generate Description button ────────────────────────────────────

const DESC_RESPONSE = {
  status: 'success',
  data: {
    descriptionSections: ['Brand new section alpha.', 'Brand new section beta.'],
  },
}

describe('Admin Briefs — Generate Description button', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows "Generate Description" button inside the Description Sections panel when a brief is open', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()
    expect(screen.getByRole('button', { name: /generate description/i })).toBeDefined()
  })

  it('button is absent in new-brief mode (no briefId)', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await navigateToBriefsTab()
    fireEvent.click(await screen.findByRole('button', { name: /new brief/i }))
    await screen.findByRole('button', { name: /save brief/i })
    expect(screen.queryByRole('button', { name: /generate description/i })).toBeNull()
  })

  it('clicking does NOT open the cascade confirmation modal', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description'))
        return Promise.resolve({ ok: true, json: async () => DESC_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    // Modal text must NOT appear
    await waitFor(() => {}, { timeout: 300 }).catch(() => {})
    expect(screen.queryByText(/confirm & regenerate/i)).toBeNull()
    expect(screen.queryByText(/delete all read history/i)).toBeNull()
  })

  it('shows "Generating…" label while request is in flight', async () => {
    let resolveDesc
    const descPromise = new Promise(resolve => { resolveDesc = resolve })
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description')) return descPromise
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    await waitFor(() => screen.getByText(/↺ generating…/i))
    resolveDesc({ ok: true, json: async () => DESC_RESPONSE })
  })

  it('updates description section textareas on success', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description'))
        return Promise.resolve({ ok: true, json: async () => DESC_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    await waitFor(() => screen.getByDisplayValue('Brand new section alpha.'))
    expect(screen.getByDisplayValue('Brand new section beta.')).toBeDefined()
  })

  it('does NOT modify keywords after a successful description generation', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description'))
        return Promise.resolve({ ok: true, json: async () => DESC_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    await waitFor(() => screen.getByDisplayValue('Brand new section alpha.'))
    // Keywords section is collapsed by default — expand it to see the keyword inputs
    fireEvent.click(screen.getByText('Keywords'))
    // Original keyword from MOCK_BRIEF must still be in the editor
    await waitFor(() => expect(screen.getByDisplayValue('Typhoon')).toBeDefined())
  })

  it('shows success toast after generation completes', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description'))
        return Promise.resolve({ ok: true, json: async () => DESC_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    await waitFor(() => screen.getByText(/description generated — review and save/i))
  })

  it('shows error toast when the API returns an error response', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description'))
        return Promise.resolve({ ok: false, json: async () => ({ status: 'error', message: 'AI timeout' }) })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    await waitFor(() => screen.getByText(/generate description failed/i))
  })

  it('is disabled while regeneratingAll is in progress', async () => {
    let resolveCascade
    const cascadePromise = new Promise(resolve => { resolveCascade = resolve })
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('confirm-regeneration')) return cascadePromise
      if (url.includes('ai/regenerate-brief'))  return Promise.resolve({ ok: true, json: async () => REGEN_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    // Start the full regen (opens modal)
    await confirmRegenModal()
    // While cascade is in flight, Generate Description must be disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate description/i }).disabled).toBe(true)
    })
    resolveCascade({ ok: true, json: async () => CASCADE_SUCCESS })
  })

  it('does NOT automatically call saveBrief after generation completes', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-description'))
        return Promise.resolve({ ok: true, json: async () => DESC_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()
    fireEvent.click(screen.getByRole('button', { name: /generate description/i }))
    await waitFor(() => screen.getByText(/description generated/i))
    const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
    const saveCalls = calls.filter(([url, opts]) =>
      url.includes('/api/admin/briefs/brief1') && opts?.method === 'PATCH'
    )
    expect(saveCalls.length).toBe(0)
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

// Builds a brief list handler that returns a single brief with the given shape
function briefListHandler(briefOverrides) {
  const brief = { ...MOCK_BRIEF, ...briefOverrides }
  return (url, opts) => {
    if (url.includes('/api/admin/briefs/brief1') && (!opts || opts.method !== 'POST'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { brief } }) })
    if (url.includes('/api/admin/briefs') && !url.includes('brief1'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { briefs: [brief], total: 1 } }) })
    return baseHandlers()(url, opts)
  }
}

// Returns 10 fake ObjectId strings (simulates unpopulated quiz question refs)
function fakeIds(n = 10) {
  return Array.from({ length: n }, (_, i) => `60f1b2c3d4e5f6a7b8c9d${String(i).padStart(3, '0')}`)
}

// ── Tests: BriefStatusPills badges ────────────────────────────────────────

describe('Admin Briefs — BriefStatusPills badges', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('K badge is green when brief has ≥20 keywords (default threshold)', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({
      keywords: Array.from({ length: 20 }, (_, i) => ({ keyword: `kw${i}`, generatedDescription: '' })),
    }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('K').className).toContain('bg-emerald-100')
  })

  it('K badge is grey when brief has <20 keywords (default threshold)', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({ keywords: [{ keyword: 'one', generatedDescription: '' }] }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('K').className).toContain('bg-slate-100')
  })

  it('Q badge is green when brief has ≥10 easy AND ≥10 medium question refs', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({
      quizQuestionsEasy:   fakeIds(10),
      quizQuestionsMedium: fakeIds(10),
    }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('Q').className).toContain('bg-emerald-100')
  })

  it('Q badge is grey when brief has <10 easy question refs', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({
      quizQuestionsEasy:   fakeIds(5),
      quizQuestionsMedium: fakeIds(10),
    }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('Q').className).toContain('bg-slate-100')
  })

  it('Q badge is grey when brief has <10 medium question refs', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({
      quizQuestionsEasy:   fakeIds(10),
      quizQuestionsMedium: fakeIds(3),
    }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('Q').className).toContain('bg-slate-100')
  })

  it('Q badge is grey when both easy and medium question arrays are empty', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({
      quizQuestionsEasy:   [],
      quizQuestionsMedium: [],
    }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('Q').className).toContain('bg-slate-100')
  })

  it('M badge is green when brief has at least one media item', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({
      media: [{ _id: 'media1', mediaType: 'picture', cloudinaryPublicId: 'media1', mediaUrl: 'https://example.com/img.jpg' }],
    }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('M').className).toContain('bg-emerald-100')
  })

  it('M badge is grey when brief has no media', async () => {
    global.fetch = vi.fn().mockImplementation(briefListHandler({ media: [] }))
    render(<Admin />)
    await navigateToBriefsTab()
    await screen.findByText('Eurofighter Typhoon')
    expect(screen.getByText('M').className).toContain('bg-slate-100')
  })
})
