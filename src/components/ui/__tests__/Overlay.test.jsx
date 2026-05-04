import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Overlay from '../Overlay'

beforeEach(() => {
  // Reset body styles between tests
  document.body.removeAttribute('style')
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.removeAttribute('style')
})

describe('Overlay', () => {
  it('renders children inside a portal on document.body', () => {
    render(<Overlay><span data-testid="child">hello</span></Overlay>)
    expect(screen.getByTestId('child')).toBeTruthy()
    expect(document.body.contains(screen.getByTestId('child'))).toBe(true)
  })

  it('has the safe-area-inset class by default', () => {
    render(<Overlay data-testid="overlay">content</Overlay>)
    expect(screen.getByTestId('overlay').classList.contains('safe-area-inset')).toBe(true)
  })

  it('omits safe-area-inset class when respectSafeArea={false}', () => {
    render(<Overlay data-testid="overlay" respectSafeArea={false}>content</Overlay>)
    expect(screen.getByTestId('overlay').classList.contains('safe-area-inset')).toBe(false)
  })

  it('calls onDismiss when the backdrop is clicked but not when a child is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <Overlay data-testid="overlay" onDismiss={onDismiss}>
        <button data-testid="child-btn">click me</button>
      </Overlay>
    )
    fireEvent.click(screen.getByTestId('child-btn'))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('overlay'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('applies the given zIndex to the root style', () => {
    render(<Overlay data-testid="overlay" zIndex={9999}>content</Overlay>)
    expect(screen.getByTestId('overlay').style.zIndex).toBe('9999')
  })

  it('locks body scroll when lockBodyScroll is true', () => {
    render(<Overlay lockBodyScroll>content</Overlay>)
    expect(document.body.style.position).toBe('fixed')
  })

  it('restores body scroll on unmount when lockBodyScroll was true', () => {
    const { unmount } = render(<Overlay lockBodyScroll>content</Overlay>)
    expect(document.body.style.position).toBe('fixed')
    act(() => { unmount() })
    expect(document.body.style.position).not.toBe('fixed')
  })
})
