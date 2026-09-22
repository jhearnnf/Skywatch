import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// A support thread is a ticket. What that changes in the pane: the header
// names the ticket and its status, the close control is "Mark resolved", and a
// resolved ticket is not a dead end — it offers to reopen rather than a bare
// composer, and a reply reopens it.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockRefresh  = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ _id: 'u1', displayName: 'Falcon' }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/chat/t1', state: null }),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: mockRefresh }),
}))

import ChatThread from '../ChatThread'
import { clearChatCache } from '../../../utils/chatCache'

const SENDERS = { u1: { _id: 'u1', displayName: 'Falcon', agentNumber: '1234567' } }
const message = (id, body) => ({
  _id: id, body, senderUserId: 'u1', senderDisplayName: 'Falcon',
  createdAt: new Date().toISOString(), reactions: [], mentions: [], deleted: false, editedAt: null,
})

let conversation
const snapshot = () => ({
  ok: true,
  json: async () => ({ status: 'success', data: {
    messages: [message('m1', 'The needles are off the dial')], senders: SENDERS, conversation,
  } }),
})

const route = (url, opts = {}) => {
  if (opts.method === 'POST' && url.includes('/messages')) {
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { message: message('m2', JSON.parse(opts.body).body) } }) })
  }
  if (opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
  return Promise.resolve(snapshot())
}

describe('ChatThread — a support ticket', () => {
  beforeEach(() => {
    clearChatCache()
    mockApiFetch.mockReset()
    mockApiFetch.mockImplementation(route)
    conversation = { _id: 't1', type: 'support', status: 'open', title: 'Instruments needles off the dial', postPolicy: 'everyone', reportId: 'r1' }
  })
  afterEach(() => cleanup())

  it('heads the pane with the ticket title, its status and a Mark resolved control', async () => {
    render(<ChatThread conversationId="t1" />)
    await screen.findByText('Instruments needles off the dial')
    expect(screen.getByText(/Support ticket · Open/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeTruthy()
    expect(screen.getByPlaceholderText(/type a message/i)).toBeTruthy()
  })

  it('puts a resolved ticket behind a Reopen button rather than a bare composer', async () => {
    conversation = { ...conversation, status: 'closed' }
    render(<ChatThread conversationId="t1" />)
    await screen.findByText(/Support ticket · Resolved/)
    expect(screen.getByText('Resolved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark resolved' })).toBeNull()
    expect(screen.queryByPlaceholderText(/type a message/i)).toBeNull()

    fireEvent.click(screen.getByTestId('reopen-ticket'))
    expect(screen.getByPlaceholderText(/type a message/i)).toBeTruthy()
    expect(screen.getByText(/Your reply will reopen this ticket/)).toBeTruthy()
  })

  it('shows the ticket as open again the moment a reply is sent', async () => {
    conversation = { ...conversation, status: 'closed' }
    render(<ChatThread conversationId="t1" />)
    await screen.findByTestId('reopen-ticket')
    fireEvent.click(screen.getByTestId('reopen-ticket'))

    fireEvent.change(screen.getByPlaceholderText(/type a message/i), { target: { value: 'Still broken for me' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(screen.getByText(/Support ticket · Open/)).toBeTruthy())
    expect(screen.queryByText(/Your reply will reopen/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeTruthy()
  })
})
