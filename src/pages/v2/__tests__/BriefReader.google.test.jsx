import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockSetUser  = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

vi.mock('../../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate,
  Link:        ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal',  () => ({ default: () => null }))
vi.mock('../../../components/LockedCategoryModal',     () => ({ default: () => null }))
vi.mock('../../../components/MissionDetectedModal',    () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, onClick, style }) => <div className={className} onClick={onClick} style={style}>{children}</div>,
    button: ({ children, className, onClick })        => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })                 => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BRIEF = {
  _id: 'brief123', title: 'RAF Typhoon', category: 'Aircrafts',
  descriptionSections: ['The Typhoon is a swing-role combat aircraft.'],
  keywords: [], sources: [], media: [],
}

function makeGetResponse() {
  return { ok: true, json: async () => ({ data: { brief: BRIEF, readRecord: null, ammoMax: 3 } }) }
}

function makeCompleteResponse() {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: {
        aircoinsEarned: 5, dailyCoinsEarned: 5,
        loginStreak: 1, newTotalAircoins: 10, newCycleAircoins: 10, rankPromotion: null,
      },
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BriefReader CompletionScreen — Google sign-in awards coins', () => {
  let googleCallback = null

  beforeEach(() => {
    googleCallback = null
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()

    mockUseAuth.mockReturnValue({ user: null, setUser: mockSetUser, API: '', awardAircoins: vi.fn() })

    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    window.google = {
      accounts: {
        id: {
          initialize:   vi.fn(({ callback }) => { googleCallback = callback }),
          renderButton: vi.fn(),
          prompt:       vi.fn(),
        },
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    delete window.google
  })

  async function reachCompletionScreen() {
    // All fetches (brief GET + mark-started) return the guest brief response
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))
    await waitFor(() => screen.getByText('Brief Complete!'))
  }

  it('calls /complete and navigates to brief after Google sign-in on completion screen', async () => {
    await reachCompletionScreen()

    // Now wire up the auth + complete responses
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: { _id: 'u1' } } }) }) // /api/auth/google
      .mockResolvedValueOnce(makeCompleteResponse()) // /api/briefs/brief123/complete

    expect(googleCallback).not.toBeNull()
    await googleCallback({ credential: 'fake-token' })

    await waitFor(() => {
      const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
      expect(completeCalled).toBe(true)
    })
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123', { replace: true })
    expect(sessionStorage.getItem('sw_brief_coins')).not.toBeNull()
    expect(sessionStorage.getItem('sw_brief_just_completed')).toBe('brief123')
  })

  it('clears sw_pending_brief from sessionStorage after consuming it', async () => {
    await reachCompletionScreen()

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: { _id: 'u1' } } }) })
      .mockResolvedValueOnce(makeCompleteResponse())

    expect(googleCallback).not.toBeNull()
    await googleCallback({ credential: 'fake-token' })

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(sessionStorage.getItem('sw_pending_brief')).toBeNull()
  })

  it('does NOT call /complete if Google auth fails', async () => {
    await reachCompletionScreen()

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Auth failed' }) })

    expect(googleCallback).not.toBeNull()
    await googleCallback({ credential: 'bad-token' })

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
    expect(completeCalled).toBe(false)
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
