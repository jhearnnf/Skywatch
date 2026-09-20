import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import MessageList from '../components/MessageList'

// Paging back through history from the top of the list.
//
// The list asks for the previous page when its top comes into view, and a page
// arriving above the viewer must not move what they are reading. jsdom has no
// layout and no IntersectionObserver, so both are stood in for: a content
// height the test can raise, and an observer whose callback the test fires.

const SENDERS = {
  u1: { _id: 'u1', displayName: 'Falcon', agentNumber: '1234567', selectedBadge: null, rank: null },
}

let seq = 0
const msg = (body) => ({
  _id: `m${++seq}`,
  senderUserId: 'u1',
  senderRole: 'user',
  senderDisplayName: 'Falcon',
  body,
  deleted: false,
  canEdit: true,
  canDelete: true,
  createdAt: new Date(2026, 0, 1, 12, seq).toISOString(),
})

const renderList = (messages, props = {}) =>
  render(
    <MessageList
      messages={messages}
      currentUserId="me"
      conversationType="channel"
      senders={SENDERS}
      {...props}
    />,
  )

const list = () => document.querySelector('.overflow-y-auto')

let fire
let observed
const geometry = { scrollHeight: 1000 }

beforeEach(() => {
  fire = null
  observed = null
  globalThis.IntersectionObserver = class {
    constructor(cb) { fire = cb }
    observe(el) { observed = el }
    disconnect() {}
  }
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, get() { return 400 } })
  Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', { configurable: true, get() { return geometry.scrollHeight } })
})
afterEach(() => {
  delete globalThis.IntersectionObserver
  delete HTMLDivElement.prototype.clientHeight
  delete HTMLDivElement.prototype.scrollHeight
  geometry.scrollHeight = 1000
  cleanup()
})

describe('MessageList — older pages', () => {
  it('shows no sentinel when there is nothing further back', () => {
    renderList([msg('hello')], { onLoadOlder: vi.fn(), hasOlder: false })
    expect(screen.queryByTestId('older-messages')).not.toBeInTheDocument()
    expect(fire).toBeNull()
  })

  it('shows no sentinel for a list with no handler, whatever the server said', () => {
    renderList([msg('hello')], { hasOlder: true })
    expect(screen.queryByTestId('older-messages')).not.toBeInTheDocument()
  })

  it('asks for the previous page when the top of the list comes into view', () => {
    const onLoadOlder = vi.fn()
    renderList([msg('hello')], { onLoadOlder, hasOlder: true })
    expect(observed).toBe(screen.getByTestId('older-messages'))

    fire([{ isIntersecting: false }])
    expect(onLoadOlder).not.toHaveBeenCalled()

    fire([{ isIntersecting: true }])
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('does not watch the top while a page is already on its way', () => {
    const onLoadOlder = vi.fn()
    renderList([msg('hello')], { onLoadOlder, hasOlder: true, loadingOlder: true })
    expect(screen.getByTestId('older-messages')).toHaveTextContent('Loading older messages…')
    expect(fire).toBeNull()
  })

  it('offers a retry when a page failed, and does not keep re-asking by itself', () => {
    const onLoadOlder = vi.fn()
    renderList([msg('hello')], { onLoadOlder, hasOlder: true, olderError: true })
    expect(fire).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('keeps the viewer on the same message when a page lands above them', () => {
    const newer = [msg('one'), msg('two')]
    const { rerender } = renderList(newer, { onLoadOlder: vi.fn(), hasOlder: true })
    const el = list()
    // Opened at the bottom, as always.
    expect(el.scrollTop).toBe(1000)

    // They scroll to the top and the page arrives, making the list taller.
    el.scrollTop = 0
    fireEvent.scroll(el)
    geometry.scrollHeight = 1600
    const older = [msg('minus two'), msg('minus one')]
    rerender(
      <MessageList
        messages={[...older, ...newer]}
        currentUserId="me"
        conversationType="channel"
        senders={SENDERS}
        onLoadOlder={vi.fn()}
        hasOlder
      />,
    )

    // Pushed down by exactly the added height, not snapped to the bottom.
    expect(el.scrollTop).toBe(600)
    expect(screen.getByText('minus two')).toBeInTheDocument()
  })

  it('still follows a new message at the bottom', () => {
    const initial = [msg('one')]
    const { rerender } = renderList(initial, { onLoadOlder: vi.fn(), hasOlder: true })
    const el = list()
    geometry.scrollHeight = 1200
    rerender(
      <MessageList
        messages={[...initial, msg('two')]}
        currentUserId="me"
        conversationType="channel"
        senders={SENDERS}
        onLoadOlder={vi.fn()}
        hasOlder
      />,
    )
    expect(el.scrollTop).toBe(1200)
  })
})
