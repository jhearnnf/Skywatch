import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory startbox so we don't need IndexedDB in jsdom.
const mem = new Map()
vi.mock('../../../lib/net', () => ({
  isOnline: vi.fn(() => true),
  onNetworkChange: () => () => {},
}))
vi.mock('../../../lib/offlineStore', () => ({
  startboxPut: vi.fn(async (i) => { mem.set(i.clientStartId, i) }),
  startboxDelete: vi.fn(async (id) => { mem.delete(id) }),
  startboxAll: vi.fn(async () => [...mem.values()].sort((a, b) => a.queuedAt - b.queuedAt)),
}))

import { recordCbatStart, flushStartOutbox } from '../recordStart'
import { setOutboxOwner } from '../../../lib/outboxOwner'
import { isOnline } from '../../../lib/net'

const API = 'http://x'
const ctx = (apiFetch) => ({ apiFetch, API })

// Start beacons are ownership-filtered now — nothing flushes without a signed-in
// user. Ownership is covered in lib/__tests__/outboxOwner.test.js; setup here.
beforeEach(() => { mem.clear(); vi.clearAllMocks(); isOnline.mockReturnValue(true); setOutboxOwner('test-user') })

describe('recordCbatStart', () => {
  it('POSTs immediately when online and does not queue', async () => {
    const apiFetch = vi.fn(async () => ({ ok: true, status: 201 }))
    await recordCbatStart('act', apiFetch, API)
    expect(apiFetch).toHaveBeenCalledWith('http://x/api/games/cbat/act/start', expect.any(Object))
    expect(mem.size).toBe(0)
  })

  it('sends a clientStartId + startedAt in the body', async () => {
    const apiFetch = vi.fn(async () => ({ ok: true, status: 201 }))
    await recordCbatStart('target', apiFetch, API)
    const body = JSON.parse(apiFetch.mock.calls[0][1].body)
    expect(body.clientStartId).toBeTruthy()
    expect(body.startedAt).toBeTruthy()
  })

  it('queues when offline without calling the network', async () => {
    isOnline.mockReturnValue(false)
    const apiFetch = vi.fn()
    await recordCbatStart('symbols', apiFetch, API)
    expect(apiFetch).not.toHaveBeenCalled()
    expect(mem.size).toBe(1)
  })

  it('queues on a 5xx for later retry', async () => {
    const apiFetch = vi.fn(async () => ({ ok: false, status: 500 }))
    await recordCbatStart('flag', apiFetch, API)
    expect(mem.size).toBe(1)
  })

  it('queues on a 401 for later retry', async () => {
    const apiFetch = vi.fn(async () => ({ ok: false, status: 401 }))
    await recordCbatStart('flag', apiFetch, API)
    expect(mem.size).toBe(1)
  })

  it('queues on a network throw', async () => {
    const apiFetch = vi.fn(async () => { throw new Error('offline') })
    await recordCbatStart('dpt', apiFetch, API)
    expect(mem.size).toBe(1)
  })

  it('does NOT queue on a non-retryable 4xx (e.g. game disabled)', async () => {
    const apiFetch = vi.fn(async () => ({ ok: false, status: 403 }))
    await recordCbatStart('ant', apiFetch, API)
    expect(mem.size).toBe(0)
  })

  it('never throws even if storage rejects', async () => {
    isOnline.mockReturnValue(false)
    const { startboxPut } = await import('../../../lib/offlineStore')
    startboxPut.mockRejectedValueOnce(new Error('quota'))
    await expect(recordCbatStart('sat', vi.fn(), API)).resolves.toBeUndefined()
  })
})

describe('flushStartOutbox', () => {
  it('replays queued starts and clears them on success', async () => {
    isOnline.mockReturnValue(false)
    await recordCbatStart('act', vi.fn(), API)
    await recordCbatStart('flag', vi.fn(), API)
    expect(mem.size).toBe(2)

    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn(async () => ({ ok: true, status: 201 }))
    await flushStartOutbox(ctx(apiFetch))
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(mem.size).toBe(0)
  })

  it('keeps queued starts on a 5xx', async () => {
    isOnline.mockReturnValue(false)
    await recordCbatStart('act', vi.fn(), API)
    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn(async () => ({ ok: false, status: 503 }))
    await flushStartOutbox(ctx(apiFetch))
    expect(mem.size).toBe(1)
  })

  it('drops a start on a 4xx so it cannot loop forever', async () => {
    isOnline.mockReturnValue(false)
    await recordCbatStart('act', vi.fn(), API)
    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn(async () => ({ ok: false, status: 409 }))
    await flushStartOutbox(ctx(apiFetch))
    expect(mem.size).toBe(0)
  })

  it('stops and keeps the queue intact on a 401', async () => {
    isOnline.mockReturnValue(false)
    await recordCbatStart('act', vi.fn(), API)
    await recordCbatStart('flag', vi.fn(), API)
    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn(async () => ({ ok: false, status: 401 }))
    await flushStartOutbox(ctx(apiFetch))
    expect(mem.size).toBe(2)
  })

  it('is a no-op when offline', async () => {
    isOnline.mockReturnValue(false)
    await recordCbatStart('act', vi.fn(), API)
    const apiFetch = vi.fn()
    await flushStartOutbox(ctx(apiFetch))
    expect(apiFetch).not.toHaveBeenCalled()
    expect(mem.size).toBe(1)
  })
})
