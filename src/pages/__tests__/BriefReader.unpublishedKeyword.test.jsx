import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

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
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: false, enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

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

const STUB_LINKED = { _id: 'brief-stub', title: 'Future Brief', category: 'Aircrafts', status: 'stub' }

const HOST_BRIEF = {
  _id: 'brief-host',
  title: 'Host Brief',
  subtitle: 'Top stuff',
  category: 'Training',
  descriptionSections: ['The Spitfire is mentioned here.'],
  keywords: [{ keyword: 'Spitfire', linkedBriefId: STUB_LINKED }],
  sources: [],
  media: [],
}

const FRESH_READ_RECORD = { _id: 'rr1', coinsAwarded: false, completed: false, currentSection: 0 }

function setupAuth({ isAdmin }) {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1', loginStreak: 0, isAdmin },
    API:           '',
    apiFetch:      (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  sessionStorage.clear()
  localStorage.clear()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { brief: HOST_BRIEF, readRecord: FRESH_READ_RECORD, ammoMax: 3 } }),
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('BriefReader — keyword linked to unpublished brief', () => {
  it('shows a disabled "Intel still being prepared" CTA for non-admin users and does not navigate on click', async () => {
    setupAuth({ isAdmin: false })
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))

    const kwButton = screen.getByRole('button', { name: 'Spitfire' })
    fireEvent.click(kwButton)

    expect(await screen.findByText('Intel still being prepared')).toBeInTheDocument()
    expect(screen.queryByText('Open Non-Published Brief')).not.toBeInTheDocument()

    const disabledCta = screen.getByText('Intel still being prepared').closest('button')
    fireEvent.click(disabledCta)
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/brief/brief-stub'))
  })

  it('reveals an admin-only "Open Non-Published Brief" CTA on first interaction for admins, then navigates on the second click', async () => {
    setupAuth({ isAdmin: true })
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))

    const kwButton = screen.getByRole('button', { name: 'Spitfire' })
    fireEvent.click(kwButton)

    // Default disabled state shown to admins too — no admin CTA yet.
    expect(await screen.findByText('Intel still being prepared')).toBeInTheDocument()
    expect(screen.queryByText('Open Non-Published Brief')).not.toBeInTheDocument()

    // First admin click reveals (does not navigate).
    const disabledCta = screen.getByText('Intel still being prepared').closest('button')
    fireEvent.click(disabledCta)
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/brief/brief-stub'))

    // Admin override CTA now visible.
    const adminCta = await screen.findByText('Open Non-Published Brief')
    expect(adminCta).toBeInTheDocument()

    // Second click navigates.
    fireEvent.click(adminCta.closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief-stub')
  })

  it('reveals the admin override on hover (desktop) without an extra click', async () => {
    setupAuth({ isAdmin: true })
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))

    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    const disabledCta = (await screen.findByText('Intel still being prepared')).closest('button')
    fireEvent.mouseEnter(disabledCta)

    const adminCta = await screen.findByText('Open Non-Published Brief')
    fireEvent.click(adminCta.closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief-stub')
  })

  it('auto-collapses the admin override after 2s of inactivity', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupAuth({ isAdmin: true })
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))

    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))
    const disabledCta = (await screen.findByText('Intel still being prepared')).closest('button')
    fireEvent.mouseEnter(disabledCta)

    expect(await screen.findByText('Open Non-Published Brief')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(2100) })

    expect(screen.queryByText('Open Non-Published Brief')).not.toBeInTheDocument()
    expect(screen.getByText('Intel still being prepared')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('collapses the admin override immediately when the admin mouses away', async () => {
    setupAuth({ isAdmin: true })
    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))

    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))
    const disabledCta = (await screen.findByText('Intel still being prepared')).closest('button')
    fireEvent.mouseEnter(disabledCta)

    const adminBtn = (await screen.findByText('Open Non-Published Brief')).closest('button')
    fireEvent.mouseLeave(adminBtn)

    await waitFor(() => expect(screen.queryByText('Open Non-Published Brief')).not.toBeInTheDocument())
    expect(screen.getByText('Intel still being prepared')).toBeInTheDocument()
  })

  it('renders the regular blue CTA when the linked brief is published', async () => {
    setupAuth({ isAdmin: false })
    const PUBLISHED_LINKED = { ...STUB_LINKED, status: 'published' }
    const PUBLISHED_HOST = { ...HOST_BRIEF, keywords: [{ keyword: 'Spitfire', linkedBriefId: PUBLISHED_LINKED }] }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { brief: PUBLISHED_HOST, readRecord: FRESH_READ_RECORD, ammoMax: 3 } }),
    })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Host Brief'))
    fireEvent.click(screen.getByRole('button', { name: 'Spitfire' }))

    expect(await screen.findByText('Open Intel Brief')).toBeInTheDocument()
    expect(screen.queryByText('Intel still being prepared')).not.toBeInTheDocument()
  })
})
