import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The Admin nav dot must light up on everything the Admin panel's Intel tab
// lights up on. It used to watch unsolved reports only, so an unresolved system
// log dotted Intel but left the nav entry clean — invisible unless you happened
// to open Admin.
const mockReports = vi.hoisted(() => ({ unsolvedCount: 0, unresolvedSystemLogs: 0 }))
const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
  Link: ({ children, className, to, onClick, ...rest }) => (
    <a href={to} className={className} onClick={onClick} {...rest}>{children}</a>
  ),
}))

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../../context/NewGameUnlockContext', () => ({ useNewGameUnlock: () => ({ hasAnyNew: false }) }))
vi.mock('../../../context/NewCategoryUnlockContext', () => ({ useNewCategoryUnlock: () => ({ hasAnyNew: false, firstNewCategory: null }) }))
vi.mock('../../../context/UnsolvedReportsContext', () => ({ useUnsolvedReports: () => mockReports }))
vi.mock('../../../context/ChatUnreadContext', () => ({ useChatUnread: () => ({ hasUnread: false, badgeCount: 0 }) }))
vi.mock('../../../hooks/useSlimMode', () => ({ useSlimMode: () => false }))
vi.mock('../../world3d/state/useWorld3dEnabled', () => ({ useWorld3dNavVisible: () => false }))
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    levels: [{ levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 }],
    settings: { chatEnabled: false },
  }),
}))

import Sidebar from '../Sidebar'

const adminDot = () =>
  document.querySelector('a[href="/admin"] .nav-new-badge')

function setupAdmin() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', displayName: 'Agent', isAdmin: true, cycleAirstars: 0, totalAirstars: 0 },
    logout: vi.fn(),
    apiFetch: vi.fn(),
  })
}

describe('Sidebar — Admin nav dot', () => {
  beforeEach(() => {
    mockReports.unsolvedCount = 0
    mockReports.unresolvedSystemLogs = 0
    setupAdmin()
  })

  it('shows no dot when both intel queues are clear', () => {
    render(<Sidebar />)
    expect(adminDot()).toBeNull()
  })

  it('shows the dot for unsolved reports', () => {
    mockReports.unsolvedCount = 2
    render(<Sidebar />)
    expect(adminDot()).not.toBeNull()
    expect(screen.getByLabelText('2 unsolved reports')).toBeInTheDocument()
  })

  it('shows the dot for unresolved system logs alone', () => {
    mockReports.unresolvedSystemLogs = 1
    render(<Sidebar />)
    expect(adminDot()).not.toBeNull()
    expect(screen.getByLabelText('1 unresolved system log')).toBeInTheDocument()
  })

  it('names both queues when both have work waiting', () => {
    mockReports.unsolvedCount = 1
    mockReports.unresolvedSystemLogs = 3
    render(<Sidebar />)
    expect(screen.getByLabelText('1 unsolved report, 3 unresolved system logs')).toBeInTheDocument()
  })
})
