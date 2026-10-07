import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useContainWheel } from '../useContainWheel'

function Panel() {
  const ref = useRef(null)
  useContainWheel(ref)
  return (
    <aside ref={ref}>
      <header data-testid="header">Lounge</header>
      <div data-testid="list" style={{ overflowY: 'auto' }}>
        <p data-testid="message">hello</p>
      </div>
    </aside>
  )
}

// jsdom does no layout, so the list's scroll geometry is pinned by hand: 1000px
// of messages in a 300px box, scrolled to `top`.
function setList(top) {
  const list = screen.getByTestId('list')
  Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true })
  list.scrollTop = top
}

// fireEvent returns false when the event was cancelled.
const wheel = (el, deltaY, extra = {}) => fireEvent.wheel(el, { deltaY, cancelable: true, ...extra })

describe('useContainWheel', () => {
  it('lets a list that can still scroll take the wheel', () => {
    render(<Panel />)
    setList(200)
    expect(wheel(screen.getByTestId('message'), 100)).toBe(true)
    expect(wheel(screen.getByTestId('message'), -100)).toBe(true)
  })

  it('stops the page scrolling once the list is at its end', () => {
    render(<Panel />)
    setList(700) // at the bottom, where the chat sits
    expect(wheel(screen.getByTestId('message'), 100)).toBe(false)
    // Back up still works.
    expect(wheel(screen.getByTestId('message'), -100)).toBe(true)
  })

  it('stops the page scrolling over parts of the panel that do not scroll', () => {
    render(<Panel />)
    setList(200)
    expect(wheel(screen.getByTestId('header'), 100)).toBe(false)
  })

  it('leaves ctrl+wheel to the browser for zooming', () => {
    render(<Panel />)
    expect(wheel(screen.getByTestId('header'), 100, { ctrlKey: true })).toBe(true)
  })
})
