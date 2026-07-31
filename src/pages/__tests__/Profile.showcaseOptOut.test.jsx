import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Profile from '../Profile'

// The GDPR right-to-object control for the landing page's progress wall
// (backend/utils/cbatShowcase.js). Mirrors the harness in Profile.displayName.test.jsx.

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../utils/sound', () => ({
  getMasterVolume: () => 50,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn(), resetAll: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

vi.mock('../../data/mockData', () => ({ MOCK_LEADERBOARD: [] }))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    levels: [{ levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 }],
    settings: {},
    loading: false,
  }),
}))

const BASE_USER = {
  _id: 'u1',
  email: 'a@test.com',
  agentNumber: '1234567',
  totalAirstars: 0,
  cycleAirstars: 0,
  loginStreak: 0,
  difficultySetting: 'easy',
  subscriptionTier: 'free',
  rank: { rankName: 'Airman', rankAbbreviation: 'AC' },
}

function mountWith({ user, apiFetch, setUser = vi.fn() }) {
  mockUseAuth.mockReturnValue({ user, setUser, API: '', apiFetch, logout: vi.fn() })
  return { setUser }
}

function fetchWith(overrideHandler) {
  return vi.fn().mockImplementation((url, opts) => {
    if (overrideHandler) {
      const result = overrideHandler(url, opts)
      if (result) return result
    }
    if (url.includes('/api/users/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { brifsRead: 0, gamesPlayed: 0, abandonedGames: 0, winPercent: 0 } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function goToSettings() {
  render(<Profile />)
  fireEvent.click(await screen.findByText(/⚙️ Settings/))
}

describe('Profile — homepage feature opt-out', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('defaults to included, so the wall works without anyone opting in', async () => {
    mountWith({ user: { ...BASE_USER }, apiFetch: fetchWith() })
    await goToSettings()

    expect(await screen.findByText('Homepage Feature')).toBeInTheDocument()
    // No "will not appear" note while included.
    expect(screen.queryByText(/will not appear on the homepage/i)).toBeNull()
  })

  it('says what is shown and what is not, without needing the privacy policy', async () => {
    mountWith({ user: { ...BASE_USER }, apiFetch: fetchWith() })
    await goToSettings()

    const blurb = await screen.findByText(/agent number only/i)
    expect(blurb.textContent).toMatch(/never your display name/i)
    expect(blurb.textContent).toMatch(/never the date\/time you played/i)
  })

  it('sends the objection when the player opts out', async () => {
    const calls = []
    const apiFetch = fetchWith((url, opts) => {
      if (url.includes('/api/users/me/showcase')) {
        calls.push(JSON.parse(opts.body))
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { user: { ...BASE_USER, hideFromShowcase: true } } }),
        })
      }
    })
    const { setUser } = mountWith({ user: { ...BASE_USER }, apiFetch })
    await goToSettings()

    fireEvent.click(await screen.findByRole('button', { name: /Leave me out/ }))

    await waitFor(() => expect(calls).toEqual([{ visible: false }]))
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ hideFromShowcase: true }))
  })

  it('confirms the opt-out is already in force, not queued', async () => {
    mountWith({ user: { ...BASE_USER, hideFromShowcase: true }, apiFetch: fetchWith() })
    await goToSettings()

    expect(await screen.findByText(/takes effect straight away/i)).toBeInTheDocument()
  })

  it('lets an opted-out player opt back in', async () => {
    const calls = []
    const apiFetch = fetchWith((url, opts) => {
      if (url.includes('/api/users/me/showcase')) {
        calls.push(JSON.parse(opts.body))
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { user: { ...BASE_USER, hideFromShowcase: false } } }),
        })
      }
    })
    mountWith({ user: { ...BASE_USER, hideFromShowcase: true }, apiFetch })
    await goToSettings()

    fireEvent.click(await screen.findByRole('button', { name: /Include me/ }))

    await waitFor(() => expect(calls).toEqual([{ visible: true }]))
  })

  it('does not re-send the choice the player already has', async () => {
    const calls = []
    const apiFetch = fetchWith((url, opts) => {
      if (url.includes('/api/users/me/showcase')) {
        calls.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
    })
    mountWith({ user: { ...BASE_USER }, apiFetch })
    await goToSettings()

    fireEvent.click(await screen.findByRole('button', { name: /Include me/ }))
    await waitFor(() => expect(calls).toEqual([]))
  })
})
