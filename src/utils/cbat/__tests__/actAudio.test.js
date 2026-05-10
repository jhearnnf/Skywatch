import { describe, it, expect, vi } from 'vitest'
import {
  CALLSIGNS,
  VOICES,
  ActAudioEngine,
  pickCallsigns,
  isValidDistractor,
  generateDistractorCallsign,
  buildAvoidSequence,
  computeDistractionSegments,
} from '../actAudio'

describe('CALLSIGNS pool', () => {
  it('has 6 callsigns including hotel', () => {
    expect(CALLSIGNS).toHaveLength(6)
    expect(CALLSIGNS).toContain('hotel')
  })
})

describe('pickCallsigns', () => {
  it('returns the requested count of distinct callsigns', () => {
    for (let i = 0; i < 50; i++) {
      const set = pickCallsigns(3)
      expect(set).toHaveLength(3)
      expect(new Set(set).size).toBe(3)
      for (const c of set) expect(CALLSIGNS).toContain(c)
    }
  })
})

describe('isValidDistractor — 2-callsign rounds', () => {
  const userSet = ['bravo', 'echo']

  it('rejects exact same set in same order', () => {
    expect(isValidDistractor(['bravo', 'echo'], userSet)).toBe(false)
  })

  it('rejects reordered same set', () => {
    expect(isValidDistractor(['echo', 'bravo'], userSet)).toBe(false)
  })

  it('rejects 50% overlap (one matching)', () => {
    expect(isValidDistractor(['bravo', 'alpha'], userSet)).toBe(false)
    expect(isValidDistractor(['echo', 'delta'], userSet)).toBe(false)
  })

  it('accepts 100% different (no overlap)', () => {
    expect(isValidDistractor(['alpha', 'delta'], userSet)).toBe(true)
    expect(isValidDistractor(['charlie', 'hotel'], userSet)).toBe(true)
  })
})

describe('isValidDistractor — 3-callsign rounds', () => {
  const userSet = ['bravo', 'echo', 'charlie']

  it('rejects exact same set', () => {
    expect(isValidDistractor(['bravo', 'echo', 'charlie'], userSet)).toBe(false)
  })

  it('rejects any reordering of same set', () => {
    expect(isValidDistractor(['echo', 'charlie', 'bravo'], userSet)).toBe(false)
    expect(isValidDistractor(['charlie', 'bravo', 'echo'], userSet)).toBe(false)
  })

  it('rejects 2/3 overlap (only 33% different)', () => {
    expect(isValidDistractor(['bravo', 'echo', 'alpha'], userSet)).toBe(false)
  })

  it('accepts 1/3 overlap (66.7% different)', () => {
    expect(isValidDistractor(['bravo', 'alpha', 'delta'], userSet)).toBe(true)
    expect(isValidDistractor(['echo', 'hotel', 'delta'], userSet)).toBe(true)
  })

  it('accepts 0% overlap (100% different)', () => {
    expect(isValidDistractor(['alpha', 'delta', 'hotel'], userSet)).toBe(true)
  })
})

describe('generateDistractorCallsign', () => {
  it('always returns a valid distractor for 2-callsign user sets', () => {
    const userSet = ['bravo', 'echo']
    for (let i = 0; i < 100; i++) {
      const d = generateDistractorCallsign(userSet)
      expect(d).not.toBeNull()
      expect(isValidDistractor(d, userSet)).toBe(true)
    }
  })

  it('always returns a valid distractor for 3-callsign user sets', () => {
    const userSet = ['bravo', 'echo', 'charlie']
    for (let i = 0; i < 100; i++) {
      const d = generateDistractorCallsign(userSet)
      expect(d).not.toBeNull()
      expect(isValidDistractor(d, userSet)).toBe(true)
    }
  })
})

describe('buildAvoidSequence', () => {
  it('builds 2-callsign + combined avoid+shape clip', () => {
    expect(buildAvoidSequence(['bravo', 'echo'], 'circle'))
      .toEqual(['bravo', 'echo', 'avoid_the_next_circle'])
  })

  it('builds 3-callsign + combined avoid+shape clip (square)', () => {
    expect(buildAvoidSequence(['bravo', 'echo', 'hotel'], 'square'))
      .toEqual(['bravo', 'echo', 'hotel', 'avoid_the_next_square'])
  })
})

describe('VOICES', () => {
  it('exposes both male and female variants', () => {
    expect(VOICES).toEqual(expect.arrayContaining(['male', 'female']))
    expect(VOICES).toHaveLength(2)
  })
})

describe('ActAudioEngine voice handling', () => {
  // A fake AudioContext with the minimum surface playSequence touches.
  function makeFakeCtx() {
    let now = 0
    const createBufferSource = () => ({
      buffer: null,
      connect() {},
      start() {},
      stop() {},
      onended: null,
    })
    const createGain = () => ({
      gain: { value: 0 },
      connect() {},
    })
    return {
      get currentTime() { return now },
      _advance(t) { now += t },
      createBufferSource,
      createGain,
      destination: {},
    }
  }

  // Stub buffer for any (voice, name) pair so the loop has something to play.
  const stubBuffer = { duration: 0.3 }

  function makeEngineWithBothVoices() {
    const engine = new ActAudioEngine()
    engine.ctx = makeFakeCtx()
    for (const v of VOICES) {
      engine.buffers.set(`${v}:alpha`, stubBuffer)
      engine.buffers.set(`${v}:bravo`, stubBuffer)
      engine.buffers.set(`${v}:avoid_the_next_circle`, stubBuffer)
    }
    return engine
  }

  it('plays the explicitly requested voice when one is provided', () => {
    const engine = makeEngineWithBothVoices()
    const spy = vi.spyOn(engine.buffers, 'get')

    const result = engine.playSequence(['alpha', 'bravo', 'avoid_the_next_circle'], { voice: 'male' })
    expect(result.played).toBe(true)
    for (const call of spy.mock.calls) {
      expect(call[0].startsWith('male:')).toBe(true)
    }
  })

  it('falls back to a random voice when caller passes an unknown voice', () => {
    const engine = makeEngineWithBothVoices()
    vi.spyOn(engine, '_pickVoice').mockReturnValue('female')
    const spy = vi.spyOn(engine.buffers, 'get')

    engine.playSequence(['alpha'], { voice: 'whisper' })
    expect(spy).toHaveBeenCalledWith('female:alpha')
  })

  it('uses a single voice across the whole sequence', () => {
    const engine = makeEngineWithBothVoices()
    vi.spyOn(engine, '_pickVoice').mockReturnValue('female')
    const spy = vi.spyOn(engine.buffers, 'get')

    engine.playSequence(['alpha', 'bravo', 'avoid_the_next_circle'])
    const prefixes = new Set(spy.mock.calls.map(([k]) => k.split(':')[0]))
    expect(prefixes).toEqual(new Set(['female']))
  })

  it('picks independently per playSequence call so voices vary across instructions', () => {
    const engine = makeEngineWithBothVoices()
    const pickSpy = vi.spyOn(engine, '_pickVoice')
      .mockReturnValueOnce('male')
      .mockReturnValueOnce('female')

    engine.playSequence(['alpha'])
    engine.playSequence(['bravo'])
    expect(pickSpy).toHaveBeenCalledTimes(2)
  })
})

describe('computeDistractionSegments', () => {
  it('returns 10 non-overlapping windows inside the bumpered range', () => {
    const D = 90
    const segs = computeDistractionSegments(D)
    expect(segs).toHaveLength(10)

    let prevEnd = 0
    for (const s of segs) {
      // each window stays within [0.5, D-0.5]
      expect(s.offset).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(s.offset + s.duration).toBeLessThanOrEqual(D - 0.5 + 1e-9)
      // 2–4 s window
      expect(s.duration).toBeGreaterThanOrEqual(2)
      expect(s.duration).toBeLessThanOrEqual(4)
      // monotonic, non-overlapping
      expect(s.offset).toBeGreaterThanOrEqual(prevEnd)
      prevEnd = s.offset + s.duration
    }
  })

  it('returns empty array if total duration is shorter than the bumpers', () => {
    expect(computeDistractionSegments(0.5)).toEqual([])
    expect(computeDistractionSegments(0)).toEqual([])
  })

  it('clamps segment duration when the source file is short', () => {
    // 11s source → usable=10s → 10 chunks of 1s each → segDur clamps to ~0.9s
    const segs = computeDistractionSegments(11)
    expect(segs).toHaveLength(10)
    for (const s of segs) expect(s.duration).toBeLessThanOrEqual(1.0)
  })
})

describe('ActAudioEngine playDistraction', () => {
  function makeFakeCtx() {
    let now = 0
    return {
      get currentTime() { return now },
      _advance(t) { now += t },
      createBufferSource: () => ({
        buffer: null, connect() {}, start() {}, stop() {}, onended: null,
      }),
      createGain: () => ({ gain: { value: 0 }, connect() {} }),
      destination: {},
    }
  }

  function makeEngineWithChatter() {
    const engine = new ActAudioEngine()
    engine.ctx = makeFakeCtx()
    const fakeBuf = { duration: 90 }
    for (const v of VOICES) {
      engine.distractionBuffers.set(v, fakeBuf)
      engine._distractionSegments.set(v, [{ offset: 1, duration: 3 }])
    }
    return engine
  }

  it('plays when the requested voice is idle', () => {
    const engine = makeEngineWithChatter()
    const result = engine.playDistraction({ voice: 'male' })
    expect(result.played).toBe(true)
  })

  it('drops a second play of the same voice while the first is still going', () => {
    const engine = makeEngineWithChatter()
    expect(engine.playDistraction({ voice: 'male' }).played).toBe(true)
    expect(engine.playDistraction({ voice: 'male' }).played).toBe(false)
  })

  it('allows the OTHER voice to play while one voice is busy', () => {
    const engine = makeEngineWithChatter()
    expect(engine.playDistraction({ voice: 'male' }).played).toBe(true)
    expect(engine.playDistraction({ voice: 'female' }).played).toBe(true)
  })

  it('does not consult the instruction-busy gate (chatter overlaps instructions freely)', () => {
    const engine = makeEngineWithChatter()
    engine._instructionPlayingUntil = engine.ctx.currentTime + 99   // long instruction in progress
    const result = engine.playDistraction({ voice: 'male' })
    expect(result.played).toBe(true)
  })

  it('rejects an unknown voice', () => {
    const engine = makeEngineWithChatter()
    expect(engine.playDistraction({ voice: 'whisper' }).played).toBe(false)
    expect(engine.playDistraction({}).played).toBe(false)
  })

  it('lets a voice play again once its busy window has elapsed', () => {
    const engine = makeEngineWithChatter()
    expect(engine.playDistraction({ voice: 'male' }).played).toBe(true)
    engine.ctx._advance(10)   // well past the 3s segment
    expect(engine.playDistraction({ voice: 'male' }).played).toBe(true)
  })

  it('stopAll resets per-voice busy windows so the round end frees the gate', () => {
    const engine = makeEngineWithChatter()
    engine.playDistraction({ voice: 'male' })
    engine.stopAll()
    expect(engine.playDistraction({ voice: 'male' }).played).toBe(true)
  })
})
