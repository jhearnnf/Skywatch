import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// A support thread is created the moment someone presses "chat to us", before
// they type anything, and its `lastMessageAt` defaults to that moment. The rail
// has to say so, or an empty thread looks like a message waiting for a reply.
const mockApiFetch = vi.hoisted(() => vi.fn())
// Stable across renders on purpose: the messages effect lists `refresh` in its
// deps, so a fresh function each render re-fires it forever.
const mockRefreshUnread = vi.hoisted(() => vi.fn())
const mockUnread = vi.hoisted(() => ({ refresh: null }))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: { _id: 'admin1', isAdmin: true } }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => mockUnread,
}))
vi.mock('../components/MessageList', () => ({ default: () => <div data-testid="messages" /> }))
vi.mock('../components/ComposeBox', () => ({ default: () => null }))
vi.mock('../components/SeenByDialog', () => ({ default: () => null }))

import AdminChatView from '../AdminChatView'

const convo = (over) => ({
  _id: 'c1',
  type: 'support',
  status: 'open',
  isArchived: false,
  hasAdminUnread: false,
  userId: { _id: 'u1', email: 'annie@example.com' },
  lastMessageAt: '2026-09-07T20:50:00.000Z',
  ...over,
})

function route(conversations) {
  mockApiFetch.mockImplementation((url) => {
    if (String(url).includes('/api/chat/admin/conversations')) {
      return Promise.resolve({ ok: true, json: async () => ({
        status: 'success', data: { conversations },
      }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
  })
}

const row = (label) => screen.getByText(label).closest('button')

mockUnread.refresh = mockRefreshUnread

describe('AdminChatView — threads nobody ever wrote in', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('labels an empty thread rather than showing a bare timestamp', async () => {
    route([convo({ messageCount: 0 })])
    render(<AdminChatView />)

    await waitFor(() => expect(screen.getByText('annie@example.com')).toBeTruthy())
    expect(row('annie@example.com').textContent).toContain('Opened, no messages ·')
  })

  it('leaves a thread with messages alone', async () => {
    route([convo({ messageCount: 4 })])
    render(<AdminChatView />)

    await waitFor(() => expect(screen.getByText('annie@example.com')).toBeTruthy())
    expect(row('annie@example.com').textContent).not.toContain('Opened, no messages')
  })

  // Pre-migration rows have no count at all. Silence beats claiming a thread
  // with a transcript behind it is empty.
  it('says nothing when the count is missing', async () => {
    route([convo({})])
    render(<AdminChatView />)

    await waitFor(() => expect(screen.getByText('annie@example.com')).toBeTruthy())
    expect(row('annie@example.com').textContent).not.toContain('Opened, no messages')
  })

  it('still marks an empty thread that was closed', async () => {
    route([convo({ messageCount: 0, status: 'closed' })])
    render(<AdminChatView />)

    await waitFor(() => expect(screen.getByText('annie@example.com')).toBeTruthy())
    expect(row('annie@example.com').textContent).toContain('Closed · Opened, no messages ·')
  })
})
