import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Searching a Community room and jumping to a result.
//
// A result older than what is loaded replaces the list with a chunk around it
// (`around`), Discord-style, rather than paging back through everything in
// between. That leaves the list short of the present: scrolling down pages
// forward (`after`), the poll must not merge the newest page onto the chunk,
// and "Jump to latest" goes straight back.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ _id: 'u1', displayName: 'Falcon' }))
const mockRefresh  = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/chat/c1', state: null }),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: mockRefresh }),
}))

import ChatThread from '../ChatThread'
import { clearChatCache } from '../../../utils/chatCache'

const SENDERS = { u2: { _id: 'u2', displayName: 'Viper', agentNumber: '7654321' } }
const CONVERSATION = { _id: 'c1', type: 'channel', title: 'General', postPolicy: 'everyone' }
const PAGE = 4

const message = (n) => ({
  _id: `m${n}`, body: `message ${n}`, senderUserId: 'u2', senderDisplayName: 'Viper',
  senderRole: 'user', createdAt: new Date(2026, 0, 1, 12, n).toISOString(),
  reactions: [], mentions: [], deleted: false, editedAt: null,
})
const server = { messages: [] }

// The real route's three ways in, in miniature.
const page = (url) => {
  const qs     = new URL(url, 'http://x').searchParams
  const limit  = parseInt(qs.get('limit') ?? PAGE, 10)
  const all    = server.messages
  let items, hasMore, hasNewer
  if (qs.get('around')) {
    const i = all.findIndex(m => m._id === qs.get('around'))
    const half = Math.floor(limit / 2)
    items = all.slice(Math.max(0, i - half), i + half + 1)
    hasMore = i - half > 0
    hasNewer = i + half + 1 < all.length
  } else if (qs.get('after')) {
    const after = new Date(qs.get('after')).getTime()
    const pool = all.filter(m => new Date(m.createdAt).getTime() > after)
    items = pool.slice(0, limit)
    hasNewer = pool.length > items.length
  } else {
    items = all.slice(-limit)
    hasMore = all.length > items.length
    hasNewer = false
  }
  return { ok: true, json: async () => ({ status: 'success', data: {
    messages: items, senders: SENDERS, conversation: CONVERSATION, hasMore, hasNewer,
  } }) }
}

const route = (url, opts = {}) => {
  if (opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
  return Promise.resolve(page(url))
}

const getRequests = () => mockApiFetch.mock.calls
  .filter(([url, opts]) => !opts?.method && url.includes('/messages'))
  .map(([url]) => url)

// The search panel uses plain fetch: one hit, message 3, far above the newest page.
const stubSearch = () => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'success', data: {
      results: [{ ...message(3), conversationId: 'c1' }],
      senders: SENDERS, hasMore: false,
    } }),
  }))
}

let observers
beforeEach(() => {
  clearChatCache()
  server.messages = Array.from({ length: 20 }, (_, i) => message(i + 1))
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(route)
  stubSearch()
  observers = []
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this) }
    observe(el) { this.el = el }
    disconnect() { this.gone = true }
  }
})
afterEach(() => { vi.useRealTimers(); delete globalThis.IntersectionObserver; cleanup() })

const renderThread = () =>
  render(<ChatThread conversationId="c1" title="General" displayNameRequired={false} />)

const searchAndPick = async () => {
  fireEvent.click(await screen.findByTestId('chat-search-toggle'))
  fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'message 3' } })
  fireEvent.click(await screen.findByTestId('search-result'))
}

const reachBottom = async () => {
  const sentinel = await screen.findByTestId('newer-messages')
  const io = observers.filter(o => !o.gone && o.el === sentinel).pop()
  await act(async () => { io.cb([{ isIntersecting: true }]) })
}

describe('ChatThread — search', () => {
  it('searches this room only, with no room picker', async () => {
    renderThread()
    await screen.findByText('message 20')
    fireEvent.click(screen.getByTestId('chat-search-toggle'))
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'radar' } })
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain('in=c1')
    expect(screen.queryByRole('group', { name: 'Rooms to search' })).not.toBeInTheDocument()
  })

  it('loads the chunk around an old result instead of paging back to it', async () => {
    renderThread()
    await screen.findByText('message 20')
    expect(screen.queryByText('message 3')).not.toBeInTheDocument()

    await searchAndPick()
    expect(await screen.findByText('message 3')).toBeInTheDocument()
    expect(getRequests().some(u => u.includes('around=m3'))).toBe(true)
    expect(getRequests().some(u => u.includes('before='))).toBe(false)
    // The present is no longer on screen, and the way back to it is offered.
    expect(screen.queryByText('message 20')).not.toBeInTheDocument()
    expect(screen.getByTestId('jump-to-latest')).toBeInTheDocument()
  })

  it('pages back down towards the present from the chunk', async () => {
    renderThread()
    await screen.findByText('message 20')
    await searchAndPick()
    await screen.findByText('message 5')

    await reachBottom()
    expect(await screen.findByText('message 9')).toBeInTheDocument()
    expect(getRequests().some(u => u.includes(`after=${encodeURIComponent(message(5).createdAt)}`))).toBe(true)
  })

  it('does not merge the newest page onto the chunk while it is short of the present', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderThread()
    await screen.findByText('message 20')
    await searchAndPick()
    await screen.findByText('message 3')

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.queryByText('message 20')).not.toBeInTheDocument()
    expect(screen.getByText('message 3')).toBeInTheDocument()
  })

  it('jumps straight back to the newest page', async () => {
    renderThread()
    await screen.findByText('message 20')
    await searchAndPick()
    await screen.findByText('message 3')

    fireEvent.click(screen.getByTestId('jump-to-latest'))
    expect(await screen.findByText('message 20')).toBeInTheDocument()
    expect(screen.queryByText('message 3')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('newer-messages')).not.toBeInTheDocument())
  })

  it('scrolls to a result that is already loaded without refetching', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', data: {
        results: [{ ...message(19), conversationId: 'c1' }], senders: SENDERS, hasMore: false,
      } }),
    }))
    renderThread()
    await screen.findByText('message 20')
    await searchAndPick()
    await waitFor(() => expect(screen.queryByTestId('chat-search')).not.toBeInTheDocument())
    expect(getRequests().some(u => u.includes('around='))).toBe(false)
    expect(screen.getByText('message 20')).toBeInTheDocument()
  })
})
