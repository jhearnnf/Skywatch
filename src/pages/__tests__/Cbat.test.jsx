import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Cbat, { CBAT_GAMES } from '../Cbat'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  // Spread the rest so contextmenu/touch/click handlers reach the anchor.
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
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

// Every CBAT game is visible on the hub as a clickable, imaged tile — no
// `hidden` entries. These tests assert that end state across the whole list.
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
  it('has 15 games, all visible and clickable with images', () => {
    expect(CBAT_GAMES.length).toBe(15)
    expect(GAMES_WITH_IMAGES.length).toBe(15)
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

describe('Cbat page — shortcut to all-time leaderboard', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    mockNavigate.mockReset()
    localStorage.clear()
  })

  // The tile's leaderboard key is the last path segment for most games…
  it('right-clicking a tile navigates to its all-time leaderboard', () => {
    renderWithUser()
    fireEvent.contextMenu(screen.getByText('Target').closest('a'))
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/target/leaderboard?period=all-time')
  })

  // …but the two combined tiles have no single board, so with nothing stored
  // they fall back to their hooks' defaults (Trace 1, Visualisation 2D).
  it('defaults the combined Trace and Visualisation tiles to their default modes', () => {
    renderWithUser()

    fireEvent.contextMenu(screen.getByText('Trace 1/2').closest('a'))
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/trace-1/leaderboard?period=all-time')

    fireEvent.contextMenu(screen.getByText('Visualisation 2D/3D').closest('a'))
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/visualisation-2d/leaderboard?period=all-time')
  })

  // …and follow the mode the user last selected when one is persisted.
  it('follows the persisted mode for the combined tiles', () => {
    localStorage.setItem('cbat:trace:mode', 'trace2')
    localStorage.setItem('cbat:visualisation:mode', '3d')
    renderWithUser()

    fireEvent.contextMenu(screen.getByText('Trace 1/2').closest('a'))
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/trace-2/leaderboard?period=all-time')

    fireEvent.contextMenu(screen.getByText('Visualisation 2D/3D').closest('a'))
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/visualisation-3d/leaderboard?period=all-time')
  })

  // Desktop hover split: the combined tiles overlay two mode buttons.
  it('overlays the two mode buttons on the combined tiles', () => {
    renderWithUser()
    expect(screen.getByText('Trace 1')).toBeInTheDocument()
    expect(screen.getByText('Trace 2')).toBeInTheDocument()
    expect(screen.getByText('2D')).toBeInTheDocument()
    expect(screen.getByText('3D')).toBeInTheDocument()
  })

  it('left-clicking a mode button selects that mode and opens the game', () => {
    renderWithUser()
    fireEvent.click(screen.getByText('Trace 2'))
    expect(localStorage.getItem('cbat:trace:mode')).toBe('trace2')
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/trace')
  })

  it('right-clicking a mode button opens that mode\'s all-time leaderboard', () => {
    renderWithUser()
    fireEvent.contextMenu(screen.getByText('3D'))   // Visualisation 3D half
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/visualisation-3d/leaderboard?period=all-time')
  })

  // Mobile: a ~500ms long-press does the same as a right-click.
  it('opens the all-time board on a long-press, and swallows the tap-through', () => {
    vi.useFakeTimers()
    try {
      renderWithUser()
      const tile = screen.getByText('Target').closest('a')

      fireEvent.touchStart(tile)
      vi.advanceTimersByTime(500)
      expect(mockNavigate).toHaveBeenCalledWith('/cbat/target/leaderboard?period=all-time')

      // The click synthesised after the press must not also open the game.
      const clickEvt = fireEvent.click(tile)
      expect(clickEvt).toBe(false)   // defaultPrevented → RRD navigation suppressed
    } finally {
      vi.useRealTimers()
    }
  })

  // A quick tap (released before the threshold) must NOT hijack navigation.
  it('does not fire on a short tap', () => {
    vi.useFakeTimers()
    try {
      renderWithUser()
      const tile = screen.getByText('Target').closest('a')

      fireEvent.touchStart(tile)
      vi.advanceTimersByTime(200)
      fireEvent.touchEnd(tile)
      vi.advanceTimersByTime(500)
      expect(mockNavigate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
