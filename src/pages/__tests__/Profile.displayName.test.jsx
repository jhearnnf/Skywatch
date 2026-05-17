import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Profile from '../Profile'

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

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

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
  mockUseAuth.mockReturnValue({
    user,
    setUser,
    API: '',
    apiFetch,
    logout: vi.fn(),
  })
  return { setUser }
}

function statsAndDefaultFetch(overrideHandler) {
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

describe('Profile — Display Name', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows "Set a display name" placeholder when none is set', async () => {
    mountWith({ user: { ...BASE_USER, displayName: null }, apiFetch: statsAndDefaultFetch() })
    await goToSettings()
    expect(await screen.findByText(/Set a display name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Set$/ })).toBeEnabled()
  })

  it('shows the current display name and a Change button', async () => {
    mountWith({ user: { ...BASE_USER, displayName: 'Maverick' }, apiFetch: statsAndDefaultFetch() })
    await goToSettings()
    // "Maverick" appears in both the user-card header and the Settings card
    const occurrences = await screen.findAllByText('Maverick')
    expect(occurrences.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /^Change$/ })).toBeInTheDocument()
  })

  it('saves a new display name and calls setUser with the response', async () => {
    const updatedUser = { ...BASE_USER, displayName: 'Goose', displayNameChangedAt: new Date().toISOString() }
    const apiFetch = statsAndDefaultFetch((url, opts) => {
      if (url.includes('/api/users/me/display-name') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { user: updatedUser } }) })
      }
    })
    const { setUser } = mountWith({ user: { ...BASE_USER, displayName: null }, apiFetch })

    await goToSettings()
    fireEvent.click(screen.getByRole('button', { name: /^Set$/ }))
    const input = await screen.findByPlaceholderText(/3–20 chars/)
    fireEvent.change(input, { target: { value: 'Goose' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(setUser).toHaveBeenCalledWith(updatedUser))
  })

  it('surfaces backend validation errors', async () => {
    const apiFetch = statsAndDefaultFetch((url) => {
      if (url.includes('/api/users/me/display-name')) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ status: 'error', message: 'That name is reserved' }) })
      }
    })
    mountWith({ user: { ...BASE_USER, displayName: null }, apiFetch })

    await goToSettings()
    fireEvent.click(screen.getByRole('button', { name: /^Set$/ }))
    fireEvent.change(await screen.findByPlaceholderText(/3–20 chars/), { target: { value: 'Admin Joe' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    expect(await screen.findByText(/reserved/i)).toBeInTheDocument()
  })

  it('disables the Change button when within the 30-day cooldown', async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    mountWith({
      user: { ...BASE_USER, displayName: 'Viper', displayNameChangedAt: recent },
      apiFetch: statsAndDefaultFetch(),
    })
    await goToSettings()
    expect(screen.getByRole('button', { name: /^Change$/ })).toBeDisabled()
    expect(screen.getByText(/Next change available in/i)).toBeInTheDocument()
  })

  it('clears the display name when Clear is clicked', async () => {
    const clearedUser = { ...BASE_USER, displayName: null, displayNameChangedAt: new Date().toISOString() }
    const apiFetch = statsAndDefaultFetch((url, opts) => {
      if (url.includes('/api/users/me/display-name') && opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body)
        expect(body.displayName).toBeNull()
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { user: clearedUser } }) })
      }
    })
    const { setUser } = mountWith({ user: { ...BASE_USER, displayName: 'Hollywood' }, apiFetch })

    await goToSettings()
    fireEvent.click(screen.getByRole('button', { name: /^Change$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Clear$/ }))

    await waitFor(() => expect(setUser).toHaveBeenCalledWith(clearedUser))
  })
})
