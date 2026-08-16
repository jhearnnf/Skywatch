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

afterEach(cleanup)

const box = () => screen.getByPlaceholderText('Type a message…')

describe('ComposeBox', () => {
  it('grows to fit a message that has become multi-line', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    expect(box().style.height).toBe(`${LINE}px`)

    fireEvent.change(box(), { target: { value: 'one\ntwo\nthree' } })
    expect(box().style.height).toBe(`${LINE * 3}px`)
  })

  it('stops growing past the cap so the composer cannot eat the thread', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    fireEvent.change(box(), { target: { value: Array(20).fill('line').join('\n') } })
    expect(box().style.height).toBe('160px')
  })

  it('shrinks back to one line after sending', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    fireEvent.change(box(), { target: { value: 'one\ntwo\nthree' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(box().style.height).toBe(`${LINE}px`)
  })
})
