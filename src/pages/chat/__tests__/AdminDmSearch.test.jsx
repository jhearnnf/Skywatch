import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockApiFetch = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ value: { _id: 'u1', isAdmin: true } }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
  ),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: mockUser.value }),
}))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ refresh: vi.fn() }),
}))
vi.mock('../ChatThread', () => ({ default: () => <div data-testid="thread" /> }))

import ChatShell from '../ChatShell'

const VIEWER = { displayName: 'Control', displayNameRequired: false, chatBanned: false, chatBanReason: null }
const OVERVIEW = { support: null, guides: [], channels: [], dms: [], bots: [], viewer: VIEWER }

const json = (data) => ({ ok: true, json: async () => ({ status: 'success', data }) })

// One fetch mock for the three endpoints this flow touches, routed by URL —
// the search is a type-ahead, so the number of calls is not fixed.
function route({ users = [], dm = { _id: 'new-dm' }, dmError = null }) {
  mockApiFetch.mockImplementation((url) => {
    if (url.includes('/api/chat/admin/users/search')) return Promise.resolve(json({ users }))
    if (url.includes('/api/chat/dm')) {
      return Promise.resolve(dmError
        ? { ok: false, json: async () => ({ message: dmError }) }
        : json({ conversation: dm }))
    }
    return Promise.resolve(json(OVERVIEW))
  })
}

const VIPER = { _id: 'u2', displayName: 'Viper', agentNumber: '333111666', isAdmin: false, chatBanned: false }

describe('admin DM search', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockNavigate.mockReset()
    mockUser.value = { _id: 'u1', isAdmin: true }
    document.body.className = ''
  })

  const findBox = () => screen.findByLabelText('Search agents to message')

  it('is not offered to a non-admin', async () => {
    mockUser.value = { _id: 'u1', isAdmin: false }
    route({})
    render(<ChatShell />)

    await waitFor(() => expect(screen.getByText('Direct messages')).toBeTruthy())
    expect(screen.queryByLabelText('Search agents to message')).toBeNull()
  })

  it('searches for an agent and opens a DM with them', async () => {
    route({ users: [VIPER] })
    render(<ChatShell />)

    await userEvent.type(await findBox(), 'vip')

    const hit = await screen.findByText('Viper')
    expect(screen.getByText('Agent #333111666')).toBeTruthy()

    const searchCall = mockApiFetch.mock.calls.find(c => c[0].includes('/admin/users/search'))
    expect(searchCall[0]).toContain('q=vip')

    await userEvent.click(hit)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/chat/new-dm'))
    const dmCall = mockApiFetch.mock.calls.find(c => c[0].includes('/api/chat/dm'))
    expect(dmCall[1].method).toBe('POST')
    expect(JSON.parse(dmCall[1].body)).toEqual({ userId: 'u2' })
  })

  it('clears itself once the thread is open, so the rail goes back to a list', async () => {
    route({ users: [VIPER] })
    render(<ChatShell />)

    const box = await findBox()
    await userEvent.type(box, 'vip')
    await userEvent.click(await screen.findByText('Viper'))

    await waitFor(() => expect(box.value).toBe(''))
    expect(screen.queryByText('Agent #333111666')).toBeNull()
  })

  it('names an agent who has never picked a display name', async () => {
    route({ users: [{ _id: 'u3', displayName: null, agentNumber: '900900900', isAdmin: false, chatBanned: false }] })
    render(<ChatShell />)

    await userEvent.type(await findBox(), '900')
    expect(await screen.findByText('Agent #900900900')).toBeTruthy()
  })

  it('searches without the leading "@" an admin naturally types', async () => {
    route({ users: [VIPER] })
    render(<ChatShell />)

    await userEvent.type(await findBox(), '@Viper')

    expect(await screen.findByText('Viper')).toBeTruthy()
    const searchCall = mockApiFetch.mock.calls.find(c => c[0].includes('/admin/users/search'))
    expect(searchCall[0]).toContain('q=Viper')
    expect(searchCall[0]).not.toContain('%40')
  })

  it('says so when nothing matches', async () => {
    route({ users: [] })
    render(<ChatShell />)

    await userEvent.type(await findBox(), 'nobody')
    expect(await screen.findByText('No agents found')).toBeTruthy()
  })

  it('surfaces a failure to open the thread instead of doing nothing', async () => {
    route({ users: [VIPER], dmError: 'That agent is not accepting direct messages.' })
    render(<ChatShell />)

    await userEvent.type(await findBox(), 'vip')
    await userEvent.click(await screen.findByText('Viper'))

    expect(await screen.findByText('That agent is not accepting direct messages.')).toBeTruthy()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
