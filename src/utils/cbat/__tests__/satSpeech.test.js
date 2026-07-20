import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { speak, stopSpeech, primeSpeech, _resetSpeech } from '../satSpeech'

function makeSynth(voices = []) {
  const listeners = {}
  return {
    spoken: [],
    cancelled: 0,
    getVoices: () => voices,
    speak(u) { this.spoken.push(u) },
    cancel() { this.cancelled += 1 },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn) },
    emit(type) { (listeners[type] || []).slice().forEach(fn => fn()) },
    listenerCount(type) { return (listeners[type] || []).length },
  }
}

let synth

beforeEach(() => {
  vi.useFakeTimers()
  synth = makeSynth([{ lang: 'en-GB', name: 'GB' }, { lang: 'en-US', name: 'US' }])
  window.speechSynthesis = synth
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.volume = 1 }
  _resetSpeech()
})

afterEach(() => {
  vi.useRealTimers()
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
})

describe('primeSpeech', () => {
  it('speaks a silent utterance once so iOS unlocks playback', () => {
    primeSpeech()
    primeSpeech()
    expect(synth.spoken).toHaveLength(1)
    expect(synth.spoken[0].volume).toBe(0)
  })
})

describe('speak', () => {
  it('does nothing when muted or when there is no text', () => {
    speak('Leeds, climb to 20000', false)
    speak('', true)
    expect(synth.spoken).toHaveLength(0)
  })

  it('speaks immediately when voices are already loaded', () => {
    speak('Leeds, climb to 20000', true)
    expect(synth.spoken.map(u => u.text)).toEqual(['Leeds, climb to 20000'])
  })

  it('prefers an English voice', () => {
    speak('York, switch to channel four', true)
    expect(synth.spoken[0].voice.name).toBe('GB')
    expect(synth.spoken[0].lang).toBe('en-GB')
  })

  it('waits for voiceschanged when voices are not loaded yet (Android Chrome)', () => {
    synth = makeSynth([])
    window.speechSynthesis = synth
    speak('Hull, hold at waypoint two', true)
    expect(synth.spoken).toHaveLength(0)

    synth.getVoices = () => [{ lang: 'en-GB', name: 'GB' }]
    synth.emit('voiceschanged')
    expect(synth.spoken.map(u => u.text)).toEqual(['Hull, hold at waypoint two'])
    expect(synth.listenerCount('voiceschanged')).toBe(0)
  })

  it('falls back to speaking if voiceschanged never fires', () => {
    synth = makeSynth([])
    window.speechSynthesis = synth
    speak('Hull, hold at waypoint two', true)
    expect(synth.spoken).toHaveLength(0)

    vi.advanceTimersByTime(600)
    expect(synth.spoken).toHaveLength(1)

    // The fallback must not double up with a late voiceschanged event.
    synth.emit('voiceschanged')
    expect(synth.spoken).toHaveLength(1)
  })

  it('does not throw when speech synthesis is unavailable', () => {
    delete window.speechSynthesis
    expect(() => { primeSpeech(); speak('anything', true); stopSpeech() }).not.toThrow()
  })
})

describe('stopSpeech', () => {
  it('cancels playback and drops any queued utterance', () => {
    synth = makeSynth([])
    window.speechSynthesis = synth
    speak('Leeds, climb to 20000', true)
    stopSpeech()

    expect(synth.cancelled).toBe(1)
    expect(synth.listenerCount('voiceschanged')).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(synth.spoken).toHaveLength(0)
  })
})
