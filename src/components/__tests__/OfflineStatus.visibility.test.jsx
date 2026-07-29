import { describe, it, expect } from 'vitest'
import { canShowSyncStatus } from '../OfflineStatus'

// The hard rule: nothing may be drawn over a CBAT game. These are timed,
// reaction-scored tasks — a pill appearing mid-run corrupts the score. The
// banner used to mount globally at bottom-centre, so anyone with a queued score
// had it sitting on top of every game they played.
//
// It is now narrowed to a single screen, the CBAT menu: the one place a player
// passes between runs, and the only place the pill's own "Sign in" CTA leads
// anywhere useful. An allowlist rather than a blocklist of game routes means a
// route added later is hidden by default and can't start overlaying gameplay.

const playing = { immersive: true }
const idle    = { immersive: false }

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

  it('stays hidden while immersive even on the one allowed route', () => {
    expect(canShowSyncStatus('/cbat', playing)).toBe(false)
  })
})

describe('canShowSyncStatus — the CBAT menu only', () => {
  it('shows on the CBAT menu', () => {
    expect(canShowSyncStatus('/cbat', idle)).toBe(true)
  })

  it('defaults to hidden when no chrome state is passed', () => {
    expect(canShowSyncStatus('/cbat/target')).toBe(false)
  })

  // Previously allowed, deliberately dropped. The landing page and /home are
  // public, so a signed-out visitor there has nothing at stake — every game is
  // behind RequireAuth. The score screen is still inside a game, where a fixed
  // pill costs space at the worst moment.
  it.each([
    '/',
    '/home',
    '/cbat/target/leaderboard',
    '/cbat/plane-turn-2d/leaderboard',
    '/cbat/act/leaderboard/',
  ])('no longer shows on %s', (path) => {
    expect(canShowSyncStatus(path, idle)).toBe(false)
  })

  it('does not show on a score screen — gameOver no longer grants visibility', () => {
    expect(canShowSyncStatus('/cbat/target', { immersive: false, gameOver: true })).toBe(false)
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

  it('does not treat a sub-route as the menu', () => {
    expect(canShowSyncStatus('/cbat/target', idle)).toBe(false)
    expect(canShowSyncStatus('/cbat/', idle)).toBe(false)
  })
})
