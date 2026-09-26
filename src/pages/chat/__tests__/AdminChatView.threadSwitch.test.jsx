import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Clicking another thread used to leave the previous thread's messages on
// screen, under the new thread's header, until the new fetch came back.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockUnread = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: { _id: 'admin1', isAdmin: true } }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => mockUnread,
}))
vi.mock('../components/MessageList', () => ({
  default: ({ messages }) => (
    <div data-testid="messages">{messages.map(m => <p key={m._id}>{m.body}</p>)}</div>
  ),
}))
vi.mock('../components/ComposeBox', () => ({ default: () => null }))
vi.mock('../components/SeenByDialog', () => ({ default: () => null }))

import AdminChatView from '../AdminChatView'

const convo = (over) => ({
  type: 'support', status: 'open', isArchived: false, hasAdminUnread: false,
  lastMessageAt: '2026-09-07T20:50:00.000Z', messageCount: 1,
  ...over,
})

const CONVOS = [
  convo({ _id: 'c1', title: 'Dials broken' }),
  convo({ _id: 'c2', title: 'Table reading', status: 'closed' }),
]

// Message fetches are held until the test releases them, per conversation.
let pending
function route() {
  pending = {}
  mockApiFetch.mockImplementation((url) => {
    const u = String(url)
    if (u.includes('/api/chat/admin/conversations')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { conversations: CONVOS } }) })
    }
    const m = u.match(/conversations\/(c\d)\/messages/)
    if (m) {
      return new Promise(resolve => {
        (pending[m[1]] ??= []).push(() => resolve({ ok: true, json: async () => ({
          data: { messages: [{ _id: `${m[1]}-m`, body: `body of ${m[1]}` }], senders: {} },
        }) }))
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: {} }) })
  })
}
const release = async (id) => {
  await act(async () => { (pending[id] ?? []).splice(0).forEach(fn => fn()) })
}

describe('AdminChatView — switching threads', () => {
  beforeEach(() => { mockApiFetch.mockReset(); route() })

  it('never shows the previous thread under the new header', async () => {
    render(<AdminChatView />)
    fireEvent.click(await screen.findByText('Dials broken'))
    await waitFor(() => expect(pending.c1?.length).toBeTruthy())
    await release('c1')
    expect(await screen.findByText('body of c1')).toBeTruthy()

    fireEvent.click(screen.getByText('Table reading'))
    expect(screen.queryByText('body of c1')).toBeNull()
    expect(screen.getByTestId('thread-loading')).toBeTruthy()

    await waitFor(() => expect(pending.c2?.length).toBeTruthy())
    await release('c2')
    expect(await screen.findByText('body of c2')).toBeTruthy()
  })

  it('drops a late reply for a thread the admin has already left', async () => {
    render(<AdminChatView />)
    fireEvent.click(await screen.findByText('Dials broken'))
    await waitFor(() => expect(pending.c1?.length).toBeTruthy())

    fireEvent.click(screen.getByText('Table reading'))
    await release('c1')
    expect(screen.queryByText('body of c1')).toBeNull()
    expect(screen.getByTestId('thread-loading')).toBeTruthy()
  })

  it('shows a revisited thread from cache straight away', async () => {
    render(<AdminChatView />)
    fireEvent.click(await screen.findByText('Dials broken'))
    await waitFor(() => expect(pending.c1?.length).toBeTruthy())
    await release('c1')
    await screen.findByText('body of c1')

    fireEvent.click(screen.getByText('Table reading'))
    fireEvent.click(screen.getByText('Dials broken'))
    expect(screen.getByText('body of c1')).toBeTruthy()
  })
})

describe('AdminChatView — resolved tickets in the rail', () => {
  beforeEach(() => { mockApiFetch.mockReset(); route() })

  it('dims, strikes through and ticks a resolved ticket only', async () => {
    render(<AdminChatView />)
    const resolved = (await screen.findByText('Table reading'))
    const open = screen.getByText('Dials broken')

    expect(resolved.className).toContain('line-through')
    expect(resolved.closest('button').getAttribute('data-resolved')).toBe('true')
    expect(resolved.closest('button').querySelector('[aria-label="Resolved"]')).toBeTruthy()

    expect(open.className).not.toContain('line-through')
    expect(open.closest('button').getAttribute('data-resolved')).toBeNull()
  })
})
