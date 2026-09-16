import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { MISSION_FIELD_BY_KEY } from '../../utils/cbat/cutSim'

// The tutorial walks the board the run will use, so under the Real CBAT theme
// it walks that variant: the field-entry Mission display with its dispenser,
// a camera order with a time, and the Confirm button when a code timer hits
// zero. Same eight steps, same arrows-on-real-panels approach.

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

function mount() {
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', uiTheme: 'cbat', tutorials: { cbat_cut: 'unseen' } },
    API: '',
    apiFetch,
    setUser: vi.fn(),
  })
  return render(<CbatCut />)
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const next = () => fireEvent.click(screen.getByRole('button', { name: /^(next|finish)$/i }))
const tick = (ms) => act(async () => { vi.advanceTimersByTime(ms) })

// A lit Message line is split into parts (the called-out token is its own
// element), so lines are found by their <li>'s full text, not by getByText.
const lines = (re) => [...document.querySelectorAll('li')].filter(li => re.test(li.textContent))

function latestOrder() {
  const line = lines(/MISSION: set /).at(-1)
  const m = line.textContent.match(/MISSION: set (.+) to (\S+)$/)
  const field = Object.values(MISSION_FIELD_BY_KEY).find(f => f.order === m[1])
  return { line, field, digits: m[2].replace(/:/g, '') }
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('CUT tutorial — Real CBAT theme', () => {
  it('shows the variant copy on the steps it changes', async () => {
    mount()
    await settle()
    for (let i = 0; i < 2; i++) next()   // 3: Message
    expect(screen.getByText(/Mission orders name one field/)).toBeInTheDocument()
    // And a sample order is in the log to point at, with nothing waiting on it.
    expect(screen.getAllByText(/^MISSION: set /).length).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < 3; i++) next()   // 6: Sensor
    expect(screen.getByText(/names a camera and a Clock time/)).toBeInTheDocument()
    next()                                // 7: Mission
    expect(screen.getByText(/press RELEASE/)).toBeInTheDocument()
    next()                                // 8: System
    expect(screen.getByText(/a Confirm button appears/)).toBeInTheDocument()
  })

  it('Sensor step orders a camera with a time and refuses an early press', async () => {
    mount()
    await settle()
    for (let i = 0; i < 5; i++) next()   // 6: Sensor
    const order = lines(/SENSOR: select camera \w+ at \d\d:\d\d:\d\d$/).at(-1)
    expect(order).toBeDefined()
    const cam = order.textContent.match(/camera (\w+)/)[1]
    // The panel gives nothing away.
    expect(screen.queryByText(/order: /)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: cam }))
    expect(screen.getByText(/too early/i)).toBeInTheDocument()
    await tick(9_000)
    fireEvent.click(screen.getByRole('button', { name: cam }))
    expect(screen.getByText(new RegExp(`camera ${cam} selected. Well done`))).toBeInTheDocument()
  })

  it('Mission step walks an order to its field, then RELEASE when the lights fill', async () => {
    const { container } = mount()
    await settle()
    for (let i = 0; i < 6; i++) next()   // 7: Mission
    const arrows = () => [...container.querySelectorAll('[data-guide-arrow]')]
    const { line, field, digits } = latestOrder()

    // 1. On the order line, value called out.
    expect(arrows()).toHaveLength(1)
    expect(line.querySelector('[data-guide-arrow]')).not.toBeNull()
    expect(line.querySelector('.cbat-tutorial-emph').textContent).toBe(
      field.digits === 6 ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}` : digits)

    // 2. Then on that field's confirm button.
    await tick(6_000)
    const confirm = screen.getByRole('button', { name: `Confirm ${field.order}` })
    expect(confirm.querySelector('[data-guide-arrow]')).not.toBeNull()
    expect(confirm.className).toMatch(/cbat-triple-pulse/)

    // Wrong value answers back; the right one is thanked and another is ordered.
    const input = screen.getByLabelText(field.order)
    fireEvent.change(input, { target: { value: digits.replace(/\d$/, d => String((Number(d) + 1) % 10)) } })
    fireEvent.click(confirm)
    expect(screen.getByText(new RegExp(`wrong ${field.order}`))).toBeInTheDocument()
    fireEvent.change(input, { target: { value: digits } })
    fireEvent.click(confirm)
    expect(screen.getByText(new RegExp(`${field.order} set. Well done`))).toBeInTheDocument()
    expect(latestOrder().line.textContent).not.toBe(line.textContent)

    // 3. The dispenser fills on its own (one light every 2s from the step's
    //    start); on the sixth light RELEASE takes the arrow, urgently.
    await tick(7_000)
    const release = screen.getByRole('button', { name: 'RELEASE' })
    expect(release).toBeEnabled()
    const inRelease = release.querySelector('[data-guide-arrow]')
    expect(inRelease).not.toBeNull()
    expect(inRelease.dataset.guideUrgent).toBe('true')
    fireEvent.click(release)
    expect(screen.getByText(/load released. Well done/)).toBeInTheDocument()
    expect(release).toBeDisabled()
  })

  it('System step keeps an entered code until zero, then points at Confirm', async () => {
    mount()
    await settle()
    for (let i = 0; i < 7; i++) next()   // 8: System
    // Pressure outranks everything in the guide, so keep it in band for the
    // half-minute this takes: the pump on from 93 climbs to ~108 by the end.
    fireEvent.click(screen.getByRole('button', { name: 'Pump ON' }))
    await tick(6_100)                     // the first code arrives
    const issued = () => lines(/COMMS: code \d{3}\. Enter it in System/)
    const code = issued().at(-1).textContent.match(/COMMS: code (\d{3})/)[1]
    for (const d of code) fireEvent.click(screen.getByRole('button', { name: d }))
    await tick(16_000)                    // OK live in the last 15s
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByText(/accepted. Press Confirm when the timer reaches zero/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    await tick(15_000)                    // timer runs out
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(confirm.querySelector('[data-guide-arrow]')).not.toBeNull()
    fireEvent.click(confirm)
    expect(screen.getByText(/COMMS: confirmed. Well done/)).toBeInTheDocument()
    // And the next code follows.
    expect(issued().length).toBe(2)
  })

  it('does not run the dispenser or field orders on the other steps', async () => {
    mount()
    await settle()
    for (let i = 0; i < 7; i++) next()   // 8: System
    await tick(30_000)
    fireEvent.click(screen.getAllByRole('button', { name: 'Mission' })[0])
    expect(document.querySelectorAll('[data-light="on"]')).toHaveLength(0)
    expect(screen.queryByText(/order missed/)).toBeNull()
  })
})
