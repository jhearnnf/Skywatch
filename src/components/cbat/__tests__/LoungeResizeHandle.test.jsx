import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LoungeResizeHandle from '../LoungeResizeHandle'

// jsdom does no layout, so the two cards' heights are pinned by hand: 600px of
// column shared 360 (Recent Scores) / 240 (chat).
function setup() {
  const onChange = vi.fn()
  const onDragChange = vi.fn()
  render(
    <div>
      <div data-testid="scores" />
      <LoungeResizeHandle onChange={onChange} onDragChange={onDragChange} />
      <div data-testid="chat" />
    </div>,
  )
  Object.defineProperty(screen.getByTestId('scores'), 'offsetHeight', { value: 360, configurable: true })
  Object.defineProperty(screen.getByTestId('chat'),   'offsetHeight', { value: 240, configurable: true })
  const handle = screen.getByRole('separator')
  handle.setPointerCapture = vi.fn()
  return { handle, onChange, onDragChange }
}

describe('LoungeResizeHandle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers a "Drag to resize" tooltip', () => {
    setup()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Drag to resize')
  })

  it('makes the chat taller when dragged up', () => {
    const { handle, onChange, onDragChange } = setup()

    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    expect(onDragChange).toHaveBeenLastCalledWith(true)
    fireEvent.pointerMove(handle, { clientY: 340, pointerId: 1 })
    // Chat 240 + 60 = 300 of 600: an even split.
    expect(onChange).toHaveBeenLastCalledWith(1)

    fireEvent.pointerUp(handle, { clientY: 340, pointerId: 1 })
    expect(onDragChange).toHaveBeenLastCalledWith(false)
  })

  it('never shrinks either card below its minimum', () => {
    const { handle, onChange } = setup()
    fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 })
    // Way past the top: the chat stops at 600 - 120, leaving Recent Scores 120.
    fireEvent.pointerMove(handle, { clientY: -2000, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(480 / 120)
  })

  it('resizes with the arrow keys', () => {
    const { handle, onChange } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    // 5% of 600 = 30px onto the chat: 270 / 330.
    expect(onChange).toHaveBeenCalledWith(270 / 330)
  })
})
