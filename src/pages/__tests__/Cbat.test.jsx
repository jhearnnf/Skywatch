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

// ⚠️ INTENTIONAL FAILURES until SAT launches.
// Some tests below encode the *end state* — every CBAT game visible on the hub
// as a clickable, imaged tile. SAT is currently `hidden: true` with no image
// (it's in private testing), so those tests fail on purpose. They serve as a
// forcing reminder and turn green automatically the moment SAT is unhidden and
// given an image. Tests that are scoped to what's actually rendered today
// (image paths, aria-hidden, lock card) stay green. See src/data/cbatGames.js.
const GAMES_WITH_IMAGES    = CBAT_GAMES.filter(g => g.image)
const GAMES_WITHOUT_IMAGES = CBAT_GAMES.filter(g => !g.image)

// ── Helpers ───────────────────────────────────────────────────────────────

function renderWithUser(user = { _id: '1', name: 'Test' }) {
  // RecentCbatScores side column renders for any signed-in user; stub apiFetch
  // so the polling loop has a no-op fetch to call.
  const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { recent: [] } }) })
  mockUseAuth.mockReturnValue({ user, API: '', apiFetch })
  return render(<Cbat />)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CBAT_GAMES data', () => {
  // ❌ Fails until SAT launches: SAT is hidden + has no image today.
  it('has 14 games, all visible and clickable with images', () => {
    expect(CBAT_GAMES.length).toBe(14)
    expect(GAMES_WITH_IMAGES.length).toBe(14)
    expect(GAMES_WITHOUT_IMAGES.length).toBe(0)
    expect(CBAT_GAMES.every(g => !g.hidden)).toBe(true)
  })

  it('image paths match expected filenames', () => {
    const expected = {
      'target':          '/images/Target.png',
      'ant':             '/images/ANT.png',
      'symbols':         '/images/Symbols.png',
      'code-duplicates': '/images/Code Duplicates.png',
      'angles':          '/images/Angles.png',
      'instruments':     '/images/Instruments.png',
      'plane-turn':      '/images/Plane Turn.png',
      'visualisation':   '/images/Visualisation 2D.png',
    }
    for (const [key, path] of Object.entries(expected)) {
      const game = CBAT_GAMES.find(g => g.key === key)
      expect(game.image).toBe(path)
    }
  })

})

describe('Cbat page — background images', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  // ❌ Fails until SAT launches: no card-bg-image-sat is rendered while SAT is
  // hidden + imageless. Passes once SAT is a visible, imaged tile.
  it('renders a bg image element for every game', () => {
    renderWithUser()
    for (const game of CBAT_GAMES) {
      const img = screen.getByTestId(`card-bg-image-${game.key}`)
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', game.image)
    }
  })

  it('bg image elements are aria-hidden', () => {
    renderWithUser()
    for (const game of GAMES_WITH_IMAGES) {
      const img = screen.getByTestId(`card-bg-image-${game.key}`)
      expect(img).toHaveAttribute('aria-hidden', 'true')
    }
  })

  // ❌ Fails until SAT launches: the SAT tile isn't rendered while hidden.
  it('renders every game title', () => {
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
