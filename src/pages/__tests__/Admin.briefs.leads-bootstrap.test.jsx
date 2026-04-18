import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Location mock (mutable so each test can override) ──────────────────────

let mockLocationState = { openLeads: true, leadsSearch: '617 Squadron' }

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
  useLocation: () => ({ state: mockLocationState }),
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

// ── Fetch handlers ─────────────────────────────────────────────────────────

function baseHandlers() {
  return (url) => {
    if (url.includes('/api/admin/stats'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {
        users:     { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, totalLogins: 0, combinedStreaks: 0 },
        games:     { totalGamesPlayed: 0, totalGamesCompleted: 0, totalGamesAbandoned: 0, quizTotalSeconds: 0, boo: { totalSeconds: 0 } },
        briefs:    { totalBrifsRead: 0, totalBrifsOpened: 0, totalReadSeconds: 0 },
        tutorials: { viewed: 0, skipped: 0 },
      }}) })
    if (url.includes('/api/admin/problems/count'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/briefs'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { briefs: [], total: 0 } }) })
    if (url.includes('/api/admin/intel-leads'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { leads: [] } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin Briefs — leads modal bootstrap from stub page', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    mockLocationState = { openLeads: true, leadsSearch: '617 Squadron' }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('opens the leads modal automatically when location.state.openLeads is true', async () => {
    render(<Admin />)
    await screen.findByPlaceholderText(/search leads/i)
  })

  it('pre-fills the search field with location.state.leadsSearch', async () => {
    render(<Admin />)
    const input = await screen.findByPlaceholderText(/search leads/i)
    expect(input.value).toBe('617 Squadron')
  })

  it('starts on the Briefs tab when openLeads is true', async () => {
    render(<Admin />)
    // LeadsModal is inside BriefsTab — its presence proves the Briefs tab is active
    await screen.findByPlaceholderText(/search leads/i)
    // Stats content should not be visible
    expect(screen.queryByText(/total users/i)).toBeNull()
  })

  it('does not open the leads modal when location.state is null', async () => {
    mockLocationState = null
    render(<Admin />)
    // Wait for the page to settle (stats tab loads)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByPlaceholderText(/search leads/i)).toBeNull()
  })

  it('does not pre-fill search when leadsSearch is absent', async () => {
    mockLocationState = { openLeads: true }
    render(<Admin />)
    const input = await screen.findByPlaceholderText(/search leads/i)
    expect(input.value).toBe('')
  })

  it('clears the pre-fill after the modal is closed', async () => {
    render(<Admin />)
    await screen.findByPlaceholderText(/search leads/i)

    // Close the modal
    const closeBtn = screen.getByRole('button', { name: /close|dismiss|✕|×/i })
    fireEvent.click(closeBtn)
    await waitFor(() => expect(screen.queryByPlaceholderText(/search leads/i)).toBeNull())

    // Re-open via the "Leads" button in the briefs tab toolbar
    const leadsBtn = screen.getByRole('button', { name: /leads/i })
    fireEvent.click(leadsBtn)
    const input = await screen.findByPlaceholderText(/search leads/i)
    // Should be empty — bootstrap search was consumed on close
    expect(input.value).toBe('')
  })
})
