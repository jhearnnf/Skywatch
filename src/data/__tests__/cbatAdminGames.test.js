import { describe, it, expect } from 'vitest'
import { CBAT_ADMIN_GAMES, CBAT_GAMES, CBAT_LEADERBOARD_CONFIG, CBAT_DIFFICULTY_BY_KEY } from '../cbatGames'
import { CBAT_GAMES as BACKEND_CBAT_GAMES } from '../../../backend/constants/cbatGames'
import batteryData from '../../../backend/constants/cbatBatteries.json'

// CBAT_ADMIN_GAMES drives the per-game enable/disable rows on the admin Settings
// page. It is derived from the frontend CBAT_GAMES array, NOT from the backend
// registry, so the two can drift — and the failure is silent in both directions:
//
//   • a game missing here has no admin toggle at all, so it can never be turned
//     off without a DB edit
//   • a key here that the backend's CBAT_KNOWN_KEYS does not accept renders a
//     toggle that flips on screen, saves with a 200, and does nothing
//
// Hence checking the frontend list against the real backend registry rather than
// against a hand-copied list of names.

const EASIER_SUFFIX = '-easier'
const backendKeys = Object.keys(BACKEND_CBAT_GAMES)
const hardKeys = backendKeys.filter(k => !k.endsWith(EASIER_SUFFIX))

describe('CBAT_ADMIN_GAMES', () => {
  it('offers a toggle for every non-Easier backend game', () => {
    const adminKeys = new Set(CBAT_ADMIN_GAMES.map(g => g.key))
    for (const key of hardKeys) {
      expect([key, adminKeys.has(key)]).toEqual([key, true])
    }
  })

  it('offers no toggle for an Easier difficulty', () => {
    // The parent game's toggle gates the page — the route is /cbat/sit whichever
    // difficulty is chosen — so a second toggle would imply a control that does
    // not exist.
    for (const g of CBAT_ADMIN_GAMES) {
      expect([g.key, g.key.endsWith(EASIER_SUFFIX)]).toEqual([g.key, false])
    }
  })

  it('points every toggle at a key the backend registry knows', () => {
    for (const g of CBAT_ADMIN_GAMES) {
      expect([g.key, !!BACKEND_CBAT_GAMES[g.key]]).toEqual([g.key, true])
    }
  })

  it('gives every toggle a title and an emoji to render', () => {
    for (const g of CBAT_ADMIN_GAMES) {
      expect([g.key, !!g.title]).toEqual([g.key, true])
      expect([g.key, !!g.emoji]).toEqual([g.key, true])
    }
  })

  it('marks every toggle as implemented — Admin.jsx reads `path` for that', () => {
    // `isImpl = !!game.path` in Admin.jsx. A game without one renders as an
    // unimplemented placeholder row.
    for (const g of CBAT_ADMIN_GAMES) {
      expect([g.key, !!g.path]).toEqual([g.key, true])
    }
  })

  it('covers the five roster-completing tests and SMA specifically', () => {
    const adminKeys = new Set(CBAT_ADMIN_GAMES.map(g => g.key))
    for (const key of ['sit', 'slt', 'vlt', 'matf', 'vigilance', 'sma']) {
      expect([key, adminKeys.has(key)]).toEqual([key, true])
    }
  })
})

// The Aptitude Report renders each test's SkyWatch game with a name, an emoji
// and a "go and play it" link, and it resolves all three out of
// CBAT_LEADERBOARD_CONFIG (see gamePath/gameTitle/gameEmoji in
// src/data/cbatBatteries.js). A test mapped to a game with no entry there still
// SCORES — the backend never touches this file — but the report row that tells
// the user what to practise silently degrades to a bare key and a link back to
// the hub. Nothing else would fail, which is exactly why this is asserted.
describe('Aptitude Report ↔ leaderboard config', () => {
  const mappedGames = [...new Set(Object.values(batteryData.tests).flatMap(t => t.games))]

  it('can name and link every game a battery test is mapped to', () => {
    expect(mappedGames.length).toBeGreaterThan(0)
    for (const gameKey of mappedGames) {
      const cfg = CBAT_LEADERBOARD_CONFIG[gameKey]
      expect([gameKey, !!cfg]).toEqual([gameKey, true])
      expect([gameKey, !!cfg.title]).toEqual([gameKey, true])
      expect([gameKey, !!cfg.emoji]).toEqual([gameKey, true])
      // backPath is the "play it" destination, so a bare '/cbat' would send
      // someone told to practise SMA to the hub to hunt for it. Not derived
      // from the key: trace-1 and trace-2 both live at /cbat/trace, and the two
      // Visualisation modes share /cbat/visualisation.
      expect([gameKey, cfg.backPath?.startsWith('/cbat/')]).toEqual([gameKey, true])
    }
  })

  it('has a stanine anchor for every mapped game, or its runs cannot be scored', () => {
    for (const gameKey of mappedGames) {
      const anchor = batteryData.stanineAnchors[gameKey]
      expect([gameKey, !!anchor]).toEqual([gameKey, true])
      expect([gameKey, anchor.strong > anchor.median]).toEqual([gameKey, true])
    }
  })
})

describe('frontend ↔ backend registry coverage', () => {
  it('has a leaderboard config entry for every backend game, Easier included', () => {
    // Every key gets a board, including the Easier halves — they have their own
    // collections, so they have their own boards even without a hub tile.
    for (const key of backendKeys) {
      expect([key, !!CBAT_LEADERBOARD_CONFIG[key]]).toEqual([key, true])
    }
  })

  it('labels both halves of every split, and neither half of a single-difficulty game', () => {
    for (const key of backendKeys) {
      const hasEasierSibling = !!BACKEND_CBAT_GAMES[`${key}${EASIER_SUFFIX}`]
      const isEasier = key.endsWith(EASIER_SUFFIX)
      const expectLabel = hasEasierSibling || isEasier
      expect([key, !!CBAT_DIFFICULTY_BY_KEY[key]]).toEqual([key, expectLabel])
    }
  })

  it('leaves Vigilance unlabelled — it ships one difficulty on purpose', () => {
    expect(BACKEND_CBAT_GAMES['vigilance-easier']).toBeUndefined()
    expect(CBAT_DIFFICULTY_BY_KEY.vigilance).toBeUndefined()
  })

  it('gives every hub tile a backend key or a documented fan-out', () => {
    // The hub's `plane-turn` and `visualisation` tiles link to combined pages and
    // deliberately have no backend key of their own; CBAT_ADMIN_GAMES expands
    // them. Everything else must map one-to-one.
    const FAN_OUT = new Set(['plane-turn', 'visualisation'])
    for (const g of CBAT_GAMES) {
      if (FAN_OUT.has(g.key)) continue
      expect([g.key, !!BACKEND_CBAT_GAMES[g.key]]).toEqual([g.key, true])
    }
  })
})
