import { render, screen, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

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
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

// ── Mock AuthContext ──────────────────────────────────────────────────────────
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1' }, API: '' }),
}))

// ── Mock SEO ──────────────────────────────────────────────────────────────────
vi.mock('../../components/SEO', () => ({ default: () => null }))

// ── Mock TutorialModal + GameChromeContext (CaseFilePlay imports both) ───────
vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))

// ── Mock StageRouter ──────────────────────────────────────────────────────────
vi.mock('../../components/caseFiles/StageRouter', () => ({
  default: ({ stage, onSubmit }) => (
    <div data-testid="stage-router" data-stage-type={stage?.type}>
      <button
        data-testid="submit-stage-btn"
        onClick={() => onSubmit({ completed: true })}
      >
        Submit
      </button>
    </div>
  ),
}))

// ── Mock useCaseFileSession ───────────────────────────────────────────────────
import useCaseFileSession from '../../hooks/useCaseFileSession'
vi.mock('../../hooks/useCaseFileSession', () => ({ default: vi.fn() }))

// ── Default hook return ───────────────────────────────────────────────────────
const CHAPTER = {
  caseSlug:      'russia-ukraine',
  chapterSlug:   'ch1',
  title:         'Chapter 1: The Invasion',
  dateRangeLabel: 'Feb–Apr 2022',
  stages: [
    { id: 's0', type: 'cold_open',    payload: {} },
    { id: 's1', type: 'evidence_wall', payload: {} },
    { id: 's2', type: 'debrief',      payload: {} },
  ],
}

function makeHookReturn(overrides = {}) {
  return {
    loading:           false,
    error:             null,
    chapter:           CHAPTER,
    sessionId:         'sess-123',
    currentStageIndex: 0,
    totalStages:       3,
    priorResults:      [],
    scoring:           null,
    isCompleted:       false,
    submitStage:       vi.fn().mockResolvedValue(undefined),
    sendQuestion:      vi.fn().mockResolvedValue({ answer: 'ok', questionsRemaining: 2 }),
    ...overrides,
  }
}

import CaseFilePlay from '../CaseFilePlay'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CaseFilePlay', () => {
  it('renders loading state initially', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn({ loading: true, chapter: null, sessionId: null }))
    render(<CaseFilePlay />)
    expect(screen.getByText(/Loading case file/i)).toBeDefined()
  })

  it('renders loading state when sessionId is null', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn({ loading: false, chapter: CHAPTER, sessionId: null }))
    render(<CaseFilePlay />)
    expect(screen.getByText(/Loading case file/i)).toBeDefined()
  })

  it('renders StageRouter for stage 0 when chapter is loaded', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn())
    render(<CaseFilePlay />)
    expect(screen.getByTestId('stage-router')).toBeDefined()
    expect(screen.getByTestId('stage-router').getAttribute('data-stage-type')).toBe('cold_open')
  })

  it('renders the chapter title and stage progress', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn())
    render(<CaseFilePlay />)
    expect(screen.getByText('Chapter 1: The Invasion')).toBeDefined()
    expect(screen.getByText(/Stage 1 \/ 3/i)).toBeDefined()
  })

  it('renders error state with back link', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn({ loading: false, error: 'Chapter not found', chapter: null }))
    render(<CaseFilePlay />)
    expect(screen.getByText(/Chapter not found/i)).toBeDefined()
    expect(screen.getByText(/Back to Case Files/i)).toBeDefined()
  })

  it('renders StageRouter for the current stage index', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn({ currentStageIndex: 1 }))
    render(<CaseFilePlay />)
    expect(screen.getByTestId('stage-router').getAttribute('data-stage-type')).toBe('evidence_wall')
  })

  it('calls submitStage when the stage submits', async () => {
    const submitStage = vi.fn().mockResolvedValue(undefined)
    useCaseFileSession.mockReturnValue(makeHookReturn({ submitStage }))
    render(<CaseFilePlay />)

    const btn = screen.getByTestId('submit-stage-btn')
    await act(async () => { btn.click() })

    expect(submitStage).toHaveBeenCalledWith({ completed: true })
  })

  it('navigates to debrief when isCompleted becomes true', () => {
    const scoring = { totalScore: 900 }
    useCaseFileSession.mockReturnValue(makeHookReturn({ isCompleted: true, scoring }))
    render(<CaseFilePlay />)

    expect(mockNavigate).toHaveBeenCalledWith(
      '/case-files/russia-ukraine/ch1/debrief',
      expect.objectContaining({ state: expect.objectContaining({ scoring }) }),
    )
  })

  it('does NOT navigate when isCompleted is false', () => {
    useCaseFileSession.mockReturnValue(makeHookReturn({ isCompleted: false }))
    render(<CaseFilePlay />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
