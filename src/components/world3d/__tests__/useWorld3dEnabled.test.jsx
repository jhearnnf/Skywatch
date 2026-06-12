import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: vi.fn(),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAppSettings } from '../../../context/AppSettingsContext'
import { useAuth } from '../../../context/AuthContext'
import { useWorld3dEnabled } from '../state/useWorld3dEnabled'

function setup(flagMode, user) {
  useAppSettings.mockReturnValue({ settings: { featureFlags: { world3d: flagMode } } })
  useAuth.mockReturnValue({ user })
}

describe('useWorld3dEnabled', () => {
  it('is false when flag is off', () => {
    setup('off', { id: '1', isAdmin: true })
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })

  it('is false when flag is admin and user is not admin', () => {
    setup('admin', { id: '1', isAdmin: false })
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })

  it('is true when flag is admin and user is admin', () => {
    setup('admin', { id: '1', isAdmin: true })
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(true)
  })

  it('is true when flag is everyone and user is logged in (non-admin)', () => {
    setup('everyone', { id: '1', isAdmin: false })
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(true)
  })

  it('is false when flag is everyone but no user', () => {
    setup('everyone', null)
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })

  it('defaults to off when the flag key is missing', () => {
    useAppSettings.mockReturnValue({ settings: { featureFlags: {} } })
    useAuth.mockReturnValue({ user: { id: '1', isAdmin: true } })
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })
})
