import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import PhaseRevealStage from '../PhaseRevealStage'

// ── Mock framer-motion ────────────────────────────────────────────────────
// Stable component references per tag to avoid React unmount/remount cycles
// (the spec's Proxy approach returns a new fn per access, which React treats
// as a new component type each render, causing state loss and DOM churn).
const MotionDiv = ({ children, ...rest }) => <div {...rest}>{children}</div>
const MotionSpan = ({ children, ...rest }) => <span {...rest}>{children}</span>
const MotionP = ({ children, ...rest }) => <p {...rest}>{children}</p>

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      if (tag === 'span') return MotionSpan
      if (tag === 'p')    return MotionP
      return MotionDiv
    },
  }),
  AnimatePresence: ({ children }) => children,
}))

// ── Mock EvidenceCard (may not exist yet — built by another agent) ─────────
vi.mock('../../EvidenceCard', () => ({
  default: ({ item }) => (
    <div data-testid={`evidence-${item.id}`}>{item.title}</div>
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const STAGE = {
  id:   'stage-2',
  type: 'phase_reveal',
  payload: {
    newPhaseLabel: 'February 2022 — Invasion',
    newItems: [
      {
        id:          'ev-1',
        title:       'Russian BTG Movements',
        type:        'report',
        description: 'Multiple battalion tactical groups observed crossing the border.',
        imageUrl:    null,
        imageCredit: null,
        sourceUrl:   null,
      },
      {
        id:          'ev-2',
        title:       'Kyiv Missile Strikes',
        type:        'image',
        description: 'Strikes on civilian infrastructure near Kyiv.',
        imageUrl:    null,
        imageCredit: null,
        sourceUrl:   null,
      },
    ],
    connectionResolutions: [
      {
        pairItemIds: ['ev-alpha', 'ev-beta'],
        verdict:     'confirmed',
        explanation: 'Force disposition matched the assessed invasion route.',
      },
      {
        pairItemIds: ['ev-gamma', 'ev-delta'],
        verdict:     'refuted',
        explanation: 'Diplomatic back-channel talks did not materialise into a ceasefire.',
      },
    ],
  },
}

const PRIOR_RESULTS_WITH_CONNECTIONS = [
  {
    stageType:   'evidence_wall',
    connections: [
      { idA: 'ev-alpha', idB: 'ev-beta', note: 'Both point to Kyiv axis' },
    ],
  },
]

const SESSION_CONTEXT_EMPTY = {
  caseSlug:    'russia-ukraine',
  chapterSlug: 'ch-1',
  sessionId:   'sess-abc',
  priorResults: [],
}

const SESSION_CONTEXT_WITH_PRIOR = {
  ...SESSION_CONTEXT_EMPTY,
  priorResults: PRIOR_RESULTS_WITH_CONNECTIONS,
}

// ── Helpers ───────────────────────────────────────────────────────────────

function renderStage(sessionContext = SESSION_CONTEXT_EMPTY, stageOverride = STAGE) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <PhaseRevealStage
      stage={stageOverride}
      sessionContext={sessionContext}
      onSubmit={onSubmit}
    />
  )
  return { onSubmit }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PhaseRevealStage — rendering', () => {
  it('renders the new phase label', () => {
    renderStage()
    expect(screen.getByTestId('phase-label')).toBeDefined()
    expect(screen.getByText('February 2022 — Invasion')).toBeDefined()
  })

  it('renders all connection resolution rows', () => {
    renderStage()
    // Both resolutions appear
    const confirmed = screen.getAllByTestId('resolution-row-confirmed')
    const refuted   = screen.getAllByTestId('resolution-row-refuted')
    expect(confirmed.length).toBe(1)
    expect(refuted.length).toBe(1)
  })

  it('renders confirmed verdict badge', () => {
    renderStage()
    expect(screen.getByTestId('verdict-badge-confirmed')).toBeDefined()
  })

  it('renders refuted verdict badge', () => {
    renderStage()
    expect(screen.getByTestId('verdict-badge-refuted')).toBeDefined()
  })

  it('renders resolution explanation text', () => {
    renderStage()
    expect(screen.getByText('Force disposition matched the assessed invasion route.')).toBeDefined()
    expect(screen.getByText('Diplomatic back-channel talks did not materialise into a ceasefire.')).toBeDefined()
  })

  it('renders all new evidence items via EvidenceCard', () => {
    renderStage()
    expect(screen.getByTestId('evidence-ev-1')).toBeDefined()
    expect(screen.getByTestId('evidence-ev-2')).toBeDefined()
    expect(screen.getByText('Russian BTG Movements')).toBeDefined()
    expect(screen.getByText('Kyiv Missile Strikes')).toBeDefined()
  })

  it('renders NEW stickers on each new evidence item', () => {
    renderStage()
    expect(screen.getByTestId('new-sticker-ev-1')).toBeDefined()
    expect(screen.getByTestId('new-sticker-ev-2')).toBeDefined()
  })

  it('renders the Continue button', () => {
    renderStage()
    expect(screen.getByTestId('continue-btn')).toBeDefined()
  })
})

describe('PhaseRevealStage — Continue button', () => {
  it('is enabled even when priorResults is empty', () => {
    renderStage()
    const btn = screen.getByTestId('continue-btn')
    expect(btn.disabled).toBe(false)
  })

  it('calls onSubmit with empty updatedConnections when no priorResults', async () => {
    const { onSubmit } = renderStage(SESSION_CONTEXT_EMPTY)
    fireEvent.click(screen.getByTestId('continue-btn'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({ updatedConnections: [] })
  })

  it('forwards prior evidence_wall connections when priorResults provided', async () => {
    const { onSubmit } = renderStage(SESSION_CONTEXT_WITH_PRIOR)
    fireEvent.click(screen.getByTestId('continue-btn'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      updatedConnections: PRIOR_RESULTS_WITH_CONNECTIONS[0].connections,
    })
  })
})

describe('PhaseRevealStage — empty payload', () => {
  it('renders empty state when no resolutions or new items', () => {
    const emptyStage = {
      ...STAGE,
      payload: {
        newPhaseLabel:         'March 2022',
        newItems:              [],
        connectionResolutions: [],
      },
    }
    renderStage(SESSION_CONTEXT_EMPTY, emptyStage)
    expect(screen.getByText('No new intelligence at this time.')).toBeDefined()
  })

  it('Continue button still enabled in empty state', () => {
    const emptyStage = {
      ...STAGE,
      payload: {
        newPhaseLabel:         'March 2022',
        newItems:              [],
        connectionResolutions: [],
      },
    }
    renderStage(SESSION_CONTEXT_EMPTY, emptyStage)
    expect(screen.getByTestId('continue-btn').disabled).toBe(false)
  })
})
