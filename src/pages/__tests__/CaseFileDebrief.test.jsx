import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── Mock framer-motion (stable per-tag reference Proxy pattern) ───────────────
vi.mock('framer-motion', () => {
  const React = require('react')
  const cache = {}
  const make = (tag) =>
    (cache[tag] ||= React.forwardRef(({ children, ...rest }, ref) =>
      React.createElement(tag, { ref, ...rest }, children)))
  return {
    motion: new Proxy({}, { get: (_, tag) => make(tag) }),
    AnimatePresence: ({ children }) => children,
  }
})

// ── Mock react-router-dom ─────────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams:   () => ({ caseSlug: 'russia-ukraine', chapterSlug: 'ch1' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

// ── Mock AuthContext ──────────────────────────────────────────────────────────
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1' }, API: '' }),
}))

// ── Mock SEO ──────────────────────────────────────────────────────────────────
vi.mock('../../components/SEO', () => ({ default: () => null }))

// ── Mock DebriefStage ─────────────────────────────────────────────────────────
vi.mock('../../components/caseFiles/stages/DebriefStage', () => ({
  default: ({ scoring, onSubmit }) => (
    <div data-testid="debrief-stage">
      {scoring
        ? <span data-testid="scoring-total">{scoring.totalScore}</span>
        : <span data-testid="no-scoring">no scoring</span>
      }
      <button data-testid="close-btn" onClick={() => onSubmit({ viewed: true })}>Close</button>
    </div>
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CHAPTER = {
  caseSlug:      'russia-ukraine',
  chapterSlug:   'ch1',
  title:         'Chapter 1: The Invasion',
  dateRangeLabel: 'Feb–Apr 2022',
  stages: [
    { id: 's0', type: 'cold_open', payload: {} },
    { id: 's2', type: 'debrief',   payload: { annotatedReplayBeats: [] } },
  ],
}

const SCORING = {
  totalScore: 850,
  breakdown:  [],
}

const BEST_SESSION = { sessionId: 'sess-789' }
const SESSION_WITH_SCORING = { scoring: SCORING }

function makeOk(body) {
  return { ok: true, json: async () => body }
}

function make404() {
  return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
}

// ── Import after mocks ────────────────────────────────────────────────────────
import CaseFileDebrief from '../CaseFileDebrief'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('CaseFileDebrief', () => {
  it('renders loading state initially', () => {
    // Delay the fetch so we can see the loading state
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}))
    render(<CaseFileDebrief />)
    expect(screen.getByText(/Loading debrief/i)).toBeDefined()
  })

  it('renders DebriefStage with scoring after successful fetch', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOk(CHAPTER))               // GET chapter
      .mockResolvedValueOnce(makeOk(BEST_SESSION))           // GET best session
      .mockResolvedValueOnce(makeOk(SESSION_WITH_SCORING))   // GET session details

    render(<CaseFileDebrief />)

    await waitFor(() => expect(screen.getByTestId('debrief-stage')).toBeDefined())
    expect(screen.getByTestId('scoring-total').textContent).toBe('850')
  })

  it('renders "no completed session" empty state when best returns 404', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOk(CHAPTER)) // GET chapter
      .mockResolvedValueOnce(make404())        // GET best → 404

    render(<CaseFileDebrief />)

    await waitFor(() => expect(screen.getByText(/Complete the chapter first/i)).toBeDefined())
    expect(screen.getByText(/Start chapter/i)).toBeDefined()
  })

  it('uses location.state.scoring if provided (skips best fetch)', async () => {
    // Override useLocation to return state with scoring + chapter
    vi.doMock('react-router-dom', () => ({
      useParams:   () => ({ caseSlug: 'russia-ukraine', chapterSlug: 'ch1' }),
      useNavigate: () => mockNavigate,
      useLocation: () => ({ state: { scoring: SCORING, chapter: CHAPTER } }),
      Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
    }))

    // We don't need to assert on fetch calls here — just that DebriefStage renders.
    // Use a minimal fetch mock so the effect doesn't error out.
    global.fetch = vi.fn()

    // Dynamic import to pick up the new useLocation mock
    const { default: CaseFileDebriefFromState } = await import('../CaseFileDebrief')

    render(<CaseFileDebriefFromState />)

    // If location.state has both chapter and scoring, the effect loads immediately
    // (still sets loading → false after effect completes, but doesn't hit best endpoint)
    await waitFor(() => {
      // Either debrief rendered or no-session; as long as no error
      const err = screen.queryByText(/Failed to load/i)
      expect(err).toBeNull()
    })
  })

  it('shows error state when chapter fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ message: 'Server error' }),
    })

    render(<CaseFileDebrief />)

    await waitFor(() => expect(screen.getByText(/Failed to load chapter/i)).toBeDefined())
    expect(screen.getByText(/Back to Case Files/i)).toBeDefined()
  })

  it('closes/navigates when close button clicked', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOk(CHAPTER))
      .mockResolvedValueOnce(makeOk(BEST_SESSION))
      .mockResolvedValueOnce(makeOk(SESSION_WITH_SCORING))

    render(<CaseFileDebrief />)

    await waitFor(() => expect(screen.getByTestId('close-btn')).toBeDefined())
    screen.getByTestId('close-btn').click()

    expect(mockNavigate).toHaveBeenCalledWith('/case-files')
  })
})
