import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Sidebar from '../Sidebar'

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  NavLink: ({ children, className, to, onClick }) => {
    const cls = typeof className === 'function' ? className({ isActive: false }) : className
    return <a href={to} className={cls} onClick={onClick}>{children}</a>
  },
}))

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../../context/NewGameUnlockContext', () => ({ useNewGameUnlock: () => ({ hasAnyNew: false }) }))
vi.mock('../../../context/NewCategoryUnlockContext', () => ({ useNewCategoryUnlock: () => ({ hasAnyNew: false, firstNewCategory: null }) }))
vi.mock('../../../context/UnsolvedReportsContext', () => ({ useUnsolvedReports: () => ({ unsolvedCount: 0 }) }))
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ levels: [{ levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 }] }),
}))

function setupUser(overrides = {}) {
  mockUseAuth.mockReturnValue({
    user: {
      _id: 'u1',
      displayName: 'Agent',
      cycleAirstars: 0,
      totalAirstars: 0,
      rank: { rankNumber: 1, rankAbbreviation: 'AC' },
      ...overrides,
    },
    logout: vi.fn(),
  })
}

describe('Sidebar — bottom user widget badge navigation', () => {
  beforeEach(() => { mockNavigate.mockClear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('navigates to /rankings with ranks tab when user has the default rank badge', () => {
    setupUser({ selectedBadge: null })
    render(<Sidebar />)
    fireEvent.click(screen.getByLabelText('View RAF ranks'))
    expect(mockNavigate).toHaveBeenCalledWith('/rankings', { state: { tab: 'ranks' } })
  })

  it('navigates to /profile/badge when user has an aircraft cutout selected', () => {
    setupUser({
      rank: { rankNumber: 4, rankAbbreviation: 'Cpl' },
      selectedBadge: { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'https://cdn/typhoon.png' },
    })
    render(<Sidebar />)
    fireEvent.click(screen.getByLabelText('Change profile badge'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile/badge', undefined)
  })

  it('renders the aircraft cutout image when selectedBadge is set', () => {
    setupUser({
      rank: { rankNumber: 4, rankAbbreviation: 'Cpl' },
      selectedBadge: { briefId: 'b1', title: 'Typhoon', cutoutUrl: 'https://cdn/typhoon.png' },
    })
    const { container } = render(<Sidebar />)
    const img = container.querySelector('img.profile-badge-cutout-img')
    expect(img).not.toBeNull()
  })
})
