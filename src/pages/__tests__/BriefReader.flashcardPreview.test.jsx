import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1' },
    API: '',
    apiFetch:      (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

// Places the user on section 3 (second-to-last) of a 4-section brief on mount
function section3Record() {
  return { currentSection: 2, completed: false, reachedFlashcard: false }
}

describe('BriefReader — flashcard preview (lazy-load)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('fetches the reached-flashcard-preview GET when the user lands on section 3', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, section3Record()))
      .mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/reached-flashcard-preview')) {
          return Promise.resolve({
            ok:   true,
            json: async () => ({ status: 'success', wasNew: true, flashcardCount: 3, gameUnlocksGranted: [] }),
          })
        }
        return Promise.resolve(SAFE_EMPTY)
      })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      const previewHit = calls.find(([url, opts]) =>
        typeof url === 'string' &&
        url.includes('/reached-flashcard-preview') &&
        (!opts || !opts.method || opts.method === 'GET')
      )
      expect(previewHit).toBeDefined()
    })

    // The preview must NOT commit — no POST /reached-flashcard while still on section 3
    const postHit = global.fetch.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('/reached-flashcard') && !c[0].includes('preview') && c[1]?.method === 'POST'
    )
    expect(postHit).toBeUndefined()
  })

  it('does NOT fetch the preview when the user has already reached the flashcard', async () => {
    setupLoggedIn()
    const alreadyFlagged = { currentSection: 2, completed: false, reachedFlashcard: true }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF, alreadyFlagged))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await new Promise(r => setTimeout(r, 100))
    const urls = global.fetch.mock.calls.map(c => c[0])
    expect(urls.some(u => typeof u === 'string' && u.includes('/reached-flashcard-preview'))).toBe(false)
  })

  it('does NOT fetch the preview for a guest (no user)', async () => {
    mockUseAuth.mockReturnValue({
      user:          null,
      API: '',
      apiFetch:      (...args) => fetch(...args),
      awardAirstars: vi.fn(),
      setUser:       vi.fn(),
    })
    localStorage.setItem(`sw_brief_sec_brief123`, '2')
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(FOUR_SECTION_BRIEF))
      .mockResolvedValue(SAFE_EMPTY)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await new Promise(r => setTimeout(r, 100))
    const urls = global.fetch.mock.calls.map(c => c[0])
    expect(urls.some(u => typeof u === 'string' && u.includes('/reached-flashcard-preview'))).toBe(false)
  })
})
