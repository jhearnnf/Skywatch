import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatDpt from '../CbatDpt'
import { DPT_PRACTICE_DRILLS } from '../../utils/cbat/dptPractice'

// DPT's practice mode: eight drills on the run's own arena and numpad. What is
// pinned here is the shape of the thing — it opens from the select card and
// only ever goes back there, its arrows follow the input one press at a time,
// a wrong command is judged and put back, a right one is let through — and
// that its usage is reported to the same funnel the other tutorials use.
// The drills' own geometry is covered in utils/cbat/__tests__/dptPractice.test.js.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({
  default: ({ onConfirm }) => <button onClick={onConfirm}>Quit</button>,
}))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/SkywatchLogoIntro', () => ({ default: () => null, SKYWATCH_LOGO_INTRO_MS: 0 }))
vi.mock('../../components/DptAircraftLayer', () => ({ default: () => null }))
vi.mock('@react-three/drei', () => ({ useGLTF: { preload: vi.fn() } }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../lib/offlineRoster', () => ({ getAircraftRoster: vi.fn(() => Promise.resolve({ data: [] })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../utils/cbat/useAdminRoundParam', () => ({ useAdminRoundParam: vi.fn() }))
vi.mock('../../hooks/useGameBodyClass', () => ({ useGameBodyClass: vi.fn() }))
vi.mock('../../data/aircraftModels', () => ({ has3DModel: () => true, getModelUrl: () => '/models/x.glb' }))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const TOTAL = DPT_PRACTICE_DRILLS.length
let apiFetch

function mount() {
  apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
  return render(<CbatDpt />)
}

const openPractice = () => fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))
const practicePosts = () => apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/api/games/cbat/dpt/tutorial'))
const arrowsIn = (el) => [...el.querySelectorAll('[data-guide-arrow]')]
const guidedButtons = (container) => [...container.querySelectorAll('button')].filter(b => b.querySelector('[data-guide-arrow]'))
const feedback = (container) => container.querySelector('[data-practice-feedback]')
const key = (k) => fireEvent.keyDown(window, { key: k })
// Walk the card's next arrow to the named drill.
const goTo = (drillKey) => {
  const idx = DPT_PRACTICE_DRILLS.findIndex(d => d.key === drillKey)
  for (let i = 0; i < idx; i++) fireEvent.click(screen.getByRole('button', { name: /next drill/i }))
  return idx
}

// Runs the practice loop: rAF is faked alongside the timers so frames advance
// with time.
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }) })
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('DPT practice — opening and leaving', () => {
  it('opens from the select card on its first drill, and reports the start', () => {
    mount()
    openPractice()
    expect(screen.getByText(DPT_PRACTICE_DRILLS[0].title)).toBeInTheDocument()
    expect(screen.getByText(`1 / ${TOTAL}`)).toBeInTheDocument()
    expect(practicePosts()).toHaveLength(1)
    expect(JSON.parse(practicePosts()[0][1].body)).toMatchObject({ furthestStep: 0, totalSteps: TOTAL, completed: false })
  })

  it('only ever exits back to the select card', () => {
    mount()
    openPractice()
    fireEvent.click(screen.getByRole('button', { name: /exit tutorial/i }))
    expect(screen.getByRole('button', { name: /^tutorial$/i })).toBeInTheDocument()

    openPractice()
    fireEvent.click(screen.getByRole('button', { name: /^quit$/i }))
    expect(screen.getByRole('button', { name: /^tutorial$/i })).toBeInTheDocument()
  })

  it('walks to the end with the arrows and reports completion', () => {
    mount()
    openPractice()
    for (let i = 0; i < TOTAL; i++) fireEvent.click(screen.getByRole('button', { name: /next drill/i }))
    expect(screen.getByText(/tutorial complete/i)).toBeInTheDocument()
    const last = JSON.parse(practicePosts().at(-1)[1].body)
    expect(last).toMatchObject({ furthestStep: TOTAL - 1, totalSteps: TOTAL, completed: true })

    fireEvent.click(screen.getByRole('button', { name: /back to briefing/i }))
    expect(screen.getByRole('button', { name: /^tutorial$/i })).toBeInTheDocument()
  })

  it('cannot step back off the front', () => {
    mount()
    openPractice()
    expect(screen.getByRole('button', { name: /previous drill/i })).toBeDisabled()
  })
})

describe('DPT practice — the arrows follow the input', () => {
  it('points at R, then at each digit of 090 in turn, then at nothing', () => {
    const { container } = mount()
    openPractice()
    goTo('east')

    // R is already selected at the start, so the first arrow is on the first digit.
    let guided = guidedButtons(container)
    expect(guided.map(b => b.textContent)).toEqual(['0'])

    key('l')   // wander off: now R needs pressing
    guided = guidedButtons(container)
    expect(guided.map(b => b.textContent)).toEqual(['R'])

    key('r')
    key('0')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['9'])
    key('9')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['0'])
    key('0')
    // Command in and correct: nothing left to point at.
    expect(arrowsIn(container)).toHaveLength(0)
    expect(feedback(container).dataset.practiceFeedback).toBe('ok')
    expect(feedback(container).textContent).toMatch(/R 090/)
  })

  it('points back at BRG when the pad has been switched to ALT', () => {
    const { container } = mount()
    openPractice()
    goTo('east')
    key('m')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['BRG (heading)'])
  })

  it('points at the aircraft to select before anything on the pad', () => {
    const { container } = mount()
    openPractice()
    goTo('select')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['CA-N'])
    key('n')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['1'])
  })
})

describe('DPT practice — judging a command', () => {
  it('names a wrong bearing and puts the drill back to its start', async () => {
    const { container } = mount()
    openPractice()
    goTo('east')
    key('0'); key('8'); key('0')
    expect(feedback(container).dataset.practiceFeedback).toBe('bad')
    expect(feedback(container).textContent).toMatch(/That was 080/)
    // The aircraft was sent to 080 and is turning: the guide is down while
    // the wrong command plays out...
    await act(async () => { vi.advanceTimersByTime(2_000) })
    // ...then the pose is rebuilt and the arrows are back on the first digit,
    // with the verdict left up to read.
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['0'])
    expect(feedback(container).textContent).toMatch(/That was 080/)
  })

  it('moves on once a correct command has been flown', async () => {
    mount()
    openPractice()
    const idx = goTo('east')
    key('0'); key('9'); key('0')
    // A 90° turn at 35°/s is under 3s; the drill holds a moment, then loads the next.
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(screen.getByText(DPT_PRACTICE_DRILLS[idx + 1].title)).toBeInTheDocument()
    expect(screen.getByText(`${idx + 2} / ${TOTAL}`)).toBeInTheDocument()
    const last = JSON.parse(practicePosts().at(-1)[1].body)
    expect(last).toMatchObject({ furthestStep: idx + 1, completed: false })
  })

  it('opens on the L/R drill: pressing both sides is the whole task', async () => {
    const { container } = mount()
    openPractice()
    expect(screen.getByText(/left or right/i)).toBeInTheDocument()
    // R is lit but unpressed, so L is what the arrow points at first.
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['L'])
    key('l')
    expect(feedback(container).textContent).toMatch(/anticlockwise/)
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['R'])
    key('r')
    expect(feedback(container).textContent).toMatch(/Both sides seen/)
    await act(async () => { vi.advanceTimersByTime(1_500) })
    expect(screen.getByText(DPT_PRACTICE_DRILLS[1].title)).toBeInTheDocument()
  })

  it('rejects the long way round on the drill that teaches it', () => {
    const { container } = mount()
    openPractice()
    goTo('shortest')
    key('r'); key('3'); key('1'); key('5')
    expect(feedback(container).dataset.practiceFeedback).toBe('bad')
    expect(feedback(container).textContent).toMatch(/long way round/)
  })
})

describe('DPT practice — the mini compass narrows with the digits', () => {
  const compass = (container) => container.querySelector('[data-mini-compass]')
  const labels = (container) => [...container.querySelectorAll('[data-compass-label]')].map(t => t.textContent)

  it('sits around the selected aircraft with nothing lit until a digit goes in', () => {
    const { container } = mount()
    openPractice()
    const c = compass(container)
    expect(c).toBeTruthy()
    expect(c.dataset.compassSector).toBeUndefined()
    expect(c.dataset.compassCommit).toBeUndefined()
    // Centred on the aircraft, which starts in the middle of the arena.
    expect(c.getAttribute('transform')).toBe('translate(500, 500)')
  })

  it('lights 100 degrees on the first digit, 10 on the second, then blinks the bearing', () => {
    const { container } = mount()
    openPractice()
    key('0')
    expect(compass(container).dataset.compassSector).toBe('0-100')
    expect(labels(container)).toEqual(['360', '010', '020', '030', '040', '050', '060', '070', '080', '090'])
    key('9')
    expect(compass(container).dataset.compassSector).toBe('90-100')
    expect(labels(container)).toEqual(['090', '100'])
    key('0')
    expect(compass(container).dataset.compassSector).toBeUndefined()
    expect(compass(container).dataset.compassCommit).toBe('090')
    expect(container.querySelector('[data-compass-target].dpt-compass-flash')).toBeTruthy()
  })

  it('shows the wrap for a first digit of 3', () => {
    const { container } = mount()
    openPractice()
    key('3')
    expect(labels(container).slice(-4)).toEqual(['360', '010', '020', '030'])
  })

  it('lights nothing while an altitude is being typed', () => {
    const { container } = mount()
    openPractice()
    key('m')
    key('0')
    expect(compass(container).dataset.compassSector).toBeUndefined()
  })

  it('follows the aircraft that is selected', () => {
    const { container } = mount()
    openPractice()
    goTo('select')
    expect(compass(container).getAttribute('transform')).toBe('translate(300, 500)')
    key('n')
    expect(compass(container).getAttribute('transform')).toBe('translate(700, 500)')
  })
})

describe('DPT practice — the turn-direction sweep', () => {
  const compass = (container) => container.querySelector('[data-mini-compass]')

  it('sweeps the way L or R would turn, from the moment the side is chosen', () => {
    const { container } = mount()
    openPractice()
    goTo('shortest')
    // R is the default, so the sweep already runs clockwise...
    expect(compass(container).dataset.compassSweep).toBe('R')
    expect(container.querySelector('.dpt-compass-sweep-r')).toBeTruthy()
    // ...and pressing L turns it round.
    key('l')
    expect(compass(container).dataset.compassSweep).toBe('L')
    expect(container.querySelector('.dpt-compass-sweep-l')).toBeTruthy()
    expect(container.querySelector('.dpt-compass-sweep-r')).toBeNull()
  })

  it('starts at the nose and never draws behind it', () => {
    const { container } = mount()
    openPractice()
    const sweepGroup = () => container.querySelector('.dpt-compass-sweep-r, .dpt-compass-sweep-l')
    // The arc runs from the nose (0, -r) forward; its path starts exactly there.
    const r = 134
    let d = sweepGroup().querySelector('path').getAttribute('d')
    expect(d.startsWith(`M 0 ${-r}`)).toBe(true)
    // Clockwise for R: the arc ends to the right of the nose.
    let end = d.split(' ').slice(-2).map(Number)
    expect(end[0]).toBeGreaterThan(0)
    key('l')
    d = sweepGroup().querySelector('path').getAttribute('d')
    expect(d.startsWith(`M 0 ${-r}`)).toBe(true)
    end = d.split(' ').slice(-2).map(Number)
    expect(end[0]).toBeLessThan(0)
  })

  it('keeps the chosen side and typed digits when the idle aircraft is put back from the edge', async () => {
    const { container } = mount()
    openPractice()
    goTo('east')
    key('l'); key('0'); key('9')
    expect(compass(container).dataset.compassSweep).toBe('L')
    // Cruising north from the centre reaches the boundary buffer in ~22s.
    await act(async () => { vi.advanceTimersByTime(30_000) })
    // Back in the middle...
    expect(compass(container).getAttribute('transform')).toMatch(/^translate\(500, /)
    // ...with L still chosen and 09 still typed.
    expect(compass(container).dataset.compassSweep).toBe('L')
    expect(compass(container).dataset.compassSector).toBe('90-100')
  })

  it('stops short of the lit band as the digits go in', () => {
    const { container } = mount()
    openPractice()
    goTo('east')
    expect(compass(container).dataset.compassSweepRotation).toBe('140')
    key('0'); key('9')
    // Band 090 to 100 ahead of a north-pointing nose: tail travel + head = 87.
    expect(compass(container).dataset.compassSweepRotation).toBe('59')
    const sweepGroup = container.querySelector('.dpt-compass-sweep-r')
    expect(sweepGroup.style.getPropertyValue('--sweep')).toBe('59deg')
  })

  it('comes down once a gate drill is lined up, and returns when a turn is needed again', async () => {
    const { container } = mount()
    openPractice()
    goTo('gate')
    // Heading north with the gate to the south east: a turn is needed.
    expect(compass(container).dataset.compassSweep).toBe('R')
    key('1'); key('3'); key('5')
    expect(compass(container).dataset.compassSweep).toBeUndefined()   // turning
    await act(async () => { vi.advanceTimersByTime(5_000) })
    // Turn settled and the gate is dead ahead: still no arrow.
    expect(compass(container).dataset.compassCommit).toBeUndefined()
    expect(compass(container).dataset.compassSweep).toBeUndefined()
    // Steer off the line and the arrow is back.
    key('l'); key('0'); key('6'); key('0')
    await act(async () => { vi.advanceTimersByTime(3_000) })
    expect(compass(container).dataset.compassSweep).toBe('L')
  })

  it('grows on a phone so its labels keep their desktop pixel size', async () => {
    // jsdom has no ResizeObserver; stand one in that reports a 370px arena,
    // roughly a phone's, against the ~700px a desktop renders.
    const observed = []
    class FakeRO {
      constructor(cb) { this.cb = cb }
      observe(el) { observed.push(el); this.cb([{ contentRect: { width: 370 } }]) }
      disconnect() {}
    }
    const prev = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeRO
    try {
      const { container } = mount()
      openPractice()
      await act(async () => {})
      expect(observed).toHaveLength(1)
      const c = compass(container)
      // 700 / 370, capped at 2.2.
      expect(c.dataset.compassScale).toBe('1.89')
      key('0')
      const label = container.querySelector('[data-compass-label]')
      expect(Number(label.getAttribute('font-size'))).toBeCloseTo(15 * 1.89, 1)
      // Radii grow by 70% of that, so the ring does not swallow the arena.
      const ring = c.querySelector('circle')
      expect(Number(ring.getAttribute('r'))).toBeCloseTo(112 * (1 + 0.89 * 0.7), 0)
    } finally {
      globalThis.ResizeObserver = prev
    }
  })

  it('stays at desktop size on a desktop-width arena', async () => {
    class FakeRO {
      constructor(cb) { this.cb = cb }
      observe() { this.cb([{ contentRect: { width: 760 } }]) }
      disconnect() {}
    }
    const prev = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeRO
    try {
      const { container } = mount()
      openPractice()
      await act(async () => {})
      expect(compass(container).dataset.compassScale).toBe('1.00')
    } finally {
      globalThis.ResizeObserver = prev
    }
  })

  it('gives way to the flashing target once a turn is committed', () => {
    const { container } = mount()
    openPractice()
    key('0'); key('9'); key('0')
    expect(compass(container).dataset.compassCommit).toBe('090')
    expect(compass(container).dataset.compassSweep).toBeUndefined()
  })

  it('is not shown while typing an altitude', () => {
    const { container } = mount()
    openPractice()
    key('m')
    expect(compass(container).dataset.compassSweep).toBeUndefined()
  })
})

describe('DPT tutorial — the height drills', () => {
  const compass = (container) => container.querySelector('[data-mini-compass]')

  it('climb: points at ALT, then the digits, and moves on once level', async () => {
    const { container } = mount()
    openPractice()
    const idx = goTo('climb')
    // The pad opens on BRG here, so the first arrow is on the ALT button.
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['ALT (altitude)'])
    // No turn wanted, so no turn-direction sweep either.
    expect(compass(container).dataset.compassSweep).toBeUndefined()
    key('m')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['0'])
    key('0'); key('8')
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['0'])
    key('0')
    expect(feedback(container).dataset.practiceFeedback).toBe('ok')
    expect(feedback(container).textContent).toMatch(/Climbing to 8,000ft/)
    expect(arrowsIn(container)).toHaveLength(0)
    // 3,000ft at 500ft/s is 6s, then the hold.
    await act(async () => { vi.advanceTimersByTime(8_000) })
    expect(screen.getByText(DPT_PRACTICE_DRILLS[idx + 1].title)).toBeInTheDocument()
  })

  it('climb: a bearing typed with the pad on BRG is named and put back', async () => {
    const { container } = mount()
    openPractice()
    goTo('climb')
    key('0'); key('8'); key('0')
    expect(feedback(container).dataset.practiceFeedback).toBe('bad')
    expect(feedback(container).textContent).toMatch(/bearing of 080/)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['ALT (altitude)'])
  })

  it('descend: opens on ALT, then wants the pad back on BRG before it moves on', async () => {
    const { container } = mount()
    openPractice()
    const idx = goTo('descend')
    // Already on ALT from the last drill: straight to the digits.
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['0'])
    key('0'); key('3'); key('0')
    expect(feedback(container).textContent).toMatch(/press BRG/)
    expect(guidedButtons(container).map(b => b.textContent)).toEqual(['BRG (heading)'])
    // Level (10s) but the pad is still on ALT: not done.
    await act(async () => { vi.advanceTimersByTime(12_000) })
    expect(screen.getByText(DPT_PRACTICE_DRILLS[idx].title)).toBeInTheDocument()
    key('ArrowUp')
    await act(async () => { vi.advanceTimersByTime(1_500) })
    expect(screen.getByText(DPT_PRACTICE_DRILLS[idx + 1].title)).toBeInTheDocument()
  })

  it('zone: draws the zone, rejects a height inside its band, and finishes when flown through clear', async () => {
    const { container } = mount()
    openPractice()
    goTo('zone')
    expect(container.querySelectorAll('circle[stroke="#ffffff"][stroke-width="4"]')).toHaveLength(1)
    key('m'); key('0'); key('2'); key('5')
    expect(feedback(container).dataset.practiceFeedback).toBe('bad')
    expect(feedback(container).textContent).toMatch(/within 1,000ft of the zone/)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    key('m'); key('0'); key('5'); key('0')
    expect(feedback(container).textContent).toMatch(/Climbing to 5,000ft/)
    // 260 units to the zone at 18/s, plus its width: well under 25s.
    await act(async () => { vi.advanceTimersByTime(25_000) })
    expect(screen.getByText(/tutorial complete/i)).toBeInTheDocument()
  })

  it('zone: flying on at 2,000ft is caught inside the band', async () => {
    const { container } = mount()
    openPractice()
    goTo('zone')
    await act(async () => { vi.advanceTimersByTime(16_000) })
    expect(feedback(container).dataset.practiceFeedback).toBe('bad')
    expect(feedback(container).textContent).toMatch(/Inside the zone at/)
  })
})
