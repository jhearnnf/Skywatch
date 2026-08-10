import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearChatCache, syncChatCacheOwner, getCachedOverview, getCachedThread,
  setCachedThread, fetchOverview, prefetchOverview,
} from '../chatCache'

const ok = (data) => ({ ok: true, json: async () => ({ status: 'success', data }) })

describe('chatCache', () => {
  beforeEach(() => {
    syncChatCacheOwner(null)
    clearChatCache()
  })

  it('hands back the overview it last fetched', async () => {
    const apiFetch = vi.fn().mockResolvedValue(ok({ channels: [{ _id: 'c1' }] }))

    expect(getCachedOverview()).toBe(null)
    await fetchOverview('', apiFetch)
    expect(getCachedOverview().channels[0]._id).toBe('c1')
  })

  it('does not cache a failed fetch', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ message: 'Nope' }),
    })

    await expect(fetchOverview('', apiFetch)).rejects.toThrow('Nope')
    expect(getCachedOverview()).toBe(null)
  })

  // The property that matters most here: one viewer's rail can never reach
  // another's screen, however they came to share a tab.
  it('empties itself when the viewer changes', async () => {
    syncChatCacheOwner('u1')
    await fetchOverview('', vi.fn().mockResolvedValue(ok({ channels: [{ _id: 'c1' }] })))
    setCachedThread('c1', { messages: [{ _id: 'm1' }], senders: {}, conversation: null })

    syncChatCacheOwner('u2')
    expect(getCachedOverview()).toBe(null)
    expect(getCachedThread('c1')).toBe(null)
  })

  it('keeps the cache when the same viewer syncs again', async () => {
    syncChatCacheOwner('u1')
    await fetchOverview('', vi.fn().mockResolvedValue(ok({ channels: [{ _id: 'c1' }] })))

    syncChatCacheOwner('u1')
    expect(getCachedOverview()).toBeTruthy()
  })

  it('evicts the least recently cached thread once full', () => {
    const entry = (id) => ({ messages: [{ _id: id }], senders: {}, conversation: null })
    for (let i = 0; i < 12; i++) setCachedThread(`c${i}`, entry(`m${i}`))

    // The two oldest are gone; the ten most recent survive.
    expect(getCachedThread('c0')).toBe(null)
    expect(getCachedThread('c1')).toBe(null)
    expect(getCachedThread('c2')).toBeTruthy()
    expect(getCachedThread('c11')).toBeTruthy()
  })

  it('re-caching a thread makes it the newest, not the oldest', () => {
    const entry = (id) => ({ messages: [{ _id: id }], senders: {}, conversation: null })
    for (let i = 0; i < 10; i++) setCachedThread(`c${i}`, entry(`m${i}`))

    setCachedThread('c0', entry('m0-again'))   // touched, so no longer the eviction candidate
    setCachedThread('c10', entry('m10'))

    expect(getCachedThread('c0')).toBeTruthy()
    expect(getCachedThread('c1')).toBe(null)
  })

  describe('prefetchOverview', () => {
    it('warms the cache without anyone rendering it', async () => {
      const apiFetch = vi.fn().mockResolvedValue(ok({ channels: [{ _id: 'c1' }] }))

      prefetchOverview('', apiFetch, 'u1')
      await vi.waitFor(() => expect(getCachedOverview()).toBeTruthy())
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    // Hovering the nav entry is not a rare event, and a pointer crossing it
    // fires repeatedly. None of that should reach the backend more than once.
    it('fires once however many times intent is signalled', async () => {
      const apiFetch = vi.fn().mockResolvedValue(ok({ channels: [] }))

      prefetchOverview('', apiFetch, 'u1')
      prefetchOverview('', apiFetch, 'u1')
      prefetchOverview('', apiFetch, 'u1')

      await vi.waitFor(() => expect(getCachedOverview()).toBeTruthy())
      prefetchOverview('', apiFetch, 'u1')   // already cached, so still nothing to do
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    it('stays silent when the fetch fails', async () => {
      const apiFetch = vi.fn().mockRejectedValue(new Error('offline'))

      expect(() => prefetchOverview('', apiFetch, 'u1')).not.toThrow()
      await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled())
      expect(getCachedOverview()).toBe(null)
    })
  })
})
