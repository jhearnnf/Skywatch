import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// appMode.SLIM_APP is a module-load constant; mock it per-test via the shared ref.
const slimAppRef = vi.hoisted(() => ({ value: false }))
vi.mock('../../utils/appMode', () => ({
  get SLIM_APP() { return slimAppRef.value },
}))

const settingsRef = vi.hoisted(() => ({ value: {} }))
const authRef     = vi.hoisted(() => ({ value: {} }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: settingsRef.value }),
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authRef.value,
}))

import { useSlimMode } from '../useSlimMode'

describe('useSlimMode', () => {
  beforeEach(() => {
    slimAppRef.value = false
    settingsRef.value = {}
    authRef.value = { user: null }
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

  it('is true on the web when an admin enables the site-wide flag (for a non-admin user)', () => {
    settingsRef.value = { slimModeEnabled: true }
    authRef.value = { user: { isAdmin: false } }
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(true)
  })

  it('exempts admins from the settings-driven slim (so they keep /admin access)', () => {
    settingsRef.value = { slimModeEnabled: true }
    authRef.value = { user: { isAdmin: true } }
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(false)
  })

  it('still slims an admin on the native app (native flag ignores the exemption)', () => {
    slimAppRef.value = true
    settingsRef.value = { slimModeEnabled: false }
    authRef.value = { user: { isAdmin: true } }
    const { result } = renderHook(() => useSlimMode())
    expect(result.current).toBe(true)
  })
})
