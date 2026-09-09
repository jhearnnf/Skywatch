import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The admin-only route from a name in Community into that agent's profile.
//
// The button carries an "Admin only" mark on purpose. Everything else on this
// card is a control every agent has, so an extra unlabelled button would read
// as a feature the whole community can see. The gate itself is the point of
// these tests: nobody but an admin is offered it, and it never appears on a
// bot or on the viewer's own card.
const mockApiFetch = vi.hoisted(() => vi.fn())
const mockUser     = vi.hoisted(() => ({ current: null }))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current, API: '', apiFetch: mockApiFetch }),
}))
vi.mock('../../../utils/cbat/demoMode', () => ({ useCbatDemoPortalTarget: () => null }))
vi.mock('../../../components/BotBadge', () => ({ default: () => <div>bot</div> }))

import UserCard from '../components/UserCard'

const ok = (data) => ({ ok: true, json: () => Promise.resolve({ status: 'success', data }) })

const card = (overrides = {}) => ({
  _id: 'u2', displayName: 'Viper', agentNumber: '1234567',
  isAdmin: false, isBot: false, cbatPassed: false, botKey: null,
  isSelf: false, isBlocked: false, canBlock: true, ...overrides,
})

beforeEach(() => { mockApiFetch.mockReset(); mockUser.current = null })
afterEach(() => cleanup())

const renderCard = (overrides = {}, props = {}) => {
  mockApiFetch.mockResolvedValueOnce(ok({ user: card(overrides) }))
  return render(
    <UserCard userId="u2" onClose={vi.fn()} onOpenDm={vi.fn()} onViewProfile={vi.fn()} {...props} />,
  )
}

describe('UserCard — View profile', () => {
  it('offers it to an admin', async () => {
    mockUser.current = { isAdmin: true }
    renderCard()
    expect(await screen.findByRole('button', { name: /View profile/ })).toBeInTheDocument()
  })

  it('marks it as admin only, so it does not read as a feature everyone has', async () => {
    mockUser.current = { isAdmin: true }
    renderCard()
    const btn = await screen.findByRole('button', { name: /View profile/ })
    expect(btn).toHaveTextContent('Admin only')
  })

  it('hides it from an ordinary agent', async () => {
    mockUser.current = { isAdmin: false }
    renderCard()
    await screen.findByText('Viper')
    expect(screen.queryByRole('button', { name: /View profile/ })).not.toBeInTheDocument()
  })

  it('hides it on a bot, which has no profile to report on', async () => {
    mockUser.current = { isAdmin: true }
    renderCard({ isBot: true, canBlock: false })
    await screen.findByText('Viper')
    expect(screen.queryByRole('button', { name: /View profile/ })).not.toBeInTheDocument()
  })

  it('hides it on your own card', async () => {
    mockUser.current = { isAdmin: true }
    renderCard({ isSelf: true, canBlock: false })
    await screen.findByText('Viper')
    expect(screen.queryByRole('button', { name: /View profile/ })).not.toBeInTheDocument()
  })

  it('hands the agent id back so the thread can navigate and close the card', async () => {
    mockUser.current = { isAdmin: true }
    const onViewProfile = vi.fn()
    renderCard({}, { onViewProfile })

    fireEvent.click(await screen.findByRole('button', { name: /View profile/ }))
    expect(onViewProfile).toHaveBeenCalledWith('u2')
    // Opening a profile is a read, so nothing is sent beyond the card fetch.
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })
})
