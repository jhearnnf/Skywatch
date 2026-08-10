import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PLAY_STORE_URL,
  setUpdateSW,
  forceUpdateWebApp,
  isNativeUpdateAvailable,
} from '../appUpdate'

// Stand-ins for the two browser APIs the force-refresh touches. Both are
// optional in the real world (private modes, disabled service workers), so
// every test that needs them installs them explicitly and the "missing"
// cases delete them again.
function installServiceWorker(registrations) {
  navigator.serviceWorker = { getRegistrations: vi.fn().mockResolvedValue(registrations) }
}

function installCaches(keys) {
  globalThis.caches = {
    keys:   vi.fn().mockResolvedValue(keys),
    delete: vi.fn().mockResolvedValue(true),
  }
}

const registration = () => ({ unregister: vi.fn().mockResolvedValue(true) })

beforeEach(() => {
  setUpdateSW(null)
  delete navigator.serviceWorker
  delete globalThis.caches
})

describe('forceUpdateWebApp', () => {
  it('unregisters every worker, deletes every cache, then reloads', async () => {
    const regs = [registration(), registration()]
    installServiceWorker(regs)
    installCaches(['workbox-precache-v2', 'sw-aircraft-models'])
    const reload = vi.fn()

    await forceUpdateWebApp({ reload })

    expect(regs[0].unregister).toHaveBeenCalled()
    expect(regs[1].unregister).toHaveBeenCalled()
    expect(globalThis.caches.delete).toHaveBeenCalledWith('workbox-precache-v2')
    expect(globalThis.caches.delete).toHaveBeenCalledWith('sw-aircraft-models')
    expect(reload).toHaveBeenCalled()
  })

  it('asks the registered worker to check for a new deploy first', async () => {
    // The cheap path: if a new bundle is already waiting, this alone gets it.
    // It runs before the clear so the clear is a backstop, not the whole plan.
    const updateSW = vi.fn().mockResolvedValue(undefined)
    setUpdateSW(updateSW)
    installServiceWorker([])
    installCaches([])

    await forceUpdateWebApp({ reload: vi.fn() })

    expect(updateSW).toHaveBeenCalled()
  })

  it('still reloads when the service worker API is unavailable', async () => {
    // Private browsing / SW disabled. There is nothing to clear, but the user
    // pressed a button and a plain reload is still the right outcome.
    installCaches([])
    const reload = vi.fn()

    await forceUpdateWebApp({ reload })

    expect(reload).toHaveBeenCalled()
  })

  it('still reloads when a cleanup step throws', async () => {
    // A browser that refuses a cache delete must not leave the button dead.
    installServiceWorker([registration()])
    globalThis.caches = { keys: vi.fn().mockRejectedValue(new Error('denied')) }
    const reload = vi.fn()

    await forceUpdateWebApp({ reload })

    expect(reload).toHaveBeenCalled()
  })

  it('still clears and reloads when the worker update check rejects', async () => {
    setUpdateSW(vi.fn().mockRejectedValue(new Error('no worker')))
    const regs = [registration()]
    installServiceWorker(regs)
    installCaches(['workbox-precache-v2'])
    const reload = vi.fn()

    await forceUpdateWebApp({ reload })

    expect(regs[0].unregister).toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })
})

describe('isNativeUpdateAvailable', () => {
  const android = (build) => ({ platform: 'android', version: '1.2.0', build })

  it('is true when the store has a higher build than this device', () => {
    expect(isNativeUpdateAvailable(android('27'), { android: { version: '1.2.23', build: '28' } })).toBe(true)
  })

  it('is false when the device is on the newest build', () => {
    expect(isNativeUpdateAvailable(android('28'), { android: { version: '1.2.23', build: '28' } })).toBe(false)
  })

  it('is false when the device is somehow ahead of everyone else', () => {
    // The developer's own build. Nothing to offer, and the store would only
    // show "Open".
    expect(isNativeUpdateAvailable(android('30'), { android: { version: '1.2.23', build: '28' } })).toBe(false)
  })

  it('compares numerically, not as strings', () => {
    // '9' > '28' lexicographically — the bug this guards against would tell
    // every user on build 9 that they were up to date.
    expect(isNativeUpdateAvailable(android('9'), { android: { version: '1.2.23', build: '28' } })).toBe(true)
  })

  it('reads the platform the device actually reports', () => {
    const ios = { platform: 'ios', version: '1.0.0', build: '4' }
    // A newer Android build must not make an iOS device look outdated.
    expect(isNativeUpdateAvailable(ios, { android: { build: '99' }, ios: { build: '4' } })).toBe(false)
    expect(isNativeUpdateAvailable(ios, { android: { build: '99' }, ios: { build: '5' } })).toBe(true)
  })

  it('is false on web — a commit sha cannot be compared', () => {
    const web = { platform: 'web', version: '1.2.23', build: 'a3f9c21' }
    expect(isNativeUpdateAvailable(web, { android: { build: '99' } })).toBe(false)
  })

  it('is false when either side is missing or unusable', () => {
    expect(isNativeUpdateAvailable(null, { android: { build: '28' } })).toBe(false)
    expect(isNativeUpdateAvailable(android('27'), null)).toBe(false)
    expect(isNativeUpdateAvailable(android('27'), { android: null })).toBe(false)
    expect(isNativeUpdateAvailable(android(null), { android: { build: '28' } })).toBe(false)
    expect(isNativeUpdateAvailable(android('27'), { android: { build: 'beta' } })).toBe(false)
  })
})

describe('PLAY_STORE_URL', () => {
  it('points at the shipped application id', () => {
    // Must match applicationId in android/app/build.gradle and appId in
    // capacitor.config.ts, or the link lands on a Play 404.
    expect(PLAY_STORE_URL).toBe('https://play.google.com/store/apps/details?id=academy.skywatch.app')
  })
})
