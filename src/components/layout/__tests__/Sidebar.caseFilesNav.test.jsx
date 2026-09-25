import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The Case Files tab is earned: the feature and nav switches must be on, and
// the server must say the player has finished enough CBAT games.
const mockSlim     = vi.hoisted(() => ({ value: false }))
const mockSettings = vi.hoisted(() => ({ value: {} }))
const mockPath     = vi.hoisted(() => ({ value: '/home' }))
const mockUseAuth  = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: mockPath.value }),
  Link: ({ children, className, to, onClick, ...rest }) => (
    <a href={to} className={className} onClick={onClick} {...rest}>{children}</a>
  ),
}))
vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../../context/NewGameUnlockContext', () => ({ useNewGameUnlock: () => ({ hasAnyNew: false }) }))
vi.mock('../../../context/NewCategoryUnlockContext', () => ({ useNewCategoryUnlock: () => ({ hasAnyNew: false, firstNewCategory: null }) }))
vi.mock('../../../context/UnsolvedReportsContext', () => ({ useUnsolvedReports: () => ({ unsolvedCount: 0 }) }))
vi.mock('../../../context/ChatUnreadContext', () => ({ useChatUnread: () => ({ hasUnread: false, badgeCount: 0 }) }))
vi.mock('../../../hooks/useSlimMode', () => ({ useSlimMode: () => mockSlim.value, useSlimLearnEnabled: () => true }))
vi.mock('../../world3d/state/useWorld3dEnabled', () => ({ useWorld3dNavVisible: () => false }))
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    levels: [{ levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 }],
    settings: mockSettings.value,
  }),
}))

import Sidebar from '../Sidebar'
import { __resetCaseFilesNavCache } from '../../../hooks/useCaseFilesNav'

const tab = () => document.querySelector('[data-nav="case-files"]')

function signIn(id = 'u1') {
  mockUseAuth.mockReturnValue({
    user: { _id: id, displayName: 'Agent', cycleAirstars: 0, totalAirstars: 0, rank: { rankNumber: 1, rankAbbreviation: 'AC' } },
    logout: vi.fn(), API: '', apiFetch: vi.fn(),
  })
}
function serverSays(visible) {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ visible }) }))
}

beforeEach(() => {
  __resetCaseFilesNavCache()
  mockSlim.value = false
  mockPath.value = '/home'
  mockSettings.value = { chatEnabled: true, caseFilesEnabled: true, caseFilesNavEnabled: true }
  try { localStorage.clear() } catch { /* ignore */ }
  signIn()
})
afterEach(() => vi.restoreAllMocks())

describe('Sidebar — Case Files tab', () => {
  it('appears for a player the server says has earned it, straight after Play', async () => {
    serverSays(true)
    render(<Sidebar />)
    await waitFor(() => expect(tab()).not.toBeNull())
    const hrefs = [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href'))
    expect(hrefs.indexOf('/case-files')).toBe(hrefs.indexOf('/play') + 1)
    expect(screen.getByTestId('case-files-nav-icon')).toBeDefined()
    expect(tab().querySelector('[aria-label="Case Files"]')).not.toBeNull()
  })

  it('stays away for a player who has not', async () => {
    serverSays(false)
    render(<Sidebar />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(tab()).toBeNull()
  })

  it('is not even asked for when the nav switch is off', async () => {
    serverSays(true)
    mockSettings.value = { ...mockSettings.value, caseFilesNavEnabled: false }
    render(<Sidebar />)
    await new Promise(r => setTimeout(r, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(tab()).toBeNull()
  })

  it('is not asked for when Case Files itself is off', async () => {
    serverSays(true)
    mockSettings.value = { ...mockSettings.value, caseFilesEnabled: false }
    render(<Sidebar />)
    await new Promise(r => setTimeout(r, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(tab()).toBeNull()
  })

  it('carries a "new" dot until Case Files has been opened', async () => {
    serverSays(true)
    render(<Sidebar />)
    await waitFor(() => expect(tab()).not.toBeNull())
    expect(tab().querySelector('.nav-new-badge')).not.toBeNull()
  })

  it('drops the dot for a player who has already opened it', async () => {
    serverSays(true)
    localStorage.setItem('cfNavSeen:u1', '1')
    render(<Sidebar />)
    await waitFor(() => expect(tab()).not.toBeNull())
    expect(tab().querySelector('.nav-new-badge')).toBeNull()
  })

  it('lights up on Case Files pages instead of Play', async () => {
    serverSays(true)
    mockPath.value = '/case-files/russia-ukraine/road-to-invasion'
    render(<Sidebar />)
    await waitFor(() => expect(tab()).not.toBeNull())
    expect(tab().getAttribute('aria-current')).toBe('page')
    expect(document.querySelector('[data-nav="play"]').getAttribute('aria-current')).toBeNull()
    // And, being on Case Files, the "new" dot is already gone.
    expect(tab().querySelector('.nav-new-badge')).toBeNull()
  })

  it('shows in slim mode too, after CBAT', async () => {
    serverSays(true)
    mockSlim.value = true
    render(<Sidebar />)
    await waitFor(() => expect(tab()).not.toBeNull())
    const hrefs = [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href'))
    expect(hrefs.indexOf('/case-files')).toBe(hrefs.indexOf('/cbat') + 1)
  })
})
