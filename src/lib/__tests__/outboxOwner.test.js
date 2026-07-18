import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory outbox so we don't need IndexedDB in jsdom.
const mem = new Map()
vi.mock('../net', () => ({
  isOnline: vi.fn(() => true),
  onNetworkChange: () => () => {},
}))
vi.mock('../offlineStore', () => ({
  outboxPut: vi.fn(async (i) => { mem.set(i.clientResultId, i) }),
  outboxDelete: vi.fn(async (id) => { mem.delete(id) }),
  outboxAll: vi.fn(async () => [...mem.values()].sort((a, b) => a.queuedAt - b.queuedAt)),
  outboxCount: vi.fn(async () => mem.size),
}))

import { submitCbatResult, flushOutbox } from '../cbatOutbox'
import { setOutboxOwner, getOutboxOwner, ownsQueuedItem } from '../outboxOwner'
import { isOnline } from '../net'

const API = 'http://x'
const ctx = (apiFetch) => ({ apiFetch, API })

beforeEach(() => {
  mem.clear()
  vi.clearAllMocks()
  isOnline.mockReturnValue(true)
  setOutboxOwner(null)
})

describe('ownsQueuedItem', () => {
  it('refuses everything when nobody is signed in', () => {
    expect(ownsQueuedItem({ userId: 'u1' }, null)).toBe(false)
    expect(ownsQueuedItem({}, null)).toBe(false)
  })

  it('adopts legacy items queued before ownership existed', () => {
    expect(ownsQueuedItem({}, 'u1')).toBe(true)
    expect(ownsQueuedItem({ userId: null }, 'u1')).toBe(true)
  })

  it('matches on id regardless of string/object id shape', () => {
    expect(ownsQueuedItem({ userId: 'u1' }, 'u1')).toBe(true)
    expect(ownsQueuedItem({ userId: { toString: () => 'u1' } }, 'u1')).toBe(true)
  })

  it('rejects another user’s item', () => {
    expect(ownsQueuedItem({ userId: 'u2' }, 'u1')).toBe(false)
  })
})

describe('queued scores carry their owner', () => {
  it('stamps the signed-in user when queueing', async () => {
    setOutboxOwner('u1')
    isOnline.mockReturnValue(false)
    await submitCbatResult('target', { totalScore: 10 }, ctx(vi.fn()))

    expect([...mem.values()][0].userId).toBe('u1')
  })

  it('reflects a change of user', async () => {
    setOutboxOwner('u1')
    expect(getOutboxOwner()).toBe('u1')
    setOutboxOwner('u2')
    isOnline.mockReturnValue(false)
    await submitCbatResult('angles', { correctCount: 3 }, ctx(vi.fn()))

    expect([...mem.values()][0].userId).toBe('u2')
  })
})

describe('flushOutbox ownership filtering', () => {
  // The bug: queued items carried no identity, so a flush posted whatever was on
  // the device as whoever happened to be signed in. On a shared phone that
  // donated one person's scores to someone else's leaderboard.
  it('does not post another user’s queued score', async () => {
    setOutboxOwner('u1')
    isOnline.mockReturnValue(false)
    await submitCbatResult('target', { totalScore: 10 }, ctx(vi.fn()))

    // A different user signs in on the same device.
    setOutboxOwner('u2')
    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    await flushOutbox(ctx(apiFetch))

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('leaves the other user’s score queued rather than dropping it', async () => {
    setOutboxOwner('u1')
    isOnline.mockReturnValue(false)
    await submitCbatResult('target', { totalScore: 10 }, ctx(vi.fn()))

    setOutboxOwner('u2')
    isOnline.mockReturnValue(true)
    await flushOutbox(ctx(vi.fn().mockResolvedValue({ ok: true, status: 201 })))
    expect(mem.size).toBe(1)

    // ...and it syncs when its real owner comes back.
    setOutboxOwner('u1')
    const apiFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    await flushOutbox(ctx(apiFetch))
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(mem.size).toBe(0)
  })

  it('flushes the owner’s own scores as normal', async () => {
    setOutboxOwner('u1')
    isOnline.mockReturnValue(false)
    await submitCbatResult('target', { totalScore: 10 }, ctx(vi.fn()))
    await submitCbatResult('angles', { correctCount: 4 }, ctx(vi.fn()))

    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    await flushOutbox(ctx(apiFetch))

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(mem.size).toBe(0)
  })

  it('flushes nothing at all when nobody is signed in', async () => {
    setOutboxOwner('u1')
    isOnline.mockReturnValue(false)
    await submitCbatResult('target', { totalScore: 10 }, ctx(vi.fn()))

    setOutboxOwner(null)
    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    await flushOutbox(ctx(apiFetch))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(mem.size).toBe(1)
  })
})
