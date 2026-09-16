import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import PedalSetup from '../PedalSetup'
import { loadPedalProfile, savePedalProfile, PEDAL_PROFILE_VERSION } from '../../../utils/cbat/gamepad'

// The panel's frame loop is a rAF, so every test has to let frames actually
// happen. jsdom's rAF fires on a timer, hence the real (short) waits.
const frames = async (n = 8) => {
  for (let i = 0; i < n; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  }
}

function pad(id, axes, buttons = 0) {
  return {
    id, connected: true, axes,
    buttons: Array.from({ length: buttons }, () => ({ pressed: false, value: 0 })),
  }
}

let pads = []
beforeEach(() => {
  localStorage.clear()
  navigator.getGamepads = () => pads
})
afterEach(() => {
  delete navigator.getGamepads
  localStorage.clear()
  pads = []
})

describe('PedalSetup', () => {
  it('goes into attract mode while nothing is plugged in, and says how to wake a device', async () => {
    const { container } = render(<PedalSetup />)
    await frames()
    expect(container.firstChild.dataset.pedalsConnected).toBe('no')
    expect(container.firstChild.className).toContain('cbat-arcade-idle')
    const headline = container.querySelector('[data-pedals-missing]')
    expect(headline).toBeInTheDocument()
    // The same hard stepped amber blink as the joystick cabinet's.
    expect(headline.className).toContain('cbat-stick-attract')
    expect(headline.textContent).toMatch(/no pedals detected/i)
    expect(screen.getByText(/press a pedal all the way down/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /calibrate/i })).toBeNull()
  })

  it('offers calibration once any device is present, and learns the pedals from it', async () => {
    const stick = pad('Sidestick', [0, 0], 12)
    const pedals = pad('Pedals', [0, 0, 0])
    pads = [stick, pedals]
    const { container } = render(<PedalSetup />)
    await frames()
    expect(container.firstChild.dataset.pedalsConnected).toBe('no')
    fireEvent.click(screen.getByRole('button', { name: /calibrate pedals/i }))

    // Rest.
    expect(screen.getByText(/rest your feet/i)).toBeInTheDocument()
    await frames(3)
    fireEvent.click(screen.getByRole('button', { name: /capture/i }))

    // Right pedal forward: negative on this driver.
    expect(screen.getByText(/right pedal/i)).toBeInTheDocument()
    pedals.axes = [0, 0, -0.9]
    await frames(3)
    fireEvent.click(screen.getByRole('button', { name: /capture/i }))

    // Left.
    expect(screen.getByText(/left pedal/i)).toBeInTheDocument()
    pedals.axes = [0, 0, 0.9]
    await frames(3)
    fireEvent.click(screen.getByRole('button', { name: /capture/i }))

    const stored = loadPedalProfile('Pedals')
    expect(stored).toBeTruthy()
    expect(stored.axis.index).toBe(2)
    expect(stored.axis.sign).toBe(-1)
    expect(loadPedalProfile('Sidestick')).toBeNull()

    await frames()
    expect(container.firstChild.dataset.pedalsConnected).toBe('yes')
    const banner = container.querySelector('[data-pedals-detected]')
    expect(banner.textContent).toMatch(/pedals detected!/i)
    // The same slow pulse as JOYSTICK DETECTED!, not the attract blink.
    expect(banner.className).toContain('cbat-stick-detected')
    expect(screen.getByText('SAVED')).toBeInTheDocument()
  })

  it('reports a calibration where nothing moved, and keeps nothing', async () => {
    pads = [pad('Pedals', [0, 0, 0])]
    render(<PedalSetup />)
    await frames()
    fireEvent.click(screen.getByRole('button', { name: /calibrate pedals/i }))
    for (let i = 0; i < 3; i++) {
      await frames(2)
      fireEvent.click(screen.getByRole('button', { name: /capture/i }))
    }
    expect(screen.getByText(/no axis moved far enough/i)).toBeInTheDocument()
    expect(loadPedalProfile('Pedals')).toBeNull()
  })

  it('forgets a calibrated set', async () => {
    savePedalProfile({
      id: 'Pedals', version: PEDAL_PROFILE_VERSION, calibrated: true,
      axis: { index: 2, centre: 0, min: -1, max: 1, sign: 1 },
    })
    pads = [pad('Pedals', [0, 0, 0])]
    const { container } = render(<PedalSetup />)
    await frames()
    expect(container.firstChild.dataset.pedalsConnected).toBe('yes')
    fireEvent.click(screen.getByRole('button', { name: /forget/i }))
    await frames()
    expect(loadPedalProfile('Pedals')).toBeNull()
    expect(container.firstChild.dataset.pedalsConnected).toBe('no')
  })
})
