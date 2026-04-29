import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Play from '../Play'

// ── Mocks (mirror Play.test.jsx exactly) ──────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className, 'data-testid': testId }) => (
    <a href={to} className={className} data-testid={testId}>{children}</a>
  ),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, API: '', apiFetch: (...args) => fetch(...args) })),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: vi.fn().mockReturnValue(false) }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: vi.fn(() => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  })),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('../../components/FlashcardGameModal', () => ({
  default: () => null,
}))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: vi.fn(() => ({
    newGames:             new Set(),
    hasAnyNew:            false,
    isUnlocked:           () => false,
    markSeen:             vi.fn(),
    markUnlockFromServer: vi.fn(),
    applyUnlocks:         vi.fn(),
    revokeUnlock:         vi.fn(),
  })),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Import mocked hook ─────────────────────────────────────────────────────

import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'

function setSettings(over = {}) {
  useAppSettings.mockReturnValue({
    settings: over,
    levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.scrollTo = vi.fn()
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('flashcard-recall/available-briefs'))
      return Promise.resolve({ json: async () => ({ data: { count: 0 } }) })
    return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Play page — Case Files entry', () => {
  it('hides the Case Files link when caseFilesEnabled is false (admin too)', () => {
    setSettings({ caseFilesEnabled: false })
    useAuth.mockReturnValue({
      user:      { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
      API:       '',
      apiFetch:  (...args) => fetch(...args),
    })
    render(<Play />)
    expect(screen.queryByTestId('case-files-link')).toBeNull()
  })

  it('hides the link entirely when caseFilesEnabled is false for a guest', () => {
    setSettings({ caseFilesEnabled: false })
    useAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
    render(<Play />)
    expect(screen.queryByTestId('case-files-link')).toBeNull()
  })

  it('renders the Case Files link as a navigable link for an admin when enabled', () => {
    setSettings({ caseFilesEnabled: true })
    useAuth.mockReturnValue({
      user:      { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
      API:       '',
      apiFetch:  (...args) => fetch(...args),
    })
    render(<Play />)
    const link = screen.getByTestId('case-files-link')
    expect(link.getAttribute('href')).toBe('/case-files')
    expect(link.getAttribute('data-locked')).toBeNull()
    expect(link.tagName.toLowerCase()).toBe('a')
  })

  it('renders the Case Files link for any signed-in user when enabled', () => {
    setSettings({ caseFilesEnabled: true })
    useAuth.mockReturnValue({
      user:      { _id: 'u1', isAdmin: false, subscriptionTier: 'free' },
      API:       '',
      apiFetch:  (...args) => fetch(...args),
    })
    render(<Play />)
    const link = screen.getByTestId('case-files-link')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link.getAttribute('href')).toBe('/case-files')
    expect(link.getAttribute('data-locked')).toBeNull()
  })
})
