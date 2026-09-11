import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'

// CUT's tutorial exists because of a measured problem, not a hunch: mean score by
// run number across players with 5+ runs goes 298, 403, 460, 552, 623, 645, 708
// against a population median of 604. It takes about five runs just to reach
// average, and most of that climb is learning where the six displays are. The
// walkthrough takes that first slice off.
//
// Two properties matter and are what these tests hold:
//
//   only the display being taught MOVES — it teaches against real panels reading
//   a real sim, and on each step exactly one thing is happening, the thing the
//   card describes. Everything else holds in tolerance and the board is reset on
//   every step change, so it never decays into a wall of warnings from displays
//   the user has not reached yet
//
//   it opens ITSELF on a first visit, once, and never nags again

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const TOTAL_STEPS = 8
const TUTORIAL_CODE_AT_MS = 6_000

let apiFetch, setUser

// `best` null means "asked, no runs" — a genuine first-timer. Pass a number to
// stand for someone who has already played this board.
function mount({ best = null, tutorialStatus = 'unseen' } = {}) {
  apiFetch = vi.fn(async (url) => {
    if (String(url).includes('personal-best')) {
      return { ok: true, json: async () => ({ data: best === null ? null : { bestScore: best } }) }
    }
    return { ok: true, json: async () => ({ data: null }) }
  })
  setUser = vi.fn()
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', tutorials: { cbat_cut: tutorialStatus } },
    API: '',
    apiFetch,
    setUser,
  })
  return render(<CbatCut />)
}

// Let the personal-best request settle, which is what the auto-open waits on.
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const tutorialPosts = () =>
  apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/api/games/cbat/cut/tutorial'))

const seenPatches = () =>
  apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/api/users/me/tutorials'))

// The primary button reads "Next" until the last step, where it reads "Finish".
const next = () => fireEvent.click(screen.getByRole('button', { name: /^(next|finish)$/i }))

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('CUT tutorial — opening it', () => {
  it('opens by itself for a first-timer with no score on the board', async () => {
    mount()
    await settle()
    expect(screen.getByText(/two windows, six displays/i)).toBeInTheDocument()
  })

  it('leaves someone who has already played this board alone', async () => {
    mount({ best: 420 })
    await settle()
    expect(screen.queryByText(/two windows, six displays/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument()
  })

  it('does not reopen for someone who has already been offered it', async () => {
    mount({ tutorialStatus: 'skipped' })
    await settle()
    expect(screen.queryByText(/two windows, six displays/i)).not.toBeInTheDocument()
  })

  it('can still be opened on purpose from the briefing', async () => {
    mount({ tutorialStatus: 'viewed' })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))
    expect(screen.getByText(/two windows, six displays/i)).toBeInTheDocument()
  })
})

describe('CUT tutorial — walking it', () => {
  it('steps forward and back through every display', async () => {
    mount()
    await settle()

    expect(screen.getByText(`1 / ${TOTAL_STEPS}`)).toBeInTheDocument()
    next()
    expect(screen.getByText(`2 / ${TOTAL_STEPS}`)).toBeInTheDocument()
    expect(screen.getByText(/warnings and the clock/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))
    expect(screen.getByText(`1 / ${TOTAL_STEPS}`)).toBeInTheDocument()
  })

  it('cannot step back off the front', async () => {
    mount()
    await settle()
    expect(screen.getByRole('button', { name: /previous section/i })).toBeDisabled()
  })

  it('lights the display being taught and dims the rest', async () => {
    const { container } = mount()
    await settle()

    // Step 1 is about the display selector rows, so those are lit.
    next()   // 2: warnings + clock
    next()   // 3: Message, the first panel step
    expect(screen.getByText(/every order arrives here/i)).toBeInTheDocument()

    expect(container.querySelectorAll('.cbat-tutorial-pulse').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.cbat-tutorial-dim').length).toBeGreaterThan(0)
  })

  it('finishes on the last step and offers the way back', async () => {
    mount()
    await settle()
    for (let i = 0; i < TOTAL_STEPS; i++) next()

    expect(screen.getByText(/tutorial complete/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back to briefing/i }))
    // Back to the briefing, never straight into a scored run.
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument()
  })
})

describe('CUT tutorial — only the taught display moves', () => {
  // Engine is step 4. Message (step 3) shows the same fuel state in the dimmed
  // second window, so the same reading can be taken on either step.
  // Each level renders as a "420" text node beside a child <span>L</span>. The
  // matcher sees an element's own text only, so match the digits and confirm
  // the unit — keypad keys and the speed readout are digits too.
  const fuelLevels = () => screen.getAllByText(/^\d+$/)
    .filter(el => el.querySelector('span')?.textContent === 'L')
    .map(el => parseInt(el.textContent, 10))

  it('keeps the clock running', async () => {
    const { container } = mount()
    await settle()
    next()   // step 2 shows the clock
    // The Clock panel's readout — the step counter is tabular-nums too.
    const clock = () => container.querySelector('.whitespace-nowrap.tabular-nums').textContent

    const before = clock()
    expect(before).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    await act(async () => { vi.advanceTimersByTime(3_000) })
    expect(clock()).not.toBe(before)
  })

  it('drains the feeding tank on the Engine step', async () => {
    mount()
    await settle()
    next(); next(); next()   // 4: Engine
    const before = fuelLevels()

    await act(async () => { vi.advanceTimersByTime(10_000) })
    const after = fuelLevels()

    // Tank 0 feeds; the other two are static.
    expect(after[0]).toBeLessThan(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })

  it('holds the fuel still on a step that is not about it', async () => {
    mount()
    await settle()
    next(); next()   // 3: Message, with Engine in the dimmed second window
    const before = fuelLevels()

    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(fuelLevels()).toEqual(before)
  })

  it('shows the real warning if the taught display is ignored', async () => {
    mount()
    await settle()
    next(); next(); next()   // 4: Engine
    expect(screen.getByText(/all systems nominal/i)).toBeInTheDocument()

    // Easier drains 2.5 L/s. Tank 0 starts 35 L above the lowest tank, so the
    // 50 L spread is breached once it has lost 85 L — about 34 s.
    await act(async () => { vi.advanceTimersByTime(40_000) })
    expect(screen.getByText(/ENGINE: fuel imbalance/)).toBeInTheDocument()
  })

  it('leaves the warning strip clear on a step where nothing drifts', async () => {
    mount()
    await settle()
    next()   // 2: the strip itself
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByText(/all systems nominal/i)).toBeInTheDocument()
  })

  it('resets the board on every step change', async () => {
    mount()
    await settle()
    next(); next(); next()   // 4: Engine
    const fresh = fuelLevels()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(fuelLevels()).not.toEqual(fresh)

    next()   // away
    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))   // and back
    expect(fuelLevels()).toEqual(fresh)
  })

  // The Mission step is the one that cannot be taught by a frozen panel: the
  // panel shows nothing by design, so the step has to order a drop for real and
  // let the moment come.
  it('orders a drop on the Mission step, through Message, and answers a press', async () => {
    mount()
    await settle()
    for (let i = 0; i < 6; i++) next()   // 7: Mission, with Message in the other window

    // Newest order is the last line of the log.
    const order = screen.getAllByText(/MISSION: drop Station \d at/).at(-1)
    const station = order.textContent.match(/Station (\d)/)[1]
    const press = () => fireEvent.click(screen.getByRole('button', { name: `Station ${station}` }))

    press()
    expect(screen.getByText(/too early/i)).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(15_000) })
    press()
    expect(screen.getByText(/dropped on time/i)).toBeInTheDocument()
  })

  // The arrow walks the eye through the order in three moves, on the drop's own
  // clock: the Message line first, then the time, then the station, urgently,
  // once the release window opens.
  it('points at the order, then the clock, then the station when it is time', async () => {
    const { container } = mount()
    await settle()
    for (let i = 0; i < 6; i++) next()   // 7: Mission

    const arrows = () => [...container.querySelectorAll('[data-guide-arrow]')]
    const order = screen.getAllByText(/MISSION: drop Station \d at/).at(-1)
    const station = order.textContent.match(/Station (\d)/)[1]

    // 1. On the order line, which is lit, and nowhere else.
    expect(arrows()).toHaveLength(1)
    expect(order.closest('li').querySelector('[data-guide-arrow]')).not.toBeNull()
    expect(order.className).toMatch(/cbat-word-lit/)

    // 2. After a few seconds, on the clock. The line stays lit; the arrow leaves
    //    it; and the TIME in the line is now the called-out token.
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(arrows()).toHaveLength(1)
    expect(order.closest('li').querySelector('[data-guide-arrow]')).toBeNull()
    const emph = () => order.closest('li').querySelector('.cbat-tutorial-emph')
    expect(emph()).not.toBeNull()
    expect(emph().textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(container.querySelector('.whitespace-nowrap.tabular-nums').className).toMatch(/cbat-word-lit/)
    expect(container.querySelector('.whitespace-nowrap.tabular-nums').previousSibling?.dataset?.guideArrow).toBe('right')

    // 3. When the time comes: on the ordered station, urgent, and the button pulses.
    await act(async () => { vi.advanceTimersByTime(10_000) })
    const button = screen.getByRole('button', { name: `Station ${station}` })
    const inButton = button.querySelector('[data-guide-arrow]')
    expect(inButton).not.toBeNull()
    expect(inButton.dataset.guideUrgent).toBe('true')
    expect(button.className).toMatch(/cbat-triple-pulse/)
    expect(arrows()).toHaveLength(1)
    // And the called-out token moves from the time to the station.
    expect(emph().textContent).toBe(`Station ${station}`)
    // And not the other two.
    for (const other of screen.getAllByRole('button', { name: /^Station \d$/ })) {
      if (other !== button) expect(other.querySelector('[data-guide-arrow]')).toBeNull()
    }
  })

  it('does not leave a drop running on the steps after Mission', async () => {
    mount()
    await settle()
    for (let i = 0; i < 7; i++) next()   // 8: System
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(screen.queryByText(/drop .* missed/i)).not.toBeInTheDocument()
  })

  it('still lets a control be pressed, so the user can see what it does', async () => {
    mount()
    await settle()
    next(); next(); next()   // 4: Engine

    const toggles = screen.getAllByRole('button', { name: /^(ON|OFF)$/ })
    expect(toggles.some(b => b.textContent === 'ON')).toBe(true)
    fireEvent.click(toggles[2])
    // The feed moved to the tank that was pressed rather than nothing happening.
    const after = screen.getAllByRole('button', { name: /^(ON|OFF)$/ })
    expect(after[2].textContent).toBe('ON')
  })
})

describe('CUT tutorial — every step points at something', () => {
  const arrows = (container) => [...container.querySelectorAll('[data-guide-arrow]')]
  const arrowInside = (el) => el.querySelector('[data-guide-arrow]')
  const goTo = (stepNumber) => { for (let i = 1; i < stepNumber; i++) next() }

  // A code line has its digits wrapped in a callout, so its text is split
  // across elements: match on the whole <li>.
  const CODE_LINE = /COMMS: code \d{3}\. Enter it in System/
  const codeLines = () => [...document.querySelectorAll('li')].filter(li => CODE_LINE.test(li.textContent))

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('step %i shows at least one arrow', async (n) => {
    const { container } = mount()
    await settle()
    goTo(n)
    expect(arrows(container).length).toBeGreaterThan(0)
  })

  it('step 1 points at both display selectors', async () => {
    const { container } = mount()
    await settle()
    expect(arrows(container)).toHaveLength(2)
  })

  it('step 2 points at the warning strip first, then the clock', async () => {
    const { container } = mount()
    await settle()
    goTo(2)
    const clock = () => container.querySelector('.whitespace-nowrap.tabular-nums')
    expect(clock().previousSibling?.dataset?.guideArrow).toBeUndefined()
    expect(arrows(container)).toHaveLength(1)

    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(clock().previousSibling?.dataset?.guideArrow).toBe('right')
    expect(arrows(container)).toHaveLength(1)
  })

  it('step 3 points at the drop order in the log', async () => {
    mount()
    await settle()
    goTo(3)
    const order = screen.getAllByText(/MISSION: drop Station \d at/).at(-1)
    expect(arrowInside(order.closest('li'))).not.toBeNull()
    expect(order.className).toMatch(/cbat-word-lit/)
  })

  it('step 4 arrives with the feed on the lowest tank and asks for the switch', async () => {
    mount()
    await settle()
    goTo(4)
    const toggles = () => screen.getAllByRole('button', { name: /^(ON|OFF)$/ }).slice(0, 3)

    // Feeding from tank 0 at 380 while tank 1 sits at 420: the arrow is on
    // tank 1, urgently, before anything has moved.
    expect(toggles()[0].textContent).toBe('ON')
    expect(arrowInside(toggles()[0])).toBeNull()
    expect(arrowInside(toggles()[1])).not.toBeNull()
    expect(arrowInside(toggles()[1]).dataset.guideUrgent).toBe('true')

    // Make the switch and it settles to calm on the new feed.
    fireEvent.click(toggles()[1])
    expect(toggles()[1].textContent).toBe('ON')
    expect(arrowInside(toggles()[1]).dataset.guideUrgent).toBeUndefined()

    // Tank 1 drains from 420; once it is under tank 2's 400, tank 2 is the switch.
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(arrowInside(toggles()[1])).toBeNull()
    expect(arrowInside(toggles()[2]).dataset.guideUrgent).toBe('true')
  })

  it('step 5 points at whichever button closes the gap', async () => {
    const { container } = mount()
    await settle()
    goTo(5)
    const plus = () => screen.getByRole('button', { name: '+' })
    const minus = () => screen.getByRole('button', { name: '−' })
    const current = () => screen.getByText('Current').nextSibling

    // Arrives 10 over Required: bring it down. Minus, calmly. Never plus.
    expect(arrowInside(plus())).toBeNull()
    expect(arrowInside(minus())).not.toBeNull()
    expect(arrowInside(minus()).dataset.guideUrgent).toBeUndefined()

    // Five presses of minus lands it on the number: nothing to press, and a
    // thumbs-up beside Current says so. No arrows anywhere.
    for (let i = 0; i < 5; i++) fireEvent.click(minus())
    expect(arrowInside(minus())).toBeNull()
    expect(arrowInside(plus())).toBeNull()
    expect(current().querySelector('[data-guide-ok]')).not.toBeNull()
    expect(container.querySelectorAll('[data-guide-arrow]')).toHaveLength(0)

    // It drifts under: plus, calmly.
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(arrowInside(plus())).not.toBeNull()
    expect(arrowInside(plus()).dataset.guideUrgent).toBeUndefined()

    // Overshoot with plus and the arrow moves to minus, urgently — never plus.
    for (let i = 0; i < 10; i++) fireEvent.click(plus())
    expect(arrowInside(plus())).toBeNull()
    expect(arrowInside(minus()).dataset.guideUrgent).toBe('true')

    // Let it drift right through the band and out the bottom: plus, urgently.
    await act(async () => { vi.advanceTimersByTime(150_000) })
    expect(arrowInside(minus())).toBeNull()
    expect(arrowInside(plus()).dataset.guideUrgent).toBe('true')
    expect(container.querySelectorAll('[data-guide-arrow]')).toHaveLength(1)
  })

  it('step 6 points at the ordered camera, then at the sensor due next', async () => {
    mount()
    await settle()
    goTo(6)
    const bravo = () => screen.getByRole('button', { name: 'Bravo' })
    expect(arrowInside(bravo())).not.toBeNull()

    fireEvent.click(bravo())
    expect(screen.getByText(/camera Bravo selected/i)).toBeInTheDocument()
    expect(arrowInside(bravo())).toBeNull()

    // Air is due first (8 s) and arms at 6 s out: the arrow is on its Activate.
    const activates = () => screen.getAllByRole('button', { name: 'Activate' })
    expect(arrowInside(activates()[0])).not.toBeNull()
    await act(async () => { vi.advanceTimersByTime(3_000) })
    expect(arrowInside(activates()[0]).dataset.guideUrgent).toBe('true')
    fireEvent.click(activates()[0])
    expect(screen.getByText(/air sensor activated on time/i)).toBeInTheDocument()
  })

  it('step 8 starts with the pump, then a code arrives in Message and is read first', async () => {
    const { container } = mount()
    await settle()
    goTo(8)
    const pump = () => screen.getByRole('button', { name: /^Pump/ })

    // Pressure is seeded just above the bottom of the band, falling: pump, calmly.
    // No code yet, so no key is pointed at and the keypad is inert.
    expect(arrowInside(pump())).not.toBeNull()
    expect(arrowInside(pump()).dataset.guideUrgent).toBeUndefined()
    expect(screen.getByRole('button', { name: '4' })).toBeDisabled()
    expect(codeLines()).toHaveLength(0)

    // Turn it on and pressure is fine: thumbs-up on the readout, no arrows.
    fireEvent.click(pump())
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(container.querySelector('[data-guide-ok]')).not.toBeNull()
    expect(arrows(container)).toHaveLength(0)

    // The code arrives through Message, digits called out, arrow on the line,
    // and the Message window is the lit one.
    await act(async () => { vi.advanceTimersByTime(5_000) })
    const line = codeLines()[0]
    expect(line).toBeDefined()
    expect(arrowInside(line)).not.toBeNull()
    expect(line.querySelector('.cbat-tutorial-emph').textContent).toMatch(/^\d{3}$/)
    expect(container.querySelector('.cbat-tutorial-pulse ul')).not.toBeNull()
  })

  it('step 8 walks the code one key at a time, then OK once it is live', async () => {
    const { container } = mount()
    await settle()
    goTo(8)
    fireEvent.click(screen.getByRole('button', { name: /^Pump/ }))
    // Past the code's arrival and its read phase.
    await act(async () => { vi.advanceTimersByTime(TUTORIAL_CODE_AT_MS + 6_000) })

    const line = codeLines()[0]
    const digits = line.querySelector('.cbat-tutorial-emph').textContent
    const key = (label) => screen.getByRole('button', { name: label })

    // First digit: pointed at AND pulsing, the digits still called out to copy from.
    expect(arrowInside(key(digits[0]))).not.toBeNull()
    expect(key(digits[0]).className).toMatch(/cbat-triple-pulse/)
    expect(line.querySelector('.cbat-tutorial-emph')).not.toBeNull()

    fireEvent.click(key(digits[0]))
    // The code is random, so the second digit can be the same key as the first —
    // in which case the arrow rightly stays put.
    if (digits[1] !== digits[0]) expect(arrowInside(key(digits[0]))).toBeNull()
    expect(arrowInside(key(digits[1]))).not.toBeNull()
    fireEvent.click(key(digits[1]))
    fireEvent.click(key(digits[2]))

    // All three in, but OK is not live yet: no arrow on the disabled button.
    // Instead the countdown says wait, and the arrow is on that.
    expect(arrowInside(key('OK'))).toBeNull()
    expect(key('OK')).toBeDisabled()
    const wait = container.querySelector('[data-guide-wait]')
    expect(wait).not.toBeNull()
    expect(wait.textContent).toMatch(/wait, OK in \d+s/)
    expect(arrowInside(wait)).not.toBeNull()

    // The final 15 s opens: the wait goes, OK lights and the arrow is on it, urgent.
    await act(async () => { vi.advanceTimersByTime(12_000) })
    expect(container.querySelector('[data-guide-wait]')).toBeNull()
    expect(key('OK')).toBeEnabled()
    expect(arrowInside(key('OK')).dataset.guideUrgent).toBe('true')

    fireEvent.click(key('OK'))
    expect(screen.getByText(new RegExp(`code ${digits} accepted`, 'i'))).toBeInTheDocument()
    // And the next one is already on its way, through Message.
    expect(codeLines()).toHaveLength(2)
    expect(container.querySelectorAll('[data-guide-arrow]').length).toBeGreaterThan(0)
  })

  it('step 8 puts the pump first if pressure has drifted out', async () => {
    mount()
    await settle()
    goTo(8)
    // Pump off from 93, Easier falls 0.3/s: under 90 in about 10 s. A code has
    // arrived by then too, and the pump still outranks it.
    await act(async () => { vi.advanceTimersByTime(14_000) })
    const pump = screen.getByRole('button', { name: /^Pump/ })
    expect(arrowInside(pump)).not.toBeNull()
    expect(arrowInside(pump).dataset.guideUrgent).toBe('true')
    expect(screen.getByText(/SYSTEM: hydraulic pressure/)).toBeInTheDocument()
  })

  // The window highlight belongs to whatever the arrow is pointing into, not to
  // the step's own panel. On the Mission step that means Message while the
  // order is being read, the strip while the clock is being watched, and the
  // Mission panel only once it is time to press.
  it('moves the highlight with the arrow on the Mission step', async () => {
    const { container } = mount()
    await settle()
    goTo(7)
    const pulsing = () => [...container.querySelectorAll('.cbat-tutorial-pulse')]
    const holds = (sel) => pulsing().some(el => el.querySelector(sel) || el.matches(sel))

    // Reading: the Message window pulses, the Mission panel does not.
    expect(pulsing()).toHaveLength(1)
    expect(holds('ul')).toBe(true)                       // the log
    expect(holds('[class*="MISSION"], .cbat-triple-pulse')).toBe(false)

    // Watching: the strip pulses.
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(pulsing()).toHaveLength(1)
    expect(holds('.whitespace-nowrap.tabular-nums')).toBe(true)

    // Pressing: the Mission panel pulses.
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(pulsing().some(el => el.querySelector('.cbat-triple-pulse'))).toBe(true)
  })
})

describe('CUT tutorial — what it records', () => {
  it('reports the step reached so the drop-off funnel can be built', async () => {
    mount()
    await settle()
    await waitFor(() => expect(tutorialPosts().length).toBeGreaterThan(0))

    next()
    await waitFor(() => {
      const bodies = tutorialPosts().map(([, opt]) => JSON.parse(opt.body))
      expect(bodies.some(b => b.furthestStep === 1 && b.totalSteps === TOTAL_STEPS)).toBe(true)
    })
    // One playthrough, one id — the backend upserts on it.
    const ids = new Set(tutorialPosts().map(([, opt]) => JSON.parse(opt.body).clientRunId))
    expect(ids.size).toBe(1)
  })

  it('marks it completed only once the last step is done', async () => {
    mount()
    await settle()
    for (let i = 0; i < TOTAL_STEPS; i++) next()

    await waitFor(() => {
      const bodies = tutorialPosts().map(([, opt]) => JSON.parse(opt.body))
      expect(bodies.some(b => b.completed === true)).toBe(true)
    })
  })

  it('records a finished walkthrough as viewed', async () => {
    mount()
    await settle()
    for (let i = 0; i < TOTAL_STEPS; i++) next()
    fireEvent.click(screen.getByRole('button', { name: /back to briefing/i }))

    await waitFor(() => {
      const [, opt] = seenPatches().at(-1)
      expect(JSON.parse(opt.body)).toEqual({ tutorialId: 'cbat_cut', status: 'viewed' })
    })
  })

  it('records a skipped walkthrough as skipped, so it does not reopen', async () => {
    mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /skip tutorial/i }))

    await waitFor(() => {
      const [, opt] = seenPatches().at(-1)
      expect(JSON.parse(opt.body)).toEqual({ tutorialId: 'cbat_cut', status: 'skipped' })
    })
    // Patched locally too, or the derived auto-open would fire straight back up.
    expect(setUser).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument()
  })
})
