import { describe, it, expect, beforeEach, vi } from 'vitest'

const cache = new Map()
vi.mock('../net', () => ({ isOnline: vi.fn(() => true) }))
vi.mock('../offlineStore', () => ({
  cacheGet: vi.fn(async (k) => cache.get(k) ?? null),
  cacheSet: vi.fn(async (k, v) => { cache.set(k, v) }),
}))

import { getAircraftRoster, transformCutoutUrl } from '../offlineRoster'
import { isOnline } from '../net'

const API = 'http://x'
const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1/typhoon.png'

beforeEach(() => { cache.clear(); vi.clearAllMocks(); isOnline.mockReturnValue(true) })

describe('transformCutoutUrl', () => {
  it('inserts shrink transforms into a Cloudinary upload URL', () => {
    expect(transformCutoutUrl(CLOUD)).toContain('/upload/w_400,f_auto,q_auto/')
  })
  it('is idempotent and leaves non-Cloudinary URLs alone', () => {
    expect(transformCutoutUrl(transformCutoutUrl(CLOUD))).toBe(transformCutoutUrl(CLOUD))
    expect(transformCutoutUrl('/local/x.png')).toBe('/local/x.png')
  })
})

describe('getAircraftRoster', () => {
  const roster = [
    { briefId: '1', title: 'Eurofighter Typhoon FGR4', cutoutUrl: CLOUD },
    { briefId: '2', title: 'Hawk T2', cutoutUrl: 'https://res.cloudinary.com/demo/image/upload/v1/hawk.png' },
    { briefId: '3', title: 'F-35B Lightning II', cutoutUrl: 'https://res.cloudinary.com/demo/image/upload/v1/f35.png' },
  ]

  it('returns the full live roster and caches it when online', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ json: async () => ({ data: roster }) })
    const { data } = await getAircraftRoster('aircraft-cutouts', { apiFetch, API })
    expect(data).toHaveLength(3)
    expect(cache.get('roster:aircraft-cutouts')).toHaveLength(3)
  })

  it('offline: returns only offline-available aircraft with transformed cutouts', async () => {
    cache.set('roster:aircraft-cutouts', roster)
    isOnline.mockReturnValue(false)
    const { data } = await getAircraftRoster('aircraft-cutouts', { apiFetch: vi.fn() })
    expect(data.map((a) => a.title).sort()).toEqual(['Eurofighter Typhoon FGR4', 'Hawk T2'])
    expect(data.every((a) => a.cutoutUrl.includes('/upload/w_400,'))).toBe(true)
  })

  it('offline: serves the cached data-URL cutout when present (SW-less Android path)', async () => {
    cache.set('roster:aircraft-cutouts', roster)
    cache.set('cutout:hawk t2', 'data:image/png;base64,AAAA')
    isOnline.mockReturnValue(false)
    const { data } = await getAircraftRoster('aircraft-cutouts', { apiFetch: vi.fn() })
    const hawk = data.find((a) => a.title === 'Hawk T2')
    expect(hawk.cutoutUrl).toBe('data:image/png;base64,AAAA')
  })

  it('falls back to the cached roster if the live fetch fails', async () => {
    cache.set('roster:aircraft-cutouts', roster)
    const apiFetch = vi.fn().mockRejectedValue(new Error('down'))
    const { data } = await getAircraftRoster('aircraft-cutouts', { apiFetch, API })
    // fell through to cache → filtered to offline pair
    expect(data).toHaveLength(2)
  })

  it('offline with NO cached roster still returns both bundled aircraft (fresh install)', async () => {
    isOnline.mockReturnValue(false) // cache is empty
    const { data } = await getAircraftRoster('aircraft-cutouts', { apiFetch: vi.fn() })
    expect(data.map((a) => a.title).sort()).toEqual(['Eurofighter Typhoon FGR4', 'Hawk T2'])
    // no dynamic data → synthetic entries: null briefId, null cutout, model still resolvable by title
    expect(data.every((a) => a.briefId === null && a.cutoutUrl === null)).toBe(true)
  })
})
