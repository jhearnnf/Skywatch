import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// Spies on the GameChromeContext flashcardCollect ref-count entry/exit. The
// regression we're guarding against: the unlock-driven play-nav flash fired
// during the 1.8s pre-glow + glow phase BEFORE FDN mounted, because the
// flashcardCollectActive flag was only true for the FDN window. Fix: enter
// the flag at startCollectAnimation, before FDN mounts.

const mockUseAuth         = vi.hoisted(() => vi.fn())
const enterFlashcardCollect = vi.hoisted(() => vi.fn())
const exitFlashcardCollect  = vi.hoisted(() => vi.fn())

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn(), preloadSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({
    immersive: false,
    enterImmersive: vi.fn(),
    exitImmersive:  vi.fn(),
    enterFlashcardCollect,
    exitFlashcardCollect,
  }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))
vi.mock('../../components/FlashcardDeckNotification', () => ({
  default: ({ onDone }) => (
    <div data-testid="flashcard-deck-notif">
      <button onClick={onDone}>dismiss</button>
    </div>
  ),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick, ref }) =>
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

const FOUR_SECTION_BRIEF = {
  _id:                 'brief123',
  title:               'RAF Typhoon',
  subtitle:            'Air superiority fighter',
  category:            'Training',
  descriptionSections: ['s1', 's2', 's3', 's4 flashcard'],
  keywords: [], sources: [], media: [],
}

function makeGetResponse(brief, readRecord = null) {
  return { ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) }
}
function makeReachedFlashcardResponse(wasNew) {
  return { ok: true, json: async () => ({ status: 'success', wasNew }) }
}
const SAFE_EMPTY = { ok: true, json: async () => ({ data: {} }) }

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1' },
    API: '',
    apiFetch:      (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

function lastSectionRecord(lastIdx = 3) {
  return { currentSection: lastIdx, completed: false, reachedFlashcard: false }
}

describe('BriefReader — flashcardCollect ref-count window', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    enterFlashcardCollect.mockClear()
    exitFlashcardCollect.mockClear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('enterFlashcardCollect fires BEFORE the FDN mounts (covers the pre-glow window)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    // Wait for the reached-flashcard POST to settle and startCollectAnimation
    // to have been invoked. FDN doesn't mount until 1800ms (600 pre + 1200 glow);
    // the enter MUST already have fired before that window opens.
    await waitFor(() => {
      expect(enterFlashcardCollect).toHaveBeenCalledTimes(1)
    })

    // Confirm we're still inside the pre-FDN window — FDN should NOT yet be rendered.
    expect(screen.queryByTestId('flashcard-deck-notif')).toBeNull()

    // Now advance past the 1800ms gate. FDN mounts — but BriefReader's enter
    // count remains at one (no double-enter). FDN's own enter is wired in
    // FlashcardDeckNotification, but here it's mocked out, so the spy stays at 1.
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => {
      expect(screen.queryByTestId('flashcard-deck-notif')).not.toBeNull()
    })
    expect(enterFlashcardCollect).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('exitFlashcardCollect fires when FDN signals onDone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    await waitFor(() => expect(enterFlashcardCollect).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(2000)
    const fdn = await screen.findByTestId('flashcard-deck-notif')
    expect(exitFlashcardCollect).not.toHaveBeenCalled()

    vi.useRealTimers()
    fdn.querySelector('button').click()
    await waitFor(() => {
      expect(exitFlashcardCollect).toHaveBeenCalledTimes(1)
    })
  })

  it('does NOT enter when wasNew is false (no collect animation)', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(false))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    // Allow time for the POST to resolve and any collect animation to start
    await new Promise(r => setTimeout(r, 200))
    expect(enterFlashcardCollect).not.toHaveBeenCalled()
  })
})
