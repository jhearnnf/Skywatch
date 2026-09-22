import { describe, it, expect } from 'vitest'
import { isCanadianHint } from '../region'
import { clanOffered } from '../cbat/clanOffer'
import { storeForGeo } from '../cbat/hardwareStore'

// One answer to "is this player in Canada", read by the hardware cabinet
// (amazon.ca). IP first, then the device's timezone, then the browser
// language, each consulted only when the one before said nothing.

describe('isCanadianHint', () => {
  it('says no for nobody, and for anyone whose IP is elsewhere', () => {
    expect(isCanadianHint(null)).toBe(false)
    expect(isCanadianHint({ country: null, timeZone: null, language: null })).toBe(false)
    expect(isCanadianHint({ country: 'GB', timeZone: 'Europe/London', language: 'en-GB' })).toBe(false)
    expect(isCanadianHint({ country: 'US', timeZone: 'America/New_York', language: 'en-US' })).toBe(false)
  })

  it('says yes for a Canadian IP, whatever the device says', () => {
    expect(isCanadianHint({ country: 'CA', timeZone: 'Europe/London', language: 'en-GB' })).toBe(true)
    expect(isCanadianHint({ country: 'ca', timeZone: null, language: null })).toBe(true)
  })

  it('trusts the IP over the device when both are known', () => {
    expect(isCanadianHint({ country: 'GB', timeZone: 'America/Toronto', language: 'en-CA' })).toBe(false)
  })

  it('falls back to the timezone, then the browser language', () => {
    expect(isCanadianHint({ country: null, timeZone: 'America/Vancouver', language: 'en-GB' })).toBe(true)
    expect(isCanadianHint({ country: null, timeZone: 'Europe/London', language: 'en-CA' })).toBe(false)
    expect(isCanadianHint({ country: null, timeZone: null, language: 'fr-CA' })).toBe(true)
  })

  it('is what the hardware store reads', () => {
    const hints = [
      { country: 'CA', timeZone: null, language: null },
      { country: null, timeZone: 'America/Halifax', language: null },
      { country: 'AU', timeZone: 'Australia/Sydney', language: 'en-AU' },
      null,
    ]
    for (const h of hints) {
      expect(storeForGeo(h)).toBe(isCanadianHint(h) ? 'ca' : 'uk')
    }
  })
})

describe('clanOffered', () => {
  it('offers CLAN to everyone, wherever they are', () => {
    expect(clanOffered({ isAdmin: false, cbatGameEnabled: {} })).toBe(true)
    expect(clanOffered({ isAdmin: true, cbatGameEnabled: {} })).toBe(true)
  })

  it('withdraws it from players, but never from admins, when the game is switched off', () => {
    expect(clanOffered({ isAdmin: false, cbatGameEnabled: { clan: false } })).toBe(false)
    expect(clanOffered({ isAdmin: true, cbatGameEnabled: { clan: false } })).toBe(true)
  })
})
