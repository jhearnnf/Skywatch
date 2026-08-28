/**
 * The Clipper subject table describes real games on real routes, and it lives
 * in the backend so the capture agent and the guardrail validator can both read
 * it. That puts it one directory away from the frontend data it mirrors, which
 * is exactly the arrangement that rots quietly: a renamed route or a retired
 * game would leave Clipper filming a 404, and the first sign of it would be a
 * blank beat in a finished render.
 *
 * So this asserts the mirror, from the side that owns the truth.
 */

import { describe, it, expect } from 'vitest'
import subjectTable from '../../../../backend/constants/clipperSubjects.json'
import { CBAT_GAMES } from '../../../data/cbatGames'

const GAME_SUBJECTS = subjectTable.subjects.filter(s => s.kind === 'game')

describe('the Clipper subject table', () => {
  // Every game, not most of them. A game missing from the table cannot be the
  // subject of a video and has no capture recipe, so it never appears on screen
  // in anything the channel puts out - which is invisible from the Clipper UI,
  // because a video about one of the games that IS listed still looks fine.
  it('can promote every CBAT game the site has', () => {
    const listed = new Set(GAME_SUBJECTS.map(s => s.key))
    const missing = CBAT_GAMES.map(g => g.key).filter(k => !listed.has(k))
    expect(missing).toEqual([])
  })

  it('promotes nothing the site does not have', () => {
    const real = new Set(CBAT_GAMES.map(g => g.key))
    expect(GAME_SUBJECTS.map(s => s.key).filter(k => !real.has(k))).toEqual([])
  })

  it.each(GAME_SUBJECTS.map(s => [s.key, s]))(
    '%s is a game the site actually has',
    (key, subject) => {
      const game = CBAT_GAMES.find(g => g.key === key)
      expect(game).toBeDefined()
      expect(subject.path).toBe(game.path)
    },
  )

  // The spoken name is what the voiceover says and what the validator counts
  // mentions of. It does not have to equal the hub's title - "the Cognitive
  // Updating Test" reads better aloud than "CUT" - but the hub's title has to
  // start with one of the names we know, or a script naming the game the way
  // the site does would not be counted at all.
  //
  // Matched on the start rather than in full because two titles carry their
  // mode list ("Trace 1/2", "Visualisation 2D/3D"), and nobody says that aloud.
  it.each(GAME_SUBJECTS.map(s => [s.key, s]))(
    '%s can be recognised by the name the hub uses',
    (key, subject) => {
      const game = CBAT_GAMES.find(g => g.key === key)
      const known = [subject.spokenName, ...subject.aliases].map(n => n.toLowerCase())
      expect(known.some(n => game.title.toLowerCase().startsWith(n))).toBe(true)
    },
  )
})
