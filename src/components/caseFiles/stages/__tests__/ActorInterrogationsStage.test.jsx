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

  it('counts people asked against the number on the board', () => {
    renderStage()
    expect(screen.getByTestId('actors-interrogated-count').textContent).toBe('0 of 3 people asked')
  })

  // The limit is 3 questions per person, not a pool of 9 to spend across
  // everyone, so the counter states the per-person cap rather than a total.
  it('states the per-person question limit, not a global budget', () => {
    renderStage()
    const text = screen.getByTestId('questions-used-count').textContent
    expect(text).toContain('0 questions used')
    expect(text).toContain('up to 3 each')
    expect(text).not.toContain('9')
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
    // The answer is revealed a character at a time by the panel.
    expect(await screen.findByText('No comment.')).toBeDefined()
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


// The relationship labels used to be chips pinned to the lines themselves.
// Every actor in a pinboard row shares a y coordinate, so those lines are
// horizontal and the chips piled up on each other and on the cards. The text
// now lives in a strip under the board, and in the panel for touch users.
describe('ActorInterrogationsStage — relationships you can actually read', () => {
  it('prompts you to pick someone before anything is highlighted', () => {
    renderStage()
    expect(screen.getByTestId('connections-strip').textContent).toMatch(/Hover or open a person/i)
  })

  it('names who the hovered person is tied to, and how', () => {
    renderStage()
    fireEvent.mouseEnter(screen.getByTestId('actor-portrait-lavrov'))
    const strip = screen.getByTestId('connections-strip')
    expect(strip.textContent).toMatch(/Sergei Lavrov is tied to/i)
    expect(strip.textContent).toMatch(/Vladimir Putin/)
    expect(strip.textContent).toMatch(/reports to/)
  })

  it('reads the relationship from either end', () => {
    renderStage()
    fireEvent.mouseEnter(screen.getByTestId('actor-portrait-putin'))
    expect(screen.getByTestId('connections-strip').textContent).toMatch(/Sergei Lavrov/)
  })

  it('says so when the selected person has no ties', () => {
    renderStage()
    fireEvent.mouseEnter(screen.getByTestId('actor-portrait-biden'))
    expect(screen.getByTestId('connections-strip').textContent).toMatch(/Hover or open a person/i)
  })

  it('never draws the label on the board itself', () => {
    renderStage()
    fireEvent.mouseEnter(screen.getByTestId('actor-portrait-lavrov'))
    expect(screen.queryByTestId('relationship-line-label')).toBeNull()
  })

  // A phone has no hover, so opening someone has to carry the same facts.
  it('repeats the ties inside the interrogation panel', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('actor-portrait-lavrov'))
    const panel = await screen.findByTestId('panel-connections')
    expect(panel.textContent).toMatch(/Vladimir Putin/)
    expect(panel.textContent).toMatch(/reports to/)
  })
})


// Cards on one baseline make every same-row relationship a horizontal line, and
// horizontal lines all overlap in the same strip.
describe('ActorInterrogationsStage — pinboard stagger', () => {
  it('pins neighbouring cards at different heights', () => {
    renderStage()
    const offsets = ACTORS.map(
      a => screen.getByTestId(`actor-slot-${a.id}`).style.transform
    )
    expect(offsets[0]).not.toBe(offsets[1])
    expect(offsets[1]).not.toBe(offsets[2])
    offsets.forEach(t => expect(t).toMatch(/translateY\(\d+px\)/))
  })

  it('keeps the first card on the board baseline', () => {
    renderStage()
    expect(screen.getByTestId('actor-slot-lavrov').style.transform).toBe('translateY(0px)')
  })
})
