import { describe, it, expect } from 'vitest'
import { MOODS, MOOD_LABEL, normaliseMood, deriveMood, moodFor } from '../actorMood'

describe('normaliseMood', () => {
  it('accepts every mood the UI can draw', () => {
    for (const mood of MOODS) {
      expect(normaliseMood(mood)).toBe(mood)
      expect(MOOD_LABEL[mood]).toBeTruthy()
    }
  })

  it('tolerates casing and surrounding whitespace from the model', () => {
    expect(normaliseMood('  Guarded ')).toBe('guarded')
  })

  it('rejects anything not in the list', () => {
    expect(normaliseMood('furious')).toBe(null)
    expect(normaliseMood(undefined)).toBe(null)
    expect(normaliseMood(42)).toBe(null)
  })
})

describe('deriveMood', () => {
  it('reads a deflection as guarded', () => {
    expect(deriveMood('That is a hypothetical I will not entertain.')).toBe('guarded')
  })

  it('reads a warning as grave', () => {
    expect(deriveMood('There would be serious consequences for the region.')).toBe('grave')
  })

  it('reads a hard line as firm', () => {
    expect(deriveMood('These demands are non-negotiable.')).toBe('firm')
  })

  it('falls back to neutral for a plain answer', () => {
    expect(deriveMood('We met in Geneva on the fourteenth.')).toBe('neutral')
  })

  it('handles empty and non-string input', () => {
    expect(deriveMood('')).toBe('neutral')
    expect(deriveMood(null)).toBe('neutral')
  })
})

describe('moodFor', () => {
  it('shows the actor considering the question while one is in flight', () => {
    expect(moodFor({ mood: 'firm', answer: 'anything', isPending: true })).toBe('thinking')
  })

  it('prefers the server-supplied mood over the keyword guess', () => {
    // The text alone would read as guarded; the model said otherwise.
    expect(moodFor({ mood: 'wry', answer: 'I will not entertain that.' })).toBe('wry')
  })

  it('falls back to the text when the server sent no usable mood', () => {
    expect(moodFor({ mood: 'nonsense', answer: 'I will not entertain that.' })).toBe('guarded')
    expect(moodFor({ answer: 'I will not entertain that.' })).toBe('guarded')
  })

  it('returns a drawable mood when called with nothing at all', () => {
    expect(MOODS).toContain(moodFor())
  })
})
