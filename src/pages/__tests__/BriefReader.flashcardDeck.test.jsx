import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../../components/UpgradePrompt',          () => ({ default: () => null }))

// Mock the notification component so we can assert it renders without portal/animation complexity
vi.mock('../../../components/FlashcardDeckNotification', () => ({
  default: ({ onDone }) => (
    <div data-testid="flashcard-deck-notif">
      Flashcard added to deck
      <button onClick={onDone}>dismiss</button>
    </div>
  ),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick, ref, ...rest }) =>
              <div ref={ref} className={className} style={style} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })          => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  LayoutGroup:     ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

// 4 sections: last one is the flashcard section
const FOUR_SECTION_BRIEF = {
  _id:                 'brief123',
  title:               'RAF Typhoon',
  subtitle:            'Air superiority fighter',
  category:            'Training',      // non-Aircrafts avoids wta-spawn fetch
  descriptionSections: [
    'Section one content.',
    'Section two content.',
    'Section three content.',
    'Section four flashcard content.',
  ],
  keywords: [],
  sources:  [],
  media:    [],
}

function makeGetResponse(brief, readRecord = null) {
  return { ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) }
}

const SAFE_EMPTY = { ok: true, json: async () => ({ data: {} }) }

function makeReachedFlashcardResponse(wasNew) {
  return { ok: true, json: async () => ({ status: 'success', wasNew }) }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1' },
    API:           '',
    awardAircoins: vi.fn(),
    setUser:       vi.fn(),
  })
}

function setupGuest() {
  mockUseAuth.mockReturnValue({
    user:          null,
    API:           '',
    awardAircoins: vi.fn(),
    setUser:       vi.fn(),
  })
}

// Read record that places a logged-in user at the last section on mount.
// Pass this as the second argument to makeGetResponse.
function lastSectionRecord(lastIdx = 3) {
  return { currentSection: lastIdx, completed: false, reachedFlashcard: false }
}

// For guest users: seed localStorage so BriefReader restores to the last section.
function seedLastSectionForGuest(briefId = 'brief123', lastIdx = 3) {
  localStorage.setItem(`sw_brief_sec_${briefId}`, String(lastIdx))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BriefReader — flashcard deck notification', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('fires POST /reached-flashcard when logged-in user starts on last section', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      const hit = calls.find(([url, opts]) =>
        url.includes('/reached-flashcard') && opts?.method === 'POST'
      )
      expect(hit).toBeDefined()
    })
  })

  it('shows the deck notification when server returns wasNew: true', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    // Advance past the 600ms delay + 1200ms ring = 1800ms staged delay
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => {
      expect(screen.getByTestId('flashcard-deck-notif')).toBeDefined()
    })
    vi.useRealTimers()
  })

  it('does NOT show the notification when server returns wasNew: false', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(false))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(u => u.includes('/reached-flashcard'))).toBe(true)
    })
    expect(screen.queryByTestId('flashcard-deck-notif')).toBeNull()
  })

  it('does NOT fire POST /reached-flashcard when user is not logged in', async () => {
    setupGuest()
    seedLastSectionForGuest()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    // Flush all pending effects then assert no reached-flashcard call
    await new Promise(r => setTimeout(r, 100))
    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('/reached-flashcard'))).toBe(false)
    expect(screen.queryByTestId('flashcard-deck-notif')).toBeNull()
  })

  it('does NOT fire POST when readRecord already has reachedFlashcard: true', async () => {
    setupLoggedIn()
    const alreadyFlaggedRecord = { _id: 'rr1', reachedFlashcard: true, completed: false, currentSection: 3 }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, alreadyFlaggedRecord))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await new Promise(r => setTimeout(r, 100))
    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('/reached-flashcard'))).toBe(false)
  })

  it('does NOT fire POST when readRecord already has completed: true', async () => {
    setupLoggedIn()
    const completedRecord = { _id: 'rr1', reachedFlashcard: false, completed: true, currentSection: 0 }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, completedRecord))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await new Promise(r => setTimeout(r, 100))
    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('/reached-flashcard'))).toBe(false)
  })

  it('dismisses the notification when onDone is called', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => screen.getByTestId('flashcard-deck-notif'))
    fireEvent.click(screen.getByText('dismiss'))

    // Switch back to real timers before the polling waitFor to avoid the
    // read-time setInterval (10s) causing an infinite fake-timer loop.
    vi.useRealTimers()
    await waitFor(() => {
      expect(screen.queryByTestId('flashcard-deck-notif')).toBeNull()
    })
  })
})
