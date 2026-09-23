import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import ThrottleSetup from '../ThrottleSetup'
import { loadThrottleProfile } from '../../../utils/cbat/gamepad'

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
const press = (p, i, down) => { p.buttons[i] = { pressed: down, value: down ? 1 : 0 } }

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

describe('ThrottleSetup', () => {
  it('defaults to the lever, and goes into attract mode with nothing plugged in', async () => {
    const { container } = render(<ThrottleSetup />)
    await frames()
    expect(container.firstChild.dataset.throttleMode).toBe('lever')
    expect(container.firstChild.dataset.throttleReady).toBe('no')
    const headline = container.querySelector('[data-throttle-missing]')
    expect(headline.className).toContain('cbat-stick-attract')
    expect(headline.textContent).toMatch(/no throttle detected/i)
    expect(screen.queryByRole('button', { name: /set up/i })).toBeNull()
  })

  it('learns the lever from two captures and then shows it as detected', async () => {
    const stick = pad('Stick', [0, 0, 1], 12)   // lever parked at idle, reading +1
    pads = [stick]
    const { container } = render(<ThrottleSetup />)
    await frames()
    expect(container.querySelector('[data-throttle-missing]').textContent).toMatch(/no throttle set up/i)
    fireEvent.click(screen.getByRole('button', { name: /set up lever/i }))

    expect(screen.getByText(/lever fully back/i)).toBeInTheDocument()
    await frames(3)
    fireEvent.click(screen.getByRole('button', { name: /capture/i }))

    expect(screen.getByText(/lever fully forward/i)).toBeInTheDocument()
    stick.axes = [0, 0, -1]
    await frames(3)
    fireEvent.click(screen.getByRole('button', { name: /capture/i }))
    await frames()

    const saved = loadThrottleProfile()
    expect(saved.mode).toBe('lever')
    expect(saved.lever).toEqual({ id: 'Stick', axis: { index: 2, idle: 1, full: -1 } })
    expect(container.firstChild.dataset.throttleReady).toBe('yes')
    expect(container.querySelector('[data-throttle-detected]')).toBeInTheDocument()
  })

  it('lets the player override with two buttons, keeping the lever setup', async () => {
    const stick = pad('Stick', [0, 0, 1], 8)
    pads = [stick]
    localStorage.setItem('sw_cbat_throttle', JSON.stringify({
      version: 1, mode: 'lever', lever: { id: 'Stick', axis: { index: 2, idle: 1, full: -1 } }, buttons: null,
    }))
    const { container } = render(<ThrottleSetup />)
    await frames()

    fireEvent.click(container.querySelector('[data-throttle-choice="buttons"]'))
    await frames()
    expect(container.firstChild.dataset.throttleMode).toBe('buttons')
    expect(container.firstChild.dataset.throttleReady).toBe('no')
    fireEvent.click(screen.getByRole('button', { name: /set up buttons/i }))
    await frames(2)

    expect(screen.getByText(/button for faster/i)).toBeInTheDocument()
    press(stick, 3, true)
    await frames(2)
    press(stick, 3, false)
    await frames(2)
    expect(screen.getByText(/button for slower/i)).toBeInTheDocument()
    press(stick, 6, true)
    await frames(3)

    const saved = loadThrottleProfile()
    expect(saved.mode).toBe('buttons')
    expect(saved.buttons).toEqual({ faster: { id: 'Stick', index: 3 }, slower: { id: 'Stick', index: 6 } })
    expect(saved.lever.axis.index).toBe(2)
    expect(container.firstChild.dataset.throttleReady).toBe('yes')

    // Flipping back to the lever finds it still set up.
    fireEvent.click(container.querySelector('[data-throttle-choice="lever"]'))
    await frames()
    expect(container.firstChild.dataset.throttleReady).toBe('yes')
  })
})
