import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import StageRouter from '../StageRouter'

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

// ── Mock AppTutorialContext (StageTutorialTrigger consumes it) ────────────────
vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn() }),
}))

// ── Mock all 8 stage components ───────────────────────────────────────────────
vi.mock('../stages/ColdOpenStage',            () => ({ default: ({ stage }) => <div data-testid="cold-open-stage">{stage.type}</div> }))
vi.mock('../stages/EvidenceWallStage',        () => ({ default: ({ stage }) => <div data-testid="evidence-wall-stage">{stage.type}</div> }))
vi.mock('../stages/MapPredictiveStage',       () => ({ default: ({ stage }) => <div data-testid="map-predictive-stage">{stage.type}</div> }))
vi.mock('../stages/ActorInterrogationsStage', () => ({
  default: ({ stage, sendQuestion }) => (
    <div data-testid="actor-interrogations-stage">
      {stage.type}
      {sendQuestion && <span data-testid="send-question-present" />}
    </div>
  ),
}))
vi.mock('../stages/DecisionPointStage',       () => ({ default: ({ stage }) => <div data-testid="decision-point-stage">{stage.type}</div> }))
vi.mock('../stages/PhaseRevealStage',         () => ({ default: ({ stage }) => <div data-testid="phase-reveal-stage">{stage.type}</div> }))
vi.mock('../stages/MapLiveStage',             () => ({ default: ({ stage }) => <div data-testid="map-live-stage">{stage.type}</div> }))
vi.mock('../stages/DebriefStage',             () => ({
  default: ({ stage, scoring }) => (
    <div data-testid="debrief-stage">
      {stage.type}
      {scoring !== undefined && <span data-testid="scoring-present">{JSON.stringify(scoring)}</span>}
    </div>
  ),
}))

// ── Shared fixtures ───────────────────────────────────────────────────────────
const SESSION_CONTEXT = { caseSlug: 'tc', chapterSlug: 'ch1', sessionId: 's1', priorResults: [] }
const noop = () => {}

function makeStage(type) {
  return { id: `stage-${type}`, type, payload: {} }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('StageRouter', () => {
  it('renders ColdOpenStage for cold_open', () => {
    render(<StageRouter stage={makeStage('cold_open')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByTestId('cold-open-stage')).toBeDefined()
  })

  it('renders EvidenceWallStage for evidence_wall', () => {
    render(<StageRouter stage={makeStage('evidence_wall')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByTestId('evidence-wall-stage')).toBeDefined()
  })

  it('renders MapPredictiveStage for map_predictive', () => {
    render(<StageRouter stage={makeStage('map_predictive')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByTestId('map-predictive-stage')).toBeDefined()
  })

  it('renders ActorInterrogationsStage for actor_interrogations', () => {
    const sendQuestion = vi.fn()
    render(
      <StageRouter
        stage={makeStage('actor_interrogations')}
        sessionContext={SESSION_CONTEXT}
        onSubmit={noop}
        sendQuestion={sendQuestion}
      />,
    )
    expect(screen.getByTestId('actor-interrogations-stage')).toBeDefined()
  })

  it('forwards sendQuestion only to actor_interrogations', () => {
    const sendQuestion = vi.fn()
    render(
      <StageRouter
        stage={makeStage('actor_interrogations')}
        sessionContext={SESSION_CONTEXT}
        onSubmit={noop}
        sendQuestion={sendQuestion}
      />,
    )
    expect(screen.getByTestId('send-question-present')).toBeDefined()
  })

  it('does NOT forward sendQuestion to other stage types', () => {
    const sendQuestion = vi.fn()
    render(
      <StageRouter
        stage={makeStage('cold_open')}
        sessionContext={SESSION_CONTEXT}
        onSubmit={noop}
        sendQuestion={sendQuestion}
      />,
    )
    // ColdOpenStage mock doesn't render send-question-present
    expect(screen.queryByTestId('send-question-present')).toBeNull()
  })

  it('renders DecisionPointStage for decision_point', () => {
    render(<StageRouter stage={makeStage('decision_point')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByTestId('decision-point-stage')).toBeDefined()
  })

  it('renders PhaseRevealStage for phase_reveal', () => {
    render(<StageRouter stage={makeStage('phase_reveal')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByTestId('phase-reveal-stage')).toBeDefined()
  })

  it('renders MapLiveStage for map_live', () => {
    render(<StageRouter stage={makeStage('map_live')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByTestId('map-live-stage')).toBeDefined()
  })

  it('renders DebriefStage for debrief', () => {
    render(<StageRouter stage={makeStage('debrief')} sessionContext={SESSION_CONTEXT} onSubmit={noop} scoring={null} />)
    expect(screen.getByTestId('debrief-stage')).toBeDefined()
  })

  it('forwards scoring prop to DebriefStage', () => {
    const scoring = { totalScore: 42, breakdown: [] }
    render(<StageRouter stage={makeStage('debrief')} sessionContext={SESSION_CONTEXT} onSubmit={noop} scoring={scoring} />)
    expect(screen.getByTestId('scoring-present')).toBeDefined()
    expect(screen.getByTestId('scoring-present').textContent).toContain('42')
  })

  it('renders fallback for unknown stage type', () => {
    render(<StageRouter stage={makeStage('totally_unknown')} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByText(/Unknown stage type/i)).toBeDefined()
    expect(screen.getByText(/totally_unknown/)).toBeDefined()
  })

  it('renders fallback gracefully when stage is undefined', () => {
    render(<StageRouter stage={undefined} sessionContext={SESSION_CONTEXT} onSubmit={noop} />)
    expect(screen.getByText(/Unknown stage type/i)).toBeDefined()
  })
})
