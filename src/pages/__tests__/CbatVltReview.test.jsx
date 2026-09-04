import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatVlt from '../CbatVlt'
import { press } from '../../components/landingGames/demoDriver'
import { VLT_PACKS } from '../../utils/cbat/vltPacks'
import { VLT_LAUNCH_MS } from '../../utils/cbat/vltDifficulty'

// The post-answer review on the Verbal Logic Test. Getting one wrong is the only
// moment the reasoning is worth anything, so what is pinned here is that the
// walkthrough appears exactly then — and that it puts the sentences it depends
// on back on screen, highlighted, rather than describing them.
//
// The mocks match CbatRosterCompletion.test.jsx, which drives the same page.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const ALL_QUESTIONS = VLT_PACKS.flatMap(p => p.questions)

function renderVlt() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatVlt />)
}

// Intro → launch flash → reading → the first question on screen.
function startRun() {
  const view = renderVlt()
  act(() => { press(screen.getByText('Start')) })
  act(() => { vi.advanceTimersByTime(VLT_LAUNCH_MS + 100) })
  act(() => { press(screen.getByText('Start the questions')) })
  return view
}

// Which question the run actually drew, found by its prompt. The run is built
// with Math.random, so the test reads what it got rather than pinning a seed.
function currentQuestion(container) {
  const q = ALL_QUESTIONS.find(x => container.textContent.includes(x.prompt))
  expect(q).toBeTruthy()
  return q
}

const optionButton = (container, label) =>
  [...container.querySelectorAll('button')].find(b => b.textContent === label)

const marks = (container, kind = 'evidence') =>
  [...container.querySelectorAll(`[data-testid="vlt-${kind}-mark"]`)]

describe('VLT post-answer review', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('leaves the tabs unmarked while the question is still live', () => {
    // Highlighting mid-question would hand over the search the test measures.
    const { container } = startRun()
    expect(marks(container)).toHaveLength(0)
    expect(screen.queryByText('How to get there')).toBeNull()
  })

  it('walks through the derivation after a wrong answer', () => {
    const { container } = startRun()
    const q = currentQuestion(container)

    act(() => { press(optionButton(container, q.distractors[0])) })

    expect(screen.getByText('How to get there')).toBeTruthy()
    const steps = [...container.querySelectorAll('ol li')]
    expect(steps).toHaveLength(q.evidence.length)
    for (const step of q.evidence) {
      expect(container.textContent).toContain(step.why)
    }
  })

  it('reopens the tabs it depends on and marks the sentences inside them', () => {
    const { container } = startRun()
    const q = currentQuestion(container)
    const pack = VLT_PACKS.find(p => p.questions.includes(q))
    const wantedTabs = [...new Set(q.evidence.map(s => s.tab).filter(Boolean))]

    act(() => { press(optionButton(container, q.distractors[0])) })

    const openTitles = [...container.querySelectorAll('[data-testid="tab-strip"] button')]
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.textContent)
    for (const id of wantedTabs) {
      const tab = pack.tabs.find(t => t.id === id)
      expect([id, openTitles.some(t => t.includes(tab.title))]).toEqual([id, true])
    }

    // Every quote whose tab is open is marked, and marked with its own text.
    const quoted = q.evidence.filter(s => s.tab && s.quote).map(s => s.quote)
    const marked = marks(container).map(m => m.textContent)
    for (const quote of quoted) expect(marked).toContain(quote)
  })

  it('marks the plainly-stated trap in its own colour, where one is claimed', () => {
    // Only some questions name a trap sentence — plenty of distractors are just
    // plausible. This drives to one that does rather than skipping the case.
    const withTrap = ALL_QUESTIONS.find(q => q.trapEvidence)
    expect(withTrap).toBeTruthy()

    let container
    for (let attempt = 0; attempt < 40; attempt++) {
      const view = startRun()
      container = view.container
      if (container.textContent.includes(withTrap.prompt)) break
      view.unmount()
      container = null
    }
    // Forty runs of a pack that holds this question deals it with near-certainty.
    // Failing here rather than skipping quietly, so a genuine regression is loud.
    expect(container).toBeTruthy()

    act(() => { press(optionButton(container, withTrap.distractors[0])) })
    const trapMarks = marks(container, 'trap').map(m => m.textContent)
    expect(trapMarks).toContain(withTrap.trapEvidence.quote)
  })

  it('says nothing extra when the answer was right', () => {
    const { container } = startRun()
    const q = currentQuestion(container)

    act(() => { press(optionButton(container, q.answer)) })

    expect(screen.getByText('✓ Correct')).toBeTruthy()
    expect(screen.queryByText('How to get there')).toBeNull()
    expect(marks(container)).toHaveLength(0)
  })
})
