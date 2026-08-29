import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Cbat, { CBAT_GAMES } from '../Cbat'
import { formatEstTime, formatEstTimeCompact, shortTitle, CBAT_SHORT_TITLES } from '../../data/cbatGames'


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
  it('has 22 games, all visible, and every one of them now carries tile art', () => {
    // The six most recent — SIT, SLT, VLT, MATF, Vigilance and SMA — shipped
    // without an image on purpose, because CardBgImage returns null when `image`
    // is unset and a finished game should never be held back waiting on
    // artwork. That art has now arrived, so the roster is fully illustrated.
    // The invariant that matters is still the one below: a tile either has art
    // or renders cleanly without it.
    expect(CBAT_GAMES.length).toBe(22)
    expect(GAMES_WITH_IMAGES.length).toBe(22)
    expect(GAMES_WITHOUT_IMAGES.length).toBe(0)
    expect(CBAT_GAMES.every(g => !g.hidden)).toBe(true)
  })

  // A new game landing on the hub without a time estimate would render a tile
  // that's silently missing a line the others all have, so this is an
  // invariant over the whole list rather than a spot check.
  it('every game states how long a run takes', () => {
    for (const game of CBAT_GAMES) {
      const est = game.estMinutes
      expect(est, `${game.key} has no estMinutes`).toBeDefined()
      const bounds = Array.isArray(est) ? est : [est]
      expect(bounds.every(n => typeof n === 'number' && n > 0)).toBe(true)
      // A range must actually be a range, low end first.
      if (Array.isArray(est)) {
        expect(est).toHaveLength(2)
        expect(est[0]).toBeLessThanOrEqual(est[1])
      }
    }
  })

  it('formats single estimates and ranges', () => {
    expect(formatEstTime({ estMinutes: 2 })).toBe('⏱ 2 min')
    expect(formatEstTime({ estMinutes: 1.5 })).toBe('⏱ 1.5 min')
    expect(formatEstTime({ estMinutes: [2, 3] })).toBe('⏱ 2–3 min')
    // A range whose ends collapse reads as a single value, not "2–2".
    expect(formatEstTime({ estMinutes: [2, 2] })).toBe('⏱ 2 min')
    expect(formatEstTime({})).toBeNull()
    expect(formatEstTime(null)).toBeNull()
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

  it('renders a bg image element for every game that has art', () => {
    renderWithUser()
    for (const game of GAMES_WITH_IMAGES) {
      const img = screen.getByTestId(`card-bg-image-${game.key}`)
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', game.image)
    }
  })

  it('renders no bg image element for a game without art, rather than an empty one', () => {
    // A broken <img> with no src would show the browser's placeholder over the
    // tile. CardBgImage returns null instead — this pins that.
    renderWithUser()
    for (const game of GAMES_WITHOUT_IMAGES) {
      expect(screen.queryByTestId(`card-bg-image-${game.key}`)).toBeNull()
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

  // Covers both tile branches a signed-in user sees: the plain <Link> tile and
  // the CombinedGameTile used by Trace 1/2 and Visualisation 2D/3D.
  it('renders the time estimate on every tile', () => {
    renderWithUser()
    for (const game of CBAT_GAMES) {
      expect(screen.getByTestId(`est-time-${game.key}`)).toHaveTextContent(formatEstTime(game))
    }
  })

  // The desktop card's estimate is a corner pill on the card itself, not part of
  // the text block — it must be a sibling of the title/desc wrapper, or absolute
  // positioning would resolve against the wrong box.
  it('pins the desktop estimate to the card corner, outside the text block', () => {
    renderWithUser()
    const pill = screen.getByTestId('est-time-target')
    expect(pill.className).toContain('absolute')
    expect(pill.className).toContain('top-2')
    expect(pill.className).toContain('left-2')
    expect(pill.className).toContain('hidden sm:block')
    expect(pill.parentElement).not.toBe(screen.getByText('Target').parentElement)
  })

  it('shows a range on the tiles that cover two run lengths', () => {
    renderWithUser()
    expect(screen.getByTestId('est-time-plane-turn')).toHaveTextContent('⏱ 1–2 min')
    expect(screen.getByTestId('est-time-sat')).toHaveTextContent('⏱ 4–6 min')
    // DPT is by far the longest game — worth stating plainly before a player
    // starts it, and worth a test so a future retune can't quietly drop it.
    // It was a flat 15 minutes until the eight-round ladder was split in two:
    // Easier now runs rounds 1-4 (105+105+105+120 seconds) and Hard runs
    // rounds 5-8 (120+180+180+180), so the tile covers both lengths.
    expect(screen.getByTestId('est-time-dpt')).toHaveTextContent('⏱ 7–11 min')
  })

  it('shows lock card and blurs grid when user is null', () => {
    mockUseAuth.mockReturnValue({ user: null })
    render(<Cbat />)
    expect(screen.getByText(/Sign in to access CBAT Aptitude Practise/i)).toBeInTheDocument()
  })
})

// The hub is four tiles across on a phone so all 22 games sit on one screen. The
// desktop card grid is deliberately untouched — two columns of 130px cards with
// descriptions, as it has always been. One DOM serves both, so these tests are
// about the responsive classes rather than a measured layout; jsdom computes
// none. What they protect is the set of decisions that let the phone grid fit,
// and that none of them leaked into the desktop card.
describe('Cbat page — dense mobile grid', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    localStorage.clear()
  })

  const grid = () => screen.getByText('Target').closest('.grid')

  it('is four across on mobile and two across from sm up', () => {
    renderWithUser()
    expect(grid().className).toContain('grid-cols-4')
    expect(grid().className).toContain('sm:grid-cols-2')
  })

  // The 2rem row gap used to be an inline style, which beats any class and
  // applies at every width — it would have put 32px between rows of an 83px
  // tile and undone the whole layout. It has to stay a responsive class.
  it('sets the desktop row gap by class, never inline', () => {
    renderWithUser()
    expect(grid().getAttribute('style')).toBeNull()
    expect(grid().className).toContain('sm:gap-y-8')
  })

  it('gives every tile the compact geometry on mobile and the card from sm up', () => {
    renderWithUser()
    for (const game of CBAT_GAMES) {
      const tile = screen.getByText(shortTitle(game) ?? game.title).closest('a, div.relative')
      expect(tile.className, game.key).toContain('min-h-[70px]')
      expect(tile.className, game.key).toContain('sm:min-h-[130px]')
      expect(tile.className, game.key).toContain('flex-col')
      expect(tile.className, game.key).toContain('sm:flex-row')
    }
  })

  // There is no room for a sentence on an 83px tile. The description stays in
  // the DOM for the desktop card and is hidden below sm, rather than being
  // dropped from the markup, so one render serves both widths.
  it('hides the description below sm and keeps it from sm up', () => {
    renderWithUser()
    const desc = screen.getByText(CBAT_GAMES[0].desc)
    expect(desc.className).toContain('hidden')
    expect(desc.className).toContain('sm:block')
  })

  it('shows the compact run time on mobile alongside the desktop pill', () => {
    renderWithUser()
    for (const game of CBAT_GAMES) {
      expect(screen.getByTestId(`est-time-compact-${game.key}`))
        .toHaveTextContent(formatEstTimeCompact(game))
      expect(screen.getByTestId(`est-time-compact-${game.key}`).className).toContain('sm:hidden')
      // The corner pill is still there for the desktop card, hidden below sm.
      expect(screen.getByTestId(`est-time-${game.key}`).className).toContain('hidden')
      expect(screen.getByTestId(`est-time-${game.key}`).className).toContain('sm:block')
    }
  })

  // The report link sits on the bottom edge of the page rather than trailing the
  // last row of tiles, which on a phone leaves it stranded mid-screen.
  it('pushes the report link to the bottom of the page', () => {
    renderWithUser()
    expect(screen.getByTestId('cbat-footer-report').className).toContain('mt-auto')
  })

  // On a phone the grid is four across, so a roster that is not a multiple of
  // four ends on a part-empty row. The report link goes in that dead space
  // instead of costing the page a footer strip of its own — the whole point
  // being that it is free height, so it must only happen when the cells are
  // genuinely spare.
  describe('report link in the grid', () => {
    const visible = CBAT_GAMES.filter(g => !g.hidden)
    const trailing = (4 - (visible.length % 4)) % 4

    it('fills the last row dead cells at the current roster size', () => {
      // 22 games, so two cells free beside Vigilance and SMA. If this fails the
      // roster changed size and the expectations below are what matter.
      expect(trailing).toBe(2)
      renderWithUser()
      const cell = screen.getByTestId('cbat-grid-report')
      expect(cell).toBeInTheDocument()
      expect(cell.closest('div').className).toContain('col-span-2')
      // Phone only: the desktop grid is two across and always full.
      expect(cell.closest('div').className).toContain('sm:hidden')
    })

    it('is not a tile', () => {
      renderWithUser()
      // Everything that makes a card in this grid read as a game is absent, or
      // the grid grows a 23rd thing that looks playable.
      const cell = screen.getByTestId('cbat-grid-report')
      for (const tileClass of ['bg-surface', 'card-shadow', 'border-slate-200', 'rounded-xl']) {
        expect(cell.className).not.toContain(tileClass)
      }
    })

    it('hides the footer strip on a phone while the grid carries the link', () => {
      renderWithUser()
      // Both exist in the DOM; the footer is the one that goes away under `sm`.
      expect(screen.getByTestId('cbat-footer-report').className).toContain('hidden sm:block')
    })

    // The link must still be reachable from this page on a phone at any roster
    // size, because /report is not in BottomNav. One free cell is too narrow to
    // read at 73px, and zero would open a whole seventh row for one link.
    it('leaves the footer as the fallback when the last row is full', () => {
      expect(trailing >= 2 || trailing === 0 || trailing === 1).toBe(true)
      // The two states are mutually exclusive and one is always present.
      renderWithUser()
      const inGrid = screen.queryByTestId('cbat-grid-report')
      const footer = screen.getByTestId('cbat-footer-report')
      expect(Boolean(inGrid)).toBe(trailing >= 2)
      expect(footer.className.includes('hidden sm:block')).toBe(trailing >= 2)
    })
  })
})

describe('CBAT short tile titles', () => {
  beforeEach(() => mockUseAuth.mockReset())

  it('names only games that exist, and only where the short form is shorter', () => {
    for (const [key, short] of Object.entries(CBAT_SHORT_TITLES)) {
      const game = CBAT_GAMES.find(g => g.key === key)
      expect(game, `${key} is not a game`).toBeDefined()
      expect(short.length, `${key} short title is no shorter`).toBeLessThan(game.title.length)
    }
  })

  // A short title identical to the full one would render two nodes with the
  // same text and quietly break every getByText(title) on this page.
  it('never duplicates a title it does not actually shorten', () => {
    for (const game of CBAT_GAMES) {
      if (shortTitle(game)) expect(shortTitle(game)).not.toBe(game.title)
    }
    expect(shortTitle({ key: 'target' })).toBeUndefined()
  })

  // A shortened game renders both labels: the code on the phone tile, the real
  // name on the desktop card, which has the room for it.
  it('renders both labels for a shortened game and one node for the rest', () => {
    renderWithUser()
    expect(screen.getByText('CUT').className).toContain('sm:hidden')
    expect(screen.getByText('Cognitive Updating Test').className).toContain('hidden sm:inline')
    // Target needs no shortening, so its title is a single node — this would
    // throw "found multiple elements" if it were rendered as a pair.
    expect(screen.getByText('Target').tagName).toBe('P')
  })

  it('formats the compact estimate as a bare number of minutes', () => {
    expect(formatEstTimeCompact({ estMinutes: 2 })).toBe('2m')
    expect(formatEstTimeCompact({ estMinutes: 1.5 })).toBe('1.5m')
    expect(formatEstTimeCompact({ estMinutes: [1, 2] })).toBe('1\u20132m')
    expect(formatEstTimeCompact({ estMinutes: [2, 2] })).toBe('2m')
    expect(formatEstTimeCompact({})).toBeNull()
    expect(formatEstTimeCompact(null)).toBeNull()
  })
})

describe('Cbat page — tile badges', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no longer announces the difficulty modes — they are not news any more', () => {
    // FLAG, CUT, Numerical Operations and SAT all carried a "New Difficulty
    // Modes" badge from when the split shipped. Every one of them has had it for
    // months and half the roster now has a split, so the badge had stopped
    // distinguishing anything and was only crowding the tiles.
    renderWithUser()
    expect(CBAT_GAMES.filter(g => g.badge === 'New Difficulty Modes')).toEqual([])
    expect(screen.queryByText('New Difficulty Modes')).toBeNull()
  })

  it('points at SAT, whose difficulty was rebuilt around the real test', () => {
    // SAT now feeds the picture one fact at a time instead of all at once. A
    // returning player would otherwise find a game that scores nothing like the
    // one they left and have no way to know why, so the tile says so. Drop this
    // once it has been true long enough to stop being news.
    renderWithUser()
    expect(CBAT_GAMES.filter(g => g.badge).map(g => g.key)).toEqual(['sat'])
    expect(screen.getByText('Realistic Difficulty Update')).toBeTruthy()
  })

  it('no longer flags any game as new — the badge is gone entirely', () => {
    // The roster is complete, so "New Game" had stopped meaning "look here"
    // and was just decorating a third of the grid. The mechanism went with it:
    // no game carries `isNew` and the hub renders no such badge.
    renderWithUser()
    expect(CBAT_GAMES.filter(g => g.isNew)).toEqual([])
    expect(screen.queryByText('New Game')).toBeNull()
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

// The admin-only switch docked to the Recent Scores card. It asks the API for the
// board a player would get (?adminView=0) rather than hiding emails client-side,
// so the assertions here are about the request, not the rendered names.
describe('Cbat page — admin view toggle', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    mockNavigate.mockReset()
    localStorage.clear()
  })

  function renderFor(user) {
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: 'success', data: { recent: [] } }),
    })
    mockUseAuth.mockReturnValue({ user, API: '', apiFetch })
    render(<Cbat />)
    return apiFetch
  }

  const toggle = () => screen.queryByRole('switch', { name: 'Admin view' })

  it('is not rendered for a regular user', () => {
    renderFor({ _id: '1' })
    expect(toggle()).toBeNull()
  })

  it('starts in admin view for an admin who has never touched it', () => {
    const apiFetch = renderFor({ _id: '1', isAdmin: true })
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(toggle()).toHaveTextContent('Admin view')
    // No opt-out param: the admin view is what the server gives an admin anyway.
    expect(apiFetch).toHaveBeenCalledWith('/api/games/cbat/recent?limit=25')
  })

  it('switching to agent view refetches recent scores as a player would see them', () => {
    const apiFetch = renderFor({ _id: '1', isAdmin: true })
    fireEvent.click(toggle())

    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(toggle()).toHaveTextContent('Agent view')
    expect(apiFetch).toHaveBeenLastCalledWith('/api/games/cbat/recent?limit=25&adminView=0')
  })

  it('remembers the choice across visits', () => {
    renderFor({ _id: '1', isAdmin: true })
    fireEvent.click(toggle())
    cleanup()

    const apiFetch = renderFor({ _id: '1', isAdmin: true })
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(apiFetch).toHaveBeenCalledWith('/api/games/cbat/recent?limit=25&adminView=0')
  })
})

// The hub is the one page in the app that is meant to end exactly at the fold:
// 22 tiles tuned to a phone screen, with the report link pinned to the bottom
// edge by mt-auto. That only works while its own height deduction matches what
// the shell takes off the viewport. Deduct too little and the page is a handful
// of pixels taller than the box it sits in, so it scrolls with nothing below the
// fold to scroll to — which is exactly what the Android app showed when the
// status-bar inset was left out of the sum.
describe('CBAT hub — fitting the viewport', () => {
  it('deducts both safe-area insets as well as the chrome', () => {
    renderWithUser()
    const page = document.querySelector('.cbat-page')
    expect(page).toBeTruthy()

    // `.app-shell-body` pads down by 3.5rem + the top inset, `.app-shell-main`
    // up by 5rem + the bottom inset. The top one is 0 on desktop and 24-48px in
    // the Android app (index.html sets viewport-fit=cover), so leaving it out
    // only breaks on the phone.
    expect(page.className).toContain('env(safe-area-inset-top)')
    expect(page.className).toContain('env(safe-area-inset-bottom)')
  })

  it('pays the tightened padding at phone width and the full py-6 above it', () => {
    renderWithUser()
    const page = document.querySelector('.cbat-page')
    // Phone: 3.5 topbar + 0.75 + 0.75 (usePhoneTight halves .app-shell-content's
    // py-6 below 40rem) + 5 BottomNav.
    expect(page.className).toContain('min-h-[calc(100dvh-10rem-')
    // sm and up: the full 1.5rem top and bottom is paid again. The 5rem stays —
    // .app-shell-main sets it unlayered in main.css, so main's own md:pb-6 never
    // wins and the BottomNav's reservation is held at desktop width too.
    expect(page.className).toContain('sm:min-h-[calc(100dvh-11.5rem-')
  })

  it('adds body.phone-tight so the deduction it assumes is real', () => {
    renderWithUser()
    // The 10rem above is only correct while usePhoneTight is mounted; without
    // the class the shell still pays py-6 and the page overflows by 24px.
    expect(document.body.classList.contains('phone-tight')).toBe(true)
  })
})
