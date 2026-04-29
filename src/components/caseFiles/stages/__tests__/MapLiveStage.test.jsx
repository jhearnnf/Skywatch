import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import MapLiveStage from '../MapLiveStage'

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

// ── MapCanvas mock ────────────────────────────────────────────────────────────
vi.mock('../../MapCanvas', () => ({
  default: ({ hotspots, units }) => (
    <div
      data-testid="map-canvas"
      data-hotspots={hotspots?.length ?? 0}
      data-units={units?.length ?? 0}
    />
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOTSPOTS = [
  { id: 'hs-1', label: 'Belgorod', lat: 50.6, lng: 36.6, kind: 'staging' },
  { id: 'hs-2', label: 'Kyiv',     lat: 50.4, lng: 30.5, kind: 'capital' },
  { id: 'hs-3', label: 'Kharkiv',  lat: 49.9, lng: 36.2, kind: 'logistics' },
]

const UNIT_1 = {
  id: 'u-1', side: 'ru', kind: 'armour',
  fromHotspotId: 'hs-1', toHotspotId: 'hs-2', animationMs: 2000,
}

const UNIT_2 = {
  id: 'u-2', side: 'ua', kind: 'infantry',
  fromHotspotId: 'hs-2', toHotspotId: 'hs-3', animationMs: 1500,
}

const SUB_DECISION_SINGLE = {
  id: 'sd-1',
  prompt: 'What is the primary axis?',
  options: [
    { id: 'opt-a', text: 'Northern axis via Kyiv' },
    { id: 'opt-b', text: 'Eastern axis via Kharkiv' },
  ],
  selectionMode: 'single',
}

const SUB_DECISION_MULTI = {
  id: 'sd-2',
  prompt: 'Select all threatened cities',
  options: [
    { id: 'opt-x', text: 'Kyiv' },
    { id: 'opt-y', text: 'Kharkiv' },
    { id: 'opt-z', text: 'Mariupol' },
  ],
  selectionMode: 'multi',
}

function makeStage(phases) {
  return {
    id:   'stage-maplive',
    type: 'map_live',
    payload: {
      mapBounds: { south: 44, west: 22, north: 53, east: 40 },
      hotspots:  HOTSPOTS,
      phases,
    },
  }
}

const SESSION_CONTEXT = {
  caseSlug:    'russia-ukraine',
  chapterSlug: 'chapter-1',
  sessionId:   'sess-abc',
  priorResults: [],
}

function renderStage(phases, overrides = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <MapLiveStage
      stage={makeStage(phases)}
      sessionContext={SESSION_CONTEXT}
      onSubmit={onSubmit}
      {...overrides}
    />
  )
  return { onSubmit }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MapLiveStage — rendering', () => {
  it('renders the phase 1 timeLabel in the phase chip', () => {
    renderStage([
      { id: 'p1', timeLabel: 'Feb 24, 04:00', units: [], subDecision: null },
      { id: 'p2', timeLabel: 'Feb 24, 08:00', units: [], subDecision: null },
    ])
    expect(screen.getByTestId('phase-chip').textContent).toMatch('Feb 24, 04:00')
  })

  it('renders the map canvas', () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: null },
    ])
    expect(screen.getByTestId('map-canvas')).toBeDefined()
  })

  it('renders the Advance button on the first phase when not yet complete', () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: null },
      { id: 'p2', timeLabel: 'T+1', units: [], subDecision: null },
    ])
    expect(screen.getByTestId('advance-phase-btn')).toBeDefined()
  })
})

describe('MapLiveStage — phase progression', () => {
  it('clicking Advance moves to phase 2 (timeLabel updates)', () => {
    renderStage([
      { id: 'p1', timeLabel: 'Feb 24, 04:00', units: [], subDecision: null },
      { id: 'p2', timeLabel: 'Feb 24, 08:00', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    expect(screen.getByTestId('phase-chip').textContent).toMatch('Feb 24, 08:00')
  })

  it('shows Submit Analysis after advancing past all phases (no sub-decisions)', async () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('submit-analysis')).toBeDefined()
    )
  })
})

describe('MapLiveStage — sub-decision', () => {
  it('shows sub-decision card when a phase has one (after advance)', () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: SUB_DECISION_SINGLE },
      { id: 'p2', timeLabel: 'T+1', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    expect(screen.getByTestId('sub-decision-card')).toBeDefined()
    expect(screen.getByTestId('sub-decision-prompt').textContent).toBe(
      'What is the primary axis?'
    )
  })

  it('single-mode: clicking an option auto-commits and removes the card', async () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: SUB_DECISION_SINGLE },
      { id: 'p2', timeLabel: 'T+1', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    // Card should be visible
    expect(screen.getByTestId('sub-decision-card')).toBeDefined()
    // Click single option
    fireEvent.click(screen.getByTestId('sub-option-opt-a'))
    // Card should disappear after commit
    await waitFor(() =>
      expect(screen.queryByTestId('sub-decision-card')).toBeNull()
    )
  })

  it('multi-mode: options do NOT auto-commit; Confirm Selection button is required', async () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: SUB_DECISION_MULTI },
      { id: 'p2', timeLabel: 'T+1', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    // Confirm button should exist (multi-mode)
    expect(screen.getByTestId('sub-decision-submit')).toBeDefined()
    // Click one option — card should still be visible (no auto-commit)
    fireEvent.click(screen.getByTestId('sub-option-opt-x'))
    expect(screen.getByTestId('sub-decision-card')).toBeDefined()
    // Click Confirm
    fireEvent.click(screen.getByTestId('sub-decision-submit'))
    await waitFor(() =>
      expect(screen.queryByTestId('sub-decision-card')).toBeNull()
    )
  })

  it('multi-mode: Confirm Selection is disabled until at least one option is selected', () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: SUB_DECISION_MULTI },
      { id: 'p2', timeLabel: 'T+1', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    const confirmBtn = screen.getByTestId('sub-decision-submit')
    expect(confirmBtn.disabled).toBe(true)
  })
})

describe('MapLiveStage — final submit', () => {
  it('calls onSubmit with all sub-decisions collected after last phase', async () => {
    const phases = [
      { id: 'p1', timeLabel: 'T+0', units: [UNIT_1], subDecision: SUB_DECISION_SINGLE },
      { id: 'p2', timeLabel: 'T+1', units: [UNIT_2], subDecision: null },
    ]
    const { onSubmit } = renderStage(phases)

    // Advance phase 1 → sub-decision appears
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    // Answer sub-decision (single mode, auto-commits)
    fireEvent.click(screen.getByTestId('sub-option-opt-a'))
    await waitFor(() =>
      expect(screen.queryByTestId('sub-decision-card')).toBeNull()
    )

    // Now on phase 2 — advance to complete it
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    // Submit Analysis should now appear
    await waitFor(() =>
      expect(screen.getByTestId('submit-analysis')).toBeDefined()
    )

    fireEvent.click(screen.getByTestId('submit-analysis'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    const [result] = onSubmit.mock.calls[0]
    expect(result).toHaveProperty('subDecisions')
    expect(result.subDecisions).toHaveLength(1)
    expect(result.subDecisions[0]).toMatchObject({
      subDecisionId:     'sd-1',
      selectedOptionIds: ['opt-a'],
    })
  })

  it('onSubmit called with empty subDecisions when no sub-decisions exist', async () => {
    const { onSubmit } = renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [], subDecision: null },
    ])
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('submit-analysis')).toBeDefined()
    )
    fireEvent.click(screen.getByTestId('submit-analysis'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toEqual({ subDecisions: [] })
  })
})

describe('MapLiveStage — unit accumulation', () => {
  it('passes cumulative units from all completed phases to MapCanvas', () => {
    renderStage([
      { id: 'p1', timeLabel: 'T+0', units: [UNIT_1], subDecision: null },
      { id: 'p2', timeLabel: 'T+1', units: [UNIT_2], subDecision: null },
    ])
    // Phase 1 is active: only UNIT_1 should be on map
    expect(screen.getByTestId('map-canvas').dataset.units).toBe('1')

    // Advance to phase 2
    fireEvent.click(screen.getByTestId('advance-phase-btn'))
    // Now both units should be visible
    expect(screen.getByTestId('map-canvas').dataset.units).toBe('2')
  })
})
