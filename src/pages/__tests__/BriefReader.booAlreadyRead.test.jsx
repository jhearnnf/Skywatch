import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const mockUseAuth    = vi.hoisted(() => vi.fn())
const mockNavigate   = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, onClick, style }) => <div className={className} onClick={onClick} style={style}>{children}</div>,
    button: ({ children, className, onClick })        => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })                 => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  LayoutGroup:     ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BRIEF = {
  _id:                 'brief123',
  title:               'RAF Typhoon',
  subtitle:            'Air superiority fighter',
  category:            'Aircrafts',
  descriptionSections: ['Section one.'],
  keywords:            [],
  sources:             [],
  media:               [],
}

// readRecord with completed: true → AlreadyReadScreen is shown on mount
const COMPLETED_RECORD = { _id: 'rr1', completed: true, coinsAwarded: true }

const BRIEF_RESPONSE      = { ok: true, json: async () => ({ data: { brief: BRIEF, readRecord: COMPLETED_RECORD, ammoMax: 3 } }) }
const WTA_SPAWN_EMPTY     = { ok: true, json: async () => ({ data: null }) }
const QUIZ_PASSED         = { ok: true, json: async () => ({ data: { hasCompleted: true  } }) }
const QUIZ_NOT_PASSED     = { ok: true, json: async () => ({ data: { hasCompleted: false } }) }
const BOO_STATUS_FRESH    = { ok: true, json: async () => ({ data: { hasCompleted: false } }) }
const BOO_STATUS_DONE     = { ok: true, json: async () => ({ data: { hasCompleted: true  } }) }
const CATCH_ALL           = { ok: true, json: async () => ({}) }

function booOptions(available, reason = null, opts = []) {
  return { ok: true, json: async () => ({ data: { available, reason, options: opts } }) }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup(fetchMocks) {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1', loginStreak: 0 },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
  global.fetch = vi.fn()
  fetchMocks.forEach((mock, i) => {
    if (i < fetchMocks.length - 1) global.fetch.mockResolvedValueOnce(mock)
    else                           global.fetch.mockResolvedValue(mock) // catch-all for last
  })
  render(<BriefReader />)
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.setItem('skywatch_first_brief', '1')
  mockNavigate.mockClear()
})
afterEach(() => vi.restoreAllMocks())

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BriefReader AlreadyReadScreen — BOO card locked states', () => {

  it('shows locked BOO card with aircraft-reads message when needs-aircraft-reads', async () => {
    // Fetch order: brief → wta-spawn → quiz/status → options
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(false, 'needs-aircraft-reads'),
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('RAF Typhoon'))
    await waitFor(() => screen.getByText('Read more Aircrafts briefs to unlock'))
    expect(screen.getByText('🔒 Locked')).toBeDefined()
  })

  it('shows locked BOO card with quiz message when quiz_not_passed', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_NOT_PASSED,
      booOptions(false, 'quiz_not_passed'),
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('RAF Typhoon'))
    await waitFor(() => screen.getByText('Pass the quiz to unlock'))
    expect(screen.getByText('🔒 Locked')).toBeDefined()
  })

  it('locked BOO card is a div — not interactive', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(false, 'needs-aircraft-reads'),
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('Read more Aircrafts briefs to unlock'))
    // The locked card should NOT be a button or anchor
    const lockedCard = screen.getByText('Battle of Order').closest('button, a')
    expect(lockedCard).toBeNull()
  })

  it('hides BOO card entirely for ineligible_category', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(false, 'ineligible_category'),
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('RAF Typhoon'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText('Battle of Order')).toBeNull()
  })

  it('shows playable BOO card when available and quiz passed', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(true, null, [{ orderType: 'speed' }]),
      BOO_STATUS_FRESH,
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('RAF Typhoon'))
    await waitFor(() => screen.getByText('Play →'))
    expect(screen.queryByText('🔒 Locked')).toBeNull()
  })

  it('playable BOO card navigates to the game on click', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(true, null, [{ orderType: 'speed' }]),
      BOO_STATUS_FRESH,
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('Play →'))
    screen.getByText('Battle of Order').closest('button').click()
    expect(mockNavigate).toHaveBeenCalledWith('/battle-of-order/brief123')
  })

  it('shows completed BOO card when BOO already won', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(true, null, [{ orderType: 'speed' }]),
      BOO_STATUS_DONE,
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('RAF Typhoon'))
    await waitFor(() => screen.getByText('✓ Completed'))
  })

  it('completed BOO card navigates to the game on click', async () => {
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_PASSED,
      booOptions(true, null, [{ orderType: 'speed' }]),
      BOO_STATUS_DONE,
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('✓ Completed'))
    // Find the BOO card button (contains "Battle of Order" and "✓ Completed")
    const booCard = screen.getByText('✓ Completed').closest('button')
    booCard.click()
    expect(mockNavigate).toHaveBeenCalledWith('/battle-of-order/brief123')
  })

  it('shows locked aircraft-reads card even when quiz not yet passed', async () => {
    // aircraft-reads gate fires before quiz check — so we get needs-aircraft-reads
    // even when quiz is not passed
    setup([
      BRIEF_RESPONSE,
      WTA_SPAWN_EMPTY,
      QUIZ_NOT_PASSED,
      booOptions(false, 'needs-aircraft-reads'),
      CATCH_ALL,
    ])

    await waitFor(() => screen.getByText('Read more Aircrafts briefs to unlock'))
  })

})
