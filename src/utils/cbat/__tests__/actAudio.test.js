import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  CALLSIGNS,
  VOICES,
  ActAudioEngine,
  pickCallsigns,
  isValidDistractor,
  generateDistractorCallsign,
  buildAvoidSequence,
  computeDistractionSegments,
  CODE_VOICE,
  CODE_DIGITS,
  CODE_PREAMBLE,
  CODE_DIGIT_GAP_S,
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

describe('ActAudioEngine memory code', () => {
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

  function makeEngineWithCode() {
    const engine = new ActAudioEngine()
    engine.ctx = makeFakeCtx()
    engine.buffers.set(`${CODE_VOICE}:${CODE_PREAMBLE}`, { duration: 1.2 })
    for (const d of CODE_DIGITS) engine.buffers.set(`${CODE_VOICE}:${d}`, { duration: 0.5 })
    return engine
  }

  it('has no zero — there is no 0.mp3 to read out', () => {
    expect(CODE_DIGITS).toHaveLength(9)
    expect(CODE_DIGITS).not.toContain('0')
  })

  it('plays the preamble then each digit, all from the code namespace', () => {
    const engine = makeEngineWithCode()
    const spy = vi.spyOn(engine.buffers, 'get')

    const result = engine.playCode(['1', '2', '3'])
    expect(result.played).toBe(true)
    // Only the playback pass — the duck's duration lookup reads the same map
    // again afterwards.
    const keys = spy.mock.calls.map(c => c[0]).slice(0, 4)
    expect(keys).toEqual([
      `${CODE_VOICE}:${CODE_PREAMBLE}`,
      `${CODE_VOICE}:1`,
      `${CODE_VOICE}:2`,
      `${CODE_VOICE}:3`,
    ])
  })

  it('is louder than the voice commands by default', () => {
    const engine = makeEngineWithCode()
    expect(engine._volumes.code).toBeGreaterThan(engine._volumes.voiceCommand)
  })

  it('uses the code gain, not the voice-command gain', () => {
    const engine = makeEngineWithCode()
    engine.setVolumes({ volumes: { code: 0.8, voiceCommand: 0.1 } })
    const gains = []
    engine.ctx.createGain = () => {
      const node = { gain: { value: 0 }, connect() {} }
      gains.push(node)
      return node
    }
    engine.playCode(['4'])
    expect(gains[0].gain.value).toBeCloseTo(0.8)
  })

  it('is silenced by its own enabled flag, independently of voice commands', () => {
    const engine = makeEngineWithCode()
    engine.setVolumes({ enabled: { code: false, voiceCommand: true } })
    expect(engine.playCode(['5']).played).toBe(false)

    engine.setVolumes({ enabled: { code: true, voiceCommand: false } })
    expect(engine.playCode(['5']).played).toBe(true)
  })

  it('reports the readout duration from the decoded buffers', () => {
    const engine = makeEngineWithCode()
    // preamble 1.2 + three digits at 0.5, each followed by a 0.04 gap.
    expect(engine.codeDurationS(['1', '2', '3'], { gap: 0.04 })).toBeCloseTo(1.2 + 1.5 + 4 * 0.04)
  })

  it('spaces digits by the wide code gap by default, not the instruction gap', () => {
    const engine = makeEngineWithCode()
    expect(CODE_DIGIT_GAP_S).toBeGreaterThan(0.2)
    expect(engine.codeDurationS(['1', '2', '3'])).toBeCloseTo(1.2 + 1.5 + 4 * CODE_DIGIT_GAP_S)
  })

  it('ducks the static for the length of the readout, then restores it', () => {
    const engine = makeEngineWithCode()
    engine.setVolumes({ volumes: { staticNoise: 0.4 } })
    const ramps = []
    engine._staticNodes = {
      gain: {
        gain: {
          value: 0.4,
          cancelScheduledValues() {},
          setValueAtTime(v, t) { ramps.push(['set', v, t]) },
          linearRampToValueAtTime(v, t) { ramps.push(['ramp', v, t]) },
        },
      },
    }

    engine.playCode(['1', '2', '3'])

    const ducked = ramps.find(r => r[0] === 'ramp' && r[1] < 0.4)
    expect(ducked).toBeDefined()
    expect(ducked[1]).toBeLessThan(0.4 * 0.5)          // meaningfully quieter
    const restore = ramps[ramps.length - 1]
    expect(restore[1]).toBeCloseTo(0.4)                 // back to the configured level
    expect(restore[2]).toBeGreaterThan(engine.codeDurationS(['1', '2', '3']))
  })

  it('leaves the static alone when the code did not play', () => {
    const engine = makeEngineWithCode()
    engine.setVolumes({ enabled: { code: false } })
    const spy = vi.fn()
    engine._staticNodes = {
      gain: { gain: { value: 0.4, cancelScheduledValues: spy, setValueAtTime: spy, linearRampToValueAtTime: spy } },
    }
    engine.playCode(['1'])
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports zero duration when the clips never loaded', () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeFakeCtx()
    expect(engine.codeDurationS(['1', '2', '3'])).toBe(0)
  })
})

describe('ActAudioEngine suspend/resume', () => {
  function makeSuspendableCtx(state = 'running') {
    return {
      state,
      currentTime: 0,
      suspend: vi.fn(function () { this.state = 'suspended'; return Promise.resolve() }),
      resume:  vi.fn(function () { this.state = 'running';   return Promise.resolve() }),
      destination: {},
    }
  }

  it('suspends and resumes the underlying context', () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeSuspendableCtx()

    engine.suspend()
    expect(engine.ctx.suspend).toHaveBeenCalledTimes(1)
    expect(engine.ctx.state).toBe('suspended')

    engine.resume()
    expect(engine.ctx.resume).toHaveBeenCalledTimes(1)
    expect(engine.ctx.state).toBe('running')
  })

  it('is a no-op with no context (audio never initialised)', () => {
    const engine = new ActAudioEngine()
    expect(() => { engine.suspend(); engine.resume() }).not.toThrow()
  })

  it('is a no-op on a closed context (dispose raced the pause)', () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeSuspendableCtx('closed')
    engine.suspend()
    engine.resume()
    expect(engine.ctx.suspend).not.toHaveBeenCalled()
    expect(engine.ctx.resume).not.toHaveBeenCalled()
  })

  it('swallows a rejected suspend/resume promise', async () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeSuspendableCtx()
    engine.ctx.suspend = vi.fn(() => Promise.reject(new Error('nope')))
    engine.ctx.resume  = vi.fn(() => Promise.reject(new Error('nope')))
    engine.suspend()
    engine.resume()
    await Promise.resolve()
    expect(engine.ctx.suspend).toHaveBeenCalled()
  })
})

// ── Safari-shaped failures: suspended contexts, dropped decodes, double init ──
describe('ActAudioEngine ensureRunning', () => {
  function makeCtx(state, { resumeBehaviour = 'resolve' } = {}) {
    const ctx = {
      state,
      currentTime: 0,
      destination: {},
      resume: vi.fn(function () {
        if (resumeBehaviour === 'resolve') { this.state = 'running'; return Promise.resolve() }
        if (resumeBehaviour === 'reject')  return Promise.reject(new Error('not allowed'))
        // 'hang' — Safari outside a gesture: the promise never settles
        return new Promise(() => {})
      }),
    }
    return ctx
  }

  it('resumes a suspended context and reports running', async () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeCtx('suspended')
    await expect(engine.ensureRunning()).resolves.toBe(true)
    expect(engine.ctx.resume).toHaveBeenCalledTimes(1)
    expect(engine.isRunning()).toBe(true)
  })

  it('does not call resume on a context that is already running', async () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeCtx('running')
    await expect(engine.ensureRunning()).resolves.toBe(true)
    expect(engine.ctx.resume).not.toHaveBeenCalled()
  })

  it('reports false when the browser refuses the resume', async () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeCtx('suspended', { resumeBehaviour: 'reject' })
    await expect(engine.ensureRunning()).resolves.toBe(false)
  })

  it('gives up after the timeout when resume() never settles (Safari outside a gesture)', async () => {
    const engine = new ActAudioEngine()
    engine.ctx = makeCtx('suspended', { resumeBehaviour: 'hang' })
    await expect(engine.ensureRunning({ timeoutMs: 10 })).resolves.toBe(false)
  })

  it('is false with no context or a closed one', async () => {
    const engine = new ActAudioEngine()
    await expect(engine.ensureRunning()).resolves.toBe(false)
    engine.ctx = makeCtx('closed')
    await expect(engine.ensureRunning()).resolves.toBe(false)
    expect(engine.ctx.resume).not.toHaveBeenCalled()
  })

  it('init() kicks the context awake in the same call stack as creation', async () => {
    const resume = vi.fn(function () { this.state = 'running'; return Promise.resolve() })
    const decodeAudioData = vi.fn(() => Promise.resolve({ duration: 0.3 }))
    class FakeCtx {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {} }
      resume() { return resume.call(this) }
      decodeAudioData(buf) { return decodeAudioData(buf) }
    }
    vi.stubGlobal('AudioContext', FakeCtx)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) })))
    try {
      const engine = new ActAudioEngine()
      const p = engine.init()
      // resume() must have been called synchronously — before init's first
      // await — so a Safari tap still counts for it.
      expect(resume).toHaveBeenCalledTimes(1)
      await p
      expect(engine.isRunning()).toBe(true)
      expect(engine.loadOk).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('ActAudioEngine clip loading', () => {
  function stubLoadEnvironment({ failUrls = new Set(), failOnce = new Set() } = {}) {
    const attempts = new Map()
    const fetchMock = vi.fn((url) => {
      const n = (attempts.get(url) || 0) + 1
      attempts.set(url, n)
      if (failUrls.has(url) || (failOnce.has(url) && n === 1)) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) })
    })
    vi.stubGlobal('fetch', fetchMock)
    class FakeCtx {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
      resume() { return Promise.resolve() }
      decodeAudioData() { return Promise.resolve({ duration: 0.3 }) }
    }
    vi.stubGlobal('AudioContext', FakeCtx)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    return { attempts }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads every clip and reports loadOk', async () => {
    stubLoadEnvironment()
    const engine = new ActAudioEngine()
    await engine.init()
    expect(engine.missingClips()).toEqual([])
    expect(engine.loadOk).toBe(true)
  })

  it('retries a clip that fails once and still ends up loaded', async () => {
    const url = '/sounds/act/male_alpha.mp3'
    const { attempts } = stubLoadEnvironment({ failOnce: new Set([url]) })
    const engine = new ActAudioEngine()
    await engine.init()
    expect(attempts.get(url)).toBe(2)
    expect(engine.buffers.has('male:alpha')).toBe(true)
    expect(engine.loadOk).toBe(true)
  })

  it('names the clip that never arrived and flags the load as not ok', async () => {
    stubLoadEnvironment({ failUrls: new Set(['/sounds/act/female_bravo.mp3']) })
    const engine = new ActAudioEngine()
    await engine.init()
    expect(engine.missingClips()).toEqual(['female:bravo'])
    expect(engine.loadOk).toBe(false)
  })

  it('a missing chatter file does not make the load not ok', async () => {
    stubLoadEnvironment({ failUrls: new Set(['/sounds/act/distractions_male.mp3']) })
    const engine = new ActAudioEngine()
    await engine.init()
    expect(engine.loadOk).toBe(true)
    expect(engine.distractionBuffers.has('male')).toBe(false)
  })

  it('loadClips() after a failure refetches only the missing clip', async () => {
    const url = '/sounds/act/1.mp3'
    const { attempts } = stubLoadEnvironment({ failUrls: new Set([url]) })
    const engine = new ActAudioEngine()
    await engine.init()
    expect(engine.loadOk).toBe(false)
    const before = new Map(attempts)
    // Let the file come good, then retry.
    globalThis.fetch.mockImplementation(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }))
    await engine.loadClips()
    expect(engine.loadOk).toBe(true)
    // Nothing else was fetched again.
    for (const [u, n] of before) {
      if (u !== url) expect(globalThis.fetch.mock.calls.filter(([c]) => c === u)).toHaveLength(n)
    }
  })

  it('calling init() twice keeps the same context', async () => {
    stubLoadEnvironment()
    const engine = new ActAudioEngine()
    await engine.init()
    const ctx = engine.ctx
    await engine.init()
    expect(engine.ctx).toBe(ctx)
  })

  it('a demo engine reports loadOk with nothing loaded', () => {
    const engine = new ActAudioEngine()
    expect(engine.ctx).toBeNull()
    expect(engine.loadOk).toBe(true)
  })
})
