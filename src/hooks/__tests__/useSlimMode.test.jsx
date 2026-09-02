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

  // The native app used to be excluded outright. It now follows the same flag
  // as web slim: the page is reachable from the header logo, and the proof wall
  // it carries has no equivalent on /cbat. Opening on it every launch is a
  // separate question — see useNativeLaunchRoute.
  it('defaults to on in the native app', () => {
    slimAppRef.value = true
    expect(render()).toBe(true)
  })

  it('is off in the native app when an admin turns the landing page off', () => {
    slimAppRef.value = true
    settingsRef.value = { slimLandingEnabled: false }
    expect(render()).toBe(false)
  })
})
