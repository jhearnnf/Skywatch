import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../utils/sound', () => ({
  getMasterVolume: () => 50,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mockFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { levels: [], useLiveLeaderboard: false } }),
  })
}

function setupUser(overrides = {}) {
  mockUseAuth.mockReturnValue({
    user: {
      _id: 'u1',
      displayName: 'Agent Test',
      subscriptionTier: 'free',
      cycleAircoins: 0,
      totalAircoins: 0,
      loginStreak: 0,
      ...overrides,
    },
    API: '',
    setUser: vi.fn(),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Profile — trial tier display', () => {
  beforeEach(() => {
    mockFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('active trial user sees "Trial (Silver)" as plan label', async () => {
    setupUser({ subscriptionTier: 'trial', isTrialActive: true })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Trial (Silver)')).toBeDefined())
  })

  it('expired trial user sees "Trial (expired)" as plan label', async () => {
    setupUser({ subscriptionTier: 'trial', isTrialActive: false })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Trial (expired)')).toBeDefined())
  })

  it('free user sees "Free" as plan label', async () => {
    setupUser({ subscriptionTier: 'free' })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Free')).toBeDefined())
  })

  it('silver user sees "Silver" as plan label', async () => {
    setupUser({ subscriptionTier: 'silver' })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Silver')).toBeDefined())
  })

  it('gold user sees "Gold" as plan label', async () => {
    setupUser({ subscriptionTier: 'gold' })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Gold')).toBeDefined())
  })

  it('active trial user sees "Manage →" CTA (same as paid tiers)', async () => {
    setupUser({ subscriptionTier: 'trial', isTrialActive: true })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Manage →')).toBeDefined())
  })

  it('expired trial user sees "Upgrade →" CTA', async () => {
    setupUser({ subscriptionTier: 'trial', isTrialActive: false })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Upgrade →')).toBeDefined())
  })

  it('free user sees "Upgrade →" CTA', async () => {
    setupUser({ subscriptionTier: 'free' })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Upgrade →')).toBeDefined())
  })

  it('active trial shows silver medal icon (🥈)', async () => {
    setupUser({ subscriptionTier: 'trial', isTrialActive: true })
    render(<Profile />)
    // Find the subscription section — the icon span should contain the silver medal
    await waitFor(() => {
      const subscriptionSection = screen.getByText('Current Plan').closest('div').parentElement
      expect(subscriptionSection.textContent).toContain('🥈')
    })
  })

  it('gold user shows gold medal icon (🥇)', async () => {
    setupUser({ subscriptionTier: 'gold' })
    render(<Profile />)
    await waitFor(() => {
      const subscriptionSection = screen.getByText('Current Plan').closest('div').parentElement
      expect(subscriptionSection.textContent).toContain('🥇')
    })
  })
})
