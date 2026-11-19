import { vi, describe, it, expect, beforeEach } from 'vitest'

// A stand-in for a Capacitor plugin as Capacitor builds it: a Proxy that
// answers EVERY property as a native method, `then` included. That `then` is
// what hung the 1.2.78 Settings card: a promise resolved with the plugin
// treated it as another promise and waited on it forever.
const native = vi.hoisted(() => ({ permission: 'prompt', calls: [] }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}))

vi.mock('@capacitor/push-notifications', () => {
  const methods = {
    checkPermissions: async () => ({ receive: native.permission }),
    requestPermissions: async () => { native.permission = 'granted'; return { receive: 'granted' } },
    createChannel: async () => {},
    register: async () => { setTimeout(() => native.onRegistration?.({ value: 'fcm-token-1' }), 0) },
    unregister: async () => {},
    addListener: async (event, fn) => {
      if (event === 'registration') native.onRegistration = fn
      return { remove: () => {} }
    },
  }
  const PushNotifications = new Proxy({}, {
    get(_, prop) {
      native.calls.push(prop)
      if (prop in methods) return methods[prop]
      // Capacitor's createPluginMethodWrapper: calls into native, and never
      // touches the resolve/reject a thenable-check would hand it.
      return () => new Promise(() => {})
    },
  })
  return { PushNotifications }
})

const { deviceStatus, enableOnDevice } = await import('../pushNotifications')

const apiFetch = vi.fn(async (url) => ({
  ok: true,
  json: async () => (url.endsWith('/config') ? { data: { webPublicKey: null, fcm: true } } : { status: 'success' }),
}))

beforeEach(() => {
  native.permission = 'prompt'
  native.calls = []
  apiFetch.mockClear()
  localStorage.clear()
})

describe('push on Android', () => {
  it('finishes the device check instead of hanging on the plugin', async () => {
    await expect(deviceStatus({ API: '', apiFetch })).resolves.toBe('off')
    expect(native.calls).not.toContain('then')
  })

  it('asks permission, registers and saves the token', async () => {
    await expect(enableOnDevice({ API: '', apiFetch })).resolves.toBe('on')
    expect(apiFetch).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
      body: JSON.stringify({ kind: 'fcm', token: 'fcm-token-1', platform: 'android' }),
    }))
    await expect(deviceStatus({ API: '', apiFetch })).resolves.toBe('on')
  })

  it('reports a refused permission as blocked', async () => {
    native.permission = 'denied'
    await expect(deviceStatus({ API: '', apiFetch })).resolves.toBe('blocked')
  })
})
