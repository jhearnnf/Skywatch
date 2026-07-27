import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// appMode.SLIM_APP is a module-load constant; mock it per-test via the shared ref.
const slimAppRef = vi.hoisted(() => ({ value: false }))
vi.mock('../../utils/appMode', () => ({
  get SLIM_APP() { return slimAppRef.value },
}))

const settingsRef = vi.hoisted(() => ({ value: {} }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: settingsRef.value }),
}))

import { useSlimMode, useLandingPageEnabled } from '../useSlimMode'

describe('useSlimMode', () => {
  beforeEach(() => {
    slimAppRef.value = false
    settingsRef.value = {}
  })

  it('is false on the web with the flag off', () => {
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(false)
  })

  it('is true on the native app regardless of the flag', () => {
    slimAppRef.value = true
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(true)
  })

  it('is true on the web when an admin enables the site-wide flag', () => {
    settingsRef.value = { slimModeEnabled: true }
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(true)
  })

  it('does NOT exempt anyone — the flag slims all clients (admins included)', () => {
    // Admin exemption was removed: /admin stays reachable instead, so admins
    // can still turn the flag off. The hook itself is user-agnostic.
    settingsRef.value = { slimModeEnabled: true }
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(true)
  })
})

describe('useLandingPageEnabled', () => {
  beforeEach(() => {
    slimAppRef.value = false
    settingsRef.value = {}
  })

  const render = () => renderHook(() => useLandingPageEnabled()).result.current

  it('is always true on the full site — the landing page is not optional there', () => {
    expect(render()).toBe(true)
    settingsRef.value = { slimLandingEnabled: false }
    expect(render()).toBe(true)
  })

  it('defaults to on in web slim mode', () => {
    settingsRef.value = { slimModeEnabled: true }
    expect(render()).toBe(true)
  })

  it('is off in web slim mode when an admin turns the landing page off', () => {
    settingsRef.value = { slimModeEnabled: true, slimLandingEnabled: false }
    expect(render()).toBe(false)
  })

  it('is off on the native app whatever the flag says', () => {
    slimAppRef.value = true
    settingsRef.value = { slimLandingEnabled: true }
    expect(render()).toBe(false)
  })
})
