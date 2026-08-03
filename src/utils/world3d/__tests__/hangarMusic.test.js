import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Controlled master volume (0..100) + admin hangar-music setting. The controller
// scales zone volume by both.
let masterVolume = 100
let adminVolume = 1     // 0..1, the admin ceiling
let userVolume = 100    // 0..100, the player's own pause-menu slider
let enabled = true
vi.mock('../../sound', () => ({
  getMasterVolume: () => masterVolume,
  getHangarMusicVolume: () => userVolume,
  getHangarLobbyMusicSetting: () => ({ volume: adminVolume, enabled }),
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

const LOOP = '/sounds/hangar lobby (repeat).mp3'

// Drive document.visibilityState + fire the change event the controller listens for.
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

let updateHangarMusic, _resetHangarMusic, refreshHangarMusicVolume

beforeEach(async () => {
  masterVolume = 100
  adminVolume = 1
  userVolume = 100
  enabled = true
  MockAudio.reset()
  vi.stubGlobal('Audio', MockAudio)
  // Force the controller's synchronous (no-rAF) fade path for determinism.
  vi.stubGlobal('requestAnimationFrame', undefined)
  vi.stubGlobal('cancelAnimationFrame', undefined)
  ;({ updateHangarMusic, _resetHangarMusic, refreshHangarMusicVolume } = await import('../hangarMusic'))
  _resetHangarMusic()
})

afterEach(() => {
  _resetHangarMusic()
  vi.unstubAllGlobals()
  setVisibility('visible')
})

describe('hangar lobby music controller', () => {
  it('loops the single clip straight away — there is no intro clip', () => {
    updateHangarMusic('lobby')

    const loops = MockAudio.ofSrc(LOOP)
    expect(loops).toHaveLength(1)
    expect(loops[0].loop).toBe(true)
    expect(loops[0].play).toHaveBeenCalled()
    expect(loops[0].volume).toBeCloseTo(1.0)
  })

  it('is idempotent — re-declaring the lobby zone does not restart the track', () => {
    updateHangarMusic('lobby')
    updateHangarMusic('lobby')
    expect(MockAudio.ofSrc(LOOP)).toHaveLength(1)
  })

  it('scales by the admin volume and the user master-volume preference', () => {
    adminVolume = 0.5
    masterVolume = 50
    updateHangarMusic('lobby')
    expect(MockAudio.ofSrc(LOOP)[0].volume).toBeCloseTo(0.25) // 1.0 × 0.5 × 0.5
  })

  it('scales by the player\'s own music slider, underneath the admin ceiling', () => {
    adminVolume = 0.5
    userVolume = 50
    updateHangarMusic('lobby')
    expect(MockAudio.ofSrc(LOOP)[0].volume).toBeCloseTo(0.25) // 1.0 × 0.5 admin × 0.5 player
  })

  it('the player can silence the music without touching master volume', () => {
    userVolume = 0
    updateHangarMusic('lobby')
    expect(MockAudio.ofSrc(LOOP)[0].volume).toBe(0)
  })

  it('refreshHangarMusicVolume applies a slider drag to the playing track', () => {
    updateHangarMusic('lobby')
    const loop = MockAudio.ofSrc(LOOP)[0]

    userVolume = 30
    refreshHangarMusicVolume()
    expect(loop.volume).toBeCloseTo(0.3)
  })

  it('plays nothing when the admin has disabled the soundtrack', () => {
    enabled = false
    updateHangarMusic('lobby')
    expect(MockAudio.ofSrc(LOOP)).toHaveLength(0)
  })

  it('stops (pauses) the track on leaving the hangar, and restarts on return', () => {
    updateHangarMusic('lobby')
    const first = MockAudio.ofSrc(LOOP)[0]

    updateHangarMusic(null)
    expect(first.pause).toHaveBeenCalled()

    updateHangarMusic('lobby')
    expect(MockAudio.ofSrc(LOOP)).toHaveLength(2)
    expect(MockAudio.ofSrc(LOOP)[1].play).toHaveBeenCalled()
  })

  it('refreshHangarMusicVolume re-applies a changed master volume mid-playback', () => {
    updateHangarMusic('lobby')
    const loop = MockAudio.ofSrc(LOOP)[0]
    expect(loop.volume).toBeCloseTo(1.0)

    masterVolume = 40
    refreshHangarMusicVolume()
    expect(loop.volume).toBeCloseTo(0.4)
  })

  it('refreshHangarMusicVolume is a no-op when nothing is playing', () => {
    masterVolume = 40
    expect(() => refreshHangarMusicVolume()).not.toThrow()
    expect(MockAudio.instances).toHaveLength(0)
  })

  it('auto-mutes when the page is hidden and resumes the same clip when visible', () => {
    updateHangarMusic('lobby')
    const loop = MockAudio.ofSrc(LOOP)[0]
    expect(loop.play).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    expect(loop.pause).toHaveBeenCalled()

    setVisibility('visible')
    // Resumed the SAME clip — no second Audio element.
    expect(loop.play).toHaveBeenCalledTimes(2)
    expect(MockAudio.ofSrc(LOOP)).toHaveLength(1)
  })
})
