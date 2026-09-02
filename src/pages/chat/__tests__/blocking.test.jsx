import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The user-level block: the safeguard that lets someone leave a conversation
// without waiting for a moderator, and the thing Google Play requires of an app
// carrying user-generated content.
//
// Two surfaces, and both matter. UserCard is where a block is made — reachable
// from a name in a channel and from the action bar on any message. BlockedAgents
// (in Profile) is where it is undone, and it has to be somewhere else entirely,
// because blocking someone hides the very messages you would go back to.
const mockApiFetch = vi.hoisted(() => vi.fn())

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch }),
}))
vi.mock('../../../utils/cbat/demoMode', () => ({ useCbatDemoPortalTarget: () => null }))
vi.mock('../../../components/BotBadge', () => ({ default: () => <div>bot</div> }))

import UserCard from '../components/UserCard'
import BlockedAgents from '../components/BlockedAgents'

const ok = (data) => ({ ok: true, json: () => Promise.resolve({ status: 'success', data }) })
const fail = (message) => ({ ok: false, json: () => Promise.resolve({ message }) })

const card = (overrides = {}) => ({
  _id: 'u2', displayName: 'Viper', agentNumber: '1234567',
  isAdmin: false, isBot: false, cbatPassed: false, botKey: null,
  isSelf: false, isBlocked: false, canBlock: true, ...overrides,
})

beforeEach(() => { mockApiFetch.mockReset() })
afterEach(() => cleanup())

describe('UserCard — blocking', () => {
  const renderCard = (overrides = {}, props = {}) => {
    mockApiFetch.mockResolvedValueOnce(ok({ user: card(overrides) }))
    return render(<UserCard userId="u2" onClose={vi.fn()} onOpenDm={vi.fn()} {...props} />)
  }

  it('offers a Block button on another agent', async () => {
    renderCard()
    expect(await screen.findByRole('button', { name: 'Block' })).toBeInTheDocument()
  })

  it('offers no Block button on yourself or a bot', async () => {
    renderCard({ isSelf: true, canBlock: false })
    await screen.findByText('Viper')
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument()
  })

  it('asks before blocking rather than acting on the first tap', async () => {
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }))

    // Nothing has been sent yet — only the card fetch.
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Block this agent' })).toBeInTheDocument()
    // The confirm says what actually happens, including that it is silent and
    // where to undo it.
    expect(screen.getByText(/They are not told/)).toBeInTheDocument()
  })

  it('backs out cleanly', async () => {
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('POSTs the block, tells the thread, and closes', async () => {
    const onClose = vi.fn()
    const onBlockChanged = vi.fn()
    renderCard({}, { onClose, onBlockChanged })

    fireEvent.click(await screen.findByRole('button', { name: 'Block' }))
    mockApiFetch.mockResolvedValueOnce(ok({ blocked: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Block this agent' }))

    await waitFor(() => expect(onBlockChanged).toHaveBeenCalledWith(true))
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/chat/users/u2/block',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('unblocks in one tap, with no confirm', async () => {
    // Undoing a block is not the destructive direction, so it does not ask.
    const onBlockChanged = vi.fn()
    renderCard({ isBlocked: true }, { onBlockChanged })

    mockApiFetch.mockResolvedValueOnce(ok({ blocked: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }))

    await waitFor(() => expect(onBlockChanged).toHaveBeenCalledWith(false))
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/chat/users/u2/block',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('hides Message on someone already blocked', async () => {
    // Offering to open a DM the server is going to refuse would be a dead end.
    renderCard({ isBlocked: true })
    await screen.findByText('Viper')
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument()
  })

  it('says so when the block fails rather than closing regardless', async () => {
    const onClose = vi.fn()
    renderCard({}, { onClose })

    fireEvent.click(await screen.findByRole('button', { name: 'Block' }))
    mockApiFetch.mockResolvedValueOnce(fail('Could not update that block'))
    fireEvent.click(screen.getByRole('button', { name: 'Block this agent' }))

    expect(await screen.findByText('Could not update that block')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BlockedAgents — the undo', () => {
  it('lists who is blocked', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({ blocked: [
      { _id: 'u2', displayName: 'Viper', agentNumber: '1234567' },
    ] }))
    render(<BlockedAgents />)

    expect(await screen.findByText('Viper')).toBeInTheDocument()
    expect(screen.getByText('Agent #1234567')).toBeInTheDocument()
  })

  it('says plainly when nobody is blocked, rather than rendering nothing', async () => {
    // The panel is where people come to look for this, so it has to be here
    // before there is anything in it.
    mockApiFetch.mockResolvedValueOnce(ok({ blocked: [] }))
    render(<BlockedAgents />)

    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument()
  })

  it('unblocks and drops the row', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({ blocked: [
      { _id: 'u2', displayName: 'Viper', agentNumber: '1234567' },
    ] }))
    render(<BlockedAgents />)
    await screen.findByText('Viper')

    mockApiFetch.mockResolvedValueOnce(ok({ blocked: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }))

    await waitFor(() => expect(screen.queryByText('Viper')).not.toBeInTheDocument())
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      '/api/chat/users/u2/block',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('keeps the row when unblocking fails', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({ blocked: [
      { _id: 'u2', displayName: 'Viper', agentNumber: '1234567' },
    ] }))
    render(<BlockedAgents />)
    await screen.findByText('Viper')

    mockApiFetch.mockResolvedValueOnce(fail('Could not unblock that agent'))
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }))

    expect(await screen.findByText('Could not unblock that agent')).toBeInTheDocument()
    expect(screen.getByText('Viper')).toBeInTheDocument()
  })
})
