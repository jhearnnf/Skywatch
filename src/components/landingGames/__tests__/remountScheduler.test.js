import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestRemountSlot, RECYCLE_GAP_MS, __resetRemountScheduler } from '../remountScheduler'

// Nine cards recycling on their own timers eventually land two game mounts in
// the same frame — the perf sweep caught that as a 115ms hitch. The scheduler
// exists to make that impossible.

describe('requestRemountSlot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetRemountScheduler()
    // jsdom has no idle callback; the module falls back to a timer.
    delete globalThis.requestIdleCallback
  })
  afterEach(() => vi.useRealTimers())

  it('runs a lone request straight away', () => {
    const run = vi.fn()
    requestRemountSlot(run)
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('spaces simultaneous requests instead of firing them together', () => {
    const calls = []
    for (let i = 0; i < 3; i++) requestRemountSlot(() => calls.push(i))

    vi.advanceTimersByTime(1)
    expect(calls).toEqual([0])

    vi.advanceTimersByTime(RECYCLE_GAP_MS)
    expect(calls).toEqual([0, 1])

    vi.advanceTimersByTime(RECYCLE_GAP_MS)
    expect(calls).toEqual([0, 1, 2])
  })

  it('drops a card that unmounted while it was queued', () => {
    const first = vi.fn()
    const second = vi.fn()
    requestRemountSlot(first)
    const cancel = requestRemountSlot(second)

    cancel()
    vi.advanceTimersByTime(RECYCLE_GAP_MS * 3)

    expect(first).toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('is safe to cancel after the slot has fired', () => {
    const cancel = requestRemountSlot(() => {})
    vi.advanceTimersByTime(RECYCLE_GAP_MS)
    expect(() => cancel()).not.toThrow()
  })

  it('waits for idle when the browser offers it', () => {
    const idleCbs = []
    globalThis.requestIdleCallback = (cb) => { idleCbs.push(cb); return idleCbs.length }
    const run = vi.fn()

    requestRemountSlot(run)
    vi.advanceTimersByTime(1)
    // The slot is due, but nothing has mounted yet — it is waiting for idle.
    expect(run).not.toHaveBeenCalled()

    idleCbs[0]()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
