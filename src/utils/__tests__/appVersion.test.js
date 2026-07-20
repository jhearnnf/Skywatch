import { describe, it, expect, vi, beforeEach } from 'vitest'

// Platform + native bridge are both swappable so each case can pin them.
const platformRef = vi.hoisted(() => ({ value: 'web' }))
const infoRef     = vi.hoisted(() => ({ value: { version: '1.2.3', build: '7' }, calls: 0, throws: false }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platformRef.value },
}))
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: async () => {
      infoRef.calls += 1
      if (infoRef.throws) throw new Error('no bridge')
      return infoRef.value
    },
  },
}))

const load = async () => {
  vi.resetModules()
  return import('../appVersion')
}

beforeEach(() => {
  platformRef.value = 'web'
  infoRef.value  = { version: '1.2.3', build: '7' }
  infoRef.calls  = 0
  infoRef.throws = false
})

describe('appVersion', () => {
  it('resolves the web build synchronously', async () => {
    // The heartbeat's send loop is not allowed to await, so web — where the
    // answer is baked into the bundle — must be readable immediately.
    const { peekClientInfo } = await load()
    const info = peekClientInfo()
    expect(info.platform).toBe('web')
    expect(info.version).toBeTruthy()
    expect(info.build).toBeTruthy()
  })

  it('reads the native version from the OS, not the bundle stamp', async () => {
    // The same JS bundle ships inside every Android build, so only the bridge
    // can say which store release this is.
    platformRef.value = 'android'
    const { getClientInfo } = await load()
    await expect(getClientInfo()).resolves.toEqual({
      platform: 'android', version: '1.2.3', build: '7',
    })
  })

  it('does not answer for native until the bridge has replied', async () => {
    platformRef.value = 'android'
    const { peekClientInfo, getClientInfo } = await load()
    expect(peekClientInfo()).toBeNull()
    await getClientInfo()
    expect(peekClientInfo()).toMatchObject({ platform: 'android', version: '1.2.3' })
  })

  it('reports nothing rather than guessing when the bridge fails', async () => {
    // Falling back to the web stamp would file the bundle's commit sha as an
    // Android build, poisoning the server's "newest release" ranking and making
    // every real app user look outdated.
    platformRef.value = 'android'
    infoRef.throws = true
    const { getClientInfo, peekClientInfo } = await load()
    await expect(getClientInfo()).resolves.toBeNull()
    expect(peekClientInfo()).toBeNull()
  })

  it('asks the bridge only once', async () => {
    platformRef.value = 'android'
    const { getClientInfo } = await load()
    await Promise.all([getClientInfo(), getClientInfo()])
    await getClientInfo()
    expect(infoRef.calls).toBe(1)
  })

  it('ignores a blank version from the bridge', async () => {
    platformRef.value = 'android'
    infoRef.value = { version: '   ', build: '7' }
    const { getClientInfo } = await load()
    await expect(getClientInfo()).resolves.toBeNull()
  })
})
