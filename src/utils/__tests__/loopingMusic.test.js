import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createLoopingMusic } from '../loopingMusic'

// Every Audio the module constructs, so a leaked one is visible to the test.
const built = []

class FakeAudio {
  constructor(src) {
    this.src = src
    this.volume = 0
    this.loop = false
    this.currentTime = 0
    this.paused = true
    this.playCount = 0
    built.push(this)
  }
  play() { this.paused = false; this.playCount += 1; return undefined }
  pause() { this.paused = true }
  addEventListener() {}
  removeEventListener() {}
}

// Fades are driven by requestAnimationFrame. Holding the frames lets a test sit
// inside a fade, which is exactly the window the bug lived in.
//
// cancelAnimationFrame must genuinely drop the frame: with a no-op stub the
// cancelled callback still ran on flush, which quietly hid the very bug these
// tests exist to catch.
let frames = new Map()
let nextFrameId = 0
const queueFrame = (fn) => { frames.set(++nextFrameId, fn); return nextFrameId }
const dropFrame  = (id) => { frames.delete(id) }
const runFrames = (advanceMs) => {
  const queued = [...frames.values()]
  frames.clear()
  for (const fn of queued) fn(performance.now() + advanceMs)
}
// Advance a fade PART of the way (FADE_MS is 700). This matters: a fade still
// sitting at gain 0 makes the stop's fade-to-0 a no-op that runs its callback
// synchronously, which hides the bug entirely.
const stepFrames = () => runFrames(200)
const flushFrames = () => runFrames(10_000)

const makeMusic = () => createLoopingMusic({
  repeatSrc: '/sounds/test (repeat).mp3',
  zoneVolumes: { on: 1 },
  getSetting: () => ({ volume: 1, enabled: true }),
  getMasterVolume: () => 100,
})

beforeEach(() => {
  built.length = 0
  frames.clear()
  nextFrameId = 0
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('requestAnimationFrame', queueFrame)
  vi.stubGlobal('cancelAnimationFrame', dropFrame)
})
afterEach(() => { vi.unstubAllGlobals() })

const playing = () => built.filter(a => !a.paused)

describe('createLoopingMusic', () => {
  it('plays one clip in an on-zone', () => {
    const music = makeMusic()
    music.update('on')
    expect(playing()).toHaveLength(1)
  })

  it('does not restart on a repeated call with the same zone', () => {
    const music = makeMusic()
    music.update('on')
    music.update('on')
    music.update('on')
    expect(built).toHaveLength(1)
    expect(built[0].playCount).toBe(1)
  })

  it('stops when the zone goes null', () => {
    const music = makeMusic()
    music.update('on')
    music.update(null)
    flushFrames()               // let the fade-out finish
    expect(playing()).toHaveLength(0)
  })

  it('never leaves two clips playing when restarted mid-fade', () => {
    // The bug: stopSequence paused its clips from a fade callback, and the next
    // fadeTo cancelled that callback. The first element was never paused and no
    // longer referenced, so it looped forever and every visit stacked another.
    const music = makeMusic()
    music.update('on')
    stepFrames()                // fade-in partway, so the fade-out is a real fade
    music.update(null)          // fade-out begins, deliberately NOT completed
    music.update('on')          // restart inside the fade window

    flushFrames()
    expect(playing()).toHaveLength(1)
  })

  it('leaves nothing playing after repeated fast toggles', () => {
    // What navigating in and out of Community actually does, plus React's
    // double-invoked effects in development.
    const music = makeMusic()
    for (let i = 0; i < 5; i += 1) {
      music.update('on')
      stepFrames()
      music.update(null)
    }
    flushFrames()

    expect(playing()).toHaveLength(0)
    expect(built.length).toBeGreaterThan(1)   // it really did restart each time
  })

  it('stops every clip it ever built when finally silenced', () => {
    const music = makeMusic()
    music.update('on'); stepFrames(); music.update(null)
    music.update('on'); stepFrames(); music.update(null)
    music.update('on'); stepFrames()
    flushFrames()
    music.update(null)
    flushFrames()

    expect(built.every(a => a.paused)).toBe(true)
  })

  it('stays silent while the admin has it disabled', () => {
    const music = createLoopingMusic({
      repeatSrc: '/sounds/test (repeat).mp3',
      zoneVolumes: { on: 1 },
      getSetting: () => ({ volume: 1, enabled: false }),
      getMasterVolume: () => 100,
    })
    music.update('on')
    expect(playing()).toHaveLength(0)
  })
})
