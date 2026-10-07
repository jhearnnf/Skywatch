import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DisplayNameGate from '../components/DisplayNameGate'

const mockUseAuth = vi.fn()
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }))

const DAY = 86400000
const auth = (user, apiFetch = vi.fn()) => mockUseAuth.mockReturnValue({ API: '', apiFetch, user, setUser: vi.fn() })

describe('DisplayNameGate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers the name field when there is no cooldown', () => {
    auth({ _id: 'u1', displayName: null, displayNameChangedAt: null })
    render(<DisplayNameGate />)
    expect(screen.getByLabelText('Your display name')).toBeTruthy()
  })

  it('says how long is left up front while the cooldown runs, with no field to type in', () => {
    auth({ _id: 'u1', displayName: null, displayNameChangedAt: new Date(Date.now() - 2 * DAY).toISOString() })
    render(<DisplayNameGate />)
    expect(screen.getByRole('status')).toHaveTextContent('You can choose a new name in 28 days.')
    expect(screen.queryByLabelText('Your display name')).toBeNull()
  })

  it('switches to the cooldown message if the server refuses on the cooldown', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ message: 'You can change your display name once every 30 days.', retryAfterMs: 5 * DAY }),
    })
    // A stale user object that does not know about the cooldown.
    auth({ _id: 'u1', displayName: null, displayNameChangedAt: null }, apiFetch)
    render(<DisplayNameGate />)

    fireEvent.change(screen.getByLabelText('Your display name'), { target: { value: 'Falcon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByRole('status')).toHaveTextContent('You can choose a new name in 5 days.')
    expect(screen.queryByLabelText('Your display name')).toBeNull()
  })
})
