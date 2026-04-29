import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import DebriefStage from '../DebriefStage'

// ── framer-motion mock (stable per-tag reference Proxy pattern) ───────────────
vi.mock('framer-motion', () => {
  const React = require('react')
  const cache = {}
  const make = (tag) =>
    (cache[tag] ||= React.forwardRef(({ children, ...rest }, ref) =>
      React.createElement(tag, { ref, ...rest }, children)
    ))
  return {
    motion: new Proxy({}, { get: (_, tag) => make(tag) }),
    AnimatePresence: ({ children }) => children,
    useMotionValue: () => ({ get: () => 0, set: () => {} }),
    useTransform:   () => ({ get: () => 0 }),
  }
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STAGE = {
  id:   'stage-debrief',
  type: 'debrief',
  payload: {
    annotatedReplayBeats: [
      {
        refStageIndex: 0,
        headline:      'Evidence wall performance',
        body:          'You connected 5 of 7 key evidence pairs correctly.',
        takeaway:      'Always cross-reference satellite imagery with OSINT.',
      },
      {
        refStageIndex: 1,
        headline:      'Decision point analysis',
        body:          'Your assessment of the main axis was accurate.',
        takeaway:      'Force disposition near Kyiv was the decisive clue.',
      },
    ],
    teaserNextChapter: {
      title: 'The Counteroffensive',
      blurb: 'UAF prepares a surprise thrust. Can you anticipate it?',
    },
  },
}

const STAGE_NO_TEASER = {
  ...STAGE,
  payload: {
    ...STAGE.payload,
    teaserNextChapter: null,
  },
}

const SCORING = {
  totalScore: 480,
  breakdown: [
    { stageIndex: 0, stageType: 'evidence_wall',  score: 200, maxScore: 250, notes: '' },
    { stageIndex: 1, stageType: 'decision_point', score: 150, maxScore: 200, notes: '' },
    { stageIndex: 2, stageType: 'map_predictive', score: 130, maxScore: 150, notes: '' },
  ],
}

const SESSION_CONTEXT = {
  caseSlug:    'russia-ukraine',
  chapterSlug: 'chapter-one',
  sessionId:   'sess-abc',
  priorResults: [],
}

function renderStage(stageProp = STAGE, scoringProp = SCORING, overrides = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <DebriefStage
      stage={stageProp}
      sessionContext={SESSION_CONTEXT}
      onSubmit={onSubmit}
      scoring={scoringProp}
      {...overrides}
    />
  )
  return { onSubmit }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DebriefStage — heading', () => {
  it('renders the DEBRIEF heading', () => {
    renderStage()
    expect(screen.getByText('DEBRIEF')).toBeDefined()
  })

  it('renders the chapter slug from sessionContext', () => {
    renderStage()
    expect(screen.getByText('chapter-one')).toBeDefined()
  })
})

describe('DebriefStage — scoring null state', () => {
  it('renders skeleton and "Computing your score…" when scoring is null', () => {
    renderStage(STAGE, null)
    expect(screen.getByTestId('scoring-skeleton')).toBeDefined()
    expect(screen.getByText(/Computing your score/)).toBeDefined()
  })

  it('does not render breakdown table when scoring is null', () => {
    renderStage(STAGE, null)
    expect(screen.queryByTestId('breakdown-table')).toBeNull()
  })
})

describe('DebriefStage — score banner', () => {
  it('renders the total score via count-up display (eventually reaches target)', async () => {
    renderStage()
    // CountUpScore animates via rAF; jsdom stubs rAF but the display element exists
    await waitFor(() =>
      expect(screen.getByTestId('total-score-display')).toBeDefined()
    )
  })

  it('does not render airstar reward UI (Case Files do not award airstars)', () => {
    renderStage()
    expect(screen.queryByTestId('airstars-awarded')).toBeNull()
  })

  it('does not render XP reward UI (Case Files do not award level XP)', () => {
    renderStage()
    expect(screen.queryByTestId('xp-awarded')).toBeNull()
  })

  it('does not render airstar UI even if scoring object contains a stale airstarsAwarded field', () => {
    // Defensive: legacy completed sessions written before reward removal may
    // still carry airstarsAwarded in their persisted scoring blob. The UI
    // must ignore it.
    renderStage(STAGE, { ...SCORING, airstarsAwarded: 42, levelXpAwarded: 42 })
    expect(screen.queryByTestId('airstars-awarded')).toBeNull()
    expect(screen.queryByTestId('xp-awarded')).toBeNull()
  })
})

describe('DebriefStage — breakdown table', () => {
  it('renders a breakdown row for each stage in scoring.breakdown', () => {
    renderStage()
    expect(screen.getByTestId('breakdown-row-0')).toBeDefined()
    expect(screen.getByTestId('breakdown-row-1')).toBeDefined()
    expect(screen.getByTestId('breakdown-row-2')).toBeDefined()
  })

  it('renders human-readable stage type labels', () => {
    renderStage()
    expect(screen.getByText('Evidence Wall')).toBeDefined()
    expect(screen.getByText('Decision Point')).toBeDefined()
    expect(screen.getByText('Map Prediction')).toBeDefined()
  })

  it('does not render breakdown table when scoring has empty breakdown', () => {
    const emptyBreakdownScoring = { ...SCORING, breakdown: [] }
    renderStage(STAGE, emptyBreakdownScoring)
    expect(screen.queryByTestId('breakdown-table')).toBeNull()
  })
})

describe('DebriefStage — annotated replay', () => {
  it('renders all annotated replay beats', () => {
    renderStage()
    expect(screen.getByTestId('replay-beat-0')).toBeDefined()
    expect(screen.getByTestId('replay-beat-1')).toBeDefined()
  })

  it('renders headline text for each beat', () => {
    renderStage()
    expect(screen.getByText('Evidence wall performance')).toBeDefined()
    expect(screen.getByText('Decision point analysis')).toBeDefined()
  })

  it('renders takeaway quote-boxes', () => {
    renderStage()
    expect(screen.getByTestId('beat-takeaway-0').textContent).toMatch(
      'Always cross-reference satellite imagery with OSINT.'
    )
    expect(screen.getByTestId('beat-takeaway-1').textContent).toMatch(
      'Force disposition near Kyiv was the decisive clue.'
    )
  })
})

describe('DebriefStage — teaser', () => {
  it('renders teaserNextChapter when present', () => {
    renderStage()
    expect(screen.getByTestId('teaser-next-chapter')).toBeDefined()
    expect(screen.getByText('Next: The Counteroffensive')).toBeDefined()
    expect(screen.getByText('UAF prepares a surprise thrust. Can you anticipate it?')).toBeDefined()
  })

  it('does not render teaser when teaserNextChapter is null', () => {
    renderStage(STAGE_NO_TEASER)
    expect(screen.queryByTestId('teaser-next-chapter')).toBeNull()
  })
})

describe('DebriefStage — close case', () => {
  it('clicking "Close Case" calls onSubmit with { viewed: true }', async () => {
    const { onSubmit } = renderStage()
    fireEvent.click(screen.getByTestId('close-case-btn'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({ viewed: true })
  })

  it('button text is "Close Case" initially', () => {
    renderStage()
    expect(screen.getByTestId('close-case-btn').textContent).toBe('Close Case')
  })

  it('Close Case button is disabled while submitting', async () => {
    let resolve
    const onSubmit = vi.fn().mockReturnValue(new Promise(r => { resolve = r }))
    render(
      <DebriefStage
        stage={STAGE}
        sessionContext={SESSION_CONTEXT}
        onSubmit={onSubmit}
        scoring={SCORING}
      />
    )
    fireEvent.click(screen.getByTestId('close-case-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('close-case-btn').disabled).toBe(true)
    )
    await act(async () => { resolve() })
  })
})
