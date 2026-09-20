import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Paging back through a channel.
//
// A thread opens on the newest page and asks for the one before it when the
// viewer reaches the top. The 5s poll only ever fetches the newest page again,
// so what it brings back has to be merged UNDER the history the viewer has
// scrolled to, not swapped in for it — otherwise every tick would throw them
// back to the bottom with the older messages gone.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockRefresh  = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ _id: 'u1', displayName: 'Falcon' }))

const mockNavigate = vi.hoisted(() => vi.fn())
const mockLocation = vi.hoisted(() => ({ pathname: '/community/c1', state: null }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: mockRefresh }),
}))

import ChatThread from '../ChatThread'
import { clearChatCache } from '../../../utils/chatCache'

const SENDERS = {
  u1: { _id: 'u1', displayName: 'Falcon', agentNumber: '1234567' },
  u2: { _id: 'u2', displayName: 'Viper',  agentNumber: '7654321' },
}
const CONVERSATION = { _id: 'c1', type: 'channel', title: 'General', postPolicy: 'everyone' }

// Twelve messages a minute apart, m1 the oldest. The server pages in threes.
const PAGE = 3
const message = (n) => ({
  _id: `m${n}`, body: `message ${n}`, senderUserId: 'u2', senderDisplayName: 'Viper',
  createdAt: new Date(2026, 0, 1, 12, n).toISOString(),
  reactions: [], mentions: [], deleted: false, editedAt: null,
})
const server = { messages: [] }

// The real route: newest page first, `before` walks back, `hasMore` says
// whether anything precedes the page returned.
const page = (url) => {
  const qs     = new URL(url, 'http://x').searchParams
  const before = qs.get('before') ? new Date(qs.get('before')).getTime() : null
  const limit  = parseInt(qs.get('limit') ?? PAGE, 10)
  const pool   = server.messages.filter(m => !before || new Date(m.createdAt).getTime() < before)
  const items  = pool.slice(-limit)
  return {
    ok: true,
    json: async () => ({ status: 'success', data: {
      messages: items, senders: SENDERS, conversation: CONVERSATION,
      hasMore: pool.length > items.length,
    } }),
  }
}

const route = (url, opts = {}) => {
  if (opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
  return Promise.resolve(page(url))
}

const getRequests = () => mockApiFetch.mock.calls
  .filter(([url, opts]) => !opts?.method && url.includes('/messages'))
  .map(([url]) => url)

const renderThread = () =>
  render(<ChatThread conversationId="c1" title="General" displayNameRequired={false} />)

// The list asks for the previous page through an IntersectionObserver; jsdom
// has none, so the test holds the callback and fires it by hand.
let fire
beforeEach(() => {
  clearChatCache()
  server.messages = Array.from({ length: 12 }, (_, i) => message(i + 1))
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(route)
  fire = null
  globalThis.IntersectionObserver = class {
    constructor(cb) { fire = cb }
    observe() {}
    disconnect() {}
  }
})
afterEach(() => { vi.useRealTimers(); delete globalThis.IntersectionObserver; cleanup() })

const reachTop = async () => {
  await waitFor(() => expect(fire).not.toBeNull())
  const cb = fire
  fire = null
  await act(async () => { cb([{ isIntersecting: true }]) })
}

describe('ChatThread — paging back through history', () => {
  it('opens on the newest page and asks for the one before it, keyed on the oldest message shown', async () => {
    renderThread()
    expect(await screen.findByText('message 12')).toBeInTheDocument()
    expect(screen.queryByText('message 9')).not.toBeInTheDocument()

    await reachTop()
    expect(await screen.findByText('message 7')).toBeInTheDocument()
    expect(screen.getByText('message 9')).toBeInTheDocument()
    expect(screen.getByText('message 12')).toBeInTheDocument()

    const older = getRequests().find(u => u.includes('before='))
    expect(older).toContain(`before=${encodeURIComponent(message(10).createdAt)}`)
    // Still older than message 7, so the sentinel stays.
    expect(screen.getByTestId('older-messages')).toBeInTheDocument()
  })

  it('keeps the loaded history when the poll brings the newest page back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderThread()
    await screen.findByText('message 12')
    await reachTop()
    await screen.findByText('message 7')

    // Someone posts, and the poll picks it up. The newest page is now 11..13,
    // and message 10 has fallen off it — but it is still on screen here.
    server.messages = [...server.messages, message(13)]
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(await screen.findByText('message 13')).toBeInTheDocument()
    for (const n of [7, 8, 9, 10, 11, 12]) {
      expect(screen.getByText(`message ${n}`)).toBeInTheDocument()
    }
  })

  it('stops asking once the far end of the channel is reached', async () => {
    renderThread()
    await screen.findByText('message 12')
    await reachTop()
    await screen.findByText('message 7')
    await reachTop()
    await screen.findByText('message 4')
    await reachTop()
    expect(await screen.findByText('message 1')).toBeInTheDocument()

    // Nothing before message 1: the sentinel goes, and with it the observer.
    await waitFor(() => expect(screen.queryByTestId('older-messages')).not.toBeInTheDocument())
    expect(fire).toBeNull()
    expect(getRequests().filter(u => u.includes('before=')).length).toBe(3)
  })

  it('offers a retry when a page fails to load', async () => {
    renderThread()
    await screen.findByText('message 12')

    mockApiFetch.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    await reachTop()

    expect(await screen.findByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(screen.queryByText('message 9')).not.toBeInTheDocument()
  })
})
