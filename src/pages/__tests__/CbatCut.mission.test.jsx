import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'
import { MISSION_FIELD_BY_KEY, LOAD_ORDER, DISPENSER_LIGHTS, RELEASE_WINDOW, SCORE } from '../../utils/cbat/cutSim'

// The Mission display is the memory-updating task: Message orders one field
// value ("set load drop latitude to 51:28:40") and nothing else ever repeats
// it. A cue on the panel itself — the ordered field lighting up, the value
// echoed beside its boxes — would turn that into a copying task you could
// pass without reading Message at all. The panel must look the same whether
// an order is outstanding or not, under both themes and at both difficulties.
//
// The drop itself: three values in, the dispenser arms, and RELEASE is judged
// against the ordered Clock second — early is a fault and the drop stands,
// and the points fall the later it is pressed inside the window.

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

const LAUNCH_MS = 1000

// Start a run at `difficulty` with the second display showing Mission, so
// Message stays open in the first and the order can be read back.
async function missionPanel(difficulty, uiTheme) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', uiTheme, tutorials: { cbat_cut: 'viewed' } }, API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) })),
  })
  render(<CbatCut />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${difficulty}$`, 'i') }))
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })
  fireEvent.click(screen.getAllByRole('button', { name: 'Mission' })[1])
}

const panel = () => document.querySelector('[data-cbat-mission]')
// Everything about the panel that could carry a cue: its text, and the class
// and pulse state of every field row and confirm button.
const snapshot = () => ({
  text: panel().textContent,
  rows: [...panel().querySelectorAll('[data-cbat-field]')].map(el => el.className),
  confirms: screen.getAllByRole('button', { name: /^Confirm / }).map(b => b.className),
})

describe.each([
  ['Easier', 'skywatch'], ['Hard', 'skywatch'], ['Easier', 'cbat'], ['Hard', 'cbat'],
])('CUT Mission panel — %s, %s theme', (difficulty, uiTheme) => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => vi.useRealTimers())

  it('is the real three-interface display, with no stations', async () => {
    await missionPanel(difficulty, uiTheme)
    expect(screen.getByText('Load Drop Interface')).toBeInTheDocument()
    expect(screen.getByText('Load Drop Dispenser')).toBeInTheDocument()
    expect(screen.getByText('Video Recording Interface')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Station \d$/ })).toBeNull()
    for (const f of Object.values(MISSION_FIELD_BY_KEY)) {
      expect(screen.getByLabelText(f.order)).toBeInTheDocument()
    }
  })

  it('gives nothing away when an order arrives', async () => {
    await missionPanel(difficulty, uiTheme)
    const before = snapshot()

    // Past the first field order: it is in Message and nowhere else.
    await act(async () => { vi.advanceTimersByTime(CUT_TUNING[difficulty.toLowerCase()].fieldFirstMs + 200) })
    const lines = screen.getAllByText(/^MISSION: set /).map(el => el.textContent)
    const [, order, value] = lines[lines.length - 1].match(/^MISSION: set (.+) to (\S+)$/)

    expect(snapshot()).toEqual(before)
    expect(panel().textContent).not.toContain(order)
    expect(panel().textContent).not.toContain(value)
    expect(before.rows.some(c => c.includes('cbat-triple-pulse'))).toBe(false)
  })
})

describe('CUT Mission panel — the load drop', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => vi.useRealTimers())

  const advance = (ms) => act(async () => { vi.advanceTimersByTime(ms) })
  const clock = () => document.querySelector('.whitespace-nowrap.tabular-nums').textContent
  const lit = () => document.querySelectorAll('[data-light="on"]').length
  const release = () => screen.getByRole('button', { name: 'RELEASE' })
  // The points a commentary line was logged with.
  const delta = (text) => Number(screen.getByText(text).previousSibling.textContent)
  // The load orders in Message, keyed by field.
  const loadOrders = () => Object.fromEntries(
    screen.getAllByText(/^MISSION: set load drop /).map(el => {
      const [, order, value] = el.textContent.match(/^MISSION: set (.+) to (\S+)$/)
      const field = Object.values(MISSION_FIELD_BY_KEY).find(f => f.order === order)
      return [field.key, { field, value, digits: value.replace(/:/g, '') }]
    }))

  it('arms on the three values, faults an early press and scores one on the second', async () => {
    const t = CUT_TUNING.easier
    await missionPanel('Easier', 'skywatch')
    expect(release()).toBeDisabled()

    // Latitude, longitude, then the time arrive one at a time.
    await advance(t.firstDropMs + 200)
    expect(Object.keys(loadOrders())).toEqual(['loadLat'])
    await advance(2 * t.dropOrderGapMs[1] + 200)
    const orders = loadOrders()
    expect(Object.keys(orders)).toEqual(LOAD_ORDER)
    expect(orders.loadTime.value).toMatch(/^\d\d:\d\d:\d\d$/)

    // Each value in: two lights per value, RELEASE live on the sixth.
    for (const [i, key] of LOAD_ORDER.entries()) {
      const { field, digits } = orders[key]
      fireEvent.change(screen.getByLabelText(field.order), { target: { value: digits } })
      fireEvent.click(screen.getByRole('button', { name: `Confirm ${field.order}` }))
      expect(lit()).toBe(2 * (i + 1))
    }
    expect(lit()).toBe(DISPENSER_LIGHTS)
    expect(release()).toBeEnabled()

    // Well before the time: a fault, and the drop still stands.
    fireEvent.click(release())
    expect(screen.getByText(`load released before ${orders.loadTime.value}`)).toBeInTheDocument()
    expect(lit()).toBe(DISPENSER_LIGHTS)

    // Watch the Clock to the ordered second, then press.
    for (let i = 0; i < 60 && clock() !== orders.loadTime.value; i++) await advance(1_000)
    expect(clock()).toBe(orders.loadTime.value)
    fireEvent.click(release())
    // On the second (within a tick of it): all but a point or two of the full
    // score. The commentary line carries its delta.
    expect(delta(`load released at ${orders.loadTime.value}`)).toBeGreaterThanOrEqual(SCORE.release - 3)
    // Released: the interface clears and the dispenser disarms for the next drop.
    expect(lit()).toBe(0)
    expect(release()).toBeDisabled()
    for (const key of LOAD_ORDER) expect(screen.getByLabelText(orders[key].field.order).value).toBe('')
  })

  it('pays less the later RELEASE is pressed inside the window', async () => {
    const t = CUT_TUNING.easier
    await missionPanel('Easier', 'skywatch')
    await advance(t.firstDropMs + 2 * t.dropOrderGapMs[1] + 400)
    const orders = loadOrders()
    for (const key of LOAD_ORDER) {
      fireEvent.change(screen.getByLabelText(orders[key].field.order), { target: { value: orders[key].digits } })
      fireEvent.click(screen.getByRole('button', { name: `Confirm ${orders[key].field.order}` }))
    }
    for (let i = 0; i < 60 && clock() !== orders.loadTime.value; i++) await advance(1_000)
    // Most of the window gone: a fraction of the points, never the full score.
    await advance(RELEASE_WINDOW * 0.8)
    fireEvent.click(release())
    const late = delta(`load released at ${orders.loadTime.value}`)
    expect(late).toBeGreaterThan(SCORE.releaseLate)
    expect(late).toBeLessThan(SCORE.release / 2)
  })

  it('faults a drop left past its window and clears the interface', async () => {
    const t = CUT_TUNING.hard
    await missionPanel('Hard', 'skywatch')
    await advance(t.firstDropMs + 2 * t.dropOrderGapMs[1] + 400)
    const orders = loadOrders()
    for (const key of LOAD_ORDER) {
      fireEvent.change(screen.getByLabelText(orders[key].field.order), { target: { value: orders[key].digits } })
      fireEvent.click(screen.getByRole('button', { name: `Confirm ${orders[key].field.order}` }))
    }
    expect(lit()).toBe(DISPENSER_LIGHTS)
    await advance(t.dropLeadMs[1] + 1_000 + RELEASE_WINDOW + 200)
    expect(screen.getByText(`load drop at ${orders.loadTime.value} missed`)).toBeInTheDocument()
    expect(lit()).toBe(0)
    expect(release()).toBeDisabled()
  })
})
