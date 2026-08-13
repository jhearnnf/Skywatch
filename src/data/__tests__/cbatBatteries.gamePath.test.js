/**
 * Where the Aptitude Report's links send you.
 *
 * The report scores Hard runs and nothing else, so a link off it that lands on a
 * card remembering Easier is worse than no link: the user plays the game they
 * were told to play and the score they clicked to raise does not move. Every
 * split game's link therefore carries ?difficulty=hard, and every unsplit one
 * must not — there is no difficulty to force, and the game would be parsing a
 * parameter it has no state for.
 */

import { describe, it, expect } from 'vitest'
import { gamePath, gameHasDifficulties } from '../cbatBatteries'
import { CBAT_LEADERBOARD_CONFIG, CBAT_DIFFICULTY_GROUPS } from '../cbatGames'
import { forcedDifficulty } from '../../utils/cbat/difficultyParam'

// The Hard key of every split game — the keys the report actually reads.
const HARD_KEYS = Object.values(CBAT_DIFFICULTY_GROUPS).map(pills => pills.find(p => p.label === 'Hard').gameKey)

describe('gameHasDifficulties', () => {
  it('is true for every split game and false for the rest', () => {
    expect(HARD_KEYS.length).toBeGreaterThan(0)
    for (const key of HARD_KEYS) expect(gameHasDifficulties(key)).toBe(true)

    for (const key of Object.keys(CBAT_LEADERBOARD_CONFIG)) {
      if (CBAT_LEADERBOARD_CONFIG[key].difficultyGroup) continue
      expect(gameHasDifficulties(key)).toBe(false)
    }
  })

  // Vigilance ships one difficulty on purpose, so nothing on the report may tell
  // a player to go and find a Hard button on its card.
  it('is false for Vigilance', () => {
    expect(gameHasDifficulties('vigilance')).toBe(false)
  })
})

describe('gamePath', () => {
  it('asks for Hard on every game that has a difficulty to choose', () => {
    for (const key of HARD_KEYS) {
      const path = gamePath(key)
      expect(path).toBe(`${CBAT_LEADERBOARD_CONFIG[key].backPath}?difficulty=hard`)
      // The same parse the game page runs on arrival, so the link and the reader
      // can't disagree about what was asked for.
      expect(forcedDifficulty(new URL(path, 'https://x').search)).toBe('hard')
    }
  })

  it('leaves a game with no split alone', () => {
    expect(gamePath('target')).toBe('/cbat/target')
    expect(gamePath('vigilance')).toBe('/cbat/vigilance')
  })

  it('falls back to the games hub for a key with no board', () => {
    expect(gamePath('not-a-game')).toBe('/cbat')
  })
})
