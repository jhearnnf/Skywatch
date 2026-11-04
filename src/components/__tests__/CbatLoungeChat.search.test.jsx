import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatLoungeChat from '../CbatLoungeChat'
import { clearAll as clearChatOutbox } from '../../lib/chatOutbox'

// Search in the CBAT lounge widget.
//
// It reaches the lounge, General and Announcements at once (lounge + General
// by default). A lounge result jumps within the lounge; a result elsewhere
// opens that room here, read-only, with a way back and a link to its real home
// in Community. Either way an old result loads the chunk around it.

const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/cbat', search: '' }),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { chatEnabled: true } }),
}))

class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = {} }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  close() {}
}

const LOUNGE = {
  conversationId: 'c-lounge', title: '🛩️ CBAT Lounge', unread: false, canPost: true,
  displayNameRequired: false, chatBanned: false, postBlockedMessage: null, botName: null,
}
const CHANNELS = [
  { key: 'lounge',        conversationId: 'c-lounge',  title: '🛩️ CBAT Lounge' },
  { key: 'general',       conversationId: 'c-general', title: '💬 General' },
  { key: 'announcements', conversationId: 'c-news',    title: '📣 Announcements' },
]
const msg = (id, convo, body) => ({
  _id: id, conversationId: convo, senderUserId: 'u2', senderDisplayName: 'Viper', senderRole: 'user',
  body, createdAt: new Date(2026, 0, 1).toISOString(), mentions: [],
})

let searchResults
const json = (data, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => ({ data }) })
const stubFetch = () => {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/chat/search/channels')) return json({ channels: CHANNELS })
    if (u.includes('/api/chat/search?')) return json({ results: searchResults, senders: {}, hasMore: false })
    if (u.includes('/api/chat/lounge')) return json(LOUNGE)
    if (u.includes('/api/chat/cbat-group')) return json({ configured: false, applicable: true })
    if (u.includes('/messages') && u.includes('around=g1')) {
      return json({ messages: [msg('g0', 'c-general', 'before it'), msg('g1', 'c-general', 'radar in general')], senders: {}, hasMore: true, hasNewer: true })
    }
    if (u.includes('/messages') && u.includes('around=l9')) {
      return json({ messages: [msg('l9', 'c-lounge', 'old radar chat')], senders: {}, hasMore: true, hasNewer: true })
    }
    if (u.includes('/messages')) return json({ messages: [msg('l1', 'c-lounge', 'latest lounge chat')], senders: {}, hasMore: false, hasNewer: false })
    return json({})
  })
}
const calls = () => globalThis.fetch.mock.calls.map(([u]) => String(u))

beforeEach(() => {
  clearChatOutbox()
  vi.clearAllMocks()
  searchResults = []
  globalThis.EventSource = FakeEventSource
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', displayName: 'Falcon' }, API: '', apiFetch: vi.fn() })
  stubFetch()
})
afterEach(cleanup)

const openSearch = async () => {
  render(<CbatLoungeChat open onToggle={() => {}} />)
  await screen.findByText('latest lounge chat')
  fireEvent.click(screen.getByTestId('lounge-search-toggle'))
  await screen.findByLabelText('Search messages')
}

describe('CbatLoungeChat — search', () => {
  it('offers the three public rooms, with the lounge and General on by default', async () => {
    await openSearch()
    expect(screen.getByRole('button', { name: '🛩️ CBAT Lounge' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '💬 General' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '📣 Announcements' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'radar' } })
    await waitFor(() => expect(calls().some(u => u.includes('/api/chat/search?'))).toBe(true))
    const url = new URL(calls().find(u => u.includes('/api/chat/search?')), 'http://x')
    expect(url.searchParams.get('in')).toBe('c-lounge,c-general')
  })

  it('opens a General result here, read-only, with a way back and a link to Community', async () => {
    searchResults = [msg('g1', 'c-general', 'radar in general')]
    await openSearch()
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'radar' } })
    fireEvent.click(await screen.findByTestId('search-result'))

    expect(await screen.findByText('radar in general')).toBeInTheDocument()
    expect(calls().some(u => u.includes('/conversations/c-general/messages') && u.includes('around=g1'))).toBe(true)
    expect(screen.getByTestId('lounge-peek-strip')).toHaveTextContent('💬 General')
    // No composer: the room's home is Community.
    expect(screen.queryByPlaceholderText('Message the lounge…')).not.toBeInTheDocument()
    expect(screen.getByTestId('jump-to-latest')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open in Community' }))
    expect(mockNavigate).toHaveBeenCalledWith('/chat/c-general')
  })

  it('does not mark a room opened from search as read', async () => {
    searchResults = [msg('g1', 'c-general', 'radar in general')]
    await openSearch()
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'radar' } })
    fireEvent.click(await screen.findByTestId('search-result'))
    await screen.findByText('radar in general')
    expect(calls().some(u => u.includes('/conversations/c-general/read'))).toBe(false)
  })

  it('goes back to the lounge from a room opened from search', async () => {
    searchResults = [msg('g1', 'c-general', 'radar in general')]
    await openSearch()
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'radar' } })
    fireEvent.click(await screen.findByTestId('search-result'))
    await screen.findByText('radar in general')

    fireEvent.click(screen.getByRole('button', { name: 'Back to the lounge' }))
    expect(await screen.findByText('latest lounge chat')).toBeInTheDocument()
    expect(screen.queryByTestId('lounge-peek-strip')).not.toBeInTheDocument()
  })

  it('loads the chunk around an old lounge result and jumps back to the latest', async () => {
    searchResults = [msg('l9', 'c-lounge', 'old radar chat')]
    await openSearch()
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'radar' } })
    fireEvent.click(await screen.findByTestId('search-result'))

    expect(await screen.findByText('old radar chat')).toBeInTheDocument()
    expect(screen.queryByText('latest lounge chat')).not.toBeInTheDocument()
    expect(screen.getByTestId('newer-messages')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('jump-to-latest'))
    expect(await screen.findByText('latest lounge chat')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('newer-messages')).not.toBeInTheDocument())
  })
})
