import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { StrictMode } from 'react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    apiFetch: (...args) => fetch(...args),
    refreshUser: vi.fn(),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({ pending: null, clear: vi.fn() }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: [],
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20
const TOTAL     = 45          // three pages: 20, 20, 5

function makeUser(n) {
  return {
    _id: `user${n}`,
    agentNumber: String(n).padStart(3, '0'),
    email: `user${n}@test.com`,
    isAdmin: false,
    isBanned: false,
    isTester: false,
    subscriptionTier: 'free',
    difficultySetting: 'easy',
    totalAirstars: 0,
    loginStreak: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    gameUnlocks: {},
    tutorials: {},
    statsLoaded: false,
    lastTestGameAt: null,
  }
}

// The server owns the order and hands back one slice of it; the population here
// is simply numbered so a page's contents are obvious.
const ALL = Array.from({ length: TOTAL }, (_, i) => makeUser(i + 1))

describe('Users upcoming CBAT sort', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resets pagination, preserves date order over admin priority and keeps the sort when searching', async () => {
    const base = setupFetch()
    global.fetch = vi.fn((url, opts) => {
      if (url.includes('/api/admin/users?') && url.includes('sort=upcoming-cbat')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: {
          users: [
            { ...ALL[1], cbatDate: '2099-01-01' },
            { ...ALL[0], isAdmin: true, cbatDate: '2099-02-01' },
          ], total: 2, page: 1, pageCount: 1,
        } }) })
      }
      return base.fetchMock(url, opts)
    })
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Agent 001')
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByText('Agent 021')
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'upcoming-cbat' } })
    await screen.findByText('CBAT: 1 Jan 2099')
    expect(screen.getAllByRole('button', { name: /^Expand Agent/ }).map(el => el.getAttribute('aria-label')))
      .toEqual(['Expand Agent 002', 'Expand Agent 001'])
    const sortedRequest = fetch.mock.calls.find(([url]) => url.includes('sort=upcoming-cbat'))[0]
    expect(new URL(sortedRequest, 'http://x').searchParams.get('page')).toBe('1')
    fireEvent.change(screen.getByPlaceholderText(/Search by email/), { target: { value: 'user42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Agent 042')
    expect(fetch.mock.calls.some(([url]) => url.includes('/users/search?q=user42&sort=upcoming-cbat'))).toBe(true)
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'default' } })
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('/users/search?q=user42&sort=default'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await screen.findByText('Agent 001')
  })
})

function setupFetch(population = ALL) {
  const listCalls = []
  const total = population.length

  const fetchMock = vi.fn().mockImplementation((url, opts = {}) => {
    // Writes (ban, make-admin, award…) share the /users prefix; only reads are
    // list requests, and only those are recorded.
    if ((opts.method ?? 'GET').toUpperCase() !== 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
    }
    if (url.includes('/api/admin/users/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { stats: {} } }) })
    }
    if (url.includes('/api/admin/users/search')) {
      return Promise.resolve({ ok: true, json: async () => ({
        status: 'success', data: { users: [{ ...ALL[41], statsLoaded: true, profileStats: {}, emailsSent: 0 }] },
      }) })
    }
    if (url.includes('/api/admin/users')) {
      listCalls.push(url)
      const params = new URL(url, 'http://x').searchParams
      const limit  = parseInt(params.get('limit'), 10) || PAGE_SIZE
      const page   = parseInt(params.get('page'), 10) || 1
      const users  = population.slice((page - 1) * limit, page * limit)
      return Promise.resolve({ ok: true, json: async () => ({
        status: 'success',
        data: { users, latestClients: {}, total, page, limit, pageCount: Math.ceil(total / limit) },
      }) })
    }
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({
        status: 'success',
        data: {
          users:  { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, combinedStreaks: 0, emailsSent: 0, emailsFailed: 0 },
          games:  { boo: {}, wta: {}, flashcard: {}, aptitudeSync: {} },
          briefs: {},
          tutorials: {},
          server: {},
        },
      }) })
    }
    if (url.includes('/api/admin/openrouter/summary')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { main: {}, aptitude: {}, socials: {}, casefiles: {} } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: {} }) })
  })

  return { fetchMock, listCalls }
}

const rowNames = () => screen.getAllByRole('button', { name: /^Expand Agent/ })
  .map(b => b.getAttribute('aria-label').replace('Expand ', ''))

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: pagination', () => {
  let listCalls

  beforeEach(() => {
    const s = setupFetch()
    global.fetch = s.fetchMock
    listCalls = s.listCalls
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function openUsersTab() {
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
  }

  it('asks for one page rather than every account', async () => {
    await openUsersTab()

    expect(listCalls).toHaveLength(1)
    const params = new URL(listCalls[0], 'http://x').searchParams
    expect(params.get('page')).toBe('1')
    expect(params.get('limit')).toBe(String(PAGE_SIZE))
    expect(rowNames()).toHaveLength(PAGE_SIZE)
  })

  it('tells the server whether the tester highlights are on, since they change the order', async () => {
    await openUsersTab()
    expect(new URL(listCalls[0], 'http://x').searchParams.get('testerFx')).toBe('1')
  })

  it('shows where in the population this page sits', async () => {
    await openUsersTab()
    expect(screen.getByText(`Page 1 of 3 (${TOTAL} total)`)).toBeInTheDocument()
  })

  it('turns to the next page and shows its rows', async () => {
    await openUsersTab()
    expect(rowNames()[0]).toBe('Agent 001')

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))

    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    expect(rowNames()[0]).toBe('Agent 021')
    expect(screen.queryByLabelText('Expand Agent 001')).not.toBeInTheDocument()
    expect(new URL(listCalls[1], 'http://x').searchParams.get('page')).toBe('2')
  })

  it('renders the last page short rather than padded', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 3 of 3 (45 total)')).toBeInTheDocument())

    expect(rowNames()).toHaveLength(5)
  })

  it('cannot page off either end', async () => {
    await openUsersTab()
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Prev/ })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 3 of 3 (45 total)')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('goes back to the previous page', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Prev/ }))

    await waitFor(() => expect(screen.getByText('Page 1 of 3 (45 total)')).toBeInTheDocument())
    expect(rowNames()[0]).toBe('Agent 001')
  })

  it('hides the pager while showing search results', async () => {
    await openUsersTab()
    expect(screen.getByRole('button', { name: /Next/ })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search by email or agent number…'), {
      target: { value: 'user42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByText('Agent 042')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of 3/)).not.toBeInTheDocument()
  })

  it('Clear brings the pager back at the first page', async () => {
    await openUsersTab()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Search by email or agent number…'), {
      target: { value: 'user42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('Agent 042')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(screen.getByText('Page 1 of 3 (45 total)')).toBeInTheDocument())
    expect(rowNames()[0]).toBe('Agent 001')
  })

  it('re-reads the page it is on after an action, not the first one', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    // A new page collapses every row, and that runs in an effect — let it land
    // before opening one, or the click is undone a beat later.
    await act(async () => {})

    fireEvent.click(screen.getByLabelText('Expand Agent 021'))
    fireEvent.click(await screen.findByRole('button', { name: 'Make Admin' }))
    fireEvent.change(await screen.findByPlaceholderText(/briefly describe why/i), {
      target: { value: 'promoting' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }))

    await waitFor(() => expect(listCalls).toHaveLength(3))
    expect(new URL(listCalls[2], 'http://x').searchParams.get('page')).toBe('2')
  })
})

// StrictMode is how the app actually runs (src/main.jsx), and it invokes every
// effect twice on mount — which is exactly what caught the scroll out.
describe('Admin — Users tab: where a page turn leaves you', () => {
  let listCalls
  let scrollIntoView

  beforeEach(() => {
    const s = setupFetch()
    global.fetch = s.fetchMock
    listCalls = s.listCalls
    // src/test/setup.js already stubs this on HTMLElement.prototype, which is
    // the one an element actually resolves — spying anywhere else is shadowed.
    scrollIntoView = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('leaves the scroll position alone when the tab is opened', async () => {
    render(<Admin />, { wrapper: StrictMode })
    fireEvent.click(screen.getByText('Users'))

    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
    await act(async () => {})

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('goes to the top of the list when a page is turned', async () => {
    render(<Admin />, { wrapper: StrictMode })
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    await act(async () => {})

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.calls[0][0]).toEqual({ block: 'start' })
  })

  it('does not scroll when an action re-reads the page in place', async () => {
    render(<Admin />, { wrapper: StrictMode })
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
    await act(async () => {})

    fireEvent.click(screen.getByLabelText('Expand Agent 001'))
    fireEvent.click(await screen.findByRole('button', { name: 'Make Admin' }))
    fireEvent.change(await screen.findByPlaceholderText(/briefly describe why/i), {
      target: { value: 'promoting' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }))

    await waitFor(() => expect(listCalls.length).toBeGreaterThan(1))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

// The skeleton is not a first-load nicety: it stands in for whatever set of rows
// is on its way, and at exactly the height those rows will take.
describe('Admin — Users tab: the skeleton on every page', () => {
  let releaseList
  let holding

  // A gate that can be closed for the *second* list request, so the skeleton
  // that covers a page turn can be read before the rows land.
  function gatedFetch() {
    const base = setupFetch()
    let calls = 0
    return {
      ...base,
      fetchMock: vi.fn().mockImplementation((url, opts = {}) => {
        const isList = (opts.method ?? 'GET').toUpperCase() === 'GET'
          && url.includes('/api/admin/users')
          && !url.includes('/stats') && !url.includes('/search')
        if (isList) {
          calls += 1
          if (calls === 2 && holding) {
            return new Promise(resolve => {
              releaseList = () => resolve(base.fetchMock(url, opts))
            })
          }
        }
        return base.fetchMock(url, opts)
      }),
    }
  }

  beforeEach(() => { holding = true })
  afterEach(() => { vi.restoreAllMocks() })

  const shimmerRows = () => document.querySelectorAll('.skeleton-shimmer').length / 3

  it('stands a skeleton up while a page turn is in flight', async () => {
    global.fetch = gatedFetch().fetchMock

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))

    // The page being left is gone, and a full page of skeleton stands in its place.
    await waitFor(() => expect(shimmerRows()).toBe(PAGE_SIZE))
    expect(screen.queryByText('Agent 001')).not.toBeInTheDocument()

    await act(async () => { releaseList() })

    await waitFor(() => expect(screen.getByText('Agent 021')).toBeInTheDocument())
    expect(shimmerRows()).toBe(0)
  })

  it('sizes the skeleton to the short last page', async () => {
    global.fetch = gatedFetch().fetchMock

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())

    // Page 2 is held; skip it and read the skeleton for the 5-row last page.
    holding = false
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3 (45 total)')).toBeInTheDocument())
    await act(async () => {})

    holding = true
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(shimmerRows()).toBe(5))
  })

  it('keeps the rows in place when an action re-reads the same page', async () => {
    // The one load that does not blank the list: these are the same rows, and
    // the one just acted on should stay under the eye that acted on it. The
    // re-read is held open so the list can be read mid-flight rather than after.
    global.fetch = gatedFetch().fetchMock

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Expand Agent 001'))
    fireEvent.click(await screen.findByRole('button', { name: 'Make Admin' }))
    fireEvent.change(await screen.findByPlaceholderText(/briefly describe why/i), {
      target: { value: 'promoting' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }))

    // The re-read is now in flight and the rows have not gone anywhere. The
    // list-level skeleton announces itself, so its absence is the assertion —
    // the row's own stats cells shimmer here and are not what is being checked.
    await waitFor(() => expect(screen.getByText('Action completed')).toBeInTheDocument())
    expect(screen.queryByRole('status', { name: '' })).toBeNull()
    expect(screen.queryByText('Loading users…')).not.toBeInTheDocument()
    // The row acted on is the expanded one, so it answers to Collapse.
    expect(screen.getAllByRole('button', { name: /^(Expand|Collapse) Agent/ })).toHaveLength(PAGE_SIZE)
    expect(screen.getByText('Agent 001')).toBeInTheDocument()

    await act(async () => { releaseList() })
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
  })
})

// Rows must not differ in height because one of them happens to have something
// to say. jsdom does no layout, so this is asserted structurally: one height
// class, on every collapsed card and on every skeleton standing in for one.
describe('Admin — Users tab: one row height', () => {
  const ROW_H = 'h-[76px]'

  afterEach(() => { vi.restoreAllMocks() })

  it('gives every collapsed row the same height, verdict line or not', async () => {
    // Agent 001 reports a build; the rest have never reported one, which used to
    // mean no version verdict and a shorter card.
    const withBuild = {
      ...ALL[0],
      lastClients: { web: { version: '1.2.35', build: 'abc1234', buildNumber: null, lastSeenAt: new Date().toISOString() } },
    }
    const base = setupFetch()
    global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      if ((opts.method ?? 'GET').toUpperCase() === 'GET' && url.includes('/api/admin/users')
        && !url.includes('/stats') && !url.includes('/search')) {
        const users = [withBuild, ...ALL.slice(1, 20)]
        return Promise.resolve({ ok: true, json: async () => ({
          status: 'success',
          data: { users, latestClients: {}, total: TOTAL, page: 1, limit: PAGE_SIZE, pageCount: 3 },
        }) })
      }
      return base.fetchMock(url, opts)
    })

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())

    const cards = [...document.querySelectorAll('.rounded-2xl.overflow-hidden')]
    expect(cards).toHaveLength(PAGE_SIZE)
    cards.forEach(card => expect(card.className).toContain(ROW_H))
  })

  it('gives the skeleton the same height as the rows it stands in for', async () => {
    const s = setupFetch()
    let release
    global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      if ((opts.method ?? 'GET').toUpperCase() === 'GET' && url.includes('/api/admin/users')
        && !url.includes('/stats') && !url.includes('/search')) {
        return new Promise(resolve => { release = () => resolve(s.fetchMock(url, opts)) })
      }
      return s.fetchMock(url, opts)
    })

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))

    await waitFor(() => expect(document.querySelectorAll('.skeleton-shimmer').length).toBe(PAGE_SIZE * 3))
    document.querySelectorAll('.skeleton-shimmer').forEach(bar => {
      expect(bar.parentElement.className).toContain(ROW_H)
    })

    await act(async () => { release() })
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
  })

  it('lets an expanded row grow past that height', async () => {
    global.fetch = setupFetch().fetchMock

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Expand Agent 001'))
    await waitFor(() => expect(screen.getByText('Joined')).toBeInTheDocument())

    const expandedCard = screen.getByText('Joined').closest('.rounded-2xl.overflow-hidden')
    expect(expandedCard.className).not.toContain(ROW_H)
  })
})

// The numbered pager: every page of a short list, and a window with gaps on a
// long one, so an admin can land in the middle or at the end in one click.
describe('Admin — Users tab: page numbers', () => {
  let listCalls
  afterEach(() => { vi.restoreAllMocks() })

  const pageButtons = () => screen.getAllByRole('button', { name: /^Page \d+$/ })
    .map(b => b.textContent)

  it('lists every page of a short list and marks the current one', async () => {
    const s = setupFetch()
    global.fetch = s.fetchMock
    listCalls = s.listCalls
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Agent 001')

    expect(pageButtons()).toEqual(['1', '2', '3'])
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Page 3' })).not.toHaveAttribute('aria-current')
  })

  it('jumps straight to a page by its number', async () => {
    const s = setupFetch()
    global.fetch = s.fetchMock
    listCalls = s.listCalls
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Agent 001')

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))

    await screen.findByText('Page 3 of 3 (45 total)')
    expect(rowNames()[0]).toBe('Agent 041')
    expect(new URL(listCalls[1], 'http://x').searchParams.get('page')).toBe('3')
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page')
  })

  it('windows a long list around the current page with the ends always reachable', async () => {
    // 400 accounts, 20 pages — the population the real list is at.
    const big = Array.from({ length: 400 }, (_, i) => makeUser(i + 1))
    const s = setupFetch(big)
    global.fetch = s.fetchMock
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Agent 001')

    expect(pageButtons()).toEqual(['1', '2', '3', '4', '20'])

    fireEvent.click(screen.getByRole('button', { name: 'Page 20' }))
    await screen.findByText('Page 20 of 20 (400 total)')
    expect(rowNames()[0]).toBe('Agent 381')
    expect(pageButtons()).toEqual(['1', '17', '18', '19', '20'])

    // Into the middle: the window recentres and both ends stay one click away.
    for (let n = 17; n >= 10; n--) {
      fireEvent.click(screen.getByRole('button', { name: `Page ${n}` }))
      await screen.findByText(`Page ${n} of 20 (400 total)`)
    }
    expect(pageButtons()).toEqual(['1', '9', '10', '11', '20'])
    expect(rowNames()[0]).toBe('Agent 181')
  })

  it('is hidden with the rest of the pager while searching', async () => {
    global.fetch = setupFetch().fetchMock
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Agent 001')

    fireEvent.change(screen.getByPlaceholderText('Search by email or agent number…'), { target: { value: 'user42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Agent 042')

    expect(screen.queryByRole('button', { name: /^Page \d+$/ })).not.toBeInTheDocument()
  })
})
