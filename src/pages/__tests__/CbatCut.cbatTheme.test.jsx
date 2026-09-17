import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'
import { MISSION_FIELD_BY_KEY, fmtFieldValue } from '../../utils/cbat/cutSim'

// The Mission display is the real one under both themes: a Load Drop
// Interface, a Load Drop Dispenser and a Video Recording Interface, with
// Message ordering one field value at a time. What the Real CBAT theme adds
// is timed camera orders and the Confirm button when a code timer reaches
// zero. The score records which variant it came from.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSubmit = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmit }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const LAUNCH_MS = 1000

async function startRun(uiTheme, difficulty = 'Easier') {
  mockUseAuth.mockReturnValue({
    // A score on the board, so the tutorial does not open by itself.
    user: { _id: 'u1', uiTheme, tutorials: { cbat_cut: 'viewed' } }, API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) })),
  })
  render(<CbatCut />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${difficulty}$`, 'i') }))
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })
}

// The second display stack, so Message stays open in the first and the
// order lines can be read back.
const showMission = () => fireEvent.click(screen.getAllByRole('button', { name: 'Mission' })[1])
const advance = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms) }) }

// The latest field order in the Message log, parsed back to field + digits.
function latestOrder() {
  const lines = screen.getAllByText(/^MISSION: set /).map(el => el.textContent)
  const text = lines[lines.length - 1]
  const m = text.match(/^MISSION: set (.+) to (\S+)$/)
  const field = Object.values(MISSION_FIELD_BY_KEY).find(f => f.order === m[1])
  return { field, digits: m[2].replace(/:/g, ''), shown: m[2] }
}

describe('CUT — Real CBAT theme Mission display', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => vi.useRealTimers())

  it('shows the three interfaces under the Real CBAT theme', async () => {
    await startRun('cbat')
    showMission()
    expect(screen.getByText('Load Drop Interface')).toBeInTheDocument()
    expect(screen.getByText('Load Drop Dispenser')).toBeInTheDocument()
    expect(screen.getByText('Video Recording Interface')).toBeInTheDocument()
    // Every field of the real interface, each with its own confirm button.
    for (const f of Object.values(MISSION_FIELD_BY_KEY)) {
      expect(screen.getByLabelText(f.order)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: /^Confirm / })).toHaveLength(7)
    // The dispenser starts empty and RELEASE is not live.
    expect(screen.getByRole('button', { name: 'RELEASE' })).toBeDisabled()
    expect(document.querySelectorAll('[data-light="on"]')).toHaveLength(0)
  })

  it('shows the same Mission display under the SkyWatch theme', async () => {
    await startRun('skywatch')
    showMission()
    expect(screen.getByText('Load Drop Interface')).toBeInTheDocument()
    expect(screen.getByText('Load Drop Dispenser')).toBeInTheDocument()
    expect(screen.getByText('Video Recording Interface')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Confirm / })).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'RELEASE' })).toBeDisabled()
  })

  it('scores a value typed into the ordered field and confirmed', async () => {
    await startRun('cbat')
    showMission()
    await advance(CUT_TUNING.easier.fieldFirstMs + 200)
    const { field, digits, shown } = latestOrder()
    const input = screen.getByLabelText(field.order)
    fireEvent.change(input, { target: { value: digits } })
    fireEvent.click(screen.getByRole('button', { name: `Confirm ${field.order}` }))
    // The commentary column logs the award, and the value stays on the interface.
    expect(screen.getByText(`${field.order} set to ${shown}`)).toBeInTheDocument()
    expect(fmtFieldValue(field, input.value)).toBe(shown)
  })

  it('marks a wrong value as a fault and leaves the order standing', async () => {
    await startRun('cbat')
    showMission()
    await advance(CUT_TUNING.easier.fieldFirstMs + 200)
    const { field, digits } = latestOrder()
    const wrong = digits.replace(/\d$/, d => String((Number(d) + 1) % 10))
    const input = screen.getByLabelText(field.order)
    fireEvent.change(input, { target: { value: wrong } })
    fireEvent.click(screen.getByRole('button', { name: `Confirm ${field.order}` }))
    expect(screen.getByText(`wrong ${field.order}`)).toBeInTheDocument()
    // Still wanted: the right value now scores.
    fireEvent.change(input, { target: { value: digits } })
    fireEvent.click(screen.getByRole('button', { name: `Confirm ${field.order}` }))
    expect(screen.getByText(new RegExp(`^${field.order} set to`))).toBeInTheDocument()
  })

  it('hides the camera order on the Sensor display under the Real CBAT theme', async () => {
    await startRun('cbat')
    fireEvent.click(screen.getAllByRole('button', { name: 'Sensor' })[1])
    await advance(CUT_TUNING.easier.cameraFirstMs[1] + 200)
    // The order (with its time) went to Message; the panel gives nothing away.
    expect(screen.getByText(/^SENSOR: select camera \w+ at \d\d:\d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.queryByText(/order: /)).toBeNull()
  })

  it('records the theme on the submitted score', async () => {
    await startRun('cbat', 'Hard')
    await advance(181_000)
    expect(mockSubmit).toHaveBeenCalledTimes(1)
    const [key, body] = mockSubmit.mock.calls[0]
    expect(key).toBe('cut')
    expect(body.uiTheme).toBe('cbat')
  }, 20_000)

  it('records skywatch on a SkyWatch run', async () => {
    await startRun('skywatch', 'Hard')
    await advance(181_000)
    expect(mockSubmit.mock.calls[0][1].uiTheme).toBe('skywatch')
  }, 20_000)
})

describe('CUT — Real CBAT theme controls', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => vi.useRealTimers())

  // The theme block in main.css styles these classes as the real test's
  // bevelled pills (red at rest, green when selected), grey keys and blue
  // confirm dots. Under SkyWatch the classes match no rule at all.
  it('marks the pill controls and which of them is selected', async () => {
    await startRun('cbat')
    const index = screen.getAllByRole('button', { name: 'Message' })
    expect(index[0].classList.contains('cbat-pill')).toBe(true)
    expect(index[0].dataset.on).toBe('true')          // first stack opens on Message
    expect(screen.getAllByRole('button', { name: 'Engine' })[0].dataset.on).toBe('false')
    // Engine tanks: the feeding tank is the green one.
    const tanks = screen.getAllByRole('button', { name: /^(ON|OFF)$/ })
    expect(tanks.map(b => b.dataset.on)).toEqual(['true', 'false', 'false'])
    tanks.forEach(b => expect(b.classList.contains('cbat-pill')).toBe(true))
    showMission()
    const release = screen.getByRole('button', { name: 'RELEASE' })
    expect(release.classList.contains('cbat-key') && release.classList.contains('cbat-round')).toBe(true)
    screen.getAllByRole('button', { name: /^Confirm / }).forEach(b => expect(b.classList.contains('cbat-confirm')).toBe(true))
  })
})

describe('CUT — Real CBAT theme System display', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => vi.useRealTimers())

  it('brings up Confirm when the code timer reaches zero, and scores the press', async () => {
    await startRun('cbat')
    fireEvent.click(screen.getAllByRole('button', { name: 'System' })[1])
    await advance(CUT_TUNING.easier.firstCodeMs + 200)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    await advance(CUT_TUNING.easier.codeWindowMs)
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    fireEvent.click(confirm)
    expect(screen.getByText('comms button pressed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })

  it('never shows Confirm under the SkyWatch theme', async () => {
    await startRun('skywatch')
    fireEvent.click(screen.getAllByRole('button', { name: 'System' })[1])
    await advance(CUT_TUNING.easier.firstCodeMs + CUT_TUNING.easier.codeWindowMs + 200)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })
})
