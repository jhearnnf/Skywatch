import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CategoryHeader from '../CategoryHeader'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

let mockUser = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

const BRIEF_ID = '507f1f77bcf86cd799439011'

describe('CategoryHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
  })

  it('renders category and subcategory for non-admin user without id link', () => {
    mockUser = { _id: 'u1', isAdmin: false }
    const { container } = render(<CategoryHeader category="Aircrafts" subcategory="Fighters" briefId={BRIEF_ID} />)
    expect(container.textContent).toContain('Aircrafts')
    expect(container.textContent).toContain('Fighters')
    expect(screen.queryByText(BRIEF_ID)).toBeNull()
  })

  it('renders full-length brief id link for admin user', () => {
    mockUser = { _id: 'u1', isAdmin: true }
    render(<CategoryHeader category="Aircrafts" subcategory="Fighters" briefId={BRIEF_ID} />)
    expect(screen.getByText(BRIEF_ID)).toBeInTheDocument()
  })

  it('does not render id link when briefId is missing even for admin', () => {
    mockUser = { _id: 'u1', isAdmin: true }
    render(<CategoryHeader category="Aircrafts" subcategory="Fighters" briefId={null} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('clicking id link navigates to /admin with editBriefId state and stops propagation', () => {
    mockUser = { _id: 'u1', isAdmin: true }
    const outerClick = vi.fn()
    render(
      <div onClick={outerClick}>
        <CategoryHeader category="Aircrafts" briefId={BRIEF_ID} />
      </div>
    )
    fireEvent.click(screen.getByText(BRIEF_ID))
    expect(mockNavigate).toHaveBeenCalledWith('/admin', { state: { editBriefId: BRIEF_ID } })
    expect(outerClick).not.toHaveBeenCalled()
  })

  it('dark variant renders inline category and shows admin id link', () => {
    mockUser = { _id: 'u1', isAdmin: true }
    render(<CategoryHeader variant="dark" category="News" subcategory="RAF" briefId={BRIEF_ID} />)
    expect(screen.getByText((content) => content.includes('News') && content.includes('RAF'))).toBeInTheDocument()
    expect(screen.getByText(BRIEF_ID)).toBeInTheDocument()
  })
})
