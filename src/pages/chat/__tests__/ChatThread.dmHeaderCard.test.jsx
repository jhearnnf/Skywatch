import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The name at the top of a DM opens the other person's card, the same one a
// name in a channel opens, so profile and block are reachable from inside the
// thread. The server sends `otherUserId` on DMs only; a channel heading stays
// plain text.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ _id: 'u1', displayName: 'Falcon', isAdmin: false }))
const mockCard     = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/community/c1', state: null }),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: vi.fn() }),
}))
vi.mock('../components/UserCard', () => ({
  default: (props) => { mockCard(props); return <div data-testid="user-card">card for {props.userId}</div> },
}))

import ChatThread from '../ChatThread'
import { clearChatCache } from '../../../utils/chatCache'

const serve = (conversation) => {
  mockApiFetch.mockImplementation((url, opts = {}) => {
    if (opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
    return Promise.resolve({
      ok: true,
      json: async () => ({ status: 'success', data: { messages: [], senders: {}, conversation } }),
    })
  })
}

beforeEach(() => { clearChatCache(); mockApiFetch.mockReset(); mockCard.mockReset() })
afterEach(() => cleanup())

describe('ChatThread — DM header opens the other agent\'s card', () => {
  it('the name is a button that opens the card on the other party', async () => {
    serve({ _id: 'c1', type: 'dm', title: 'Viper', otherUserId: 'u2' })
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)

    const name = await screen.findByRole('button', { name: 'Options for Viper' })
    expect(screen.queryByTestId('user-card')).not.toBeInTheDocument()

    fireEvent.click(name)
    expect(await screen.findByTestId('user-card')).toHaveTextContent('card for u2')
    // Already in the thread: the card must not offer Message again.
    expect(mockCard).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'u2', inDm: true }))
  })

  it('a channel heading is plain text', async () => {
    serve({ _id: 'c1', type: 'channel', title: 'General', postPolicy: 'everyone' })
    render(<ChatThread conversationId="c1" title="General" displayNameRequired={false} />)

    expect(await screen.findByText('Everyone can see this channel')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Options for/ })).not.toBeInTheDocument()
  })

  it('stays plain text until the server has named the other party', async () => {
    serve({ _id: 'c1', type: 'dm', title: 'Viper' })
    render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)

    expect(await screen.findByText('Direct message')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Options for/ })).not.toBeInTheDocument()
  })
})
