import { describe, it, expect } from 'vitest'
import { SLIM_APP, isSlimAllowed, slimNavActiveTo, SLIM_NAV_ITEMS, HANGAR_NAV_ITEM, slimNavItems, isSlimLearnPath } from '../appMode'

describe('appMode', () => {
  it('defaults to full app (not slim) under test/web', () => {
    expect(SLIM_APP).toBe(false)
  })

  it('exposes exactly CBAT + Profile as slim nav items', () => {
    // Hangar is deliberately NOT in here — it is settings-driven, so the nav
    // components append HANGAR_NAV_ITEM themselves when the toggle is on.
    expect(SLIM_NAV_ITEMS.map((i) => i.to)).toEqual(['/cbat', '/learn-priority', '/profile'])
  })

  it('drops Learn from the slim nav when the admin switches it off', () => {
    expect(slimNavItems({ learnEnabled: true }).map(i => i.to)).toEqual(['/cbat', '/learn-priority', '/profile'])
    expect(slimNavItems({ learnEnabled: false }).map(i => i.to)).toEqual(['/cbat', '/profile'])
  })

  it('recognises the Learn routes the flag switches off', () => {
    expect(isSlimLearnPath('/learn-priority')).toBe(true)
    expect(isSlimLearnPath('/brief/abc')).toBe(true)
    expect(isSlimLearnPath('/battle-of-order/abc')).toBe(true)
    expect(isSlimLearnPath('/cbat')).toBe(false)
    expect(isSlimLearnPath('/briefing')).toBe(false)
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

    // Same reasoning as /immerse: this list cannot read AppSettings, so the
    // path stays routable and caseFilesEnabled / tier / daily-limit gating
    // happens inside. Slim mode adds no nav entry for it, so in practice only
    // a typed URL or the Admin "Open Case Files" button lands here — which is
    // the point, because admins have to be able to preview it.
    it('allows case files so admins can still reach them in slim mode', () => {
      expect(isSlimAllowed('/case-files')).toBe(true)
      expect(isSlimAllowed('/case-files/russia-ukraine/road-to-invasion')).toBe(true)
    })

    it('blocks the rest of the old site', () => {
      for (const p of [
        '/home',
        '/play',
        '/play/quiz',
        '/rankings',
        '/subscribe',
        '/intel-brief-history',
      ]) {
        expect(isSlimAllowed(p)).toBe(false)
      }
    })

    // Learn is back; which categories can be read is decided by the slim
    // category list, not by the route.
    it('allows Learn and every flow a brief leads to', () => {
      for (const p of [
        '/learn-priority',
        '/brief/abc',
        '/quiz/abc',
        '/battle-of-order/abc',
        '/aptitude-sync/abc',
        '/wheres-that-aircraft/abc',
      ]) {
        expect(isSlimAllowed(p)).toBe(true)
      }
    })

    // Allow-listed so a slimmed WEBSITE keeps its donation page — that mode is
    // just a trimmed site and carries no store exposure. The native app is the
    // risk, and it is handled in Donate.jsx under SLIM_APP rather than here,
    // because gating the route would have taken the page away from web slim too.
    it('allows the donation page, which only the native app is kept out of', () => {
      expect(isSlimAllowed('/donate')).toBe(true)
    })

    // Admin-only; the route itself sends everyone else to `/`.
    it('allows the legacy landing page so admins can view it in slim mode', () => {
      expect(isSlimAllowed('/homepagelegacy')).toBe(true)
    })

    it('allows chat, which slim mode keeps', () => {
      // Slim mode keeps chat on every platform. The chatEnabled feature flag is
      // the only thing that takes Community away now.
      expect(isSlimAllowed('/chat')).toBe(true)
      expect(isSlimAllowed('/chat/admin')).toBe(true)
      expect(isSlimAllowed('/chat/507f1f77bcf86cd799439011')).toBe(true)
    })

    it("allows another agent's profile, which chat and the score feed open", () => {
      expect(isSlimAllowed('/agent/507f1f77bcf86cd799439011')).toBe(true)
    })

    it('does not let /cbat swallow /cbat-game-history via prefix', () => {
      // /cbat-game-history is allowed on its own merit, not because it starts
      // with /cbat — guard against a regression to a bare startsWith.
      //
      // The CBAT guide needs no entry here: it is a static document
      // (public/cbat-guide.html), so opening it is a full page load and this
      // gate — which only runs inside the SPA — never sees it.
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

    it('highlights Learn for the pathway page and everything a brief leads to', () => {
      for (const p of ['/learn-priority', '/brief/abc', '/quiz/abc', '/battle-of-order/abc', '/aptitude-sync/abc', '/wheres-that-aircraft/abc']) {
        expect(slimNavActiveTo(p)).toBe('/learn-priority')
      }
    })

    it('highlights CBAT for everything else', () => {
      expect(slimNavActiveTo('/cbat')).toBe('/cbat')
      expect(slimNavActiveTo('/cbat/target')).toBe('/cbat')
      expect(slimNavActiveTo('/cbat-game-history')).toBe('/cbat')
    })
  })
})
