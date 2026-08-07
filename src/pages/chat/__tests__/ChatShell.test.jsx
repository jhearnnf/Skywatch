import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockApiFetch = vi.hoisted(() => vi.fn())
const mockRefresh  = vi.hoisted(() => vi.fn())
const mockParams   = vi.hoisted(() => ({ value: {} }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => mockParams.value,
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
  ),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: { _id: 'u1' } }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: mockRefresh }),
}))
// The thread pane fetches its own messages; this file is about the shell.
vi.mock('../ChatThread', () => ({
  default: ({ conversationId, title }) => (
    <div data-testid="thread">{title || conversationId}</div>
  ),
}))

import ChatShell from '../ChatShell'

const overview = (data) => {
  mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data }) })
}

const VIEWER = { displayName: 'Falcon', displayNameRequired: false, chatBanned: false, chatBanReason: null }
const CHANNEL = {
  _id: 'c1', type: 'channel', name: 'General', title: '💬 General', emoji: '💬',
  description: 'Anything', order: 0, unread: false,
  lastMessageAt: new Date().toISOString(),
  preview: { body: 'hello', senderDisplayName: 'Viper' },
}
const DM = {
  _id: 'd1', type: 'dm', title: 'Viper', unread: true,
  lastMessageAt: new Date().toISOString(),
  preview: { body: 'hi there', senderDisplayName: 'Viper' },
}

describe('ChatShell', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockRefresh.mockReset()
    mockParams.value = {}
    document.body.className = ''
  })

  it('renders the rail from a single overview call', async () => {
    overview({ support: null, channels: [CHANNEL], dms: [DM], viewer: VIEWER })
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByText('General')).toBeTruthy())
    expect(screen.getByText('Viper')).toBeTruthy()
    expect(screen.getByText(/Viper: hi there/)).toBeTruthy()
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(mockApiFetch.mock.calls[0][0]).toMatch(/\/api\/chat\/overview$/)
  })

  it('widens the app shell, which AppShell would otherwise clamp to 768px', async () => {
    overview({ support: null, channels: [], dms: [], viewer: VIEWER })
    render(<ChatShell />)
    await waitFor(() => expect(document.body.classList.contains('chat-wide')).toBe(true))
  })

  it('shows a placeholder pane when no conversation is open', async () => {
    overview({ support: null, channels: [CHANNEL], dms: [], viewer: VIEWER })
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByText('Pick a conversation')).toBeTruthy())
    expect(screen.queryByTestId('thread')).toBeNull()
  })

  it('renders the thread alongside the rail when one is open', async () => {
    // Desktop keeps both; the panes collapse via CSS, so both are in the DOM.
    mockParams.value = { conversationId: 'c1' }
    overview({ support: null, channels: [CHANNEL], dms: [], viewer: VIEWER })
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByTestId('thread')).toBeTruthy())
    expect(screen.getByText('General')).toBeTruthy()
  })

  it('passes the rail\'s title down so the thread needs no second fetch', async () => {
    mockParams.value = { conversationId: 'c1' }
    overview({ support: null, channels: [CHANNEL], dms: [], viewer: VIEWER })
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByTestId('thread').textContent).toBe('💬 General'))
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the rail and its data when switching conversation', async () => {
    // The bug this guards: /chat and /chat/:id used to be different component
    // types under a pathname-keyed AnimatePresence, so every channel click
    // unmounted the shell and refetched everything — it read as a page reload.
    mockParams.value = { conversationId: 'c1' }
    overview({ support: null, channels: [CHANNEL, { ...CHANNEL, _id: 'c2', name: 'Flight Deck', title: '🛩️ Flight Deck' }], dms: [], viewer: VIEWER })
    const { rerender } = render(<ChatShell />)

    await waitFor(() => expect(screen.getByTestId('thread').textContent).toBe('💬 General'))
    expect(mockApiFetch).toHaveBeenCalledTimes(1)

    // Same mounted component, new route param — as react-router now delivers it.
    mockParams.value = { conversationId: 'c2' }
    rerender(<ChatShell />)

    await waitFor(() => expect(screen.getByTestId('thread').textContent).toBe('🛩️ Flight Deck'))
    // The rail is still there, and the overview was NOT fetched again.
    expect(screen.getByText('General')).toBeTruthy()
    expect(screen.getByText('Flight Deck')).toBeTruthy()
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('offers to start a support chat when none exists', async () => {
    overview({ support: null, channels: [], dms: [], viewer: VIEWER })
    render(<ChatShell />)
    await waitFor(() => expect(screen.getByText('Start a chat with the SkyWatch team')).toBeTruthy())
  })

  it('pins an existing support thread above the channels', async () => {
    overview({
      support: { _id: 's1', type: 'support', status: 'open', unread: false, lastMessageAt: new Date().toISOString(), preview: null },
      channels: [], dms: [], viewer: VIEWER,
    })
    render(<ChatShell />)
    await waitFor(() => expect(screen.getByText('SkyWatch Support')).toBeTruthy())
    expect(screen.getByText('Usually replies within a few hours')).toBeTruthy()
  })

  it('tells a chat-banned user what they can still do', async () => {
    overview({
      support: null, channels: [], dms: [],
      viewer: { ...VIEWER, chatBanned: true, chatBanReason: 'Abusive language' },
    })
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByText('You cannot post in chat')).toBeTruthy())
    expect(screen.getByText(/Abusive language/)).toBeTruthy()
    // The ban must not read as a total lockout — support stays reachable.
    expect(screen.getByText(/still message the SkyWatch team/)).toBeTruthy()
  })

  it('lists guides above channels, as links that leave the site', async () => {
    overview({
      support: null,
      guides: [{ _id: 'g1', title: 'CBAT Guide', url: 'https://cbatguide.com/', description: 'Everything on the tests', emoji: '📖' }],
      channels: [CHANNEL], dms: [], viewer: VIEWER,
    })
    render(<ChatShell />)

    const guide = await screen.findByText('CBAT Guide')
    const link = guide.closest('a')
    expect(link.getAttribute('href')).toBe('https://cbatguide.com/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    // Above Channels: the section label and the guide both precede the first channel.
    const order = screen.getByText('Guides').compareDocumentPosition(screen.getByText('Channels'))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('links a document on our own domain in the same tab, with no ↗', async () => {
    // public/cbat-guide.html is a standalone file, not an app route, so it has
    // to be a plain anchor — routing to it would render the SPA's 404.
    overview({
      support: null,
      guides: [{ _id: 'g2', title: 'CBAT Community Guide', url: '/cbat-guide.html', description: 'What candidates reported', emoji: '📖' }],
      channels: [], dms: [], viewer: VIEWER,
    })
    render(<ChatShell />)

    const link = (await screen.findByText('CBAT Community Guide')).closest('a')
    expect(link.getAttribute('href')).toBe('/cbat-guide.html')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.textContent).not.toContain('↗')
  })

  it('hides the Guides section entirely when there are none', async () => {
    overview({ support: null, guides: [], channels: [CHANNEL], dms: [], viewer: VIEWER })
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByText('General')).toBeTruthy())
    expect(screen.queryByText('Guides')).toBeNull()
  })

  it('points users at channels as the way into a DM', async () => {
    overview({ support: null, channels: [], dms: [], viewer: VIEWER })
    render(<ChatShell />)
    await waitFor(() =>
      expect(screen.getByText(/Tap someone’s name in a channel to message them/)).toBeTruthy(),
    )
  })
})
