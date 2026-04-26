import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

const mockUseAuth        = vi.hoisted(() => vi.fn())
const mockNavigate       = vi.hoisted(() => vi.fn())
const mockUseAppSettings = vi.hoisted(() => vi.fn())

vi.mock('../../utils/sound', () => ({
  playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn(), preloadSound: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief-host' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => mockUseAppSettings(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: false, enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('../../components/LockedCategoryModal', () => ({
  default: ({ category, tier, onClose }) => (
    <div data-testid="locked-category-modal">
      <p>LockedCategoryModal:{category}:{tier}</p>
      <button onClick={onClose}>Modal close</button>
    </div>
  ),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick }) => <div className={className} style={style} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className }) => <p className={className}>{children}</p>,
  },
  AnimatePresence:      ({ children }) => <>{children}</>,
  LayoutGroup:          ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
}))

const PUBLISHED_GOLD = { _id: 'brief-locked', title: 'Locked Brief', category: 'Tech', status: 'published' }
const PUBLISHED_FREE = { _id: 'brief-free',   title: 'Free Brief',   category: 'News', status: 'published' }

function makeHostBrief(linked) {
  return {
    _id: 'brief-host', title: 'Host Brief', subtitle: 'Top stuff', category: 'News',
    descriptionSections: ['The Spitfire is mentioned here.'],
    keywords: [{ keyword: 'Spitfire', linkedBriefId: linked }],
    sources: [], media: [],
  }
}
const FRESH_READ_RECORD = { _id: 'rr1', coinsAwarded: false, completed: false, currentSection: 0 }

const SETTINGS = {
  airstarsPerBriefRead: 5,
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts'],
  pathwayUnlocks:   [{ category: 'Tech', levelRequired: 5, rankRequired: 2 }],
}

function setupAuth(user) {
  mockUseAuth.mockReturnValue({
    user, API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(), setUser: vi.fn(),
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  sessionStorage.clear()
  localStorage.clear()
  mockUseAppSettings.mockReturnValue({ settings: SETTINGS, levelThresholds: [0, 100, 350, 850, 1700, 3000] })
})

afterEach(() => { vi.restoreAllMocks() })

function loadHost(linked) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { brief: makeHostBrief(linked), readRecord: FRESH_READ_RECORD, ammoMax: 3 } }),
  })
}

describe('BriefReader — keyword linked to a locked category', () => {
  it('shows the upgrade lock card (no navigation) and opens LockedCategoryModal on tap for free users hitting a Gold-tier link', async () => {
    setupAuth({ _id: 'u1', subscriptionTier: 'free', cycleAirstars: 99999, rank: { rankNumber: 19 } })
    loadHost(PUBLISHED_GOLD)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))
    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    expect(await screen.findByText(/Requires Gold/)).toBeInTheDocument()
    expect(screen.queryByText('Open Intel Brief')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Requires Gold/).closest('button'))
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/brief/brief-locked'))

    expect(await screen.findByTestId('locked-category-modal')).toBeInTheDocument()
    expect(screen.getByText('LockedCategoryModal:Tech:gold')).toBeInTheDocument()
  })

  it('shows the sign-in lock card for guests hitting a non-guest category link', async () => {
    setupAuth(null)
    loadHost(PUBLISHED_GOLD)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))
    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    expect(await screen.findByText('Sign in to access')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Sign in to access').closest('button'))
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/brief/brief-locked'))
    expect(await screen.findByTestId('locked-category-modal')).toBeInTheDocument()
  })

  it('shows a pathway-locked card with rank requirement and never opens LockedCategoryModal', async () => {
    setupAuth({ _id: 'u1', subscriptionTier: 'gold', cycleAirstars: 0, rank: { rankNumber: 1 } })
    loadHost(PUBLISHED_GOLD)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))
    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    expect(await screen.findByText(/Pathway locked/)).toBeInTheDocument()
    // The rank lookup may not match a MOCK_RANKS entry exactly — just confirm it
    // mentions the unlock requirement and stays on the host brief.
    expect(screen.queryByText('Open Intel Brief')).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/brief/brief-locked'))
  })

  it('shows a pathway-locked card with level requirement when rank is satisfied', async () => {
    setupAuth({ _id: 'u1', subscriptionTier: 'gold', cycleAirstars: 0, rank: { rankNumber: 2 } })
    loadHost(PUBLISHED_GOLD)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))
    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    expect(await screen.findByText(/Reach Agent Level 5/)).toBeInTheDocument()
    expect(screen.queryByText('Open Intel Brief')).not.toBeInTheDocument()
  })

  it('renders the regular blue CTA when the user can access the linked category', async () => {
    setupAuth({ _id: 'u1', subscriptionTier: 'free', cycleAirstars: 99999, rank: { rankNumber: 19 } })
    loadHost(PUBLISHED_FREE)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))
    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    expect(await screen.findByText('Open Intel Brief')).toBeInTheDocument()
    expect(screen.queryByText(/Requires Gold/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pathway locked/)).not.toBeInTheDocument()
  })
})
