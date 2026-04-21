import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({
  playSound: vi.fn(),
  stopAllSounds: vi.fn(),
  playGridRevealTone: vi.fn(),
  preloadSound: vi.fn(),
}))

const navigateMock = vi.fn()

vi.mock('react-router-dom', () => ({
  useParams: () => ({ briefId: 'brief123' }),
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children }) => children,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'user1' }, API: '', apiFetch: (...args) => fetch(...args) }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick }) =>
      <div className={className} style={style} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick }) =>
      <button className={className} onClick={onClick}>{children}</button>,
    p: ({ children, className }) => <p className={className}>{children}</p>,
  },
  AnimatePresence:      ({ children }) => <>{children}</>,
  LayoutGroup:          ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_BRIEF = {
  _id: 'brief123',
  title: 'F-35 Lightning II',
  subtitle: 'Multi-role stealth fighter',
  category: 'Aircrafts',
  subcategory: 'Fighter Jets',
  descriptionSections: [
    'Section one content.',
    'Section two content.',
  ],
  keywords: [],
  sources: [],
  media: [],
}

function makeFetchOk(brief = MOCK_BRIEF) {
  return vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ data: { brief } }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BriefReader — Report an issue link', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    sessionStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders a "Report an issue" button on the brief page', async () => {
    global.fetch = makeFetchOk()
    render(<BriefReader />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /report an issue/i }).length).toBeGreaterThan(0))
  })

  it('navigates to /report with briefId query param when clicked', async () => {
    global.fetch = makeFetchOk()
    render(<BriefReader />)
    const btn = (await screen.findAllByRole('button', { name: /report an issue/i }))[0]
    fireEvent.click(btn)
    expect(navigateMock).toHaveBeenCalledWith('/report?briefId=brief123')
  })

  it('renders the button even when the brief has no sources', async () => {
    global.fetch = makeFetchOk({ ...MOCK_BRIEF, sources: [] })
    render(<BriefReader />)
    const buttons = await screen.findAllByRole('button', { name: /report an issue/i })
    expect(buttons.length).toBeGreaterThan(0)
  })
})
