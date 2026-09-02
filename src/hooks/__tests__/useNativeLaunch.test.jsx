import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// appMode.SLIM_APP is a module-load constant; mock it per-test via the shared ref.
const slimAppRef = vi.hoisted(() => ({ value: true }))
vi.mock('../../utils/appMode', () => ({
  get SLIM_APP() { return slimAppRef.value },
}))

import { NATIVE_INTRO_SEEN_KEY } from '../../utils/storageKeys'

const USER = { _id: 'u1' }

// The hook holds its decision at module scope, for the life of the app process.
// Reloading the module is therefore how a test says "cold start", which is
// exactly the thing under test.
const launchApp = async () => {
  vi.resetModules()
  const { useNativeLaunchRoute } = await import('../useNativeLaunch')
  return (props) =>
    renderHook(({ pathname, user, ready }) => useNativeLaunchRoute(pathname, user, ready), {
      initialProps: { pathname: '/', user: null, ready: true, ...props },
    })
}

describe('useNativeLaunchRoute', () => {
  beforeEach(() => {
    slimAppRef.value = true
    localStorage.clear()
  })

  it("never redirects on the web — the landing page is the site's front door", async () => {
    slimAppRef.value = false
    localStorage.setItem(NATIVE_INTRO_SEEN_KEY, '1')
    const launch = await launchApp()
    expect(launch().result.current).toBe(false)
  })

  it('shows the intro on a signed-out first launch', async () => {
    const launch = await launchApp()
    expect(launch().result.current).toBe(false)
  })

  it('burns the intro when it shows it, so the next launch opens on the games', async () => {
    const first = await launchApp()
    first()
    expect(localStorage.getItem(NATIVE_INTRO_SEEN_KEY)).toBe('1')

    const second = await launchApp()
    expect(second().result.current).toBe(true)
  })

  it('never shows the intro to a signed-in user', async () => {
    const launch = await launchApp()
    expect(launch({ user: USER }).result.current).toBe(true)
    // ...and does not burn it either: it was never shown.
    expect(localStorage.getItem(NATIVE_INTRO_SEEN_KEY)).toBeNull()
  })

  // Deciding while the session is still loading would read every returning
  // player as a signed-out first-timer and put the signup pitch in front of them.
  it('waits for auth to settle before deciding', async () => {
    const launch = await launchApp()
    const { result, rerender } = launch({ ready: false })
    expect(result.current).toBe(false)
    expect(localStorage.getItem(NATIVE_INTRO_SEEN_KEY)).toBeNull()

    rerender({ pathname: '/', user: USER, ready: true })
    expect(result.current).toBe(true)
    expect(localStorage.getItem(NATIVE_INTRO_SEEN_KEY)).toBeNull()
  })

  // The header logo routes to `/`. If the launch redirect kept firing, tapping
  // it would bounce straight back to /cbat and the page would be unreachable.
  it('stops applying once the app has left the landing page', async () => {
    localStorage.setItem(NATIVE_INTRO_SEEN_KEY, '1')
    const launch = await launchApp()
    const { result, rerender } = launch()
    expect(result.current).toBe(true)

    rerender({ pathname: '/cbat', user: null, ready: true })
    rerender({ pathname: '/', user: null, ready: true })
    expect(result.current).toBe(false)
  })

  it('does not trap a user behind the intro when storage is unavailable', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    try {
      const launch = await launchApp()
      expect(launch().result.current).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
