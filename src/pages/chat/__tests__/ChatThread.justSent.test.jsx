import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The send/poll race.
//
// The thread appends the message the POST hands back rather than re-downloading
// the channel, and separately polls every five seconds. A poll issued a moment
// BEFORE you hit Send comes back from a server that did not have your message
// yet — and it used to be applied wholesale, so the message you had just
// watched appear was taken straight back off the screen and only returned on
// the following tick. That is what these tests hold shut.
const mockApiFetch = vi.hoisted(() => vi.fn())
// Hoisted and stable: ChatThread keys its load effect and its poll on these, so
// a fresh object per render would restart both on every state change.
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
import { clearChatCache, getCachedThread } from '../../../utils/chatCache'

const message = (id, body, senderUserId = 'u2') => ({
  _id: id, body, senderUserId,
  senderDisplayName: senderUserId === 'u1' ? 'Falcon' : 'Viper',
  createdAt: new Date().toISOString(),
  reactions: [], mentions: [], deleted: false, editedAt: null,
})

const SENDERS = {
  u1: { _id: 'u1', displayName: 'Falcon', agentNumber: '1234567' },
  u2: { _id: 'u2', displayName: 'Viper',  agentNumber: '7654321' },
}
const CONVERSATION = { _id: 'c1', type: 'channel', title: 'General', postPolicy: 'everyone' }

const snapshot = (messages) => ({
  ok: true,
  json: async () => ({ status: 'success', data: { messages, senders: SENDERS, conversation: CONVERSATION } }),
})

// A response held open, so a poll can still be in flight while a send lands.
const deferred = () => {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

// Routes by URL and method so each test only has to say what is different.
const server = { messages: [], pendingPoll: null }

const route = (url, opts = {}) => {
  if (opts.method === 'POST' && url.endsWith('/read')) return Promise.resolve(snapshot([]))
  if (opts.method === 'DELETE') {
    const id = url.split('/').pop()
    server.messages = server.messages.filter(m => String(m._id) !== id)
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
  }
  if (opts.method === 'POST' && url.includes('/messages')) {
    const sent = { ...message('m2', JSON.parse(opts.body).body, 'u1'), canDelete: true, canEdit: true }
    server.messages = [...server.messages, sent]
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { message: sent } }) })
  }
  // A GET of the thread. If a test is holding one open, it resolves with the
  // snapshot as it stood when the request went out, not as it stands now.
  const frozen = server.messages
  if (server.pendingPoll) return server.pendingPoll.promise.then(() => snapshot(frozen))
  return Promise.resolve(snapshot(frozen))
}

const renderThread = () =>
  render(<ChatThread conversationId="c1" title="General" displayNameRequired={false} />)

const send = async (text) => {
  fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
}

beforeEach(() => {
  clearChatCache()
  server.messages = [message('m1', 'hello')]
  server.pendingPoll = null
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(route)
})
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('ChatThread — a send that races the poll', () => {
  it('keeps the message you just sent when a stale poll answers after it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderThread()
    expect(await screen.findByText('hello')).toBeInTheDocument()

    // A poll goes out and is held open. Everything after this happens while the
    // server's answer is still on the wire.
    server.pendingPoll = deferred()
    const frozen = server.messages
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    await send('my message')
    expect(screen.getByText('my message')).toBeInTheDocument()

    // The poll now lands, carrying the channel as it was before the send.
    expect(frozen).not.toContainEqual(expect.objectContaining({ body: 'my message' }))
    await act(async () => { server.pendingPoll.release(); await Promise.resolve() })

    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument())
    expect(screen.getByText('my message')).toBeInTheDocument()
  })

  it('shows it once, not twice, when the poll catches up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderThread()
    await screen.findByText('hello')

    await send('my message')
    // The next poll sees the message on the server, so the held copy is dropped
    // rather than appended alongside it.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    await waitFor(() => expect(screen.getAllByText('my message')).toHaveLength(1))
  })

  // The other half of holding a message: it must not be able to come BACK.
  // The author's own copy leaves the thread entirely when they remove it, so a
  // hold left in place would put a withdrawn message back on screen for as long
  // as it lasted.
  it('does not bring back a message you removed moments after sending it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderThread()
    await screen.findByText('hello')

    await send('my message')
    await act(async () => { fireEvent.click(screen.getByTitle('Delete')) })
    await waitFor(() => expect(screen.queryByText('my message')).not.toBeInTheDocument())

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.queryByText('my message')).not.toBeInTheDocument()
  })

  it('leaves the cache agreeing with the screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderThread()
    await screen.findByText('hello')

    server.pendingPoll = deferred()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    await send('my message')
    await act(async () => { server.pendingPoll.release(); await Promise.resolve() })

    // Switching channels and coming back paints from here, so a cache written
    // from the stale snapshot would lose the message a second way.
    await waitFor(() => {
      const bodies = (getCachedThread('c1')?.messages ?? []).map(m => m.body)
      expect(bodies).toContain('my message')
    })
  })
})
