/**
 * Game names that spell out the difficulty.
 *
 * A split game keeps two leaderboard keys with two separate boards, so a name
 * that qualifies only one of them ("FLAG (Easier)" beside a bare "FLAG") reads
 * as ambiguous rather than as Hard. Every surface that shows a single game name
 * — the post-game award, the admin progress chart, the landing progress wall,
 * the leaderboard's page title — goes through cbatTitleWithDifficulty().
 *
 * Mirrors backend/__tests__/unit/cbatLabelWithDifficulty.test.js. The two are
 * deliberately separate: the backend names sessions and medals from its own
 * registry, and the frontend names boards from CBAT_LEADERBOARD_CONFIG, so
 * either could drift on its own.
 */

import { describe, it, expect } from 'vitest'
import {
  CBAT_LEADERBOARD_CONFIG,
  CBAT_DIFFICULTY_GROUPS,
  CBAT_DIFFICULTY_BY_KEY,
  cbatTitleWithDifficulty,
} from '../cbatGames'

const SPLIT_KEYS = Object.keys(CBAT_DIFFICULTY_BY_KEY)

describe('CBAT_DIFFICULTY_BY_KEY', () => {
  it('covers every key in every difficulty group', () => {
    expect(SPLIT_KEYS.length).toBeGreaterThan(0)
    for (const pills of Object.values(CBAT_DIFFICULTY_GROUPS)) {
      for (const pill of pills) {
        expect(CBAT_DIFFICULTY_BY_KEY[pill.gameKey]).toBe(pill.label)
      }
    }
  })

  it('only ever says Easier or Hard', () => {
    for (const label of Object.values(CBAT_DIFFICULTY_BY_KEY)) {
      expect(['Easier', 'Hard']).toContain(label)
    }
  })

  it('marks no game that has no split', () => {
    for (const key of Object.keys(CBAT_LEADERBOARD_CONFIG)) {
      if (CBAT_LEADERBOARD_CONFIG[key].difficultyGroup) continue
      expect(CBAT_DIFFICULTY_BY_KEY[key]).toBeUndefined()
    }
  })
})

describe('cbatTitleWithDifficulty', () => {
  it('names both halves of every split game', () => {
    for (const [group, pills] of Object.entries(CBAT_DIFFICULTY_GROUPS)) {
      for (const pill of pills) {
        const base = CBAT_LEADERBOARD_CONFIG[pill.gameKey]?.title
        expect(base, `${group}: no board config for "${pill.gameKey}"`).toBeTruthy()
        expect(cbatTitleWithDifficulty(pill.gameKey)).toBe(`${base} (${pill.label})`)
      }
    }
  })

  it('names FLAG both ways', () => {
    expect(cbatTitleWithDifficulty('flag')).toBe('FLAG (Hard)')
    expect(cbatTitleWithDifficulty('flag-easier')).toBe('FLAG (Easier)')
  })

  it('leaves a game with no split unqualified', () => {
    expect(cbatTitleWithDifficulty('target')).toBe('Target')
    for (const [key, cfg] of Object.entries(CBAT_LEADERBOARD_CONFIG)) {
      if (cfg.difficultyGroup) continue
      expect(cbatTitleWithDifficulty(key)).toBe(cfg.title)
    }
  })

  it('suffixes a caller-supplied base title rather than the config one', () => {
    expect(cbatTitleWithDifficulty('cut', 'CUT')).toBe('CUT (Hard)')
    expect(cbatTitleWithDifficulty('target', 'Target Practice')).toBe('Target Practice')
  })

  it('falls back to the key for a game it does not know', () => {
    expect(cbatTitleWithDifficulty('not-a-game')).toBe('not-a-game')
  })
})
