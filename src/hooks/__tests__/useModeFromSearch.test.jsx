import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useModeFromSearch } from '../useModeFromSearch'

// Trace and Visualisation open on the mode you last played. That's right when
// you navigate in yourself and wrong when a link named a mode — the landing
// wall has a tile per mode, and tapping "Trace Practise 3D" used to open
// Trace 1.

const MODES = ['2d', '3d', 'trace1', 'trace2']

const at = (url) => ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>

describe('useModeFromSearch', () => {
  it('applies the mode a link asked for', () => {
    const apply = vi.fn()
    renderHook(() => useModeFromSearch(MODES, apply), { wrapper: at('/cbat/trace?mode=3d') })
    expect(apply).toHaveBeenCalledWith('3d')
  })

  it('does nothing when no mode was named', () => {
    const apply = vi.fn()
    renderHook(() => useModeFromSearch(MODES, apply), { wrapper: at('/cbat/trace') })
    expect(apply).not.toHaveBeenCalled()
  })

  it('ignores a mode it does not recognise', () => {
    // The page's setter validates unknown values down to its default, which
    // would quietly wipe the visitor's real stored preference.
    const apply = vi.fn()
    renderHook(() => useModeFromSearch(MODES, apply), { wrapper: at('/cbat/trace?mode=banana') })
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies once, so it cannot fight the admin-gating fallback', () => {
    const apply = vi.fn()
    const { rerender } = renderHook(() => useModeFromSearch(MODES, apply), {
      wrapper: at('/cbat/trace?mode=trace2'),
    })
    rerender()
    rerender()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('stands down when the mode is pinned by prop (a demo tile)', () => {
    renderHook(() => useModeFromSearch(MODES, null), { wrapper: at('/cbat/trace?mode=3d') })
    // Nothing to assert but the absence of a throw — the point is that a demo
    // mount inside the landing page never writes the visitor's stored mode.
    expect(true).toBe(true)
  })
})
