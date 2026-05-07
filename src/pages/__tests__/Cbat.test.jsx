import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Cbat, { CBAT_GAMES } from '../Cbat'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { cbatGameEnabled: {} } }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
  },
}))

const GAMES_WITH_IMAGES    = CBAT_GAMES.filter(g => g.image !== null)
const GAMES_WITHOUT_IMAGES = CBAT_GAMES.filter(g => g.image === null)

// ── Helpers ───────────────────────────────────────────────────────────────

function renderWithUser(user = { _id: '1', name: 'Test' }) {
  mockUseAuth.mockReturnValue({ user })
  return render(<Cbat />)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CBAT_GAMES data', () => {
  it('has 13 games with images and 0 without', () => {
    expect(GAMES_WITH_IMAGES.length).toBe(13)
    expect(GAMES_WITHOUT_IMAGES.length).toBe(0)
  })

  it('image paths match expected filenames', () => {
    const expected = {
      'target':           '/images/Target.png',
      'ant':              '/images/ANT.png',
      'symbols':          '/images/Symbols.png',
      'code-duplicates':  '/images/Code Duplicates.png',
      'angles':           '/images/Angles.png',
      'instruments':      '/images/Instruments.png',
      'plane-turn':       '/images/Plane Turn.png',
      'visualisation-2d': '/images/Visualisation 2D.png',
    }
    for (const [key, path] of Object.entries(expected)) {
      const game = CBAT_GAMES.find(g => g.key === key)
      expect(game.image).toBe(path)
    }
  })

  it('coming-soon games use the placeholder image', () => {
    const comingSoonKeys = ['audio-interrupt', 'dad', 'visualisation-3d']
    for (const key of comingSoonKeys) {
      const game = CBAT_GAMES.find(g => g.key === key)
      expect(game.image).toBe('/images/placeholder-brief.svg')
    }
  })
})

describe('Cbat page — background images', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  it('renders a bg image element for each game that has an image', () => {
    renderWithUser()
    for (const game of GAMES_WITH_IMAGES) {
      const img = screen.getByTestId(`card-bg-image-${game.key}`)
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', game.image)
    }
  })

  it('renders a bg image for coming-soon games using the placeholder', () => {
    renderWithUser()
    const placeholderKeys = ['audio-interrupt', 'dad', 'visualisation-3d']
    for (const key of placeholderKeys) {
      const img = screen.getByTestId(`card-bg-image-${key}`)
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', '/images/placeholder-brief.svg')
    }
  })

  it('bg image elements are aria-hidden', () => {
    renderWithUser()
    for (const game of GAMES_WITH_IMAGES) {
      const img = screen.getByTestId(`card-bg-image-${game.key}`)
      expect(img).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('renders all game titles regardless of image presence', () => {
    renderWithUser()
    for (const game of CBAT_GAMES) {
      expect(screen.getByText(game.title)).toBeInTheDocument()
    }
  })

  it('shows lock card and blurs grid when user is null', () => {
    mockUseAuth.mockReturnValue({ user: null })
    render(<Cbat />)
    expect(screen.getByText(/Sign in to access CBAT Games/i)).toBeInTheDocument()
  })
})
