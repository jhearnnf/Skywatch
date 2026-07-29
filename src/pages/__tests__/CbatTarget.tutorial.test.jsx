import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatTarget from '../CbatTarget'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth        = vi.hoisted(() => vi.fn())
const mockHas3DModel     = vi.hoisted(() => vi.fn(() => true))
const mockGetModelUrl    = vi.hoisted(() => vi.fn(() => null))
const mockUseAppSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseAppSettings }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/AircraftTopDown', () => ({ default: () => <div data-testid="aircraft" /> }))
vi.mock('../../data/aircraftModels', () => ({
  getModelUrl: mockGetModelUrl,
  has3DModel:  mockHas3DModel,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    p:      ({ children, className, style }) => <p className={className} style={style}>{children}</p>,
    button: ({ children, className, onClick, disabled }) => (
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

const BRIEF_ID = 'b1'
const MOCK_AIRCRAFT = [
  { briefId: BRIEF_ID, title: 'F-35', cutoutUrl: 'http://example.com/f35.png' },
]

function mockApiFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/aircraft-cutouts'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_AIRCRAFT }) })
    if (url.includes('/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupUser() {
  mockUseAuth.mockReturnValue({
    user:     { _id: 'u1', email: 'a@b.com' },
    API:      '',
    apiFetch: mockApiFetch(),
  })
  mockUseAppSettings.mockReturnValue({
    settings: { cbatTargetAircraftBriefIds: [BRIEF_ID] },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatTarget — tutorial / practice mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in section 1 with only Scene/Key/Scene Targets active', () => {
    setupUser()
    render(<CbatTarget />)

    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

    expect(screen.getByText(/practice mode/i)).toBeTruthy()
    expect(screen.getByText(/spot the targets/i)).toBeTruthy()

    // Section 2+ panels are locked during section 1 (label is "🔒 <name>")
    expect(screen.getByText(/Light$/)).toBeTruthy()
    expect(screen.getByText(/Scan$/)).toBeTruthy()
    expect(screen.getByText(/System$/)).toBeTruthy()

    // Scene Targets panel is active and shows the always-present "unknown" target
    expect(screen.getAllByText(/^unknown$/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows a red alert circle in section 1 that must be cleared to advance', () => {
    setupUser()
    render(<CbatTarget />)
    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

    // Section 1 teaches the alert mechanic: a single clickable alert is present.
    const alert = screen.getByRole('button', { name: /^alert$/i })
    expect(alert).toBeTruthy()

    // Clearing only the alert (diamonds remain) does not advance the section.
    fireEvent.click(alert)
    expect(screen.getByText(/spot the targets/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^alert$/i })).toBeNull()
  })

  it('lets the user jump between sections with the arrows', () => {
    setupUser()
    render(<CbatTarget />)
    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

    expect(screen.getByText(/spot the targets/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /previous section/i }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/read a full target/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/match the lights/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/identify the aircraft/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/catch the code/i)).toBeTruthy()
    // Last section — next is disabled
    expect(screen.getByRole('button', { name: /next section/i }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))
    expect(screen.getByText(/identify the aircraft/i)).toBeTruthy()
  })

  it('points an arrow at the red alert once every unknown is cleared', async () => {
    setupUser()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON() {},
    })
    try {
      render(<CbatTarget />)
      fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

      // No alert arrow while diamonds remain to be clicked.
      expect(document.querySelectorAll('.cbat-tutorial-arrow').length).toBe(0)

      // Clear all five stacked diamonds but leave the alert uncleared.
      const scene = document.querySelector('.cbat-target-scene')
      for (let i = 0; i < 5; i++) fireEvent.click(scene, { clientX: 80, clientY: 80 })

      // The alert is still there, so exactly one arrow now points at it.
      expect(screen.getByRole('button', { name: /^alert$/i })).toBeTruthy()
      expect(document.querySelectorAll('.cbat-tutorial-arrow').length).toBe(1)
    } finally {
      randomSpy.mockRestore()
      rectSpy.mockRestore()
    }
  })

  it('dims earlier-section panels once a later section is reached', () => {
    setupUser()
    render(<CbatTarget />)
    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

    // Section 1 — its own panels are not dimmed.
    expect(document.querySelector('.grid-scene').className).not.toContain('cbat-tutorial-dim')

    // Section 3 (Light) — the Light panels stay lit; the Scene/Key panels from
    // sections 1-2 are dimmed as they aren't part of this step's task.
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(document.querySelector('.grid-light').className).not.toContain('cbat-tutorial-dim')
    expect(document.querySelector('.grid-scene').className).toContain('cbat-tutorial-dim')
    expect(document.querySelector('.grid-info').className).toContain('cbat-tutorial-dim')
    expect(document.querySelector('.grid-scene-target').className).toContain('cbat-tutorial-dim')
  })

  it('Exit practice returns to the intro', async () => {
    setupUser()
    render(<CbatTarget />)

    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))
    fireEvent.click(screen.getByRole('button', { name: /exit practice/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeNull()
    })
  })

  it('advances Scene → demo → Light → Scan → System and completes on a system code click', async () => {
    setupUser()
    // Deterministic geometry + RNG: every shape lands at (80,80); the light
    // pattern/target are identical; and the scan panel always shows the target
    // aircraft — so each section's action is a guaranteed match.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON() {},
    })

    try {
      render(<CbatTarget />)
      // Wait for aircraft to load so the Scan section has a target.
      await waitFor(() => expect(mockGetModelUrl).toHaveBeenCalled())

      fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

      // Section 1 — clear the red alert circle, then all five unknown diamonds
      // (stacked at 80,80). Both must be cleared before the section advances.
      fireEvent.click(screen.getByRole('button', { name: /^alert$/i }))
      const scene = document.querySelector('.cbat-target-scene')
      for (let i = 0; i < 5; i++) fireEvent.click(scene, { clientX: 80, clientY: 80 })

      // Section 2 — the symbol demo, which is timed rather than interactive; it
      // has its own tests below, so skip straight past it here.
      expect(screen.getByText(/read a full target/i)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /next section/i }))

      // Section 3 — LOCK matches the target pattern and flashes; press it.
      const lock = screen.getByRole('button', { name: /^lock$/i })
      expect(lock.className).toContain('cbat-btn-flash')
      fireEvent.click(lock)

      // Section 4 — the scan panel resolves to the target aircraft; the ID
      // button flashes once matched. Press it to advance to the System section.
      const id = await screen.findByRole('button', { name: /^id$/i })
      await waitFor(() => expect(id.className).toContain('cbat-btn-flash'))
      fireEvent.click(id)

      // Section 5 — the target code is injected after a measure pass; once the
      // System Target panel shows it, clicking a matching feed row finishes.
      expect(screen.getByText(/catch the code/i)).toBeTruthy()
      const sysTargetPanel = document.querySelector('.grid-system-target')
      await waitFor(() => expect(within(sysTargetPanel).queryByText('AAAA')).not.toBeNull())
      const sysPanel = document.querySelector('.grid-system')
      fireEvent.click(within(sysPanel).getAllByRole('button')[0])

      expect(screen.getByText(/tutorial complete/i)).toBeTruthy()
    } finally {
      randomSpy.mockRestore()
      rectSpy.mockRestore()
    }
  })
})

// ── Section 2: symbol anatomy demo ────────────────────────────────────────

describe('CbatTarget — tutorial section 2 (symbol anatomy demo)', () => {
  const PHASE_MS = 3000
  const HOLD_MS  = 2200

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => vi.useRealTimers())

  // Jump straight to the demo section rather than playing section 1 out.
  function openDemo() {
    setupUser()
    render(<CbatTarget />)
    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
  }

  const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
  // Each phase's timeout is scheduled by the effect that runs after the previous
  // one's state update, so only one mark can land per act() flush — advance them
  // one at a time rather than in a single big jump.
  const tickMarks = (n) => { for (let i = 0; i < n; i++) tick(PHASE_MS) }
  const tickToEnd = () => { tickMarks(4); tick(HOLD_MS) }

  // The demo symbol's own svg — scoped past the Compass, which also lives in the
  // scene and carries polygons of its own.
  function symbol() {
    const svg = document.querySelector('.cbat-tut-symbol .cbat-shape-wrap svg')
    return {
      stroke:   svg.querySelector('rect').getAttribute('stroke'),
      lines:    svg.querySelectorAll('line').length,
      polygons: svg.querySelectorAll('polygon').length,
    }
  }

  const keyEntry  = (label) => within(document.querySelector('.grid-info')).getByText(label).parentElement
  const labelWord = (word)  => within(document.querySelector('.grid-scene-target')).getByText(word)

  it('renders the example as a bare white tank outline on the first mark', () => {
    openDemo()

    expect(screen.getByText(/read a full target/i)).toBeTruthy()
    // A square outline with no side colour yet, and none of the other marks.
    expect(symbol()).toEqual({ stroke: '#ffffff', lines: 0, polygons: 0 })
    // The scene is only the demo — no practice diamonds, no alert circle.
    expect(document.querySelectorAll('.cbat-tut-symbol .cbat-shape-wrap').length).toBe(1)
    expect(screen.queryByRole('button', { name: /^alert$/i })).toBeNull()
  })

  it('adds one mark per phase: colour, then damaged X, then arms, then arrow', () => {
    openDemo()

    // Colour — the outline takes the hostile red.
    tick(PHASE_MS)
    expect(symbol()).toEqual({ stroke: '#ef4444', lines: 0, polygons: 0 })

    // Damaged — the inscribed X adds two lines.
    tick(PHASE_MS)
    expect(symbol()).toEqual({ stroke: '#ef4444', lines: 2, polygons: 0 })

    // High-priority — four crosshair arms on top of the X.
    tick(PHASE_MS)
    expect(symbol()).toEqual({ stroke: '#ef4444', lines: 6, polygons: 0 })

    // Facing — the direction arrow, and the compass lights up to explain it.
    tick(PHASE_MS)
    expect(symbol()).toEqual({ stroke: '#ef4444', lines: 6, polygons: 1 })
    expect(document.querySelector('.cbat-compass-pulse')).not.toBeNull()
  })

  it('lights the matching Key entry and label word for each mark in turn', () => {
    openDemo()

    expect(keyEntry('tank').className).toContain('cbat-triple-pulse')
    expect(labelWord('tanks').className).toContain('cbat-word-lit')
    expect(keyEntry('damaged').className).toContain('opacity-20')

    tick(PHASE_MS)
    expect(keyEntry('hostile').className).toContain('cbat-triple-pulse')
    expect(labelWord('hostile').className).toContain('cbat-word-lit')
    expect(labelWord('tanks').className).toContain('opacity-30')

    tick(PHASE_MS)
    expect(keyEntry('damaged').className).toContain('cbat-triple-pulse')
    expect(labelWord('damaged').className).toContain('cbat-word-lit')

    tick(PHASE_MS)
    expect(keyEntry('hi-pri').className).toContain('cbat-triple-pulse')
    expect(labelWord('high-priority').className).toContain('cbat-word-lit')

    // The facing mark is explained by the compass, not the Key — so nothing in
    // the Key is spotlighted, and it returns to full legibility.
    tick(PHASE_MS)
    expect(labelWord('facing north').className).toContain('cbat-word-lit')
    expect(document.querySelector('.grid-info .cbat-triple-pulse')).toBeNull()
    expect(keyEntry('hi-pri').className).not.toContain('opacity-20')
  })

  it('offers the hunt only once the explanation has played out', () => {
    openDemo()

    // Nothing to press while the sequence is still running — the step must not
    // pull itself away mid-sentence, so it also must not auto-advance.
    expect(screen.queryByRole('button', { name: /find them/i })).toBeNull()
    tickMarks(4)
    expect(screen.queryByRole('button', { name: /find them/i })).toBeNull()
    expect(screen.getByText(/read a full target/i)).toBeTruthy()

    // After the hold on the finished symbol, the recap appears with nothing lit.
    tick(HOLD_MS)
    expect(screen.getByText(/whole description/i)).toBeTruthy()
    expect(document.querySelector('.cbat-word-lit')).toBeNull()
    expect(screen.getByRole('button', { name: /find them/i })).toBeTruthy()
  })

  it('Replay restarts the sequence from the first mark', () => {
    openDemo()
    tickToEnd()

    fireEvent.click(screen.getByRole('button', { name: /^replay$/i }))
    expect(symbol()).toEqual({ stroke: '#ffffff', lines: 0, polygons: 0 })
    expect(labelWord('tanks').className).toContain('cbat-word-lit')
    expect(screen.queryByRole('button', { name: /find them/i })).toBeNull()
  })

  it('re-entering the section replays it from the start', () => {
    openDemo()
    tickMarks(2)
    expect(symbol().lines).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(symbol()).toEqual({ stroke: '#ffffff', lines: 0, polygons: 0 })
  })

  // ── The hunt: having been shown, the player has to do it themselves ──────

  describe('hunt', () => {
    // Every shape lands at (80,80) so a click at that point hits the whole scene;
    // the hit-test prefers matching targets, so each click takes the next match.
    let randomSpy, rectSpy
    beforeEach(() => {
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
      rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON() {},
      })
    })
    afterEach(() => { randomSpy.mockRestore(); rectSpy.mockRestore() })

    function startHunt() {
      openDemo()
      tickToEnd()
      fireEvent.click(screen.getByRole('button', { name: /find them/i }))
    }

    const huntScene = () => document.querySelector('.cbat-tut-hunt')
    const clickScene = (n) => {
      for (let i = 0; i < n; i++) {
        const scene = huntScene()
        if (scene) fireEvent.click(scene, { clientX: 80, clientY: 80 })
      }
    }

    it('replaces the worked example with a scene to search', () => {
      startHunt()

      expect(huntScene()).not.toBeNull()
      // The enlarged single symbol is gone, and the scene now holds a crowd.
      expect(document.querySelector('.cbat-tut-symbol')).toBeNull()
      expect(huntScene().querySelectorAll('.cbat-shape-wrap').length).toBeGreaterThan(10)
      // The label stays on screen as the reference, no longer walking word by word.
      expect(labelWord('facing north')).toBeTruthy()
      expect(document.querySelector('.cbat-word-lit')).toBeNull()
    })

    it('counts targets found and holds the section until all five are cleared', () => {
      startHunt()
      expect(screen.getByText(/found 0 of 5/i)).toBeTruthy()

      clickScene(1)
      expect(screen.getByText(/found 1 of 5/i)).toBeTruthy()

      // Four is not enough — the section must not move on early.
      clickScene(3)
      expect(screen.getByText(/found 4 of 5/i)).toBeTruthy()
      expect(screen.getByText(/read a full target/i)).toBeTruthy()
      expect(huntScene()).not.toBeNull()
    })

    it('advances to the Light section on the fifth target', () => {
      startHunt()
      clickScene(5)

      expect(screen.getByText(/match the lights/i)).toBeTruthy()
      expect(huntScene()).toBeNull()
    })

    it('ignores a click that lands on nothing', () => {
      startHunt()
      fireEvent.click(huntScene(), { clientX: 900, clientY: 700 })

      expect(screen.getByText(/found 0 of 5/i)).toBeTruthy()
      expect(huntScene().className).not.toContain('border-red-500')
    })

    it('Replay from the hunt returns to the explanation', () => {
      startHunt()
      clickScene(2)

      fireEvent.click(screen.getByRole('button', { name: /^replay$/i }))
      expect(huntScene()).toBeNull()
      expect(symbol()).toEqual({ stroke: '#ffffff', lines: 0, polygons: 0 })
    })
  })
})
