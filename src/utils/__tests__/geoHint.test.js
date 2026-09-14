import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../isNative', () => ({ isNative: false }))

import { getGeoHint, peekGeoHint, __resetGeoHint } from '../geoHint'
import handler, { countryFromHeaders } from '../../../api/geo.js'

describe('geoHint', () => {
  beforeEach(() => {
    __resetGeoHint()
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ country: 'GB' }) }))
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({ resolvedOptions: () => ({ timeZone: 'Europe/London' }) }))
    Object.defineProperty(navigator, 'language', { value: 'en-GB', configurable: true })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('gathers the IP country, timezone and language', async () => {
    expect(peekGeoHint()).toBeNull()
    await expect(getGeoHint()).resolves.toEqual({ country: 'GB', timeZone: 'Europe/London', language: 'en-GB' })
    expect(global.fetch).toHaveBeenCalledWith('/api/geo', { cache: 'no-store' })
    expect(peekGeoHint()).toEqual({ country: 'GB', timeZone: 'Europe/London', language: 'en-GB' })
  })

  it('looks the country up once, however many times it is asked', async () => {
    await Promise.all([getGeoHint(), getGeoHint(), getGeoHint()])
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  // A dev server has no /api/geo (Vite hands back index.html), and the site
  // may be reached while Vercel is having a bad day. The device signals must
  // still go up.
  it('still reports the device signals when the lookup fails', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => { throw new Error('not json') } }))
    await expect(getGeoHint()).resolves.toEqual({ country: null, timeZone: 'Europe/London', language: 'en-GB' })

    __resetGeoHint()
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(getGeoHint()).resolves.toEqual({ country: null, timeZone: 'Europe/London', language: 'en-GB' })
  })

  it('ignores a country that is not a two-letter code', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ country: 'United Kingdom' }) }))
    await expect(getGeoHint()).resolves.toMatchObject({ country: null })
  })
})

describe('api/geo handler', () => {
  const mockRes = () => {
    const res = { headers: {}, statusCode: null, body: undefined }
    res.setHeader = (k, v) => { res.headers[k] = v }
    res.status = (c) => { res.statusCode = c; return res }
    res.json = (b) => { res.body = b; return res }
    res.end = () => res
    return res
  }

  it('echoes the Vercel country header as JSON', () => {
    const res = mockRes()
    handler({ method: 'GET', headers: { 'x-vercel-ip-country': 'gb' } }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ country: 'GB' })
    expect(res.headers['Cache-Control']).toBe('private, no-store')
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('answers null with no header rather than failing', () => {
    const res = mockRes()
    handler({ method: 'GET', headers: {} }, res)
    expect(res.body).toEqual({ country: null })
  })

  it('validates the header value', () => {
    expect(countryFromHeaders({ 'x-vercel-ip-country': 'XX' })).toBe('XX')
    expect(countryFromHeaders({ 'x-vercel-ip-country': 'GBR' })).toBeNull()
    expect(countryFromHeaders({ 'x-vercel-ip-country': '<b>' })).toBeNull()
    expect(countryFromHeaders(undefined)).toBeNull()
  })

  it('only serves GET (plus the CORS preflight)', () => {
    const res = mockRes()
    handler({ method: 'OPTIONS', headers: {} }, res)
    expect(res.statusCode).toBe(204)
    handler({ method: 'POST', headers: {} }, res)
    expect(res.statusCode).toBe(405)
  })
})
