import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Profile from '../Profile'

// The Supporter badge switch. Its own row under Score Sharing, offered only to
// someone who has donated, and separate from Score Sharing on purpose: that
// switch promises the name and badge still show.
// Mirrors the harness in Profile.showcaseOptOut.test.jsx.

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
const DONOR = { ...BASE_USER, hasDonated: true, supporter: true }

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
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
}

describe('Profile — supporter badge switch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('is not offered to someone who has never donated', async () => {
    mountWith({ user: { ...BASE_USER }, apiFetch: fetchWith() })
    await goToSettings()
    await screen.findByText('Score Sharing')
    expect(screen.queryByTestId('supporter-badge-setting')).toBeNull()
  })

  it('is offered to a donor, worn by default, and says where the badge shows', async () => {
    mountWith({ user: { ...DONOR }, apiFetch: fetchWith() })
    await goToSettings()
    const row = await screen.findByTestId('supporter-badge-setting')
    for (const place of [/chat/i, /leaderboards/i, /player profile/i]) {
      expect(row.textContent).toMatch(place)
    }
    expect(screen.queryByText(/badge is hidden/i)).toBeNull()
  })

  it('sends the objection when the donor hides it', async () => {
    const calls = []
    const apiFetch = fetchWith((url, opts) => {
      if (url.includes('/api/users/me/supporter-badge')) {
        calls.push(JSON.parse(opts.body))
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { user: { ...DONOR, supporter: false, hideSupporterBadge: true } } }),
        })
      }
    })
    const { setUser } = mountWith({ user: { ...DONOR }, apiFetch })
    await goToSettings()

    fireEvent.click(await screen.findByRole('button', { name: /Hide my badge/ }))

    await waitFor(() => expect(calls).toEqual([{ visible: false }]))
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ supporter: false }))
  })

  it('confirms a hidden badge is already in force, and lets the donor show it again', async () => {
    const calls = []
    const apiFetch = fetchWith((url, opts) => {
      if (url.includes('/api/users/me/supporter-badge')) {
        calls.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, json: async () => ({ data: { user: { ...DONOR } } }) })
      }
    })
    mountWith({ user: { ...DONOR, supporter: false }, apiFetch })
    await goToSettings()

    expect(await screen.findByText(/badge is hidden/i)).toHaveTextContent(/straight away/i)
    fireEvent.click(screen.getByRole('button', { name: /Show my badge/ }))
    await waitFor(() => expect(calls).toEqual([{ visible: true }]))
  })

  it('does not re-send the choice the donor already has', async () => {
    const calls = []
    const apiFetch = fetchWith((url, opts) => {
      if (url.includes('/api/users/me/supporter-badge')) {
        calls.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
    })
    mountWith({ user: { ...DONOR }, apiFetch })
    await goToSettings()

    fireEvent.click(await screen.findByRole('button', { name: /Show my badge/ }))
    await waitFor(() => expect(calls).toEqual([]))
  })
})
