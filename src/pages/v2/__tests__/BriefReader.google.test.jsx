import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate      = vi.hoisted(() => vi.fn())
const mockSetUser       = vi.hoisted(() => vi.fn())
const mockAwardAircoins = vi.hoisted(() => vi.fn())
const mockUseAuth       = vi.hoisted(() => vi.fn())

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

function makeCompleteResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: {
        aircoinsEarned: 5, dailyCoinsEarned: 5,
        loginStreak: 1, newTotalAircoins: 10, newCycleAircoins: 10, rankPromotion: null,
        ...overrides,
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
    mockAwardAircoins.mockClear()
    sessionStorage.clear()

    mockUseAuth.mockReturnValue({ user: null, setUser: mockSetUser, API: '', awardAircoins: mockAwardAircoins })

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
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))
    await waitFor(() => screen.getByText('Brief Complete!'))
  }

  it('calls /complete and awardAircoins after Google sign-in on completion screen', async () => {
    await reachCompletionScreen()

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: { _id: 'u1' } } }) }) // /api/auth/google
      .mockResolvedValueOnce(makeCompleteResponse()) // /api/briefs/brief123/complete

    expect(googleCallback).not.toBeNull()
    await googleCallback({ credential: 'fake-token' })

    await waitFor(() => {
      const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
      expect(completeCalled).toBe(true)
    })
    expect(mockAwardAircoins).toHaveBeenCalledWith(10, 'Daily Brief', expect.objectContaining({
      cycleAfter: 10, totalAfter: 10,
    }))
  })

  it('does not navigate away — user stays on completion screen', async () => {
    await reachCompletionScreen()

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: { _id: 'u1' } } }) })
      .mockResolvedValueOnce(makeCompleteResponse())

    expect(googleCallback).not.toBeNull()
    await googleCallback({ credential: 'fake-token' })

    await waitFor(() => expect(mockAwardAircoins).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not call /complete or awardAircoins if Google auth fails', async () => {
    await reachCompletionScreen()

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) }) // no user in response

    expect(googleCallback).not.toBeNull()
    await googleCallback({ credential: 'bad-token' })

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
    expect(completeCalled).toBe(false)
    expect(mockAwardAircoins).not.toHaveBeenCalled()
  })
})
