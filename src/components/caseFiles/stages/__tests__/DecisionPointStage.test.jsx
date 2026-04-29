import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import DecisionPointStage from '../DecisionPointStage'

// ── Mock framer-motion ────────────────────────────────────────────────────
// Use a stable component reference per tag so React never unmounts/remounts
// due to a new component type between renders (Proxy get returns a new fn
// each call, causing React to see an unknown component on every re-render).
const MotionDiv = ({ children, ...rest }) => <div {...rest}>{children}</div>
const MotionSpan = ({ children, ...rest }) => <span {...rest}>{children}</span>

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      if (tag === 'span') return MotionSpan
      return MotionDiv
    },
  }),
  AnimatePresence: ({ children }) => children,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const STAGE = {
  id:   'stage-1',
  type: 'decision_point',
  payload: {
    contextDateLabel: 'December 2021',
    prompt:           "What is Russia's most likely play?",
    options: [
      { id: 'opt-a', text: 'Full-scale invasion across multiple axes',    hint: 'Consider force disposition near Kyiv.' },
      { id: 'opt-b', text: 'Limited incursion into Donbas only',          hint: 'Think about Western sanctions tolerance.' },
      { id: 'opt-c', text: 'Coercive diplomacy — no military action',     hint: 'Historical precedent from 2014–2015.' },
      { id: 'opt-d', text: 'Proxy escalation via separatist surrogates',  hint: 'The Wagner Group playbook.' },
    ],
  },
}

const SESSION_CONTEXT = {
  caseSlug:    'russia-ukraine',
  chapterSlug: 'ch-1',
  sessionId:   'sess-abc',
  priorResults: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────

function renderStage(overrides = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <DecisionPointStage
      stage={STAGE}
      sessionContext={SESSION_CONTEXT}
      onSubmit={onSubmit}
      {...overrides}
    />
  )
  return { onSubmit }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DecisionPointStage — rendering', () => {
  it('renders the context date label', () => {
    renderStage()
    expect(screen.getByText('December 2021')).toBeDefined()
  })

  it('renders the prompt', () => {
    renderStage()
    expect(screen.getByText("What is Russia's most likely play?")).toBeDefined()
  })

  it('renders all option cards', () => {
    renderStage()
    expect(screen.getByTestId('option-card-opt-a')).toBeDefined()
    expect(screen.getByTestId('option-card-opt-b')).toBeDefined()
    expect(screen.getByTestId('option-card-opt-c')).toBeDefined()
    expect(screen.getByTestId('option-card-opt-d')).toBeDefined()
  })

  it('renders all option texts', () => {
    renderStage()
    expect(screen.getByText('Full-scale invasion across multiple axes')).toBeDefined()
    expect(screen.getByText('Limited incursion into Donbas only')).toBeDefined()
    expect(screen.getByText('Coercive diplomacy — no military action')).toBeDefined()
    expect(screen.getByText('Proxy escalation via separatist surrogates')).toBeDefined()
  })
})

describe('DecisionPointStage — Lock In button', () => {
  it('is disabled when no option is selected', () => {
    renderStage()
    const btn = screen.getByTestId('lock-in-btn')
    expect(btn.disabled).toBe(true)
  })

  it('is enabled after selecting an option', () => {
    renderStage()
    fireEvent.click(screen.getByTestId('option-card-opt-b'))
    const btn = screen.getByTestId('lock-in-btn')
    expect(btn.disabled).toBe(false)
  })
})

describe('DecisionPointStage — option selection', () => {
  it('clicking an option marks it as selected (aria-pressed)', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('option-card-opt-a'))
    // Re-query after click to get the fresh DOM node (motion mock causes remount)
    await waitFor(() =>
      expect(screen.getByTestId('option-card-opt-a').getAttribute('aria-pressed')).toBe('true')
    )
  })

  it('clicking a different option moves selection', async () => {
    renderStage()
    fireEvent.click(screen.getByTestId('option-card-opt-a'))
    fireEvent.click(screen.getByTestId('option-card-opt-c'))
    await waitFor(() => {
      expect(screen.getByTestId('option-card-opt-c').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('option-card-opt-a').getAttribute('aria-pressed')).toBe('false')
    })
  })
})

describe('DecisionPointStage — Lock In submission', () => {
  it('calls onSubmit with selectedOptionId after Lock In', async () => {
    const { onSubmit } = renderStage()
    fireEvent.click(screen.getByTestId('option-card-opt-b'))
    fireEvent.click(screen.getByTestId('lock-in-btn'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({ selectedOptionId: 'opt-b' })
  })

  it('does not call onSubmit when no option selected', async () => {
    const { onSubmit } = renderStage()
    fireEvent.click(screen.getByTestId('lock-in-btn'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('DecisionPointStage — hint affordance', () => {
  it('shows a Hint toggle button for each option that has a hint', () => {
    renderStage()
    expect(screen.getByTestId('hint-toggle-opt-a')).toBeDefined()
    expect(screen.getByTestId('hint-toggle-opt-b')).toBeDefined()
    expect(screen.getByTestId('hint-toggle-opt-c')).toBeDefined()
    expect(screen.getByTestId('hint-toggle-opt-d')).toBeDefined()
  })

  it('hint text is visible by default (no click needed)', () => {
    // Hints default to OPEN so knowledge-light players see the context up
    // front without an extra interaction.
    renderStage()
    expect(screen.getByTestId('hint-text-opt-a')).toBeDefined()
    expect(screen.getByText('Consider force disposition near Kyiv.')).toBeDefined()
  })

  it('clicking Hint toggle hides the hint text', () => {
    renderStage()
    fireEvent.click(screen.getByTestId('hint-toggle-opt-a'))
    expect(screen.queryByTestId('hint-text-opt-a')).toBeNull()
  })

  it('clicking Hint toggle twice re-shows the hint text', () => {
    renderStage()
    fireEvent.click(screen.getByTestId('hint-toggle-opt-a'))
    fireEvent.click(screen.getByTestId('hint-toggle-opt-a'))
    expect(screen.getByTestId('hint-text-opt-a')).toBeDefined()
  })

  it('options without a hint do not show a hint toggle', () => {
    const stageNoHint = {
      ...STAGE,
      payload: {
        ...STAGE.payload,
        options: [
          { id: 'opt-x', text: 'No hint option' },
        ],
      },
    }
    renderStage({ stage: stageNoHint })
    expect(screen.queryByTestId('hint-toggle-opt-x')).toBeNull()
  })
})

describe('DecisionPointStage — signalsRecap', () => {
  const STAGE_WITH_RECAP = {
    ...STAGE,
    payload: {
      ...STAGE.payload,
      signalsRecap: [
        { stageRef: 'Evidence wall', takeaway: 'Two big tank build-ups, plus field hospitals.' },
        { stageRef: 'Map',           takeaway: 'Three possible attack lines.' },
        { takeaway: 'Western intelligence has gone unusually public.' },
      ],
    },
  }

  it('renders the signalsRecap panel when payload includes one', () => {
    renderStage({ stage: STAGE_WITH_RECAP })
    expect(screen.getByTestId('signals-recap')).toBeDefined()
    expect(screen.getByText(/Two big tank build-ups/)).toBeDefined()
    expect(screen.getByText(/Three possible attack lines/)).toBeDefined()
    expect(screen.getByText(/Western intelligence has gone unusually public/)).toBeDefined()
  })

  it('renders the stageRef label when present', () => {
    renderStage({ stage: STAGE_WITH_RECAP })
    expect(screen.getByText(/Evidence wall:/)).toBeDefined()
    expect(screen.getByText(/Map:/)).toBeDefined()
  })

  it('does not render the recap panel when signalsRecap is missing or empty', () => {
    renderStage()
    expect(screen.queryByTestId('signals-recap')).toBeNull()
  })
})
