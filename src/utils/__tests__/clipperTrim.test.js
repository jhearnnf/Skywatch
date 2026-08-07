import { describe, it, expect } from 'vitest'
import { beatWindow, clampInMs, MIN_BEAT_MS } from '../clipperTrim'

const script = {
  script: {
    beats: [
      { id: 'b1', text: 'Everyone fails the first attempt at this test' },   // 8 words
      { id: 'b2', text: '' },
    ],
  },
  voice: { lines: [{ beatId: 'b1', durationMs: 2400 }] },
}

describe('beatWindow', () => {
  it('uses the measured narration when it exists', () => {
    expect(beatWindow(script, 'b1')).toEqual({ ms: 2400, estimated: false })
  })

  // The estimate is what stops the scrubber being useless before the voice
  // stage — a window of "unknown" would be no window at all.
  it('estimates from word count before narration is recorded', () => {
    const noVoice = { ...script, voice: null }
    // 8 words at 2.6 wps ≈ 3077ms
    expect(beatWindow(noVoice, 'b1')).toEqual({ ms: 3077, estimated: true })
  })

  it('marks an estimate as such so the UI can say so', () => {
    expect(beatWindow({ ...script, voice: null }, 'b1').estimated).toBe(true)
  })

  it('floors at the minimum beat length', () => {
    expect(beatWindow(script, 'b2')).toEqual({ ms: MIN_BEAT_MS, estimated: true })
    expect(beatWindow({ voice: { lines: [{ beatId: 'b1', durationMs: 100 }] } }, 'b1').ms)
      .toBe(MIN_BEAT_MS)
  })

  it('survives an empty or unknown script', () => {
    expect(beatWindow(null, 'b1').ms).toBe(MIN_BEAT_MS)
    expect(beatWindow(script, 'nope').ms).toBe(MIN_BEAT_MS)
  })
})

describe('clampInMs', () => {
  it('leaves a valid in-point alone', () => {
    expect(clampInMs(3000, 10000, 2000)).toBe(3000)
  })

  it('stops the window running off the end of the clip', () => {
    expect(clampInMs(9500, 10000, 2000)).toBe(8000)
  })

  it('pins to zero when the clip is shorter than the beat', () => {
    expect(clampInMs(1200, 1500, 2000)).toBe(0)
  })

  it('rejects negatives and rounds', () => {
    expect(clampInMs(-500, 10000, 2000)).toBe(0)
    expect(clampInMs(1200.6, 10000, 2000)).toBe(1201)
  })

  it('treats a missing clip length as no room to move', () => {
    expect(clampInMs(3000, null, 2000)).toBe(0)
  })
})
