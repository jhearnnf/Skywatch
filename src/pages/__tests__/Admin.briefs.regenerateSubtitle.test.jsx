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
    awardAirstars: vi.fn(),
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
  nickname:            '',
  category:            'Aircrafts',
  subcategory:         '',
  historic:            false,
  isPublished:         true,
  descriptionSections: ['The Typhoon is a fast jet.'],
  keywords:            [],
  sources:             [],
  media:               [],
  quizQuestionsEasy:   [],
  quizQuestionsMedium: [],
}

const SUBTITLE_RESPONSE = {
  status: 'success',
  data:   { subtitle: 'A freshly regenerated identity sentence.' },
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
  // Core Fields section is open by default — the subtitle regenerate button lives there
  await screen.findByRole('button', { name: /^↺ regenerate$/i })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin Briefs — Regenerate Subtitle button', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows the Regenerate Subtitle button when a brief is open', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await openBriefEditor()
    expect(screen.getByRole('button', { name: /^↺ regenerate$/i })).toBeDefined()
  })

  it('is absent in new-brief mode (no briefId)', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await navigateToBriefsTab()
    fireEvent.click(await screen.findByRole('button', { name: /new brief/i }))
    await screen.findByRole('button', { name: /save brief/i })
    expect(screen.queryByRole('button', { name: /^↺ regenerate$/i })).toBeNull()
  })

  it('calls the regenerate-subtitle endpoint on click', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-subtitle'))
        return Promise.resolve({ ok: true, json: async () => SUBTITLE_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /^↺ regenerate$/i }))

    await waitFor(() => {
      const urls = global.fetch.mock.calls.map(c => c[0])
      expect(urls.some(u => u.includes('/api/admin/ai/regenerate-subtitle/brief1'))).toBe(true)
    })
  })

  it('updates the subtitle input value on success', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-subtitle'))
        return Promise.resolve({ ok: true, json: async () => SUBTITLE_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /^↺ regenerate$/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('A freshly regenerated identity sentence.')).toBeDefined()
    })
  })

  it('shows "Regenerating…" label while the request is in flight', async () => {
    let resolve
    const pending = new Promise(r => { resolve = r })
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-subtitle')) return pending
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /^↺ regenerate$/i }))
    await waitFor(() => screen.getByText(/↺ regenerating…/i))
    resolve({ ok: true, json: async () => SUBTITLE_RESPONSE })
  })

  it('shows success toast after regeneration', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-subtitle'))
        return Promise.resolve({ ok: true, json: async () => SUBTITLE_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /^↺ regenerate$/i }))
    await waitFor(() => screen.getByText(/subtitle regenerated/i))
  })

  it('shows error toast when the API returns an error', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-subtitle'))
        return Promise.resolve({ ok: false, json: async () => ({ status: 'error', message: 'AI timeout' }) })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /^↺ regenerate$/i }))
    await waitFor(() => screen.getByText(/regenerate subtitle failed/i))
  })

  it('does NOT automatically call saveBrief after regeneration (stays in dirty state)', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('regenerate-subtitle'))
        return Promise.resolve({ ok: true, json: async () => SUBTITLE_RESPONSE })
      return baseHandlers()(url, opts)
    })
    render(<Admin />)
    await openBriefEditor()

    fireEvent.click(screen.getByRole('button', { name: /^↺ regenerate$/i }))
    await waitFor(() => screen.getByText(/subtitle regenerated/i))

    const saveCalls = global.fetch.mock.calls.filter(
      ([url, opts]) => url.includes('/api/admin/briefs/brief1') && opts?.method === 'PATCH'
    )
    expect(saveCalls.length).toBe(0)
  })
})
