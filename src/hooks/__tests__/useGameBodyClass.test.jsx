import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGameBodyClass } from '../useGameBodyClass'
import { CbatDemoContext } from '../../utils/cbat/demoMode'

// Games restyle <body> while they own the screen. A game playing inside a
// landing-page tile owns nothing, and one of these classes
// (cbat-vis2d-locked) sets `overflow: hidden` on phones — which killed
// scrolling on the whole landing page.

const inDemo = ({ children }) => (
  <CbatDemoContext.Provider value={{ portalTarget: null }}>{children}</CbatDemoContext.Provider>
)

describe('useGameBodyClass', () => {
  afterEach(() => { document.body.className = '' })

  it('marks the body while a real game is active', () => {
    const { unmount } = renderHook(() => useGameBodyClass('cbat-vis2d-locked', true))
    expect(document.body.classList.contains('cbat-vis2d-locked')).toBe(true)
    unmount()
    expect(document.body.classList.contains('cbat-vis2d-locked')).toBe(false)
  })

  it('leaves the body alone while the game is not active', () => {
    renderHook(() => useGameBodyClass('cbat-vis2d-locked', false))
    expect(document.body.classList.contains('cbat-vis2d-locked')).toBe(false)
  })

  it('drops the class when the game goes inactive', () => {
    const { rerender } = renderHook(({ on }) => useGameBodyClass('cbat-cut-wide', on), {
      initialProps: { on: true },
    })
    expect(document.body.classList.contains('cbat-cut-wide')).toBe(true)
    rerender({ on: false })
    expect(document.body.classList.contains('cbat-cut-wide')).toBe(false)
  })

  it('never touches the body from inside a demo card', () => {
    renderHook(() => useGameBodyClass('cbat-vis2d-locked', true), { wrapper: inDemo })
    expect(document.body.className).toBe('')
  })

  it('defaults to active, for games that mark the body for their whole mount', () => {
    renderHook(() => useGameBodyClass('cbat-sat-beta'))
    expect(document.body.classList.contains('cbat-sat-beta')).toBe(true)
  })
})
