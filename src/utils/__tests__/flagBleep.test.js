import { describe, it, expect, vi, beforeEach } from 'vitest'
import { playFlagBleep } from '../sound'

// A single persistent fake AudioContext. sound.js caches the context module-wide
// after first use, so every test must resolve to the *same* object or later
// assertions would read a stale/uncalled instance.
const freqMock = { setValueAtTime: vi.fn() }
const gainMock = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
const osc = { type: '', frequency: freqMock, connect: (d) => d, start: vi.fn(), stop: vi.fn() }
const gain = { gain: gainMock, connect: (d) => d }
const ctx = {
  state: 'running',
  currentTime: 0,
  resume: () => Promise.resolve(),
  createOscillator: vi.fn(() => osc),
  createGain: vi.fn(() => gain),
  destination: {},
}

describe('playFlagBleep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Plain function (not an arrow) so `new window.AudioContext()` is valid; it
    // returns our single shared fake context.
    window.AudioContext = function () { return ctx }
    localStorage.setItem('skywatch_master_volume', '100')
  })

  it('schedules an oscillator at the higher pitch for the enter cue', async () => {
    playFlagBleep('enter')
    await Promise.resolve(); await Promise.resolve()
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(freqMock.setValueAtTime).toHaveBeenCalledWith(760, 0)
    expect(osc.start).toHaveBeenCalled()
    expect(osc.stop).toHaveBeenCalled()
  })

  it('uses a lower pitch for the exit cue', async () => {
    playFlagBleep('exit')
    await Promise.resolve(); await Promise.resolve()
    expect(freqMock.setValueAtTime).toHaveBeenCalledWith(440, 0)
  })

  it('stays silent at zero master volume', async () => {
    localStorage.setItem('skywatch_master_volume', '0')
    playFlagBleep('enter')
    await Promise.resolve(); await Promise.resolve()
    expect(ctx.createOscillator).not.toHaveBeenCalled()
  })
})
