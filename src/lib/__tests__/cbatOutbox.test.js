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
import { isOnline } from '../net'

const API = 'http://x'
const okRes = { ok: true, status: 201 }
const ctx = (apiFetch) => ({ apiFetch, API })

beforeEach(() => { mem.clear(); vi.clearAllMocks(); isOnline.mockReturnValue(true) })

describe('submitCbatResult', () => {
  it('posts immediately when online and does not queue', async () => {
    const apiFetch = vi.fn().mockResolvedValue(okRes)
    const r = await submitCbatResult('angles', { correctCount: 5 }, ctx(apiFetch))
    expect(r.synced).toBe(true)
    expect(mem.size).toBe(0)
    // stamps playedAt + clientResultId on the body
    const body = JSON.parse(apiFetch.mock.calls[0][1].body)
    expect(body.correctCount).toBe(5)
    expect(body.playedAt).toBeTruthy()
    expect(body.clientResultId).toBeTruthy()
    expect(apiFetch.mock.calls[0][0]).toBe(`${API}/api/games/cbat/angles/result`)
  })

  it('queues when offline', async () => {
    isOnline.mockReturnValue(false)
    const apiFetch = vi.fn()
    const r = await submitCbatResult('target', { totalScore: 10 }, ctx(apiFetch))
    expect(r.queued).toBe(true)
    expect(apiFetch).not.toHaveBeenCalled()
    expect(mem.size).toBe(1)
  })

  it('queues when the network throws mid-request', async () => {
    const apiFetch = vi.fn().mockRejectedValue(new Error('network'))
    const r = await submitCbatResult('act', { totalScore: 1 }, ctx(apiFetch))
    expect(r.queued).toBe(true)
    expect(mem.size).toBe(1)
  })

  it('queues on 401 (auth expired) so the score is not lost', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const r = await submitCbatResult('act', { totalScore: 1 }, ctx(apiFetch))
    expect(r.queued).toBe(true)
    expect(mem.size).toBe(1)
  })

  it('drops on a hard 4xx (bad payload) instead of looping forever', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 })
    const r = await submitCbatResult('act', { totalScore: 1 }, ctx(apiFetch))
    expect(r.synced).toBe(false)
    expect(mem.size).toBe(0)
  })
})

describe('flushOutbox', () => {
  it('drains the queue on success', async () => {
    isOnline.mockReturnValue(false)
    await submitCbatResult('angles', { correctCount: 1 }, ctx(vi.fn()))
    await submitCbatResult('symbols', { correctCount: 2 }, ctx(vi.fn()))
    expect(mem.size).toBe(2)

    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn().mockResolvedValue(okRes)
    await flushOutbox(ctx(apiFetch))
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(mem.size).toBe(0)
  })

  it('stops and keeps the queue on 401', async () => {
    isOnline.mockReturnValue(false)
    await submitCbatResult('angles', { correctCount: 1 }, ctx(vi.fn()))
    isOnline.mockReturnValue(true)
    const apiFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    await flushOutbox(ctx(apiFetch))
    expect(mem.size).toBe(1)
  })

  it('does nothing when offline', async () => {
    isOnline.mockReturnValue(false)
    await submitCbatResult('angles', { correctCount: 1 }, ctx(vi.fn()))
    const apiFetch = vi.fn()
    await flushOutbox(ctx(apiFetch))
    expect(apiFetch).not.toHaveBeenCalled()
    expect(mem.size).toBe(1)
  })
})
