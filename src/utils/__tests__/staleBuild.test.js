import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  reloadTargetFor, startUpdateChecks, markUpdateReady, isUpdateReady, __resetStaleBuild,
  CHECK_EVERY_MS, MIN_CHECK_GAP_MS,
} from '../staleBuild'
import { MOCK_UPDATED_PATH } from '../chunkLoadRecovery'

const GAMES = new Set(['/cbat/instruments', '/cbat/flag'])
const target = over => reloadTargetFor({ pathname: '/cbat', gamePaths: GAMES, ...over })

describe('reloadTargetFor', () => {
  it('reloads in place on a page that is not a game', () => {
    expect(target({ pathname: '/cbat', search: '?tab=x', hash: '#a' })).toBe('/cbat?tab=x#a')
    expect(target({ pathname: '/profile' })).toBe('/profile')
  })

  it('never reloads into a game page or anything under it', () => {
    expect(target({ pathname: '/cbat/instruments', search: '?mode=orientation' })).toBeNull()
    expect(target({ pathname: '/cbat/flag/leaderboard' })).toBeNull()
  })

  it('leaves a navigation carrying router state alone, since a reload would drop it', () => {
    expect(target({ pathname: '/admin', state: { editBriefId: 'b1' } })).toBeNull()
  })

  it('during a mock, reloads only on the assessment screen and says SkyWatch was updated', () => {
    expect(target({ pathname: '/cbat/mock', mockActive: true, state: { mockReturned: true } })).toBe(MOCK_UPDATED_PATH)
    expect(target({ pathname: '/cbat/instruments', mockActive: true })).toBeNull()
    expect(target({ pathname: '/profile', mockActive: true })).toBeNull()
  })
})

describe('the ready flag', () => {
  afterEach(() => __resetStaleBuild())

  it('starts clear and stays set once a new build is ready', () => {
    expect(isUpdateReady()).toBe(false)
    markUpdateReady()
    expect(isUpdateReady()).toBe(true)
  })
})

function fakeDoc() {
  const handlers = new Set()
  return {
    visibilityState: 'visible',
    addEventListener: (_e, h) => handlers.add(h),
    removeEventListener: (_e, h) => handlers.delete(h),
    show() { handlers.forEach(h => h()) },
    handlers,
  }
}

describe('startUpdateChecks', () => {
  afterEach(() => vi.useRealTimers())

  it('asks the service worker to update on the timer, and on return to the tab at most once a minute', async () => {
    vi.useFakeTimers()
    let t = 0
    const registration = { update: vi.fn(() => Promise.resolve()) }
    const doc = fakeDoc()
    const stop = startUpdateChecks({ registration, doc, now: () => t })

    t = CHECK_EVERY_MS
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(1)

    t += MIN_CHECK_GAP_MS - 1
    doc.show()
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(1)

    t += 1
    doc.show()
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(2)

    stop()
    expect(doc.handlers.size).toBe(0)
  })

  it('without a service worker, marks ready when /version.json names a different build', async () => {
    vi.useFakeTimers()
    const onStale = vi.fn()
    const live = { version: '1.2.59', build: 'new' }
    startUpdateChecks({
      onStale, doc: fakeDoc(), now: () => 0,
      fetchLive: () => Promise.resolve(live),
      clientInfo: () => ({ platform: 'web', build: 'old' }),
    })
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    await vi.runAllTicks()
    await Promise.resolve()
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the live build is the one running', async () => {
    vi.useFakeTimers()
    const onStale = vi.fn()
    startUpdateChecks({
      onStale, doc: fakeDoc(), now: () => 0,
      fetchLive: () => Promise.resolve({ build: 'same' }),
      clientInfo: () => ({ platform: 'web', build: 'same' }),
    })
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    await Promise.resolve()
    await Promise.resolve()
    expect(onStale).not.toHaveBeenCalled()
  })
})
