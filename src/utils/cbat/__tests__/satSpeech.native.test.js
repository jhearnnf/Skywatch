import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The native branch is gated on the `isNative` module constant, so force it true
// and mock the Capacitor plugin. Kept in its own file because the sibling
// satSpeech.test.js exercises the web path with isNative === false (jsdom).
vi.mock('../../isNative', () => ({ isNative: true }))

const speakMock = vi.fn(() => Promise.resolve())
const stopMock = vi.fn(() => Promise.resolve())
const langsMock = vi.fn(() => Promise.resolve({ languages: ['en-GB'] }))
vi.mock('@capacitor-community/text-to-speech', () => ({
  TextToSpeech: { speak: speakMock, stop: stopMock, getSupportedLanguages: langsMock },
}))

let speak, stopSpeech, primeSpeech

beforeEach(async () => {
  speakMock.mockClear()
  stopMock.mockClear()
  langsMock.mockClear()
  vi.resetModules()
  // Ensure a lingering web engine can't be mistaken for the native path.
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  ;({ speak, stopSpeech, primeSpeech } = await import('../satSpeech'))
})

afterEach(() => {
  vi.clearAllMocks()
})

// The plugin loads via dynamic import(); let the microtask queue drain so the
// resolved plugin's method is actually invoked.
const flush = () => new Promise(r => setTimeout(r, 0))

describe('satSpeech (native)', () => {
  it('speaks a radio call through the TTS plugin, in en-GB', async () => {
    speak('Leeds, climb to 20000', true)
    await flush()
    expect(speakMock).toHaveBeenCalledTimes(1)
    expect(speakMock.mock.calls[0][0]).toMatchObject({ text: 'Leeds, climb to 20000', lang: 'en-GB' })
  })

  it('does nothing when muted or when there is no text', async () => {
    speak('Leeds, climb to 20000', false)
    speak('', true)
    await flush()
    expect(speakMock).not.toHaveBeenCalled()
  })

  it('stops native playback', async () => {
    stopSpeech()
    await flush()
    expect(stopMock).toHaveBeenCalledTimes(1)
  })

  it('primeSpeech warms up the engine without uttering anything', async () => {
    // Warming up starts the OS engine's async init early (via a cheap bridge
    // call) so the first radio call doesn't lose the init race — but it must
    // not speak, since there is no gesture-unlock requirement on native.
    primeSpeech()
    await flush()
    expect(speakMock).not.toHaveBeenCalled()
    expect(langsMock).toHaveBeenCalledTimes(1)
  })

  it('retries a rejected call so the opening radio call survives the init race', async () => {
    vi.useFakeTimers()
    try {
      // Engine not ready on the first attempt, ready on the retry.
      speakMock
        .mockImplementationOnce(() => Promise.reject(new Error('Not yet initialized')))
        .mockImplementationOnce(() => Promise.resolve())
      speak('Leeds, climb to 20000', true)
      // Drain the dynamic import + first (rejected) attempt.
      await vi.advanceTimersByTimeAsync(0)
      expect(speakMock).toHaveBeenCalledTimes(1)
      // The retry is scheduled behind a short delay.
      await vi.advanceTimersByTimeAsync(300)
      expect(speakMock).toHaveBeenCalledTimes(2)
      expect(speakMock.mock.calls[1][0]).toMatchObject({ text: 'Leeds, climb to 20000', lang: 'en-GB' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never throws even if the plugin rejects', async () => {
    speakMock.mockImplementation(() => Promise.reject(new Error('no engine')))
    expect(() => { speak('anything', true); stopSpeech() }).not.toThrow()
    await flush()
    speakMock.mockImplementation(() => Promise.resolve())
  })
})
