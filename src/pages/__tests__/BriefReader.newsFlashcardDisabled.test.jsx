import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

const mockUseAuth         = vi.hoisted(() => vi.fn())
const mockUseAppSettings  = vi.hoisted(() => vi.fn())

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn(), preloadSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseAppSettings,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))

vi.mock('../../components/FlashcardDeckNotification', () => ({
  default: ({ onDone }) => (
    <div data-testid="flashcard-deck-notif">
      Flashcard added to deck
      <button onClick={onDone}>dismiss</button>
    </div>
  ),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, ref, onDragEnd, drag }) => {
      if (drag === 'x' && onDragEnd) {
        return (
          <div ref={ref} className={className} style={style} onClick={onClick}>
            {children}
            <button
              data-testid="swipe-left"
              onClick={() => onDragEnd(null, { offset: { x: -150, y: 0 }, velocity: { x: 0, y: 0 } })}
            />
          </div>
        )
      }
      return <div ref={ref} className={className} style={style} onClick={onClick}>{children}</div>
    },
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })          => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  LayoutGroup:     ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
}))

const NEWS_BRIEF = {
  _id:                 'brief123',
  title:               'Test News Story',
  subtitle:            'A headline',
  category:            'News',
  descriptionSections: ['Section one.', 'Section two.', 'Section three.', 'Section four flashcard text.'],
  keywords: [],
  sources:  [],
  media:    [],
}

const NON_NEWS_BRIEF = { ...NEWS_BRIEF, category: 'Training', title: 'Training Brief' }

const SAFE_EMPTY = { ok: true, json: async () => ({ data: {} }) }

function makeGetResponse(brief, readRecord = null) {
  return { ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) }
}

function makeReachedFlashcardResponse(wasNew) {
  return { ok: true, json: async () => ({ status: 'success', wasNew }) }
}

function lastSectionRecord(lastIdx = 3) {
  return { currentSection: lastIdx, completed: false, reachedFlashcard: false }
}

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1' },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

describe('BriefReader — News flashcard gating (newsFlashcardsEnabled=false)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    mockUseAppSettings.mockReturnValue({ settings: { newsFlashcardsEnabled: false } })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('still POSTs /reached-flashcard for News briefs (silent persistence) when disabled', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      const hit = calls.find(([url, opts]) =>
        url.includes('/reached-flashcard') && opts?.method === 'POST'
      )
      expect(hit).toBeDefined()
    })
  })

  it('does NOT show the deck notification when News flashcards are disabled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    await vi.advanceTimersByTimeAsync(2500)

    expect(screen.queryByTestId('flashcard-deck-notif')).toBeNull()
    vi.useRealTimers()
  })

  it('does NOT render the FlashCard layout on section 4 for News briefs when disabled', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    // FlashCard component renders the text "Flashcard" and "Context" labels;
    // the normal SectionCard does not. Section 4 content should still be visible.
    expect(screen.queryByText('Flashcard')).toBeNull()
    expect(screen.queryByText('Context')).toBeNull()
    expect(screen.getByText(/Section four flashcard text/)).toBeDefined()
  })

  it('uses the brief title as the section 4 heading when News flashcards are disabled', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    // SectionCard renders the heading as an h3. With News flashcards disabled,
    // section 4 would have no heading (sec 4 is by design headingless), so the
    // brief title is used as a fallback so the card has a visual anchor.
    expect(screen.getByRole('heading', { level: 3, name: 'Test News Story' })).toBeDefined()
  })

  it('DOES render the FlashCard layout on section 4 for News briefs when enabled', async () => {
    mockUseAppSettings.mockReturnValue({ settings: { newsFlashcardsEnabled: true } })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    expect(screen.getByText('Flashcard')).toBeDefined()
    expect(screen.getByText('Context')).toBeDefined()
  })

  it('hides the brief header + progress bar on section 4 for News briefs when flashcards are disabled', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    // Section 4 now uses the brief title as its heading (via SectionCard's
    // heading fallback), so the page-level h1 + subtitle + progress bar
    // minimise exactly like they do on the normal flashcard view — showing
    // the title twice would be redundant.
    expect(screen.queryByRole('heading', { level: 1, name: 'Test News Story' })).toBeNull()
    expect(screen.queryByText(/Section 4 of 4/)).toBeNull()
  })

  it('hides the brief header on the flashcard section when News flashcards are enabled', async () => {
    mockUseAppSettings.mockReturnValue({ settings: { newsFlashcardsEnabled: true } })
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    // FlashCard renders the title as an h2 (inside the card), but the top-level
    // h1 brief header + progress bar are hidden on the flashcard view.
    expect(screen.queryByRole('heading', { level: 1, name: 'Test News Story' })).toBeNull()
    expect(screen.queryByText(/Section 4 of 4/)).toBeNull()
  })

  it('hides brief header + progress bar on the completion screen after swiping past section 4', async () => {
    // Seed so isFirstCompletion is false and heading is 'Brief Complete'
    localStorage.setItem('skywatch_first_brief', '1')
    setupLoggedIn()
    const completeResponse = { ok: true, json: async () => ({ status: 'success', data: { airstarsEarned: 5, dailyCoinsEarned: 0, newCycleAirstars: 0, newTotalAirstars: 0 } }) }
    const previewResponse  = { ok: true, json: async () => ({ data: { airstarsEarned: 5, dailyCoinsEarned: 0 } }) }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(false)) // already reached — skip animation
      .mockResolvedValueOnce(previewResponse)                      // reward-preview fires on isLast
      .mockResolvedValueOnce(completeResponse)                     // /complete after swipe
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    // Sanity: section 4 content is on-screen before the swipe. The header
    // and progress bar are already hidden on section 4 (section now uses
    // the brief title as its heading, so duplicating it above is redundant).
    expect(screen.queryByRole('heading', { level: 1, name: 'Test News Story' })).toBeNull()
    expect(screen.queryByText(/Section 4 of 4/)).toBeNull()

    fireEvent.click(screen.getByTestId('swipe-left'))

    await waitFor(() => screen.getByText('Brief Complete'))

    // The section-progress bar must be gone on the completion screen
    expect(screen.queryByText(/Section 4 of 4/)).toBeNull()
    // The top-level h1 brief-header title must be gone (CompletionScreen renders
    // its own title block — any remaining title is inside that card, not the header).
    const headerTitles = screen.queryAllByRole('heading', { level: 1, name: 'Test News Story' })
      .filter(el => el.className.includes('text-text'))
    expect(headerTitles).toHaveLength(0)
  })

  it('renders FlashCard layout for non-News briefs even when News flashcards are disabled', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(NON_NEWS_BRIEF, lastSectionRecord()))
      .mockResolvedValueOnce(makeReachedFlashcardResponse(true))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText(/Section four flashcard text/))

    expect(screen.getByText('Flashcard')).toBeDefined()
    expect(screen.getByText('Context')).toBeDefined()
  })
})
