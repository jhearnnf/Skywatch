import { describe, it, expect } from 'vitest'
import { SLIM_APP, NATIVE_APP, isSlimAllowed, slimNavActiveTo, SLIM_NAV_ITEMS, HANGAR_NAV_ITEM } from '../appMode'

describe('appMode', () => {
  it('defaults to full app (not slim) under test/web', () => {
    expect(SLIM_APP).toBe(false)
  })

  it('reports web (not native) under test', () => {
    // Chat visibility hangs off this, so a regression here would silently ship
    // user-to-user messaging into the store build.
    expect(NATIVE_APP).toBe(false)
  })

  it('exposes exactly CBAT + Profile as slim nav items', () => {
    // Hangar is deliberately NOT in here — it is settings-driven, so the nav
    // components append HANGAR_NAV_ITEM themselves when the toggle is on.
    expect(SLIM_NAV_ITEMS.map((i) => i.to)).toEqual(['/cbat', '/profile'])
  })

  it('exposes the Hangar nav item separately from the mode-driven lists', () => {
    expect(HANGAR_NAV_ITEM.to).toBe('/immerse')
    expect(SLIM_NAV_ITEMS).not.toContain(HANGAR_NAV_ITEM)
  })

  describe('isSlimAllowed', () => {
    it('allows login, profile and CBAT surfaces', () => {
      for (const p of [
        '/',
        '/login',
        '/cbat',
        '/cbat/target',
        '/cbat/dad/leaderboard',
        '/profile',
        '/profile/badge',
        '/cbat-game-history',
        '/airstar-history',
        '/report',
        '/share',
        '/privacy',
        '/delete-account',
        '/admin',
        '/admin/openrouter-usage',
      ]) {
        expect(isSlimAllowed(p)).toBe(true)
      }
    })

    it('allows the Hangar game, the one non-CBAT game slim mode keeps', () => {
      // Allow-listed unconditionally — hangarGameEnabled is checked in
      // World3DRoute, not here, since this is a pure pathname function.
      expect(isSlimAllowed('/immerse')).toBe(true)
    })

    it('blocks learning content and other games', () => {
      for (const p of [
        '/home',
        '/learn-priority',
        '/play',
        '/play/quiz',
        '/rankings',
        '/case-files',
        '/quiz/abc',
        '/intel-brief-history',
      ]) {
        expect(isSlimAllowed(p)).toBe(false)
      }
    })

    it('allows chat, which slim mode keeps', () => {
      // Slim mode keeps chat; the NATIVE_APP gate on the nav entry and the
      // /chat route is what hides it in the store build. Those are two separate
      // gates on purpose — web slim mode still gets chat.
      expect(isSlimAllowed('/chat')).toBe(true)
      expect(isSlimAllowed('/chat/admin')).toBe(true)
      expect(isSlimAllowed('/chat/507f1f77bcf86cd799439011')).toBe(true)
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

    it('highlights admin for /admin surfaces', () => {
      expect(slimNavActiveTo('/admin')).toBe('/admin')
      expect(slimNavActiveTo('/admin/openrouter-usage')).toBe('/admin')
    })

    it('highlights the Hangar for /immerse', () => {
      expect(slimNavActiveTo('/immerse')).toBe('/immerse')
    })

    it('highlights chat for /chat surfaces', () => {
      expect(slimNavActiveTo('/chat')).toBe('/chat')
      expect(slimNavActiveTo('/chat/admin')).toBe('/chat')
      expect(slimNavActiveTo('/chat/507f1f77bcf86cd799439011')).toBe('/chat')
    })

    it('highlights CBAT for everything else', () => {
      expect(slimNavActiveTo('/cbat')).toBe('/cbat')
      expect(slimNavActiveTo('/cbat/target')).toBe('/cbat')
      expect(slimNavActiveTo('/cbat-game-history')).toBe('/cbat')
    })
  })
})
