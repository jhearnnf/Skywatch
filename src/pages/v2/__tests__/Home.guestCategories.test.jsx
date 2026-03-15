import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Home from '../Home'

// ── Hoisted mock fns ────────────────────────────────────────────────────────

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, ...r }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, ...r }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Settings where only News is accessible to guests
const GUEST_SETTINGS = {
  guestCategories:  ['News'],
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts', 'Bases'],
}

// category-counts response: all categories with brief totals
const CATEGORY_COUNTS = {
  News:      3,
  Aircrafts: 5,
  Ranks:     2,
}

function setupGuest() {
  mockUseAuth.mockReturnValue({ user: null, API: '' })
  mockUseSettings.mockReturnValue({ settings: GUEST_SETTINGS })
}

function setupUser(overrides = {}) {
  mockUseAuth.mockReturnValue({
    user: {
      _id: 'u1',
      displayName: 'Agent Test',
      subscriptionTier: 'free',
      cycleAircoins: 0,
      loginStreak: 0,
      ...overrides,
    },
    API: '',
  })
  mockUseSettings.mockReturnValue({ settings: GUEST_SETTINGS })
}

function mockFetch({ counts = CATEGORY_COUNTS, briefs = [] } = {}) {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/category-counts')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { counts } }) })
    }
    if (url.includes('/api/briefs/category-stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { stats: {} } }) })
    }
    if (url.includes('/api/briefs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// Sample latest briefs — one accessible (News), one locked (Aircrafts)
const LATEST_BRIEFS_MIXED = [
  { _id: 'b1', title: 'News Brief One',     category: 'News',      isRead: false, isLocked: false },
  { _id: 'b2', title: 'Aircraft Brief One', category: 'Aircrafts', isRead: false, isLocked: true  },
]

const LATEST_BRIEFS_ALL_UNLOCKED = [
  { _id: 'b3', title: 'News Brief Alpha',  category: 'News', isRead: false, isLocked: false },
  { _id: 'b4', title: 'News Brief Beta',   category: 'News', isRead: true,  isLocked: false },
]

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Home — guest category locking', () => {
  beforeEach(() => {
    mockFetch({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('guest sees brief count for accessible category (News)', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => expect(screen.getByText('3 briefs')).toBeDefined())
  })

  it('guest sees brief count for locked category (Aircrafts)', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => expect(screen.getByText('5 briefs')).toBeDefined())
  })

  it('locked category card is not a link', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => screen.getByText('Aircrafts'))

    // The Aircrafts card should NOT be wrapped in an <a> tag
    const aircraftText = screen.getByText('Aircrafts')
    expect(aircraftText.closest('a')).toBeNull()
  })

  it('accessible category card is a link', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => screen.getByText('News'))

    const newsText = screen.getByText('News')
    const link = newsText.closest('a')
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toContain('/learn/News')
  })

  it('locked category shows lock badge', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => screen.getByText('Aircrafts'))

    // Find the Aircrafts card and verify it contains a lock badge
    // Walk up to the outer card container (motion.div > card div)
    const aircraftText = screen.getByText('Aircrafts')
    const card = aircraftText.closest('div').parentElement
    expect(card.textContent).toContain('🔒')
  })

  it('accessible category does not show lock badge', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => screen.getByText('News'))

    // The News card should not contain a lock icon
    const newsText  = screen.getByText('News')
    const newsCard  = newsText.closest('a')
    expect(newsCard.textContent).not.toContain('🔒')
  })

  it('fetches category-counts without requiring auth', async () => {
    setupGuest()
    render(<Home />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const calls = global.fetch.mock.calls.map(c => c[0])
    const countCall = calls.find(url => url.includes('category-counts'))
    expect(countCall).toBeDefined()
    // No credentials option needed for category-counts
    const countCallArgs = global.fetch.mock.calls.find(c => c[0].includes('category-counts'))
    expect(countCallArgs[1]?.credentials).toBeUndefined()
  })

  it('logged-in user sees counts for all categories too', async () => {
    setupUser()
    render(<Home />)
    await waitFor(() => {
      expect(screen.getByText('3 briefs')).toBeDefined()  // News
      expect(screen.getByText('5 briefs')).toBeDefined()  // Aircrafts
    })
  })

  it('shows 0 briefs gracefully when category-counts returns nothing', async () => {
    setupGuest()
    mockFetch({ counts: {} })
    render(<Home />)
    await waitFor(() => {
      // All categories show 0 briefs — should not crash
      const zeroTexts = screen.getAllByText('0 briefs')
      expect(zeroTexts.length).toBeGreaterThan(0)
    })
  })
})

// ── Latest Briefs strip locking ───────────────────────────────────────────────

describe('Home — Latest Briefs strip locking', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('locked brief in strip is not a link', async () => {
    setupGuest()
    mockFetch({ briefs: LATEST_BRIEFS_MIXED })
    render(<Home />)

    await waitFor(() => screen.getByText('Aircraft Brief One'))

    const title = screen.getByText('Aircraft Brief One')
    expect(title.closest('a')).toBeNull()
  })

  it('accessible brief in strip is a link to /brief/:id', async () => {
    setupGuest()
    mockFetch({ briefs: LATEST_BRIEFS_MIXED })
    render(<Home />)

    await waitFor(() => screen.getByText('News Brief One'))

    const title = screen.getByText('News Brief One')
    const link  = title.closest('a')
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/brief/b1')
  })

  it('locked brief shows 🔒 icon instead of category icon', async () => {
    setupGuest()
    mockFetch({ briefs: LATEST_BRIEFS_MIXED })
    render(<Home />)

    await waitFor(() => screen.getByText('Aircraft Brief One'))

    const title = screen.getByText('Aircraft Brief One')
    const row   = title.closest('div').parentElement
    expect(row.textContent).toContain('🔒')
  })

  it('locked brief shows "Sign in to read" instead of category name', async () => {
    setupGuest()
    mockFetch({ briefs: LATEST_BRIEFS_MIXED })
    render(<Home />)

    await waitFor(() => screen.getByText('Sign in to read'))
    expect(screen.getByText('Sign in to read')).toBeDefined()
  })

  it('accessible brief shows its category name', async () => {
    setupGuest()
    mockFetch({ briefs: LATEST_BRIEFS_MIXED })
    render(<Home />)

    await waitFor(() => screen.getByText('News'))
    // 'News' appears as the category label under the accessible brief title
    expect(screen.getByText('News Brief One')).toBeDefined()
  })

  it('logged-in user sees all briefs as links when none are locked', async () => {
    setupUser()
    mockFetch({ briefs: LATEST_BRIEFS_ALL_UNLOCKED })
    render(<Home />)

    await waitFor(() => screen.getByText('News Brief Alpha'))

    // Both briefs should be links
    const alpha = screen.getByText('News Brief Alpha')
    const beta  = screen.getByText('News Brief Beta')
    expect(alpha.closest('a')).not.toBeNull()
    expect(beta.closest('a')).not.toBeNull()
  })

  it('no lock icons shown in strip when all briefs are accessible', async () => {
    setupUser()
    mockFetch({ briefs: LATEST_BRIEFS_ALL_UNLOCKED })
    render(<Home />)

    await waitFor(() => screen.getByText('News Brief Alpha'))

    // Neither brief row should contain a lock icon
    const alpha = screen.getByText('News Brief Alpha')
    const beta  = screen.getByText('News Brief Beta')
    expect(alpha.closest('a').textContent).not.toContain('🔒')
    expect(beta.closest('a').textContent).not.toContain('🔒')
  })
})

// ── Latest Briefs strip — credentials & per-tier locking ─────────────────────
//
// Root bug: fetch(`/api/briefs?limit=4`) had no `credentials: 'include'`,
// so the JWT cookie was never sent. The backend treated every request as a
// guest, marking non-guest categories as locked even for gold-tier users.

describe('Home — Latest Briefs strip credentials and tier locking', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('sends credentials with the latest-briefs fetch', async () => {
    setupUser({ subscriptionTier: 'gold' })
    mockFetch({})
    render(<Home />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const briefsFetchArgs = global.fetch.mock.calls.find(([url]) =>
      url.includes('/api/briefs') &&
      !url.includes('category-counts') &&
      !url.includes('category-stats')
    )
    expect(briefsFetchArgs).toBeDefined()
    expect(briefsFetchArgs[1]?.credentials).toBe('include')
  })

  it('gold-tier user: all briefs in strip are links (isLocked=false from server)', async () => {
    setupUser({ subscriptionTier: 'gold' })
    // Server returns isLocked:false for gold — simulate that
    const goldBriefs = [
      { _id: 'g1', title: 'Aircraft Intel',  category: 'Aircrafts', isRead: false, isLocked: false },
      { _id: 'g2', title: 'Ranks Overview',  category: 'Ranks',     isRead: false, isLocked: false },
      { _id: 'g3', title: 'News Today',      category: 'News',      isRead: false, isLocked: false },
    ]
    mockFetch({ briefs: goldBriefs })
    render(<Home />)

    await waitFor(() => screen.getByText('Aircraft Intel'))

    ;['Aircraft Intel', 'Ranks Overview', 'News Today'].forEach(title => {
      expect(screen.getByText(title).closest('a')).not.toBeNull()
    })
  })

  it('gold-tier user: no lock icons shown in strip', async () => {
    setupUser({ subscriptionTier: 'gold' })
    const goldBriefs = [
      { _id: 'g1', title: 'Aircraft Intel', category: 'Aircrafts', isRead: false, isLocked: false },
    ]
    mockFetch({ briefs: goldBriefs })
    render(<Home />)

    await waitFor(() => screen.getByText('Aircraft Intel'))
    expect(screen.getByText('Aircraft Intel').closest('a').textContent).not.toContain('🔒')
  })

  it('free-tier user: brief in accessible category is a link', async () => {
    setupUser({ subscriptionTier: 'free' })
    const freeBriefs = [
      { _id: 'f1', title: 'News Brief', category: 'News', isRead: false, isLocked: false },
    ]
    mockFetch({ briefs: freeBriefs })
    render(<Home />)

    await waitFor(() => screen.getByText('News Brief'))
    expect(screen.getByText('News Brief').closest('a')).not.toBeNull()
  })

  it('free-tier user: brief in locked category is a non-clickable div', async () => {
    setupUser({ subscriptionTier: 'free' })
    const freeBriefs = [
      { _id: 'f2', title: 'Aircrafts Brief', category: 'Aircrafts', isRead: false, isLocked: true },
    ]
    mockFetch({ briefs: freeBriefs })
    render(<Home />)

    await waitFor(() => screen.getByText('Aircrafts Brief'))
    expect(screen.getByText('Aircrafts Brief').closest('a')).toBeNull()
  })

  it('guest: brief in guest-accessible category is a link', async () => {
    setupGuest()
    const guestBriefs = [
      { _id: 'gu1', title: 'Guest News', category: 'News', isRead: false, isLocked: false },
    ]
    mockFetch({ briefs: guestBriefs })
    render(<Home />)

    await waitFor(() => screen.getByText('Guest News'))
    expect(screen.getByText('Guest News').closest('a')).not.toBeNull()
  })

  it('guest: brief in locked category is a non-clickable div', async () => {
    setupGuest()
    const guestBriefs = [
      { _id: 'gu2', title: 'Locked Aircraft', category: 'Aircrafts', isRead: false, isLocked: true },
    ]
    mockFetch({ briefs: guestBriefs })
    render(<Home />)

    await waitFor(() => screen.getByText('Locked Aircraft'))
    expect(screen.getByText('Locked Aircraft').closest('a')).toBeNull()
  })

  it('read briefs show green styling when not locked (logged-in user)', async () => {
    setupUser({ subscriptionTier: 'gold' })
    const readBrief = [
      { _id: 'r1', title: 'Read Brief', category: 'News', isRead: true, isLocked: false },
    ]
    mockFetch({ briefs: readBrief })
    render(<Home />)

    await waitFor(() => screen.getByText('Read Brief'))
    const link = screen.getByText('Read Brief').closest('a')
    expect(link).not.toBeNull()
    // Read briefs use emerald styling classes
    expect(link.className).toContain('emerald')
  })
})
