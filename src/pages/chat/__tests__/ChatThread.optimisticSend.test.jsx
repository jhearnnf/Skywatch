import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Sending is optimistic: the message is in the thread the moment Enter is
// pressed, a "Sending…" spinner appears only if the upload takes over two seconds, and a
// failed send stays on screen with a way to retry it.
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
import { clearAll as clearChatOutbox } from '../../../lib/chatOutbox'

const message = (id, body, senderUserId = 'u2') => ({
  _id: id, body, senderUserId,
  senderDisplayName: senderUserId === 'u1' ? 'Falcon' : 'Viper',
  createdAt: new Date().toISOString(),
  reactions: [], mentions: [], deleted: false, editedAt: null,
})
const SENDERS = {
  u1: { _id: 'u1', displayName: 'Falcon' },
  u2: { _id: 'u2', displayName: 'Viper' },
}
const CONVERSATION = { _id: 'c1', type: 'dm', title: 'Viper', postPolicy: 'everyone' }
const ok = (data) => ({ ok: true, json: async () => ({ status: 'success', data }) })

// Each POST waits for the test to answer it.
let posts
const route = (url, opts = {}) => {
  if (opts.method === 'POST' && url.endsWith('/read')) return Promise.resolve(ok({}))
  if (opts.method === 'POST' && url.includes('/messages')) {
    return new Promise(resolve => {
      const sent = JSON.parse(opts.body)
      posts.push({ body: sent.body, clientId: sent.clientId, quiet: opts.quiet, resolve })
    })
  }
  return Promise.resolve(ok({ messages: [message('m1', 'hello')], senders: SENDERS, conversation: CONVERSATION }))
}

const send = async (text) => {
  fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
}

beforeEach(() => {
  clearChatCache()
  clearChatOutbox()
  posts = []
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(route)
})
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('ChatThread — optimistic send', () => {
  it('shows the message at once, a spinner only after two seconds, and neither once it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')

    await send('on its way')
    expect(screen.getByText('on its way')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(screen.queryByTestId('message-sending')).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.queryByTestId('message-sending')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByTestId('message-sending')).toBeInTheDocument()

    await act(async () => { posts[0].resolve(ok({ message: message('m2', 'on its way', 'u1') })) })
    expect(screen.getAllByText('on its way')).toHaveLength(1)
    expect(screen.queryByTestId('message-sending')).toBeNull()
  })

  it('keeps a failed send on screen and sends it again on Try again', async () => {
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')

    await send('flaky')
    await act(async () => {
      posts[0].resolve({ ok: false, json: async () => ({ message: 'Network down' }) })
    })
    expect(screen.getByTestId('message-failed')).toBeInTheDocument()
    expect(screen.getByText('flaky')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(screen.queryByTestId('message-failed')).toBeNull()
    await vi.waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].body).toBe('flaky')

    await act(async () => { posts[1].resolve(ok({ message: message('m2', 'flaky', 'u1') })) })
    expect(screen.getAllByText('flaky')).toHaveLength(1)
  })

  it('sends two quick messages in the order they were typed', async () => {
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')

    await send('first')
    await send('second')
    expect(screen.getByText('second')).toBeInTheDocument()
    // The second waits for the first to land.
    expect(posts.map(p => p.body)).toEqual(['first'])

    await act(async () => { posts[0].resolve(ok({ message: message('m2', 'first', 'u1') })) })
    await vi.waitFor(() => expect(posts.map(p => p.body)).toEqual(['first', 'second']))
  })

  it('sends quietly, with an id the server can dedupe a retry on', async () => {
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')
    await send('tagged')
    expect(posts[0].clientId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    // No full-page loading overlay over a message already on screen.
    expect(posts[0].quiet).toBe(true)
  })

  it('tries again by itself when the network drops the send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')

    await send('through a tunnel')
    await act(async () => { posts[0].resolve(Promise.reject(new TypeError('Failed to fetch'))) })
    // Still sending, not failed: the queue is waiting to go again.
    expect(screen.queryByTestId('message-failed')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    await vi.waitFor(() => expect(posts).toHaveLength(2))
    // The same message, so the server can tell it is a retry.
    expect(posts[1].clientId).toBe(posts[0].clientId)

    await act(async () => { posts[1].resolve(ok({ message: message('m2', 'through a tunnel', 'u1') })) })
    expect(screen.getAllByText('through a tunnel')).toHaveLength(1)
  })

  it('keeps sending after the thread is left, and shows it on the way back', async () => {
    const view = render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')
    await send('sent then left')
    view.unmount()

    // Back in before it has landed: still there, still on its way.
    const again = render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    expect(await screen.findByText('sent then left')).toBeInTheDocument()
    again.unmount()

    // Lands while nobody is looking.
    await act(async () => { posts[0].resolve(ok({ message: message('m2', 'sent then left', 'u1') })) })
    expect(posts).toHaveLength(1)

    // And a refetch that has not caught up yet does not lose it.
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')
    expect(screen.getAllByText('sent then left')).toHaveLength(1)
  })
})
