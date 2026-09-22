import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, afterEach, beforeAll } from 'vitest'
import ComposeBox from '../components/ComposeBox'

// jsdom has no layout, so scrollHeight is always 0. Stand in for it with a
// height that grows a line at a time, which is what the browser reports.
const LINE = 36
beforeAll(() => {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return this.value.split('\n').length * LINE },
  })
})

afterEach(() => {
  cleanup()
  delete window.matchMedia
})

// Stand in for the pointer media query: coarse is a phone, fine is a mouse.
const pointer = (kind) => {
  window.matchMedia = vi.fn(q => ({ matches: q === `(pointer: ${kind})` }))
}
const phoneWidth = () => {
  window.matchMedia = vi.fn(q => ({ matches: q === '(max-width: 600px)' }))
}

const box = () => screen.getByPlaceholderText('Type a message…')

describe('ComposeBox', () => {
  it('grows to fit a message that has become multi-line', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    expect(box().style.height).toBe(`${LINE}px`)

    fireEvent.change(box(), { target: { value: 'one\ntwo\nthree' } })
    expect(box().style.height).toBe(`${LINE * 3}px`)
  })

  it('on a phone stops growing past the cap so the composer cannot eat the thread', () => {
    phoneWidth()
    render(<ComposeBox onSend={vi.fn()} />)
    fireEvent.change(box(), { target: { value: Array(20).fill('line').join('\n') } })
    expect(box().style.height).toBe('160px')
  })

  it('on desktop keeps growing so a long message never scrolls inside the box', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    fireEvent.change(box(), { target: { value: Array(20).fill('line').join('\n') } })
    expect(box().style.height).toBe(`${LINE * 20}px`)
  })

  it('shrinks back to one line after sending', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'one\ntwo\nthree' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(box().style.height).toBe(`${LINE}px`)
  })

  it('adds the border back so the box never scrolls by a couple of pixels', () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'offsetHeight', { configurable: true, get() { return 2 } })
    Object.defineProperty(HTMLTextAreaElement.prototype, 'clientHeight', { configurable: true, get() { return 0 } })
    try {
      render(<ComposeBox onSend={vi.fn()} />)
      expect(box().style.height).toBe(`${LINE + 2}px`)
    } finally {
      delete HTMLTextAreaElement.prototype.offsetHeight
      delete HTMLTextAreaElement.prototype.clientHeight
    }
  })

  describe('the ask-the-bot button', () => {
    const askBot = () => screen.getByRole('button', { name: 'Ask Guide Bot a question' })

    it('is absent in a room the server names no bot for', () => {
      render(<ComposeBox onSend={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Ask .* a question/ })).toBeNull()
    })

    it('puts the mention in front of what is already typed', () => {
      render(<ComposeBox onSend={vi.fn()} botName="Guide Bot" />)
      fireEvent.change(box(), { target: { value: 'how long is the test?' } })
      fireEvent.click(askBot())
      expect(box().value).toBe('@Guide Bot how long is the test? ')
    })

    it('leaves a trailing space to type into when the box is empty', () => {
      render(<ComposeBox onSend={vi.fn()} botName="Guide Bot" />)
      fireEvent.click(askBot())
      expect(box().value).toBe('@Guide Bot ')
    })

    it('does not stack the mention when pressed twice', () => {
      render(<ComposeBox onSend={vi.fn()} botName="Guide Bot" />)
      fireEvent.click(askBot())
      fireEvent.change(box(), { target: { value: '@Guide Bot hello' } })
      fireEvent.click(askBot())
      expect(box().value).toBe('@Guide Bot hello')
    })
  })

  describe('Enter', () => {
    it('sends from a physical keyboard, and Shift+Enter breaks the line', () => {
      pointer('fine')
      const onSend = vi.fn()
      render(<ComposeBox onSend={onSend} />)
      fireEvent.change(box(), { target: { value: 'hello' } })
      fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
      expect(onSend).not.toHaveBeenCalled()
      fireEvent.keyDown(box(), { key: 'Enter' })
      expect(onSend).toHaveBeenCalledWith('hello')
      expect(box().value).toBe('')
    })

    it('starts a new line on a touch keyboard; only the Send button sends', () => {
      pointer('coarse')
      const onSend = vi.fn()
      render(<ComposeBox onSend={onSend} />)
      fireEvent.change(box(), { target: { value: 'hello' } })
      const evt = fireEvent.keyDown(box(), { key: 'Enter' })
      expect(evt).toBe(true) // not prevented, so the newline goes in
      expect(onSend).not.toHaveBeenCalled()
      expect(box().value).toBe('hello')
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(onSend).toHaveBeenCalledWith('hello')
    })
  })
})
