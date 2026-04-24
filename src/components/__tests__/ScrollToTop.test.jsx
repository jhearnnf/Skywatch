import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import ScrollToTop, { __resetScrollToTopForTests } from '../ScrollToTop'

let mockLocation = { pathname: '/home' }
let mockNavType  = 'PUSH'

vi.mock('react-router-dom', () => ({
  useLocation:       () => mockLocation,
  useNavigationType: () => mockNavType,
}))

describe('ScrollToTop', () => {
  let scrollSpy

  beforeEach(() => {
    __resetScrollToTopForTests()
    mockLocation = { pathname: '/home' }
    mockNavType  = 'PUSH'
    scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
  })

  it('scrolls to 0 on initial PUSH mount', () => {
    render(<ScrollToTop />)
    expect(scrollSpy).toHaveBeenCalledWith(0, 0)
  })

  it('restores cached scroll on POP and resets to 0 on PUSH', () => {
    mockLocation = { pathname: '/home' }
    mockNavType  = 'PUSH'
    const app = render(<ScrollToTop />)
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 0)

    act(() => {
      window.scrollY = 1200
      window.dispatchEvent(new Event('scroll'))
    })

    mockLocation = { pathname: '/profile' }
    mockNavType  = 'PUSH'
    scrollSpy.mockClear()
    app.rerender(<ScrollToTop />)
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 0)

    mockLocation = { pathname: '/home' }
    mockNavType  = 'POP'
    scrollSpy.mockClear()
    app.rerender(<ScrollToTop />)
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 1200)
  })

  it('falls back to 0 on POP when no cached scroll exists for that pathname', () => {
    mockLocation = { pathname: '/unseen' }
    mockNavType  = 'POP'
    render(<ScrollToTop />)
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 0)
  })

  it('does not scroll when only search params change (same pathname)', () => {
    mockLocation = { pathname: '/learn-priority' }
    mockNavType  = 'PUSH'
    const app = render(<ScrollToTop />)

    act(() => {
      window.scrollY = 800
      window.dispatchEvent(new Event('scroll'))
    })
    scrollSpy.mockClear()

    // Simulates a replace-nav that only rewrites `?category=…`.
    mockLocation = { pathname: '/learn-priority' }
    mockNavType  = 'REPLACE'
    app.rerender(<ScrollToTop />)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('skips POP restore for /learn-priority so the page owns scroll on arrival', () => {
    mockLocation = { pathname: '/learn-priority' }
    mockNavType  = 'PUSH'
    const app = render(<ScrollToTop />)

    act(() => {
      window.scrollY = 400
      window.dispatchEvent(new Event('scroll'))
    })

    mockLocation = { pathname: '/brief/xyz' }
    mockNavType  = 'PUSH'
    app.rerender(<ScrollToTop />)

    scrollSpy.mockClear()
    mockLocation = { pathname: '/learn-priority' }
    mockNavType  = 'POP'
    app.rerender(<ScrollToTop />)
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 0)
  })

  it('mutates scroll during render so child useScroll reads 0 on first paint', () => {
    let childObservedScrollY = null
    function Child() {
      childObservedScrollY = window.scrollY
      return null
    }
    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true })
    scrollSpy.mockImplementation((_x, y) => {
      Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true })
    })

    mockLocation = { pathname: '/fresh' }
    mockNavType  = 'PUSH'
    render(<><ScrollToTop /><Child /></>)
    expect(childObservedScrollY).toBe(0)
  })
})
