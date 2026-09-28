import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Sending is optimistic: the message is in the thread the moment Enter is
// pressed, a loading bar appears only if the upload takes over a second, and a
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
    return new Promise(resolve => { posts.push({ body: JSON.parse(opts.body).body, resolve }) })
  }
  return Promise.resolve(ok({ messages: [message('m1', 'hello')], senders: SENDERS, conversation: CONVERSATION }))
}

const send = async (text) => {
  fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
}

beforeEach(() => {
  clearChatCache()
  posts = []
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(route)
})
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('ChatThread — optimistic send', () => {
  it('shows the message at once, a bar only after a second, and neither once it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)
    await screen.findByText('hello')

    await send('on its way')
    expect(screen.getByText('on its way')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
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
})
