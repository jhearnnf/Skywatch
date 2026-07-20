import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The hook reads auth from context and the transport options from the same
// module. Mocking both lets us assert exactly what a raw fetch would carry on
// web vs native without standing up a provider.
const authRef    = vi.hoisted(() => ({ user: { _id: 'u1' }, API: 'https://api.test' }))
const optionsRef = vi.hoisted(() => ({ value: { credentials: 'include' } }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authRef,
  authFetchOptions: () => optionsRef.value,
}))

// Build identity is resolved per-platform elsewhere; the hook only has to put
// whatever is known on the wire (and cope with nothing being known yet).
const clientRef = vi.hoisted(() => ({ value: { platform: 'web', version: '1.2.3', build: 'a3f9c21' } }))
vi.mock('../../utils/appVersion', () => ({
  getClientInfo:  () => Promise.resolve(clientRef.value),
  peekClientInfo: () => clientRef.value,
}))

import useHeartbeat from '../useHeartbeat'

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('useHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    authRef.user = { _id: 'u1' }
    optionsRef.value = { credentials: 'include' }
    clientRef.value = { platform: 'web', version: '1.2.3', build: 'a3f9c21' }
    setVisibility('visible')
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }))
  })
  afterEach(() => { vi.useRealTimers() })

  const urlOf = (call) => call[0]
  const optsOf = (call) => call[1]

  it('posts a heartbeat on mount', () => {
    renderHook(() => useHeartbeat())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(urlOf(global.fetch.mock.calls[0])).toBe('https://api.test/api/users/heartbeat')
    expect(optsOf(global.fetch.mock.calls[0])).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it('sends the native Bearer header when authFetchOptions supplies one', () => {
    // Regression: the hook used a hard-coded `credentials: 'include'`, which the
    // Android WebView has no cookie for. Every app heartbeat 401'd, so no native
    // user ever counted towards Users Online.
    optionsRef.value = { headers: { Authorization: 'Bearer tok' } }
    renderHook(() => useHeartbeat())
    expect(optsOf(global.fetch.mock.calls[0])).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect(optsOf(global.fetch.mock.calls[0]).credentials).toBeUndefined()
  })

  it('does not send anything when signed out', () => {
    authRef.user = null
    renderHook(() => useHeartbeat())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('keeps sending while the tab is visible but untouched for 4 minutes', () => {
    // Must outlast the 2-minute gate this replaced, or someone reading a page
    // silently drops out of the server's 5-minute online window.
    renderHook(() => useHeartbeat())
    act(() => { vi.advanceTimersByTime(4 * 60 * 1000) })
    expect(global.fetch.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops once idle past the server online window', () => {
    renderHook(() => useHeartbeat())
    act(() => { vi.advanceTimersByTime(6 * 60 * 1000) })
    const afterIdle = global.fetch.mock.calls.length
    act(() => { vi.advanceTimersByTime(2 * 60 * 1000) })
    expect(global.fetch.mock.calls.length).toBe(afterIdle)
  })

  it('skips sends while the tab is hidden', () => {
    renderHook(() => useHeartbeat())
    global.fetch.mockClear()
    setVisibility('hidden')
    act(() => { vi.advanceTimersByTime(90_000) })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends immediately when the user returns to a long-backgrounded tab', () => {
    renderHook(() => useHeartbeat())
    setVisibility('hidden')
    act(() => { vi.advanceTimersByTime(30 * 60 * 1000) })
    global.fetch.mockClear()

    setVisibility('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('reports the running build alongside presence', () => {
    renderHook(() => useHeartbeat())
    const opts = optsOf(global.fetch.mock.calls[0])
    expect(JSON.parse(opts.body)).toEqual({
      client: { platform: 'web', version: '1.2.3', build: 'a3f9c21' },
    })
    expect(opts.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('keeps the native Bearer header when adding the JSON content type', () => {
    // Merging headers must not drop what authFetchOptions supplied, or every
    // native heartbeat 401s again.
    optionsRef.value = { headers: { Authorization: 'Bearer tok' } }
    renderHook(() => useHeartbeat())
    expect(optsOf(global.fetch.mock.calls[0]).headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    })
  })

  it('still sends a heartbeat when the build is not resolved yet', () => {
    // Native needs a bridge round-trip for its version. Presence drives Users
    // Online and must never wait on — or be lost to — version reporting.
    clientRef.value = null
    renderHook(() => useHeartbeat())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(optsOf(global.fetch.mock.calls[0]).body)).toEqual({})
  })

  it('stops sending after unmount', () => {
    const { unmount } = renderHook(() => useHeartbeat())
    unmount()
    global.fetch.mockClear()
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
