import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import Home from '../Home'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    svg:    ({ children, className, style }) => <svg className={className} style={style}>{children}</svg>,
    h2:     ({ children, className, style }) => <h2 className={className} style={style}>{children}</h2>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => false,
  useScroll:        () => ({ scrollY: 0 }),
  useTransform:     () => 0,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SETTINGS = { freeCategories: ['News'], silverCategories: [], goldCategories: [], guestCategories: ['News'] }

const UNLOCKED_WITH_IMAGES = {
  _id: 'b-img',
  title: 'Typhoon intercepts',
  category: 'News',
  isRead: false,
  isStarted: false,
  isLocked: false,
  images: [
    'https://res.cloudinary.com/demo/image/upload/typhoon-1.jpg',
    'https://res.cloudinary.com/demo/image/upload/typhoon-2.jpg',
  ],
}

const UNLOCKED_NO_IMAGES = {
  _id: 'b-none',
  title: 'Weather delays exercise',
  category: 'News',
  isRead: false,
  isStarted: false,
  isLocked: false,
}

const LOCKED_WITH_IMAGES = {
  _id: 'b-locked',
  title: 'Classified sortie',
  category: 'News',
  isRead: false,
  isStarted: false,
  isLocked: true,
  images: ['https://res.cloudinary.com/demo/image/upload/locked-1.jpg'],
}

function makeFetch(briefs) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupAuthedUser() {
  mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
  mockUseSettings.mockReturnValue({ settings: SETTINGS })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Home — Latest Intel image backdrops', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('renders an <img> for an unlocked brief that has images', async () => {
    global.fetch = makeFetch([UNLOCKED_WITH_IMAGES])
    setupAuthedUser()

    render(<Home />)

    // Title confirms the row mounted
    await waitFor(() => expect(screen.getByText('Typhoon intercepts')).toBeInTheDocument())

    // Backdrop uses img tags for each image in the list
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBeGreaterThan(0)
    // First image src should be the lowRes-transformed form of the first URL
    const firstSrc = imgs[0].getAttribute('src') ?? ''
    expect(firstSrc).toContain('/image/upload/w_320')
    expect(firstSrc).toContain('typhoon-1')
  })

  it('does not render an <img> when the brief has no images', async () => {
    global.fetch = makeFetch([UNLOCKED_NO_IMAGES])
    setupAuthedUser()

    render(<Home />)

    await waitFor(() => expect(screen.getByText('Weather delays exercise')).toBeInTheDocument())
    expect(document.querySelector('img')).toBeNull()
  })

  it('suppresses the backdrop on locked briefs even when images are present', async () => {
    global.fetch = makeFetch([LOCKED_WITH_IMAGES])
    setupAuthedUser()

    render(<Home />)

    await waitFor(() => expect(screen.getByText('Classified sortie')).toBeInTheDocument())
    // Locked rows should render the "Sign in to read" meta in place of image backdrop
    expect(screen.getByText('Sign in to read')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('mixes image-backed and image-less rows on the same list without crashing', async () => {
    global.fetch = makeFetch([UNLOCKED_WITH_IMAGES, UNLOCKED_NO_IMAGES, LOCKED_WITH_IMAGES])
    setupAuthedUser()

    render(<Home />)

    await waitFor(() => expect(screen.getByText('Typhoon intercepts')).toBeInTheDocument())
    expect(screen.getByText('Weather delays exercise')).toBeInTheDocument()
    expect(screen.getByText('Classified sortie')).toBeInTheDocument()

    // Only the unlocked-with-images brief contributes imgs (2 URLs in its list)
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBe(2)
  })
})
