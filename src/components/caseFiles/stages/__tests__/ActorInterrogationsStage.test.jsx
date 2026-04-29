import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import ActorInterrogationsStage from '../ActorInterrogationsStage'

// ── framer-motion mock ────────────────────────────────────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      style,
      role,
      'aria-modal': ariaModal,
      'aria-label': ariaLabel,
      'data-testid': testId,
    }) => (
      <div
        className={className}
        style={style}
        role={role}
        aria-modal={ariaModal}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── ResizeObserver stub (jsdom doesn't implement it) ─────────────────────────
beforeEach(() => {
  global.ResizeObserver = class {
    observe()    {}
    unobserve()  {}
    disconnect() {}
  }
})

// ── fixtures ──────────────────────────────────────────────────────────────────
const ACTORS = [
  { id: 'lavrov',  name: 'Sergei Lavrov',  role: 'Foreign Minister', faction: 'Russia',  systemPromptKey: 'lavrov' },
  { id: 'putin',   name: 'Vladimir Putin', role: 'President',        faction: 'Russia',  systemPromptKey: 'putin' },
  { id: 'biden',   name: 'Joe Biden',      role: 'President',        faction: 'USA',     systemPromptKey: 'biden' },
]

const RELATIONSHIPS = [
  { fromActorId: 'lavrov', toActorId: 'putin', label: 'reports to' },
]

const STAGE = {
  id:   'stage-1',
  type: 'actor_interrogations',
  payload: {
    actors:               ACTORS,
    relationships:        RELATIONSHIPS,
    maxQuestionsPerActor: 3,
    contextDateLabel:     'February 2022',
  },
}

const SESSION = {
  caseSlug:    'russia-ukraine',
  chapterSlug: 'chapter-1',
  sessionId:   'sess-abc',
  priorResults: [],
}

function renderStage(overrides = {}) {
  const defaults = {
    stage:        STAGE,
    sessionContext: SESSION,
    onSubmit:     vi.fn().mockResolvedValue(undefined),
    sendQuestion: vi.fn().mockResolvedValue({ answer: 'Classified.', questionsRemaining: 2 }),
  }
  return render(<ActorInterrogationsStage {...defaults} {...overrides} />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ActorInterrogationsStage — rendering', () => {
  it('renders the stage container', () => {
    renderStage()
    expect(screen.getByTestId('actor-interrogations-stage')).toBeDefined()
  })

  it('renders all actors as portrait cards', () => {
    renderStage()
    expect(screen.getByTestId('actor-portrait-lavrov')).toBeDefined()
    expect(screen.getByTestId('actor-portrait-putin')).toBeDefined()
    expect(screen.getByTestId('actor-portrait-biden')).toBeDefined()
  })

  it('renders each actor name', () => {
    renderStage()
    expect(screen.getByText('Sergei Lavrov')).toBeDefined()
    expect(screen.getByText('Vladimir Putin')).toBeDefined()
    expect(screen.getByText('Joe Biden')).toBeDefined()
  })

  it('renders the contextDateLabel in the header', () => {
    renderStage()
    expect(screen.getByText(/February 2022/)).toBeDefined()
  })

  it('renders the pinboard', () => {
    renderStage()
    expect(screen.getByTestId('pinboard')).toBeDefined()
  })

  it('shows 0 actors interrogated initially', () => {
    renderStage()
    expect(screen.getByTestId('actors-interrogated-count').textContent).toContain('0')
  })

  it('shows 0 / total questions used initially', () => {
    renderStage()
    // 3 actors × 3 questions = 9 max
    expect(screen.getByTestId('questions-used-count').textContent).toContain('0')
    expect(screen.getByTestId('questions-used-count').textContent).toContain('9')
  })

  it('renders the Done button', () => {
    renderStage()
    expect(screen.getByTestId('done-button')).toBeDefined()
    expect(screen.getByTestId('done-button').disabled).toBe(false)
  })
})

describe('ActorInterrogationsStage — panel interaction', () => {
  it('clicking an actor opens the interrogation panel', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => expect(screen.getByTestId('interrogation-panel')).toBeDefined())
  })

  it('panel shows the clicked actor name', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => expect(screen.getAllByText('Sergei Lavrov').length).toBeGreaterThan(0))
  })

  it('clicking the same actor again closes the panel', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => expect(screen.queryByTestId('interrogation-panel')).toBeNull())
  })

  it('close button in panel dismisses the panel', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.click(screen.getByTestId('panel-close-btn'))
    await waitFor(() => expect(screen.queryByTestId('interrogation-panel')).toBeNull())
  })
})

describe('ActorInterrogationsStage — question flow', () => {
  it('calls sendQuestion with actorId and question text', async () => {
    const sendQuestion = vi.fn().mockResolvedValue({ answer: 'No comment.', questionsRemaining: 2 })
    renderStage({ sendQuestion })

    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: 'Tell me about the buildup.' },
    })
    fireEvent.click(screen.getByTestId('send-button'))

    await waitFor(() =>
      expect(sendQuestion).toHaveBeenCalledWith('lavrov', 'Tell me about the buildup.')
    )
  })

  it('appends question and answer to the transcript', async () => {
    const sendQuestion = vi.fn().mockResolvedValue({ answer: 'No comment.', questionsRemaining: 2 })
    renderStage({ sendQuestion })

    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: 'Tell me about the buildup.' },
    })
    fireEvent.click(screen.getByTestId('send-button'))

    await waitFor(() => screen.getByTestId('transcript-q-0'))
    expect(screen.getByText('Tell me about the buildup.')).toBeDefined()
    expect(screen.getByText('No comment.')).toBeDefined()
  })

  it('updates actors-interrogated count after asking a question', async () => {
    const sendQuestion = vi.fn().mockResolvedValue({ answer: 'Fine.', questionsRemaining: 2 })
    renderStage({ sendQuestion })

    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Question?' } })
    fireEvent.click(screen.getByTestId('send-button'))

    await waitFor(() =>
      expect(screen.getByTestId('actors-interrogated-count').textContent).toContain('1')
    )
  })

  it('updates questions-used count after asking a question', async () => {
    const sendQuestion = vi.fn().mockResolvedValue({ answer: 'Fine.', questionsRemaining: 2 })
    renderStage({ sendQuestion })

    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Question?' } })
    fireEvent.click(screen.getByTestId('send-button'))

    await waitFor(() =>
      expect(screen.getByTestId('questions-used-count').textContent).toContain('1')
    )
  })
})

describe('ActorInterrogationsStage — Done / submit', () => {
  it('Done button calls onSubmit with only interrogated actors', async () => {
    const onSubmit    = vi.fn().mockResolvedValue(undefined)
    const sendQuestion = vi.fn().mockResolvedValue({ answer: 'Noted.', questionsRemaining: 2 })
    renderStage({ onSubmit, sendQuestion })

    // Interrogate Lavrov
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Question 1' } })
    fireEvent.click(screen.getByTestId('send-button'))
    await waitFor(() => screen.getByTestId('transcript-q-0'))

    // Close panel and click Done
    fireEvent.click(screen.getByTestId('panel-close-btn'))
    fireEvent.click(screen.getByTestId('done-button'))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        interrogations: [{ actorId: 'lavrov', questionCount: 1 }],
      })
    )
  })

  it('Done button calls onSubmit with empty interrogations when no questions asked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderStage({ onSubmit })

    fireEvent.click(screen.getByTestId('done-button'))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ interrogations: [] })
    )
  })

  it('Done button is always enabled (never disabled before submit)', () => {
    renderStage()
    const btn = screen.getByTestId('done-button')
    expect(btn.disabled).toBe(false)
  })

  it('Done button accumulates multiple interrogated actors', async () => {
    const onSubmit    = vi.fn().mockResolvedValue(undefined)
    const sendQuestion = vi.fn().mockResolvedValue({ answer: 'OK.', questionsRemaining: 2 })
    renderStage({ onSubmit, sendQuestion })

    // Interrogate Lavrov
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Q-Lavrov' } })
    fireEvent.click(screen.getByTestId('send-button'))
    await waitFor(() => screen.getByTestId('transcript-q-0'))
    fireEvent.click(screen.getByTestId('panel-close-btn'))
    await waitFor(() => expect(screen.queryByTestId('interrogation-panel')).toBeNull())

    // Interrogate Biden
    fireEvent.click(screen.getByTestId('actor-portrait-biden'))
    await waitFor(() => screen.getByTestId('interrogation-panel'))
    fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Q-Biden' } })
    fireEvent.click(screen.getByTestId('send-button'))
    await waitFor(() => screen.getByTestId('transcript-q-0'))
    fireEvent.click(screen.getByTestId('panel-close-btn'))
    await waitFor(() => expect(screen.queryByTestId('interrogation-panel')).toBeNull())

    fireEvent.click(screen.getByTestId('done-button'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
      const { interrogations } = onSubmit.mock.calls[0][0]
      const actorIds = interrogations.map((i) => i.actorId).sort()
      expect(actorIds).toEqual(['biden', 'lavrov'])
      expect(interrogations.every((i) => i.questionCount === 1)).toBe(true)
    })
  })
})
