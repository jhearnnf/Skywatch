import { describe, it, expect } from 'vitest'
import { canShowSyncStatus } from '../OfflineStatus'

// The hard rule: nothing may be drawn over a CBAT game. These are timed,
// reaction-scored tasks — a pill appearing mid-run corrupts the score. The
// banner used to mount globally at bottom-centre, so anyone with a queued score
// had it sitting on top of every game they played.
//
// Hence an allowlist rather than a blocklist of game routes: a route added later
// is hidden by default and can't start overlaying gameplay by accident.

const playing   = { immersive: true,  gameOver: false }
const scoreScrn = { immersive: false, gameOver: true }
const idle      = { immersive: false, gameOver: false }

describe('canShowSyncStatus — never during play', () => {
  it.each([
    '/cbat/target',
    '/cbat/act',
    '/cbat/trace',
    '/cbat/dad',
    '/cbat/visualisation',
    '/cbat/numerical-ops',
  ])('stays hidden while playing %s', (path) => {
    expect(canShowSyncStatus(path, playing)).toBe(false)
  })

  it('stays hidden while immersive even on an otherwise-allowed route', () => {
    expect(canShowSyncStatus('/cbat', playing)).toBe(false)
    expect(canShowSyncStatus('/home', playing)).toBe(false)
  })

  it('immersive beats gameOver if both are somehow set', () => {
    expect(canShowSyncStatus('/cbat/target', { immersive: true, gameOver: true })).toBe(false)
  })
})

describe('canShowSyncStatus — allowed screens', () => {
  it('shows on the CBAT menu, home and landing', () => {
    expect(canShowSyncStatus('/cbat', idle)).toBe(true)
    expect(canShowSyncStatus('/home', idle)).toBe(true)
    expect(canShowSyncStatus('/', idle)).toBe(true)
  })

  it('shows on the post-game score screen — they have stopped playing', () => {
    expect(canShowSyncStatus('/cbat/target', scoreScrn)).toBe(true)
  })

  it('shows on a game leaderboard', () => {
    expect(canShowSyncStatus('/cbat/target/leaderboard', idle)).toBe(true)
    expect(canShowSyncStatus('/cbat/plane-turn-2d/leaderboard', idle)).toBe(true)
    expect(canShowSyncStatus('/cbat/act/leaderboard/', idle)).toBe(true)
  })
})

describe('canShowSyncStatus — hidden everywhere else', () => {
  it.each([
    '/profile',
    '/rankings',
    '/play',
    '/case-files',
    '/brief/abc123',
    '/cbat-game-history',
    '/admin',
  ])('stays hidden on %s', (path) => {
    expect(canShowSyncStatus(path, idle)).toBe(false)
  })

  it('does not treat a game route as a leaderboard', () => {
    expect(canShowSyncStatus('/cbat/target', idle)).toBe(false)
    expect(canShowSyncStatus('/cbat/target/leaderboard/extra', idle)).toBe(false)
  })
})
