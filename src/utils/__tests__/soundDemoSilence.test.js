import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { playSound, playFlagBleep } from '../sound'
import { beginDemo, __resetDemoCount } from '../cbat/demoMode'

// The landing page mounts nine real CBAT games at once. Every cue they fire —
// the SkyWatch logo sting on a game start, FLAG's contact bleeps — would play
// over each other on a page nobody expects to make noise, so a demo mount
// silences the shared sound module the same way it silences ACT and SAT.

// `new Audio(...)` needs a real constructor, so this can't be an arrow.
const audioCtor = vi.fn(function FakeAudio() {
  this.volume = 1
  this.addEventListener = vi.fn()
  this.pause = vi.fn()
  this.play = () => Promise.resolve()
})

const oscillator = () => ({
  type: '',
  frequency: { setValueAtTime: vi.fn() },
  connect: (d) => d,
  start: vi.fn(),
  stop: vi.fn(),
})

const audioCtx = {
  state: 'running',
  currentTime: 0,
  resume: () => Promise.resolve(),
  createOscillator: vi.fn(oscillator),
  createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (d) => d })),
  destination: {},
}

describe('sound cues inside a demo mount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetDemoCount()
    localStorage.setItem('skywatch_master_volume', '100')
    window.AudioContext = function () { return audioCtx }
    window.Audio = audioCtor
  })
  afterEach(() => __resetDemoCount())

  it('plays a cue for a real player', async () => {
    await playSound('skywatch_logo')
    expect(audioCtor).toHaveBeenCalled()
  })

  it('stays silent while a demo card is mounted', async () => {
    const end = beginDemo()
    await playSound('skywatch_logo')
    expect(audioCtor).not.toHaveBeenCalled()
    end()
  })

  it('still resolves, so callers awaiting the cue carry on', async () => {
    const end = beginDemo()
    await expect(playSound('skywatch_logo')).resolves.toBeUndefined()
    end()
  })

  it('drops FLAG contact bleeps too', () => {
    const end = beginDemo()
    playFlagBleep('enter')
    expect(audioCtx.createOscillator).not.toHaveBeenCalled()
    end()
  })

  it('comes back once the last demo card unmounts', async () => {
    beginDemo()()
    await playSound('skywatch_logo')
    expect(audioCtor).toHaveBeenCalled()
  })
})
