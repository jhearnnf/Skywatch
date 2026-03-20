import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import LockedCategoryModal from '../LockedCategoryModal'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../data/mockData', () => ({
  CATEGORY_ICONS:        { Aircrafts: '✈️', Missions: '🎯' },
  CATEGORY_DESCRIPTIONS: { Aircrafts: 'Fast jets, transport, rotary wing, and more.', Missions: 'Operations from WWII to today.' },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ API: 'http://localhost:5000', setUser: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: { freeCategories: ['News', 'Ranks', 'Terminology'] },
  }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, ...props }) => <div onClick={onClick} {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const MOCK_USER = { _id: 'u1', subscriptionTier: 'free' }

describe('LockedCategoryModal — upgrade variant (signed-in user)', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the category name and icon', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={MOCK_USER} onClose={onClose} />)
    expect(screen.getAllByText('Aircrafts').length).toBeGreaterThan(0)
    expect(screen.getByText('✈️')).toBeTruthy()
  })

  it('shows Silver badge and perks for silver tier', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={MOCK_USER} onClose={onClose} />)
    expect(screen.getByText('🥈 Silver Required')).toBeTruthy()
    expect(screen.getByText('View Silver Plans')).toBeTruthy()
    expect(screen.getByText('Access to all Silver subject areas')).toBeTruthy()
  })

  it('shows Gold badge and perks for gold tier', () => {
    render(<LockedCategoryModal category="Missions" tier="gold" user={MOCK_USER} onClose={onClose} />)
    expect(screen.getByText('🥇 Gold Required')).toBeTruthy()
    expect(screen.getByText('View Gold Plans')).toBeTruthy()
    expect(screen.getByText('Access to ALL subject areas')).toBeTruthy()
  })

  it('navigates to /subscribe and closes when CTA clicked', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={MOCK_USER} onClose={onClose} />)
    fireEvent.click(screen.getByText('View Silver Plans'))
    expect(mockNavigate).toHaveBeenCalledWith('/subscribe')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Maybe Later is clicked', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={MOCK_USER} onClose={onClose} />)
    fireEvent.click(screen.getByText('Maybe Later'))
    expect(onClose).toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const { container } = render(<LockedCategoryModal category="Aircrafts" tier="silver" user={MOCK_USER} onClose={onClose} />)
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={MOCK_USER} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('LockedCategoryModal — sign-up variant (guest)', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows free account badge instead of tier badge', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    expect(screen.getByText('🆓 Free account required')).toBeTruthy()
    expect(screen.queryByText('🥈 Silver Required')).toBeNull()
  })

  it('shows contextual description for silver-tier category', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    expect(screen.getAllByText(/5-day Silver trial/).length).toBeGreaterThan(0)
    expect(screen.getByText(/fast jets, transport, rotary wing/i)).toBeTruthy()
  })

  it('shows free categories in the perks box', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    expect(screen.getByText(/News, Ranks, Terminology/)).toBeTruthy()
  })

  it('shows streak FOMO line', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    expect(screen.getByText(/Agents who train daily advance much faster/)).toBeTruthy()
  })

  it('navigates to /login (not /subscribe) when Sign in is clicked', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    fireEvent.click(screen.getByText('Sign in'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
    expect(mockNavigate).not.toHaveBeenCalledWith('/subscribe')
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates to /login?tab=register with email when Continue is clicked', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    const input = screen.getByPlaceholderText('your@email.com')
    fireEvent.change(input, { target: { value: 'test@example.com' } })
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/login?tab=register&email=test%40example.com'
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates to /login?tab=register without email when Continue clicked with no input', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith('/login?tab=register')
  })

  it('does not show View Plans button', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)
    expect(screen.queryByText('View Silver Plans')).toBeNull()
  })

  it('shows gold-specific copy for gold-tier category', () => {
    render(<LockedCategoryModal category="Missions" tier="gold" user={null} onClose={onClose} />)
    expect(screen.getByText(/Gold subscription/)).toBeTruthy()
    expect(screen.queryByText(/5-day Silver trial gives you immediate access/)).toBeNull()
  })
})
