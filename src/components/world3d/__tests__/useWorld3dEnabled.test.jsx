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
import { useWorld3dEnabled, useWorld3dNavVisible } from '../state/useWorld3dEnabled'

function setup(hangarGameEnabled, user) {
  useAppSettings.mockReturnValue({ settings: { hangarGameEnabled } })
  useAuth.mockReturnValue({ user })
}

const admin   = { id: '1', isAdmin: true }
const regular = { id: '2', isAdmin: false }

describe('useWorld3dEnabled — access', () => {
  it('is false for a normal user when the toggle is off', () => {
    setup(false, regular)
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })

  it('is true for a normal user when the toggle is on', () => {
    setup(true, regular)
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(true)
  })

  it('is true for an admin even when the toggle is off — URL access is never gated', () => {
    setup(false, admin)
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(true)
  })

  it('is false when logged out, even with the toggle on', () => {
    setup(true, null)
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })

  it('defaults to off when the setting is missing', () => {
    useAppSettings.mockReturnValue({ settings: {} })
    useAuth.mockReturnValue({ user: regular })
    expect(renderHook(() => useWorld3dEnabled()).result.current).toBe(false)
  })
})

describe('useWorld3dNavVisible — nav entry', () => {
  it('is false for a normal user when the toggle is off', () => {
    setup(false, regular)
    expect(renderHook(() => useWorld3dNavVisible()).result.current).toBe(false)
  })

  it('is true for a normal user when the toggle is on', () => {
    setup(true, regular)
    expect(renderHook(() => useWorld3dNavVisible()).result.current).toBe(true)
  })

  it('is false for an admin when the toggle is off — the URL escape hatch shows no nav item', () => {
    setup(false, admin)
    expect(renderHook(() => useWorld3dNavVisible()).result.current).toBe(false)
  })

  it('is true for an admin when the toggle is on', () => {
    setup(true, admin)
    expect(renderHook(() => useWorld3dNavVisible()).result.current).toBe(true)
  })

  it('is false when logged out', () => {
    setup(true, null)
    expect(renderHook(() => useWorld3dNavVisible()).result.current).toBe(false)
  })
})
