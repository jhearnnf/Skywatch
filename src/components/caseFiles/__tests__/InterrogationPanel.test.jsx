import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import InterrogationPanel from '../InterrogationPanel'

// framer-motion: replace motion.div with a plain div so panel renders in jsdom
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, role, 'aria-modal': ariaModal, 'aria-label': ariaLabel, 'data-testid': testId }) => (
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

const ACTOR = {
  id:      'lavrov',
  name:    'Sergei Lavrov',
  role:    'Minister of Foreign Affairs',
  faction: 'Russia',
}

const TRANSCRIPT = [
  { q: 'What are your intentions?', a: 'Peaceful.', askedAt: '2024-01-01T10:00:00Z' },
  { q: 'Why the buildup?',          a: 'Defensive posture.', askedAt: '2024-01-01T10:01:00Z' },
]

function renderPanel(overrides = {}) {
  const defaults = {
    actor:             ACTOR,
    transcript:        [],
    questionsRemaining: 3,
    onSendQuestion:    vi.fn().mockResolvedValue(undefined),
    onClose:           vi.fn(),
    isPending:         false,
    contextDateLabel:  'January 2024',
  }
  return render(<InterrogationPanel {...defaults} {...overrides} />)
}

describe('InterrogationPanel', () => {
  it('renders actor name and role in header', () => {
    renderPanel()
    expect(screen.getByText('Sergei Lavrov')).toBeDefined()
    expect(screen.getByText('Minister of Foreign Affairs')).toBeDefined()
  })

  it('renders the contextDateLabel', () => {
    renderPanel()
    expect(screen.getByText('January 2024')).toBeDefined()
  })

  it('renders existing transcript messages', async () => {
    renderPanel({ transcript: TRANSCRIPT })
    expect(screen.getByTestId('transcript-q-0')).toBeDefined()
    expect(screen.getByText('What are your intentions?')).toBeDefined()
    expect(screen.getByTestId('transcript-a-0')).toBeDefined()
    expect(screen.getByText('Peaceful.')).toBeDefined()
    expect(screen.getByText('Why the buildup?')).toBeDefined()
    // The newest answer types itself out, so it lands a beat after the render.
    expect(await screen.findByText('Defensive posture.')).toBeDefined()
  })

  it('send button is disabled when input is empty', () => {
    renderPanel()
    const btn = screen.getByTestId('send-button')
    expect(btn.disabled).toBe(true)
  })

  it('send button becomes enabled when input has text', () => {
    renderPanel()
    const input = screen.getByTestId('question-input')
    fireEvent.change(input, { target: { value: 'Hello?' } })
    const btn = screen.getByTestId('send-button')
    expect(btn.disabled).toBe(false)
  })

  it('character counter updates as user types', () => {
    renderPanel()
    const input = screen.getByTestId('question-input')
    fireEvent.change(input, { target: { value: 'Hi' } })
    expect(screen.getByTestId('char-counter').textContent).toMatch(/^2/)
  })

  it('character counter shows 0 / 280 initially', () => {
    renderPanel()
    expect(screen.getByTestId('char-counter').textContent).toMatch(/^0/)
    expect(screen.getByTestId('char-counter').textContent).toContain('280')
  })

  it('textarea has maxLength of 280', () => {
    renderPanel()
    const input = screen.getByTestId('question-input')
    expect(Number(input.getAttribute('maxlength'))).toBe(280)
  })

  it('calls onSendQuestion with the typed text on Send click', async () => {
    const onSendQuestion = vi.fn().mockResolvedValue(undefined)
    renderPanel({ onSendQuestion })
    const input = screen.getByTestId('question-input')
    fireEvent.change(input, { target: { value: 'What happened in 2022?' } })
    fireEvent.click(screen.getByTestId('send-button'))
    await waitFor(() => expect(onSendQuestion).toHaveBeenCalledWith('What happened in 2022?'))
  })

  it('clears input after sending', async () => {
    const onSendQuestion = vi.fn().mockResolvedValue(undefined)
    renderPanel({ onSendQuestion })
    const input = screen.getByTestId('question-input')
    fireEvent.change(input, { target: { value: 'My question' } })
    fireEvent.click(screen.getByTestId('send-button'))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('input is disabled when questionsRemaining === 0', () => {
    renderPanel({ questionsRemaining: 0 })
    const input = screen.getByTestId('question-input')
    expect(input.disabled).toBe(true)
  })

  it('send button is disabled when questionsRemaining === 0', () => {
    renderPanel({ questionsRemaining: 0 })
    const btn = screen.getByTestId('send-button')
    expect(btn.disabled).toBe(true)
  })

  it('shows "No more questions" message when questionsRemaining === 0', () => {
    renderPanel({ questionsRemaining: 0 })
    expect(screen.getByTestId('questions-remaining').textContent).toContain('No more questions')
  })

  it('input is disabled while isPending is true', () => {
    renderPanel({ isPending: true })
    const input = screen.getByTestId('question-input')
    expect(input.disabled).toBe(true)
  })

  it('send button is disabled while isPending is true', () => {
    renderPanel({ isPending: true, transcript: TRANSCRIPT })
    // Input is disabled → canSend is false
    const btn = screen.getByTestId('send-button')
    expect(btn.disabled).toBe(true)
  })

  it('shows typing indicator while isPending is true', () => {
    renderPanel({ isPending: true })
    expect(screen.getByTestId('typing-indicator')).toBeDefined()
  })

  it('hides typing indicator when not pending', () => {
    renderPanel({ isPending: false })
    expect(screen.queryByTestId('typing-indicator')).toBeNull()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    fireEvent.click(screen.getByTestId('panel-close-btn'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows inline error if onSendQuestion rejects', async () => {
    const onSendQuestion = vi.fn().mockRejectedValue(new Error('Network failure'))
    renderPanel({ onSendQuestion })
    const input = screen.getByTestId('question-input')
    fireEvent.change(input, { target: { value: 'Test question' } })
    fireEvent.click(screen.getByTestId('send-button'))
    await waitFor(() => expect(screen.getByTestId('send-error')).toBeDefined())
    expect(screen.getByText('Network failure')).toBeDefined()
  })

  // ── Portrait bay ───────────────────────────────────────────────────────────

  it('puts the person you are interviewing on screen', () => {
    renderPanel()
    expect(screen.getByTestId('portrait-bay')).toBeDefined()
    expect(screen.getByTestId('actor-face').getAttribute('aria-label')).toBe(
      'Portrait of Sergei Lavrov'
    )
  })

  it('shows the actor considering the question while one is in flight', () => {
    renderPanel({ isPending: true })
    expect(screen.getByTestId('actor-mood').getAttribute('data-mood')).toBe('thinking')
    expect(screen.getByTestId('actor-face').getAttribute('data-mood')).toBe('thinking')
  })

  it('reacts with the mood the server sent back with the answer', async () => {
    renderPanel({
      transcript: [{ q: 'Why?', a: 'A plain answer.', mood: 'wry', askedAt: 'now' }],
    })
    await waitFor(() =>
      expect(screen.getByTestId('actor-mood').getAttribute('data-mood')).toBe('wry')
    )
    expect(screen.getByTestId('actor-mood').textContent).toBe('Wry')
  })

  it('falls back to reading the answer when no mood came back', async () => {
    renderPanel({
      transcript: [
        { q: 'Will you invade?', a: 'That is a hypothetical I will not entertain.', askedAt: 'now' },
      ],
    })
    await waitFor(() =>
      expect(screen.getByTestId('actor-mood').getAttribute('data-mood')).toBe('guarded')
    )
  })

  // ── Typewriter reveal ──────────────────────────────────────────────────────

  it('types the newest answer out, and leaves older ones alone', async () => {
    renderPanel({ transcript: TRANSCRIPT })
    // The earlier answer is history and is drawn in full immediately.
    expect(screen.getByTestId('transcript-a-0').textContent).toBe('Peaceful.')
    // The newest one arrives a character at a time.
    expect(screen.getByTestId('transcript-a-1').textContent.length).toBeLessThan(
      'Defensive posture.'.length
    )
    await waitFor(() =>
      expect(screen.getByTestId('transcript-a-1').textContent).toBe('Defensive posture.')
    )
  })

  it('drops the rest of the line in when the transcript is clicked', () => {
    renderPanel({ transcript: TRANSCRIPT })
    fireEvent.click(screen.getByTestId('transcript-a-1'))
    expect(screen.getByTestId('transcript-a-1').textContent).toBe('Defensive posture.')
  })
})
