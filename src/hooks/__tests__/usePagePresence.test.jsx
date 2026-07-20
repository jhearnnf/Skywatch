import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Web by default — the native branch dynamically imports @capacitor/app, which
// isn't exercised here.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

import usePagePresence from '../usePagePresence'

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

const fire = (target, type) => act(() => { target.dispatchEvent(new Event(type)) })

describe('usePagePresence', () => {
  beforeEach(() => { setVisibility('visible') })

  it('starts present when the page is visible', () => {
    const { result } = renderHook(() => usePagePresence())
    expect(result.current.present).toBe(true)
    expect(result.current.presentRef.current).toBe(true)
  })

  it('starts absent when the page mounts hidden', () => {
    setVisibility('hidden')
    const { result } = renderHook(() => usePagePresence())
    expect(result.current.present).toBe(false)
  })

  it('drops presence when the page is hidden and restores it on return', () => {
    const { result } = renderHook(() => usePagePresence())

    setVisibility('hidden')
    fire(document, 'visibilitychange')
    expect(result.current.present).toBe(false)
    expect(result.current.presentRef.current).toBe(false)

    setVisibility('visible')
    fire(document, 'visibilitychange')
    expect(result.current.present).toBe(true)
  })

  it('drops presence on window blur and restores it on focus', () => {
    const { result } = renderHook(() => usePagePresence())

    fire(window, 'blur')
    expect(result.current.present).toBe(false)

    fire(window, 'focus')
    expect(result.current.present).toBe(true)
  })

  it('stays absent on focus while the page is still hidden', () => {
    const { result } = renderHook(() => usePagePresence())

    setVisibility('hidden')
    fire(document, 'visibilitychange')
    fire(window, 'focus')

    expect(result.current.present).toBe(false)
  })

  it('drops presence on pagehide', () => {
    const { result } = renderHook(() => usePagePresence())
    fire(window, 'pagehide')
    expect(result.current.present).toBe(false)
  })

  it('stops responding after unmount', () => {
    const { result, unmount } = renderHook(() => usePagePresence())
    unmount()
    fire(window, 'blur')
    expect(result.current.presentRef.current).toBe(true)
  })
})
