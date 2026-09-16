import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../../isNative', () => ({ isNative: false }))

import { storeForGeo, useHardwareStore, DEFAULT_STORE } from '../hardwareStore'
import { RECOMMENDED_STICK, RECOMMENDED_PEDALS, storeLink } from '../recommendedStick'
import { __resetGeoHint } from '../../geoHint'

describe('storeForGeo', () => {
  it('sends everyone to the UK store unless something says Canada', () => {
    expect(storeForGeo(null)).toBe('uk')
    expect(storeForGeo({ country: null, timeZone: null, language: null })).toBe('uk')
    expect(storeForGeo({ country: 'GB', timeZone: 'Europe/London', language: 'en-GB' })).toBe('uk')
    expect(storeForGeo({ country: 'AU', timeZone: 'Australia/Sydney', language: 'en-AU' })).toBe('uk')
    expect(storeForGeo({ country: 'US', timeZone: 'America/New_York', language: 'en-US' })).toBe('uk')
    expect(DEFAULT_STORE).toBe('uk')
  })

  it('sends a player in Canada to amazon.ca', () => {
    expect(storeForGeo({ country: 'CA', timeZone: 'America/Toronto', language: 'en-CA' })).toBe('ca')
    expect(storeForGeo({ country: 'ca', timeZone: null, language: null })).toBe('ca')
  })

  // Which shop can deliver is a question about where they are, so the IP wins
  // whenever it answered. A Canadian on a UK VPN gets the UK store; a
  // visitor to Canada with a UK laptop gets amazon.ca.
  it('trusts the IP over the device when both are known', () => {
    expect(storeForGeo({ country: 'GB', timeZone: 'America/Toronto', language: 'en-CA' })).toBe('uk')
    expect(storeForGeo({ country: 'CA', timeZone: 'Europe/London', language: 'en-GB' })).toBe('ca')
  })

  // No /api/geo on a dev server, and the edge header can go missing. The
  // device is then the only witness: the timezone first, the language after.
  it('falls back to the timezone, then the browser language', () => {
    expect(storeForGeo({ country: null, timeZone: 'America/Vancouver', language: 'en-GB' })).toBe('ca')
    expect(storeForGeo({ country: null, timeZone: 'America/St_Johns', language: null })).toBe('ca')
    expect(storeForGeo({ country: null, timeZone: 'Europe/London', language: 'en-CA' })).toBe('uk')
    expect(storeForGeo({ country: null, timeZone: null, language: 'fr-CA' })).toBe('ca')
    expect(storeForGeo({ country: null, timeZone: null, language: 'en-GB' })).toBe('uk')
  })
})

describe('storeLink', () => {
  it('has a distinct amazon.ca link for every item, and the UK link as its default', () => {
    for (const item of [RECOMMENDED_STICK, RECOMMENDED_PEDALS]) {
      expect(storeLink(item, 'uk')).toBe(item.url)
      expect(storeLink(item, 'ca')).toBe(item.links.ca)
      expect(item.links.ca).not.toBe(item.links.uk)
      expect(item.links.ca).toMatch(/^https:\/\//)
    }
    // The two Canadian links are different products.
    expect(RECOMMENDED_STICK.links.ca).not.toBe(RECOMMENDED_PEDALS.links.ca)
  })

  it('falls back to the UK link for a store the item is not listed in', () => {
    expect(storeLink(RECOMMENDED_STICK, 'us')).toBe(RECOMMENDED_STICK.url)
    expect(storeLink({ url: 'https://example.test/x' }, 'ca')).toBe('https://example.test/x')
  })
})

describe('useHardwareStore', () => {
  beforeEach(() => {
    __resetGeoHint()
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({ resolvedOptions: () => ({ timeZone: 'Europe/London' }) }))
    Object.defineProperty(navigator, 'language', { value: 'en-GB', configurable: true })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('says UK until the lookup lands, then Canada for a Canadian IP', async () => {
    let release
    globalThis.fetch = vi.fn(() => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ country: 'CA' }) }) }))

    const { result } = renderHook(() => useHardwareStore())
    expect(result.current).toBe('uk')

    release()
    await waitFor(() => expect(result.current).toBe('ca'))
  })

  it('stays on the UK store when the lookup fails and the device is British', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    const { result } = renderHook(() => useHardwareStore())
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(result.current).toBe('uk')
  })
})
