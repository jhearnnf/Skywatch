import { describe, it, expect, vi } from 'vitest'
import { forcedDifficulty, initialDifficulty } from '../difficultyParam'

// `?difficulty=hard` is how the Aptitude Report hands a game the difficulty it
// actually scores. The report's advice is only true if the card that opens has
// Hard selected, so the parse is worth pinning: anything it lets through goes
// straight into a game's difficulty state and picks the board a run is filed on.

describe('forcedDifficulty', () => {
  it('reads either difficulty out of the query string', () => {
    expect(forcedDifficulty('?difficulty=hard')).toBe('hard')
    expect(forcedDifficulty('?difficulty=easier')).toBe('easier')
    expect(forcedDifficulty('difficulty=hard')).toBe('hard')
    expect(forcedDifficulty('?round=2&difficulty=hard')).toBe('hard')
  })

  it('returns null when the parameter is absent', () => {
    expect(forcedDifficulty('')).toBeNull()
    expect(forcedDifficulty('?round=2')).toBeNull()
  })

  // A value that isn't a difficulty must fall through to the stored choice
  // rather than reach a tuning table, where an unknown key would silently take
  // whatever the game's fallback is.
  it('rejects anything that is not one of the two difficulties', () => {
    for (const bad of ['Hard', 'HARD', 'medium', 'easy', '1', 'true', '']) {
      expect(forcedDifficulty(`?difficulty=${bad}`)).toBeNull()
    }
  })
})

describe('initialDifficulty', () => {
  it('prefers the URL over the remembered choice', () => {
    const stored = vi.fn(() => 'easier')
    expect(initialDifficulty(stored, '?difficulty=hard')).toBe('hard')
  })

  it('falls back to the remembered choice when the URL says nothing', () => {
    const stored = vi.fn(() => 'easier')
    expect(initialDifficulty(stored, '')).toBe('easier')
    expect(stored).toHaveBeenCalled()
  })

  // Reads window.location when no search string is passed, which is how every
  // game page calls it — inside a useState initialiser, with no router context.
  it('reads the live URL by default', () => {
    const original = window.location.href
    window.history.replaceState({}, '', '/cbat/sma?difficulty=hard')
    try {
      expect(initialDifficulty(() => 'easier')).toBe('hard')
    } finally {
      window.history.replaceState({}, '', original)
    }
  })
})
