import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const authRef = vi.hoisted(() => ({ user: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: authRef.user }),
}))

import { useUiTheme } from '../useUiTheme'

// The hook is the one place the account's theme reaches the DOM. It has to
// track the signed-in user, including signing out, which must put the default
// look back rather than leaving a visitor on the Real CBAT screen.

describe('useUiTheme', () => {
  beforeEach(() => {
    authRef.user = null
    document.documentElement.removeAttribute('data-theme')
  })

  it('leaves <html> unstamped for a guest', () => {
    const { result } = renderHook(() => useUiTheme())
    expect(result.current).toBe('skywatch')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('stamps the saved Real CBAT theme for a signed-in user', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const { result } = renderHook(() => useUiTheme())
    expect(result.current).toBe('cbat')
    expect(document.documentElement.getAttribute('data-theme')).toBe('cbat')
  })

  it('follows the user when the theme changes', () => {
    authRef.user = { _id: 'u1', uiTheme: 'skywatch' }
    const { rerender } = renderHook(() => useUiTheme())
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)

    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    rerender()
    expect(document.documentElement.getAttribute('data-theme')).toBe('cbat')
  })

  it('removes the theme on sign-out', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const { rerender } = renderHook(() => useUiTheme())
    expect(document.documentElement.getAttribute('data-theme')).toBe('cbat')

    authRef.user = null
    rerender()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
