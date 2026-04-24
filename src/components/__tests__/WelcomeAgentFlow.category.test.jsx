import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../data/mockData', () => ({
  CATEGORY_ICONS:        { News: '📰', Aviation: '✈️' },
  CATEGORY_DESCRIPTIONS: { News: 'Latest intel', Aviation: 'Airpower' },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, ...rest }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, onMouseEnter, onMouseLeave }) => (
      <button className={className} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import WelcomeAgentFlow from '../onboarding/WelcomeAgentFlow'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup(categories = ['News', 'Aviation'], { user = null } = {}) {
  // Pickable categories depend on auth state. Guests see guestCategories;
  // signed-in users see (at least) freeCategories — so mirror the list into
  // both arrays to keep the test helper simple.
  mockUseSettings.mockReturnValue({
    settings: { guestCategories: categories, freeCategories: categories, silverCategories: categories },
  })
  mockUseAuth.mockReturnValue({ user })
  const onClose = vi.fn()
  const utils   = render(<WelcomeAgentFlow onClose={onClose} />)
  return { onClose, ...utils }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WelcomeAgentFlow — category selection navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    mockNavigate.mockReset()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('navigates to /learn-priority with the correct category state when News is clicked', () => {
    const { onClose } = setup()

    fireEvent.click(screen.getByText('News'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/learn-priority',
      { state: { category: 'News' } }
    )
  })

  it('navigates with the correct category when a non-default category is clicked', () => {
    setup(['Aviation', 'News'])

    fireEvent.click(screen.getByText('Aviation'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/learn-priority',
      { state: { category: 'Aviation' } }
    )
  })

  it('calls onClose after picking a category', () => {
    const { onClose } = setup()

    fireEvent.click(screen.getByText('News'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sets skywatch_onboarded in localStorage after picking a category', () => {
    setup()

    fireEvent.click(screen.getByText('News'))

    expect(localStorage.getItem('skywatch_onboarded')).toBe('1')
  })

  it('sets the CRO first-brief session marker after picking a category', () => {
    setup()
    sessionStorage.removeItem('sw_cro_first_brief')

    fireEvent.click(screen.getByText('News'))

    const raw = sessionStorage.getItem('sw_cro_first_brief')
    expect(raw).not.toBeNull()
    // Stored value is a timestamp string — should parse as a recent epoch ms.
    const ts = Number(raw)
    expect(Number.isFinite(ts)).toBe(true)
    expect(Date.now() - ts).toBeLessThan(2000)
  })

  it('calls onClose when Escape is pressed', async () => {
    const { onClose } = setup()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT navigate to learn-priority when Escape is pressed', () => {
    setup()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockNavigate).not.toHaveBeenCalledWith(
      '/learn-priority',
      expect.anything()
    )
  })
})

describe('WelcomeAgentFlow — copy varies by auth state', () => {
  beforeEach(() => {
    localStorage.clear()
    mockNavigate.mockReset()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows guest copy and the "Create account first" CTA when signed out', () => {
    setup(['News'], { user: null })

    expect(screen.getByText('Choose your first mission area')).toBeInTheDocument()
    expect(screen.getByText(/free, no account needed/i)).toBeInTheDocument()
    expect(screen.getByText(/Free accounts include/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create account first/i })).toBeInTheDocument()
  })

  it('guest only sees guest-tier categories (free-tier categories are excluded)', () => {
    // Admin has set Roles to 'free' tier — it lives in freeCategories but
    // NOT guestCategories. Guests should not see it in the CRO mission picker.
    mockUseSettings.mockReturnValue({
      settings: {
        guestCategories:  ['News'],
        freeCategories:   ['News', 'Roles'],
        silverCategories: ['News', 'Roles'],
      },
    })
    mockUseAuth.mockReturnValue({ user: null })
    render(<WelcomeAgentFlow onClose={vi.fn()} />)

    expect(screen.getByText('News')).toBeInTheDocument()
    expect(screen.queryByText('Roles')).not.toBeInTheDocument()
  })

  it('signed-in free user sees free-tier categories (including free-tier ones)', () => {
    mockUseSettings.mockReturnValue({
      settings: {
        guestCategories:  ['News'],
        freeCategories:   ['News', 'Roles'],
        silverCategories: ['News', 'Roles'],
      },
    })
    mockUseAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'free' } })
    render(<WelcomeAgentFlow onClose={vi.fn()} />)

    expect(screen.getByText('News')).toBeInTheDocument()
    expect(screen.getByText('Roles')).toBeInTheDocument()
  })

  it('shows signed-in copy and hides the "Create account first" CTA when a user is present', () => {
    setup(['News'], { user: { _id: 'u1', displayName: 'Test Agent' } })

    // Title is identical for both states — the modal only appears for users
    // choosing their first mission area (zero reads), regardless of auth.
    expect(screen.getByText('Choose your first mission area')).toBeInTheDocument()
    expect(screen.queryByText(/no account needed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Free accounts include/i)).not.toBeInTheDocument()
    expect(screen.getByText(/unlocked on your account/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create account first/i })).not.toBeInTheDocument()
    // Maybe later still available for both states
    expect(screen.getByRole('button', { name: /Maybe later/i })).toBeInTheDocument()
  })
})
