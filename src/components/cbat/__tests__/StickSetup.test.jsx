import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import StickSetup from '../StickSetup'
import { installMockStick } from '../../../utils/cbat/mockGamepad'
import { loadProfile } from '../../../utils/cbat/gamepad'

// The panel's frame loop is a rAF, so every test has to let frames actually
// happen. jsdom's rAF fires on a timer, hence the real (short) waits.
const frames = async (n = 8) => {
  for (let i = 0; i < n; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  }
}

// Move the mouse, which is what drives the mock stick.
function stickTo(x, y) {
  const half = window.innerHeight / 2
  fireEvent.pointerMove(window, {
    clientX: window.innerWidth / 2 + x * half,
    clientY: window.innerHeight / 2 + y * half,
  })
}

let mock = null

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  if (mock) { mock.dispose(); mock = null }
  delete navigator.getGamepads
  localStorage.clear()
})

describe('StickSetup', () => {
  it('says nothing is detected, and why that might be a lie', async () => {
    navigator.getGamepads = vi.fn(() => [])
    render(<StickSetup />)
    await frames()
    expect(screen.getByText('NOT DETECTED')).toBeInTheDocument()
    // Browsers hide a gamepad until it is used, so "not detected" is very
    // often "not pressed yet" — the copy has to say so.
    expect(screen.getByText(/press a button on the stick/i)).toBeInTheDocument()
  })

  it('shows a detected stick as flying on a guessed mapping', async () => {
    mock = installMockStick()
    render(<StickSetup />)
    await frames()
    expect(screen.getByText('DEFAULT MAPPING')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calibrate' })).toBeInTheDocument()
  })

  it('walks the whole wizard and saves a working profile', async () => {
    mock = installMockStick()
    render(<StickSetup />)
    await frames()

    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
    expect(screen.getByText(/sit centred/i)).toBeInTheDocument()

    const capture = async (x, y) => {
      stickTo(x, y)
      await frames(3)
      fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    }
    await capture(0, 0)
    expect(screen.getByText(/fully RIGHT/i)).toBeInTheDocument()
    await capture(1, 0)
    await capture(-1, 0)
    expect(screen.getByText(/fully FORWARD/i)).toBeInTheDocument()
    await capture(0, -1)
    await capture(0, 1)

    // Both button steps are skippable — not every stick has a spare button,
    // and an unbound one falls back to "any button".
    expect(screen.getByText(/Squeeze the trigger/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    await waitFor(() => expect(screen.getByText('SAVED')).toBeInTheDocument())

    // The profile it learned has to match what the mock actually is: axes at
    // 3 and 4, and a pitch axis that already reads the way the games want it,
    // so calibrating leaves the sign alone rather than reversing the stick.
    const profile = loadProfile('Mock Sidestick (Vendor: dead Product: beef)')
    expect(profile.calibrated).toBe(true)
    expect(profile.x.index).toBe(3)
    expect(profile.y.index).toBe(4)
    expect(profile.y.sign).toBe(1)

    await frames()
    expect(screen.getByText('CALIBRATED')).toBeInTheDocument()
  })

  it('refuses to save a calibration where the stick never moved', async () => {
    mock = installMockStick()
    render(<StickSetup />)
    await frames()
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
    stickTo(0, 0)
    for (let i = 0; i < 5; i++) {
      await frames(2)
      fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.getByText(/No axis moved far enough/i)).toBeInTheDocument())
    expect(screen.queryByText('SAVED')).not.toBeInTheDocument()
  })

  it('can be cancelled part way through without saving anything', async () => {
    mock = installMockStick()
    render(<StickSetup />)
    await frames()
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await frames()
    expect(screen.getByRole('button', { name: 'Calibrate' })).toBeInTheDocument()
    expect(loadProfile('Mock Sidestick (Vendor: dead Product: beef)')).toBe(null)
  })

  it('exposes the raw readout, which is the diagnostic when all else fails', async () => {
    mock = installMockStick()
    render(<StickSetup />)
    await frames()
    expect(screen.getByText('Raw readout')).toBeInTheDocument()
    // The parked throttle on axis 2 should be visible sitting at -1.00.
    expect(screen.getByText(/axes \[/)).toHaveTextContent('-1.00')
  })

  it("renders the game's own sensitivity control in its slot", async () => {
    mock = installMockStick()
    render(<StickSetup><p>Steer rate</p></StickSetup>)
    await frames()
    expect(screen.getByText('Steer rate')).toBeInTheDocument()
  })
})
