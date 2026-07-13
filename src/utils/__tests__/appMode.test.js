import { describe, it, expect } from 'vitest'
import { SLIM_APP, isSlimAllowed, slimNavActiveTo, SLIM_NAV_ITEMS } from '../appMode'

describe('appMode', () => {
  it('defaults to full app (not slim) under test/web', () => {
    expect(SLIM_APP).toBe(false)
  })

  it('exposes exactly CBAT + Profile as slim nav items', () => {
    expect(SLIM_NAV_ITEMS.map((i) => i.to)).toEqual(['/cbat', '/profile'])
  })

  describe('isSlimAllowed', () => {
    it('allows login, profile and CBAT surfaces', () => {
      for (const p of [
        '/login',
        '/cbat',
        '/cbat/target',
        '/cbat/dad/leaderboard',
        '/profile',
        '/profile/badge',
        '/cbat-game-history',
        '/airstar-history',
        '/report',
        '/privacy',
      ]) {
        expect(isSlimAllowed(p)).toBe(true)
      }
    })

    it('blocks learning content and other games', () => {
      for (const p of [
        '/',
        '/home',
        '/learn-priority',
        '/play',
        '/play/quiz',
        '/rankings',
        '/case-files',
        '/quiz/abc',
        '/chat',
        '/admin',
        '/intel-brief-history',
      ]) {
        expect(isSlimAllowed(p)).toBe(false)
      }
    })

    it('does not let /cbat swallow /cbat-game-history via prefix', () => {
      // /cbat-game-history is allowed on its own merit, not because it starts
      // with /cbat — guard against a regression to a bare startsWith.
      expect(isSlimAllowed('/cbat-game-history')).toBe(true)
      expect(isSlimAllowed('/cbatxyz')).toBe(false)
    })
  })

  describe('slimNavActiveTo', () => {
    it('highlights profile for profile + history surfaces', () => {
      expect(slimNavActiveTo('/profile')).toBe('/profile')
      expect(slimNavActiveTo('/profile/badge')).toBe('/profile')
      expect(slimNavActiveTo('/airstar-history')).toBe('/profile')
      expect(slimNavActiveTo('/game-history')).toBe('/profile')
    })

    it('highlights CBAT for everything else', () => {
      expect(slimNavActiveTo('/cbat')).toBe('/cbat')
      expect(slimNavActiveTo('/cbat/target')).toBe('/cbat')
      expect(slimNavActiveTo('/cbat-game-history')).toBe('/cbat')
    })
  })
})
