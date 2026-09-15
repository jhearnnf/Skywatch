import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The hook only ever registers on native; the platform is flipped per test.
let native = true
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
}))

const addListener = vi.fn()
const remove = vi.fn()
const exitApp = vi.fn()
vi.mock('@capacitor/app', () => ({
  App: { addListener, exitApp },
}))

import { useNativeBackButton } from '../useNativeBackButton'

// The dynamic import resolves on a microtask; let it settle before asserting.
const settle = () => new Promise(r => setTimeout(r, 0))

const atPath = (path) => history.replaceState(null, '', path)

describe('useNativeBackButton', () => {
  beforeEach(() => {
    native = true
    addListener.mockReset().mockResolvedValue({ remove })
    remove.mockReset()
    exitApp.mockReset()
    atPath('/cbat')
  })

  it('registers the back-button listener on a native app page', async () => {
    renderHook(() => useNativeBackButton())
    await settle()
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function))
  })

  it('steps back through history when there is somewhere to go, and exits otherwise', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    renderHook(() => useNativeBackButton())
    await settle()
    const handler = addListener.mock.calls[0][1]

    handler({ canGoBack: true })
    expect(back).toHaveBeenCalledTimes(1)
    expect(exitApp).not.toHaveBeenCalled()

    handler({ canGoBack: false })
    expect(exitApp).toHaveBeenCalledTimes(1)
    back.mockRestore()
  })

  it('removes the listener on unmount', async () => {
    const { unmount } = renderHook(() => useNativeBackButton())
    await settle()
    unmount()
    await settle()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  // The guide iframes /embed/cbat/:id, which boots this whole SPA. A listener
  // registered from inside that frame hijacks the hardware back button for the
  // guide document around it, which has no handler for the event, so the
  // reader is stranded on the guide. The frame must stay silent.
  it('does not register from inside an embed frame', async () => {
    atPath('/embed/cbat/flag')
    renderHook(() => useNativeBackButton())
    await settle()
    expect(addListener).not.toHaveBeenCalled()
  })

  it('does nothing on the web', async () => {
    native = false
    renderHook(() => useNativeBackButton())
    await settle()
    expect(addListener).not.toHaveBeenCalled()
  })
})
