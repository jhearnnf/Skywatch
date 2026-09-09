import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockApiFetch = vi.hoisted(() => vi.fn())
const mockRefresh  = vi.hoisted(() => vi.fn())
const mockParams   = vi.hoisted(() => ({ value: {} }))
const mockUser     = vi.hoisted(() => ({ value: { _id: 'u1', isAdmin: true } }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => mockParams.value,
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
  ),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser.value }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: mockRefresh }),
}))
vi.mock('../ChatThread', () => ({
  default: () => <div data-testid="thread" />,
}))

import ChatShell from '../ChatShell'
import { clearChatCache, syncChatCacheOwner } from '../../../utils/chatCache'

const VIEWER = { displayName: 'Control', displayNameRequired: false, chatBanned: false, chatBanReason: null }
const DM = (id, otherId, title) => ({
  _id: id, type: 'dm', title, unread: false,
  lastMessageAt: new Date().toISOString(),
  preview: { body: 'hi', senderDisplayName: title },
  otherUser: { _id: otherId, displayName: title, agentNumber: '1', isAdmin: false },
})

// One mock for both endpoints, dispatched on the URL — the shell and the
// presence hook each own their own poll, so a single blanket response would let
// an overview body answer a presence request and hide a wiring mistake.
const routes = ({ overview = {}, presence = null, presenceFails = false }) => {
  mockApiFetch.mockImplementation((url) => {
    if (String(url).includes('/api/chat/presence')) {
      if (presenceFails) return Promise.reject(new Error('offline'))
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', data: presence ?? { online: [], count: 0 } }),
      })
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ status: 'success', data: { support: null, channels: [], dms: [], viewer: VIEWER, ...overview } }),
    })
  })
}

const presenceCalls = () =>
  mockApiFetch.mock.calls.filter(([url]) => String(url).includes('/api/chat/presence'))

describe('community presence', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockRefresh.mockReset()
    mockParams.value = {}
    mockUser.value = { _id: 'u1', isAdmin: true }
    document.body.className = ''
    syncChatCacheOwner(null)
    clearChatCache()
  })

  describe('for a member', () => {
    beforeEach(() => { mockUser.value = { _id: 'u1', isAdmin: false } })

    it('never asks who is online', async () => {
      routes({ overview: { dms: [DM('d1', 'other', 'Viper')] } })
      render(<ChatShell />)

      await waitFor(() => expect(screen.getByText('Viper')).toBeTruthy())
      // Presence is admin-only server-side too; a member polling it would just
      // 403 twice a minute.
      expect(presenceCalls()).toHaveLength(0)
    })

    it('shows no strip and no dots', async () => {
      routes({ overview: { dms: [DM('d1', 'other', 'Viper')] } })
      render(<ChatShell />)

      await waitFor(() => expect(screen.getByText('Viper')).toBeTruthy())
      expect(screen.queryByText('Online')).toBeNull()
      expect(screen.queryAllByTitle('Online now')).toHaveLength(0)
    })
  })

  describe('for an admin', () => {
    it('shows the count without being expanded', async () => {
      routes({ presence: { online: [{ _id: 'a', displayName: 'Viper', lastSeen: new Date().toISOString() }], count: 1 } })
      render(<ChatShell />)

      await waitFor(() => expect(screen.getByText('Online')).toBeTruthy())
      expect(screen.getByText('1')).toBeTruthy()
      // Collapsed by default — the top of the rail is not spent on a name list.
      expect(screen.queryByText('Viper')).toBeNull()
    })

    it('lists names, staff and last-seen once expanded', async () => {
      routes({ presence: { count: 2, online: [
        { _id: 'a', displayName: 'Viper',   isAdmin: false, lastSeen: new Date().toISOString() },
        { _id: 'b', displayName: 'Control', isAdmin: true,  lastSeen: new Date(Date.now() - 240_000).toISOString() },
      ] } })
      render(<ChatShell />)

      await userEvent.click(await screen.findByRole('button', { name: /online/i }))

      expect(screen.getByText('Viper')).toBeTruthy()
      expect(screen.getByText('Control')).toBeTruthy()
      expect(screen.getByText('Staff')).toBeTruthy()
      // A ten-minute window is "recently", not "right now" — the age of the
      // signal is what tells an admin whether to expect a reply.
      expect(screen.getByText('now')).toBeTruthy()
      expect(screen.getByText('4m')).toBeTruthy()
    })

    describe('where each agent is', () => {
      const online = (over = {}) => ({
        _id: 'a', displayName: 'Viper', lastSeen: new Date().toISOString(), ...over,
      })

      it('shows the page each agent is on', async () => {
        routes({ presence: { count: 2, online: [
          online({ _id: 'a', displayName: 'Viper',  location: 'CBAT · ACT' }),
          online({ _id: 'b', displayName: 'Falcon', location: 'Reading a brief' }),
        ] } })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))
        expect(screen.getByText('CBAT · ACT')).toBeTruthy()
        expect(screen.getByText('Reading a brief')).toBeTruthy()
      })

      it('marks the viewer\'s own row and shows no page for it', async () => {
        // They are reading the strip from Community; their own location is the
        // one row that says nothing. The server sends it as null.
        routes({ presence: { count: 2, online: [
          online({ _id: 'u1', displayName: 'Control', isAdmin: true, isSelf: true, location: null }),
          online({ _id: 'a',  displayName: 'Viper',   location: 'Profile' }),
        ] } })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))
        expect(screen.getByText('You')).toBeTruthy()
        expect(screen.getByText('Profile')).toBeTruthy()
        // "You" replaces "Staff" rather than sitting next to it.
        expect(screen.queryByText('Staff')).toBeNull()
      })

      it('shows no page line at all when the location is unknown', async () => {
        // An older client, or someone on a route with no label. A filler like
        // "Somewhere else" would be a claim; an absent line is the truth.
        routes({ presence: { count: 1, online: [online({ location: null })] } })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))
        expect(screen.getByText('Viper')).toBeTruthy()
        expect(screen.queryByText(/Somewhere|Unknown|Elsewhere/)).toBeNull()
      })
    })

    it('names an agent with no display name by their number', async () => {
      routes({ presence: { count: 1, online: [{ _id: 'a', displayName: null, agentNumber: '900900900', lastSeen: new Date().toISOString() }] } })
      render(<ChatShell />)

      await userEvent.click(await screen.findByRole('button', { name: /online/i }))
      expect(screen.getByText('Agent #900900900')).toBeTruthy()
    })

    it('says how many the capped list is not showing', async () => {
      routes({ presence: { count: 62, online: [{ _id: 'a', displayName: 'Viper', lastSeen: new Date().toISOString() }] } })
      render(<ChatShell />)

      await userEvent.click(await screen.findByRole('button', { name: /online/i }))
      // Otherwise an admin counts the rows and finds 61 people missing.
      expect(screen.getByText('and 61 more')).toBeTruthy()
    })

    it('reads as quiet, not as broken, when nobody is around', async () => {
      routes({ presence: { online: [], count: 0 } })
      render(<ChatShell />)

      await waitFor(() => expect(screen.getByText('Online')).toBeTruthy())
      expect(screen.getByText('0')).toBeTruthy()

      await userEvent.click(screen.getByRole('button', { name: /online/i }))
      expect(screen.getByText(/Nobody has been active in the last 10 minutes/)).toBeTruthy()
    })

    it('dots only the DM rows whose other party is online', async () => {
      routes({
        overview: { dms: [DM('d1', 'here', 'Viper'), DM('d2', 'away', 'Falcon')] },
        presence: { count: 1, online: [{ _id: 'here', displayName: 'Viper', lastSeen: new Date().toISOString() }] },
      })
      render(<ChatShell />)

      await waitFor(() => expect(screen.getByText('Falcon')).toBeTruthy())
      await waitFor(() => expect(screen.getAllByTitle('Online now')).toHaveLength(1))

      const dotted = screen.getByTitle('Online now').closest('a')
      expect(dotted.textContent).toContain('Viper')
      expect(dotted.textContent).not.toContain('Falcon')
    })

    describe('online versus away', () => {
      // What the server sends: every row carries a status, and the two counts
      // are taken over the whole window rather than over the listed rows.
      const split = () => ({
        count: 3, onlineCount: 1, awayCount: 2,
        online: [
          { _id: 'a', displayName: 'Viper',  status: 'online', lastSeen: new Date().toISOString() },
          { _id: 'b', displayName: 'Falcon', status: 'away',   lastSeen: new Date(Date.now() - 240_000).toISOString() },
          { _id: 'c', displayName: 'Hawk',   status: 'away',   lastSeen: new Date(Date.now() - 540_000).toISOString() },
        ],
      })

      it('shows both counts in the collapsed header', async () => {
        routes({ presence: split() })
        render(<ChatShell />)

        await waitFor(() => expect(screen.getByText('Online')).toBeTruthy())
        expect(screen.getByText('Away')).toBeTruthy()
        expect(screen.getByText('1')).toBeTruthy()
        expect(screen.getByText('2')).toBeTruthy()
      })

      it('says both counts to a screen reader, which cannot see the dots', async () => {
        routes({ presence: split() })
        render(<ChatShell />)

        const toggle = await screen.findByRole('button', { name: /who is around/i })
        expect(toggle.getAttribute('aria-label')).toBe('Who is around: 1 online, 2 away')
      })

      it('groups the expanded list under Online and Away', async () => {
        routes({ presence: split() })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))

        // Both headings, and everyone still listed — away is around, not gone.
        expect(screen.getAllByText('Online').length).toBeGreaterThan(1)
        expect(screen.getAllByText('Away').length).toBeGreaterThan(1)
        expect(screen.getByText('Viper')).toBeTruthy()
        expect(screen.getByText('Falcon')).toBeTruthy()
        expect(screen.getByText('Hawk')).toBeTruthy()
      })

      it('puts the away rows after the online ones', async () => {
        routes({ presence: split() })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))

        const [first, second, third] = ['Viper', 'Falcon', 'Hawk'].map(n => screen.getByText(n))
        // Whoever would answer right now reads first, whatever order the server
        // sent the rows in.
        expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      })

      it('drops the away half of the header when nobody is away', async () => {
        routes({ presence: { count: 1, onlineCount: 1, awayCount: 0, online: [
          { _id: 'a', displayName: 'Viper', status: 'online', lastSeen: new Date().toISOString() },
        ] } })
        render(<ChatShell />)

        await waitFor(() => expect(screen.getByText('Online')).toBeTruthy())
        // "0 Away" is a line about nobody; a quiet rail stays one short line.
        expect(screen.queryByText('Away')).toBeNull()
      })

      it('drops the headings when everyone is on the same side of the line', async () => {
        routes({ presence: { count: 1, onlineCount: 1, awayCount: 0, online: [
          { _id: 'a', displayName: 'Viper', status: 'online', lastSeen: new Date().toISOString() },
        ] } })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))
        // The header already says "1 Online"; a heading repeating it directly
        // under the same button is a line spent twice.
        expect(screen.getAllByText('Online')).toHaveLength(1)
      })

      it('counts the ones the capped list is not showing per group', async () => {
        routes({ presence: { count: 62, onlineCount: 40, awayCount: 22, online: [
          { _id: 'a', displayName: 'Viper',  status: 'online', lastSeen: new Date().toISOString() },
          { _id: 'b', displayName: 'Falcon', status: 'away',   lastSeen: new Date(Date.now() - 240_000).toISOString() },
        ] } })
        render(<ChatShell />)

        await userEvent.click(await screen.findByRole('button', { name: /online/i }))
        expect(screen.getByText('and 39 more')).toBeTruthy()
        expect(screen.getByText('and 21 more away')).toBeTruthy()
      })

      it('marks a DM row amber when the other party has stepped away', async () => {
        routes({
          overview: { dms: [DM('d1', 'here', 'Viper'), DM('d2', 'idle', 'Falcon')] },
          presence: { count: 2, onlineCount: 1, awayCount: 1, online: [
            { _id: 'here', displayName: 'Viper',  status: 'online', lastSeen: new Date().toISOString() },
            { _id: 'idle', displayName: 'Falcon', status: 'away',   lastSeen: new Date(Date.now() - 240_000).toISOString() },
          ] },
        })
        render(<ChatShell />)

        await waitFor(() => expect(screen.getAllByTitle('Online now')).toHaveLength(1))
        // The whole point of the split, read from the rail: one of these two
        // will see the message land and the other will find it later.
        expect(screen.getByTitle('Online now').closest('a').textContent).toContain('Viper')
        expect(screen.getByTitle('Away').closest('a').textContent).toContain('Falcon')
      })

      it('treats a row with no status as online, for a backend without the split', async () => {
        routes({
          overview: { dms: [DM('d1', 'here', 'Viper')] },
          presence: { count: 1, online: [{ _id: 'here', displayName: 'Viper', lastSeen: new Date().toISOString() }] },
        })
        render(<ChatShell />)

        // Reads exactly as it did before the split shipped, rather than turning
        // the whole rail amber against an older API.
        await waitFor(() => expect(screen.getAllByTitle('Online now')).toHaveLength(1))
        expect(screen.getByText('1')).toBeTruthy()
        expect(screen.queryByText('Away')).toBeNull()
      })
    })

    it('keeps the last answer when a presence poll fails', async () => {
      routes({ overview: { dms: [DM('d1', 'here', 'Viper')] }, presenceFails: true })
      render(<ChatShell />)

      // The rail still renders; a dropped presence request must not blank it,
      // and must not read as "everyone just left" either.
      await waitFor(() => expect(screen.getByText('Viper')).toBeTruthy())
      expect(screen.getByText('Online')).toBeTruthy()
      expect(screen.queryAllByTitle('Online now')).toHaveLength(0)
    })
  })
})
