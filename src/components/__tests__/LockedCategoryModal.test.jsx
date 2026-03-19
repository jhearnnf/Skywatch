import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import LockedCategoryModal from '../LockedCategoryModal'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../data/mockData', () => ({
  CATEGORY_ICONS: { Aircrafts: '✈️', Missions: '🎯' },
}))

// framer-motion: render children directly
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, ...props }) => <div onClick={onClick} {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

describe('LockedCategoryModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the category name and icon', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" onClose={onClose} />)
    expect(screen.getAllByText('Aircrafts').length).toBeGreaterThan(0)
    expect(screen.getByText('✈️')).toBeTruthy()
  })

  it('shows Silver badge and perks for silver tier', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" onClose={onClose} />)
    expect(screen.getByText('🥈 Silver Required')).toBeTruthy()
    expect(screen.getByText('View Silver Plans')).toBeTruthy()
    expect(screen.getByText('Access to all Silver subject areas')).toBeTruthy()
  })

  it('shows Gold badge and perks for gold tier', () => {
    render(<LockedCategoryModal category="Missions" tier="gold" onClose={onClose} />)
    expect(screen.getByText('🥇 Gold Required')).toBeTruthy()
    expect(screen.getByText('View Gold Plans')).toBeTruthy()
    expect(screen.getByText('Access to ALL subject areas')).toBeTruthy()
  })

  it('navigates to /subscribe and closes when CTA clicked', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" onClose={onClose} />)
    fireEvent.click(screen.getByText('View Silver Plans'))
    expect(mockNavigate).toHaveBeenCalledWith('/subscribe')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Maybe Later is clicked', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" onClose={onClose} />)
    fireEvent.click(screen.getByText('Maybe Later'))
    expect(onClose).toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const { container } = render(<LockedCategoryModal category="Aircrafts" tier="silver" onClose={onClose} />)
    // The outermost div is the backdrop
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    render(<LockedCategoryModal category="Aircrafts" tier="silver" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
