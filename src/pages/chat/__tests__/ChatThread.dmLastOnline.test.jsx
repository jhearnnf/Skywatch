import { render, screen, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The admin's "last online" line under a DM header.
//
// The server only puts `otherLastSeen` on the conversation for admins, so the
// thread keys off the field being present rather than off `user.isAdmin`: a
// non-admin's payload has nothing to render, and an admin's line tracks the
// same 5s poll the messages do.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockRefresh  = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ _id: 'u1', displayName: 'Control', isAdmin: true }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/community/c1', state: null }),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: mockRefresh }),
}))

import ChatThread from '../ChatThread'
import { clearChatCache } from '../../../utils/chatCache'
import { formatLastOnline, isOnlineNow } from '../format'

const SENDERS = { u1: { _id: 'u1', displayName: 'Control' }, u2: { _id: 'u2', displayName: 'Viper' } }

const serve = (conversation) => {
  mockApiFetch.mockImplementation((url, opts = {}) => {
    if (opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
    return Promise.resolve({
      ok: true,
      json: async () => ({ status: 'success', data: { messages: [], senders: SENDERS, conversation } }),
    })
  })
}

const renderThread = () =>
  render(<ChatThread conversationId="c1" title="Viper" displayNameRequired={false} />)

beforeEach(() => { clearChatCache(); mockApiFetch.mockReset() })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('ChatThread — DM last online', () => {
  it('shows when the other party was last on the site', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    serve({ _id: 'c1', type: 'dm', title: 'Viper', otherLastSeen: twoHoursAgo })
    renderThread()

    const line = await screen.findByTestId('dm-last-online')
    expect(line).toHaveTextContent('Last online 2h ago')
    expect(screen.getByText(/Direct message/)).toBeInTheDocument()
  })

  it('reads "Online now" inside the presence window', async () => {
    serve({ _id: 'c1', type: 'dm', title: 'Viper', otherLastSeen: new Date().toISOString() })
    renderThread()
    expect(await screen.findByTestId('dm-last-online')).toHaveTextContent('Online now')
  })

  it('renders nothing when the server withheld the field', async () => {
    // What a non-admin receives: the same conversation with no key at all.
    serve({ _id: 'c1', type: 'dm', title: 'Viper' })
    renderThread()
    expect(await screen.findByText('Direct message')).toBeInTheDocument()
    expect(screen.queryByTestId('dm-last-online')).not.toBeInTheDocument()
  })

  it('never shows on a channel', async () => {
    serve({ _id: 'c1', type: 'channel', title: 'General', postPolicy: 'everyone', otherLastSeen: new Date().toISOString() })
    renderThread()
    expect(await screen.findByText('Everyone can see this channel')).toBeInTheDocument()
    expect(screen.queryByTestId('dm-last-online')).not.toBeInTheDocument()
  })
})

describe('formatLastOnline', () => {
  it('walks up the units and falls back to a dated stamp', () => {
    const at = (ms) => new Date(Date.now() - ms).toISOString()
    expect(formatLastOnline(null)).toBe('Not been online yet')
    expect(formatLastOnline(at(60 * 1000))).toBe('Online now')
    expect(formatLastOnline(at(12 * 60 * 1000))).toBe('Last online 12m ago')
    expect(formatLastOnline(at(5 * 3600 * 1000))).toBe('Last online 5h ago')
    expect(formatLastOnline(at(3 * 86400 * 1000))).toBe('Last online 3d ago')
    expect(formatLastOnline(at(30 * 86400 * 1000))).toMatch(/^Last online \S/)
    expect(formatLastOnline(at(30 * 86400 * 1000))).not.toMatch(/ago$/)
  })

  it('isOnlineNow matches the three-minute window', () => {
    expect(isOnlineNow(new Date(Date.now() - 2 * 60 * 1000).toISOString())).toBe(true)
    expect(isOnlineNow(new Date(Date.now() - 4 * 60 * 1000).toISOString())).toBe(false)
    expect(isOnlineNow(null)).toBe(false)
  })
})
