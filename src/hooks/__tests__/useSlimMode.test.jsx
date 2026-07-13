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

import { useSlimMode } from '../useSlimMode'

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
