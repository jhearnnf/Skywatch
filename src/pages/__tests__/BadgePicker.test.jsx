import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BadgePicker from '../BadgePicker'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, onClick, disabled, style, className, 'aria-disabled': ariaDisabled }) => (
      <button onClick={onClick} disabled={disabled} style={style} className={className} aria-disabled={ariaDisabled}>{children}</button>
    ),
  },
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/ProfileBadge', () => ({
  default: ({ user }) => <span data-testid="profile-badge">{user?.rank?.rankAbbreviation || 'AC'}</span>,
}))

function setupAuth({ user = baseUser(), fetchData = [], patchResponse = null, setUserFn = vi.fn() } = {}) {
  const apiFetch = vi.fn().mockImplementation((url, opts) => {
    if (url.endsWith('/badge-options')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: fetchData }) })
    }
    if (url.endsWith('/badge')) {
      return Promise.resolve({
        ok: patchResponse?.ok ?? true,
        json: async () => patchResponse?.body ?? { data: { user: { ...user, selectedBadge: null } } },
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
  mockUseAuth.mockReturnValue({ user, setUser: setUserFn, API: '', apiFetch })
  return { apiFetch, setUserFn }
}

function baseUser(overrides = {}) {
  return {
    _id: 'u1',
    rank: { rankNumber: 1, rankAbbreviation: 'AC' },
    selectedBadge: null,
    ...overrides,
  }
}

describe('BadgePicker', () => {
  beforeEach(() => { mockNavigate.mockReset() })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders the rank-badge reset tile as selected when user has no selectedBadge', async () => {
    setupAuth({ fetchData: [] })
    render(<BadgePicker />)
    await waitFor(() => expect(screen.getByText('Rank badge')).toBeDefined())
    expect(screen.getByText('Currently selected')).toBeDefined()
  })

  it('shows empty state when no aircraft are unlocked', async () => {
    setupAuth({ fetchData: [] })
    render(<BadgePicker />)
    await waitFor(() => expect(screen.getByText('No aircraft unlocked yet')).toBeDefined())
  })

  it('renders available aircraft as selectable', async () => {
    setupAuth({
      fetchData: [
        { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'https://cdn/typhoon.png', status: 'available' },
      ],
    })
    render(<BadgePicker />)
    await waitFor(() => expect(screen.getByText('Typhoon')).toBeDefined())
    expect(screen.getByText('Tap to select')).toBeDefined()
    const img = document.querySelector('.profile-badge-cutout-img')
    expect(img).not.toBeNull()
  })

  it('renders pending aircraft with recon-pending label and disables them', async () => {
    setupAuth({
      fetchData: [
        { briefId: 'b2', title: 'Chinook', cutoutUrl: null, status: 'pending' },
      ],
    })
    render(<BadgePicker />)
    await waitFor(() => expect(screen.getByText('Chinook')).toBeDefined())
    expect(screen.getByText('Recon pending')).toBeDefined()
    const pendingBtn = screen.getByText('Chinook').closest('button')
    expect(pendingBtn.disabled).toBe(true)
  })

  it('flags the currently selected aircraft', async () => {
    setupAuth({
      user: baseUser({ selectedBadge: { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'x' } }),
      fetchData: [
        { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'https://cdn/typhoon.png', status: 'available' },
      ],
    })
    render(<BadgePicker />)
    await waitFor(() => expect(screen.getByText('Typhoon')).toBeDefined())
    expect(screen.getByText('Selected')).toBeDefined()
  })

  it('PATCHes the briefId when an aircraft tile is clicked', async () => {
    const { apiFetch, setUserFn } = setupAuth({
      fetchData: [
        { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'https://cdn/typhoon.png', status: 'available' },
      ],
      patchResponse: {
        ok: true,
        body: { data: { user: { _id: 'u1', rank: { rankNumber: 1, rankAbbreviation: 'AC' }, selectedBadge: { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'x' } } } },
      },
    })
    render(<BadgePicker />)
    await waitFor(() => expect(screen.getByText('Typhoon')).toBeDefined())
    fireEvent.click(screen.getByText('Typhoon').closest('button'))
    await waitFor(() => expect(setUserFn).toHaveBeenCalled())
    const patchCall = apiFetch.mock.calls.find(c => c[0].endsWith('/badge'))
    expect(patchCall).toBeDefined()
    expect(JSON.parse(patchCall[1].body)).toEqual({ briefId: 'b1' })
  })
})
