import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Controlled master volume (0..100) + admin menu-music setting. The controller
// scales zone volume by both.
let masterVolume = 100
let menuAdminVolume = 1   // 0..1
let menuEnabled = true
vi.mock('../../sound', () => ({
  getMasterVolume: () => masterVolume,
  getCbatMenuMusicSetting: () => ({ volume: menuAdminVolume, enabled: menuEnabled }),
}))

// ── Minimal <audio> stand-in ────────────────────────────────────────────────
class MockAudio {
  constructor(src) {
    this.src = src
    this.volume = 1
    this.loop = false
    this.paused = false
    this._listeners = {}
    this.play = vi.fn(() => Promise.resolve())
    this.pause = vi.fn(() => { this.paused = true })
    MockAudio.instances.push(this)
  }
  addEventListener(ev, cb) { (this._listeners[ev] ||= []).push(cb) }
  removeEventListener(ev, cb) {
    this._listeners[ev] = (this._listeners[ev] || []).filter(f => f !== cb)
  }
  fire(ev) { (this._listeners[ev] || []).slice().forEach(cb => cb()) }
  static instances = []
  static reset() { MockAudio.instances = [] }
  static ofSrc(src) { return MockAudio.instances.filter(a => a.src === src) }
}

const START  = '/sounds/cbat menu (start).mp3'
const REPEAT = '/sounds/cbat menu (repeat).mp3'

// Drive document.visibilityState + fire the change event the controller listens for.
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

let updateCbatMusic, _resetCbatMusic

beforeEach(async () => {
  masterVolume = 100
  menuAdminVolume = 1
  menuEnabled = true
  MockAudio.reset()
  vi.stubGlobal('Audio', MockAudio)
  // Force the controller's synchronous (no-rAF) fade path for determinism.
  vi.stubGlobal('requestAnimationFrame', undefined)
  vi.stubGlobal('cancelAnimationFrame', undefined)
  ;({ updateCbatMusic, _resetCbatMusic } = await import('../menuMusic'))
  _resetCbatMusic()
})

afterEach(() => {
  _resetCbatMusic()
  vi.unstubAllGlobals()
  setVisibility('visible')
})

describe('cbat menu music controller', () => {
  it('plays the start clip once at menu (100%) volume, then loops the repeat clip', () => {
    updateCbatMusic('menu')

    const starts = MockAudio.ofSrc(START)
    expect(starts).toHaveLength(1)
    expect(starts[0].play).toHaveBeenCalled()
    expect(starts[0].volume).toBeCloseTo(1.0)
    expect(MockAudio.ofSrc(REPEAT)).toHaveLength(0)

    // Intro ends → repeat clip loops at the same volume.
    starts[0].fire('ended')
    const repeats = MockAudio.ofSrc(REPEAT)
    expect(repeats).toHaveLength(1)
    expect(repeats[0].loop).toBe(true)
    expect(repeats[0].play).toHaveBeenCalled()
    expect(repeats[0].volume).toBeCloseTo(1.0)
  })

  it('instructions zone plays at 25% volume', () => {
    updateCbatMusic('instructions')
    const starts = MockAudio.ofSrc(START)
    expect(starts[0].volume).toBeCloseTo(0.25)
  })

  it('menu → instructions cross-fades volume without restarting the track', () => {
    updateCbatMusic('menu')
    const start = MockAudio.ofSrc(START)[0]
    expect(start.volume).toBeCloseTo(1.0)

    updateCbatMusic('instructions')
    // Same audio element, lowered — no second start clip created.
    expect(MockAudio.ofSrc(START)).toHaveLength(1)
    expect(start.volume).toBeCloseTo(0.25)
  })

  it('scales zone volume by the user master-volume preference', () => {
    masterVolume = 50
    updateCbatMusic('menu')
    expect(MockAudio.ofSrc(START)[0].volume).toBeCloseTo(0.5)
  })

  it('stops (pauses) the track when leaving the CBAT zones', () => {
    updateCbatMusic('menu')
    const start = MockAudio.ofSrc(START)[0]
    start.fire('ended')
    const repeat = MockAudio.ofSrc(REPEAT)[0]

    updateCbatMusic(null)
    expect(repeat.pause).toHaveBeenCalled()
  })

  it('restarts the start+repeat sequence after returning from a game', () => {
    updateCbatMusic('menu')
    MockAudio.ofSrc(START)[0].fire('ended')
    updateCbatMusic(null)                 // entered a game — stopped
    expect(MockAudio.ofSrc(START)).toHaveLength(1)

    updateCbatMusic('instructions')       // back on instructions — fresh sequence
    expect(MockAudio.ofSrc(START)).toHaveLength(2)
    expect(MockAudio.ofSrc(START)[1].volume).toBeCloseTo(0.25)
  })

  it('scales by the admin menu-music volume, combined with master volume', () => {
    menuAdminVolume = 0.5
    updateCbatMusic('menu')
    expect(MockAudio.ofSrc(START)[0].volume).toBeCloseTo(0.5)  // 1.0 zone × 0.5 admin

    _resetCbatMusic()
    MockAudio.reset()
    menuAdminVolume = 0.5
    masterVolume = 50
    updateCbatMusic('menu')
    expect(MockAudio.ofSrc(START)[0].volume).toBeCloseTo(0.25) // 1.0 × 0.5 × 0.5
  })

  it('plays nothing when the admin has disabled the soundtrack', () => {
    menuEnabled = false
    updateCbatMusic('menu')
    expect(MockAudio.ofSrc(START)).toHaveLength(0)
  })

  it('auto-mutes when the page is hidden and resumes the same clip when visible', () => {
    updateCbatMusic('menu')
    MockAudio.ofSrc(START)[0].fire('ended')
    const repeat = MockAudio.ofSrc(REPEAT)[0]
    expect(repeat.play).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    expect(repeat.pause).toHaveBeenCalled()

    setVisibility('visible')
    // Resumed the SAME looping clip — no new start clip, play() called again.
    expect(repeat.play).toHaveBeenCalledTimes(2)
    expect(MockAudio.ofSrc(START)).toHaveLength(1)
    expect(MockAudio.ofSrc(REPEAT)).toHaveLength(1)
  })
})
