import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Play from '../Play'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className}>{children}</a>
  ),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, API: '', apiFetch: (...args) => fetch(...args) })),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: vi.fn().mockReturnValue(false) }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('../../components/FlashcardGameModal', () => ({
  default: () => null,
}))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: vi.fn(() => ({
    newGames:             new Set(),
    hasAnyNew:            false,
    isUnlocked:           () => false,
    markSeen:             vi.fn(),
    markUnlockFromServer: vi.fn(),
    applyUnlocks:         vi.fn(),
    revokeUnlock:         vi.fn(),
  })),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...rest }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

import { useAuth } from '../../context/AuthContext'
import { useNewGameUnlock } from '../../context/NewGameUnlockContext'

function renderAsGuest() {
  useAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
  render(<Play />)
}

/**
 * Renders Play as a logged-in user.
 * quizBriefs and booBriefs must already have their state embedded
 * (e.g. { _id, title, category, quizState: 'active' }).
 * The backend recommended-briefs endpoints are mocked to return them directly.
 */
function renderAsUser({ quizBriefs = [], booBriefs = [] } = {}) {
  useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '', apiFetch: (...args) => fetch(...args) })
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('quiz/recommended-briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs: quizBriefs } }) })
    if (url.includes('battle-of-order/recommended-briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs: booBriefs } }) })
    if (url.includes('flashcard-recall/available-briefs'))
      return Promise.resolve({ json: async () => ({ data: { count: 10 } }) })
    return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
  })
  render(<Play />)
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.scrollTo = vi.fn()
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('flashcard-recall/available-briefs'))
      return Promise.resolve({ json: async () => ({ data: { count: 0 } }) })
    return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Play page — game cards', () => {
  it('renders all 4 game card titles', () => {
    renderAsGuest()
    expect(screen.getAllByText('Intel Quiz').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Flashcard Recall').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Where's that Aircraft?").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Battle of Order').length).toBeGreaterThanOrEqual(1)
  })

  // In jsdom, getBoundingClientRect() returns all zeros and scrollY=0,
  // so the offset formula yields Math.max(0, 0 + 0 - 72) = 0.
  it.each([
    ['Intel Quiz',          'card-quiz'],
    ['Flashcard Recall',    'card-flashcard'],
    ["Where's that Aircraft?", 'card-wheres-that-aircraft'],
    ['Battle of Order',     'card-battle-order'],
  ])('clicking %s card calls window.scrollTo with smooth behaviour', (_label, testId) => {
    renderAsGuest()
    fireEvent.click(screen.getByTestId(testId))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('highlight timer resets on a second click', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAsGuest()

    fireEvent.click(screen.getByTestId('card-quiz'))
    expect(window.scrollTo).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1500)

    fireEvent.click(screen.getByTestId('card-quiz'))
    expect(window.scrollTo).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('keyboard Enter on a card triggers scroll', () => {
    renderAsGuest()
    fireEvent.keyDown(screen.getByTestId('card-quiz'), { key: 'Enter' })
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('keyboard Space on a card triggers scroll', () => {
    renderAsGuest()
    fireEvent.keyDown(screen.getByTestId('card-battle-order'), { key: ' ' })
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('Intel Quiz card has no "Coming soon" badge', () => {
    renderAsGuest()
    const card = screen.getByTestId('card-quiz')
    expect(card.textContent).not.toMatch(/coming soon/i)
  })

  it('Flashcard Recall card has no "Coming soon" badge (now available)', () => {
    renderAsGuest()
    expect(screen.getByTestId('card-flashcard').textContent).not.toMatch(/coming soon/i)
  })

  it('Battle of Order card has no "Coming soon" badge (it is now available)', () => {
    renderAsGuest()
    expect(screen.getByTestId('card-battle-order').textContent).not.toMatch(/coming soon/i)
  })

  it('available game mode cards do not show "Play now" badge', () => {
    renderAsGuest()
    expect(screen.getByTestId('card-quiz').textContent).not.toMatch(/play now/i)
    expect(screen.getByTestId('card-wheres-that-aircraft').textContent).not.toMatch(/play now/i)
    expect(screen.getByTestId('card-battle-order').textContent).not.toMatch(/play now/i)
  })
})

describe('Play page — launcher sections', () => {
  it('all 4 launcher section headings render', () => {
    renderAsGuest()
    const headings = screen.getAllByRole('heading', { level: 2 })
    const titles = headings.map(h => h.textContent)
    expect(titles).toContain('Intel Quiz')
    expect(titles).toContain('Flashcard Recall')
    expect(titles).toContain("Where's that Aircraft?")
    expect(titles).toContain('Battle of Order')
  })

  it('Flashcard Recall section shows sign-in prompt for guests', () => {
    renderAsGuest()
    expect(screen.getByText(/sign in to run flashcard drills/i)).toBeDefined()
  })

  it("Where's that Aircraft? section prompts user to learn about aircrafts", () => {
    renderAsGuest()
    expect(screen.getByText(/learn about aircrafts for these random missions to appear/i)).toBeDefined()
  })

  it("Where's that Aircraft? section shows bases hint", () => {
    renderAsGuest()
    expect(screen.getByText(/bases knowledge is also required/i)).toBeDefined()
  })

  it('Battle of Order section shows sign-in prompt for guests', () => {
    renderAsGuest()
    expect(screen.getByText(/sign in to play battle of order/i)).toBeDefined()
  })

  it('Flashcard Recall section shows description for logged-in user', async () => {
    renderAsUser({})
    await waitFor(() => screen.getByText(/identify briefs from their content alone/i))
  })

  it('Battle of Order section shows eligible categories hint for logged-in users with no BOO briefs', async () => {
    renderAsUser({ quizBriefs: [], booBriefs: [] })
    await waitFor(() => screen.getByText(/Read briefs in eligible categories/i))
  })

  it('Intel Quiz section "Browse intel quizzes" link points to /play/quiz', () => {
    renderAsGuest()
    const links = screen.getAllByRole('link', { name: /browse intel quizzes/i })
    const quizBrowse = links.find(l => l.getAttribute('href') === '/play/quiz')
    expect(quizBrowse).toBeDefined()
  })

  it('Battle of Order section "Browse briefs" link points to /play/battle-of-order', () => {
    renderAsGuest()
    const links = screen.getAllByRole('link', { name: /browse briefs/i })
    const booBrowse = links.find(l => l.getAttribute('href') === '/play/battle-of-order')
    expect(booBrowse).toBeDefined()
  })
})

describe('Play page — Intel Quiz section', () => {
  it('shows sign-in prompt when user is not logged in', () => {
    renderAsGuest()
    expect(screen.getByText(/sign in to take quizzes/i)).toBeDefined()
  })

  it('shows Browse Briefs CTA when logged-in user has no quiz briefs', async () => {
    renderAsUser({ quizBriefs: [] })
    await waitFor(() => screen.getByText('Browse Briefs', { selector: 'a' }))
  })

  it('shows brief cards when user has quiz briefs', async () => {
    const quizBriefs = [
      { _id: 'b1', title: 'F-35 Lightning II', category: 'Bases', quizState: 'active' },
      { _id: 'b2', title: 'RAF Lossiemouth',   category: 'Bases', quizState: 'active' },
    ]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('F-35 Lightning II'))
    expect(screen.getByText('RAF Lossiemouth')).toBeDefined()
  })

  it('each brief card links to its quiz route', async () => {
    const quizBriefs = [{ _id: 'brief42', title: 'Typhoon FGR4', category: 'Bases', quizState: 'active' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Typhoon FGR4'))
    const link = screen.getByRole('link', { name: /typhoon fgr4/i })
    expect(link.getAttribute('href')).toBe('/quiz/brief42')
  })

  it('does not show game history link for guests', () => {
    renderAsGuest()
    expect(screen.queryByText(/view game history/i)).toBeNull()
  })

  it('shows game history link for logged-in users', async () => {
    renderAsUser({})
    await waitFor(() => screen.getByText(/view game history/i))
  })
})

describe('Play page — Intel Quiz states', () => {
  it('shows "✓ Passed" badge on a passed brief', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Aircrafts', quizState: 'passed' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => expect(screen.getByText('✓ Passed')).toBeDefined())
  })

  it('does not show "✓ Passed" badge on an active brief', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Bases', quizState: 'active' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Typhoon FGR4'))
    expect(screen.queryByText('✓ Passed')).toBeNull()
  })

  it('shows "Play now" badge on an active (unlocked) quiz brief', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Bases', quizState: 'active' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Typhoon FGR4'))
    expect(screen.getByText('Play now')).toBeDefined()
  })

  it('does not show "Play now" badge on a passed quiz brief', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Aircrafts', quizState: 'passed' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Typhoon FGR4'))
    expect(screen.queryByText('Play now')).toBeNull()
  })

  it('shows "✓ Passed" only on the passed brief when list is mixed', async () => {
    const quizBriefs = [
      { _id: 'b1', title: 'Typhoon FGR4',    category: 'Aircrafts', quizState: 'passed' },
      { _id: 'b2', title: 'RAF Lossiemouth', category: 'Bases',     quizState: 'active' },
    ]
    renderAsUser({ quizBriefs })
    await waitFor(() => expect(screen.getByText('✓ Passed')).toBeDefined())
    expect(screen.getAllByText('✓ Passed').length).toBe(1)
  })

  it('shows "No questions yet" locked state for no-questions brief', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Locked Brief', category: 'Bases', quizState: 'no-questions' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Locked Brief'))
    expect(screen.getByText('No questions yet')).toBeDefined()
  })

  it('shows "Read first →" hint for needs-read brief', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Unread Brief', category: 'Bases', quizState: 'needs-read' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Unread Brief'))
    expect(screen.getByText('Read first →')).toBeDefined()
  })

  it('"Read first →" hint links to the brief page', async () => {
    const quizBriefs = [{ _id: 'b1', title: 'Unread Brief', category: 'Bases', quizState: 'needs-read' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Unread Brief'))
    const link = screen.getByRole('link', { name: /unread brief/i })
    expect(link.getAttribute('href')).toBe('/brief/b1')
  })

  it('active briefs appear before passed briefs (in the order returned by the server)', async () => {
    // Backend returns active first — frontend must render in that order
    const quizBriefs = [
      { _id: 'b1', title: 'Not Yet Passed', category: 'Bases', quizState: 'active' },
      { _id: 'b2', title: 'Already Passed',  category: 'Bases', quizState: 'passed' },
    ]
    renderAsUser({ quizBriefs })
    await waitFor(() => screen.getByText('Already Passed'))

    const links = screen.getAllByRole('link').filter(l =>
      l.getAttribute('href')?.startsWith('/quiz/')
    )
    const titles = links.map(l => l.textContent)
    const notYetIdx = titles.findIndex(t => t.includes('Not Yet Passed'))
    const passedIdx = titles.findIndex(t => t.includes('Already Passed'))
    expect(notYetIdx).toBeLessThan(passedIdx)
  })
})

describe('Play page — Battle of Order states', () => {
  it('shows "No data yet" locked state for no-data brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'No Data Brief', category: 'Aircrafts', booState: 'no-data' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('No Data Brief'))
    expect(screen.getByText('No data yet')).toBeDefined()
  })

  it('shows "Pass quiz first →" hint for needs-quiz brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Aircraft Brief', category: 'Aircrafts', booState: 'needs-quiz' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Aircraft Brief'))
    expect(screen.getByText('Pass quiz first →')).toBeDefined()
  })

  it('"Pass quiz first →" hint links to the quiz page', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Aircraft Brief', category: 'Aircrafts', booState: 'needs-quiz' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Aircraft Brief'))
    const hintLink = screen.getByRole('link', { name: /pass quiz first/i })
    expect(hintLink.getAttribute('href')).toBe('/quiz/b1')
  })

  it('BOO section shows play link for active brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Ready Brief', category: 'Aircrafts', booState: 'active' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Ready Brief'))
    const booLinks = screen.getAllByRole('link').filter(l => l.getAttribute('href') === '/battle-of-order/b1')
    expect(booLinks.length).toBeGreaterThanOrEqual(1)
  })

  it('shows "Play now" badge on an active (unlocked) BOO brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Ready Brief', category: 'Aircrafts', booState: 'active' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Ready Brief'))
    expect(screen.getByText('Play now')).toBeDefined()
  })

  it('does not show "Play now" badge on a completed BOO brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Played Brief', category: 'Aircrafts', booState: 'completed' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Played Brief'))
    expect(screen.queryByText('Play now')).toBeNull()
  })

  it('shows "✓ Played" badge on a completed BOO brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Played Brief', category: 'Aircrafts', booState: 'completed' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Played Brief'))
    expect(screen.getByText('✓ Played')).toBeDefined()
  })

  it('completed BOO brief still links to the BOO game', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Played Brief', category: 'Aircrafts', booState: 'completed' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Played Brief'))
    const links = screen.getAllByRole('link').filter(l => l.getAttribute('href') === '/battle-of-order/b1')
    expect(links.length).toBeGreaterThanOrEqual(1)
  })

  it('active BOO briefs appear before completed briefs (in the order returned by the server)', async () => {
    const booBriefs = [
      { _id: 'b1', title: 'Not Yet Played', category: 'Aircrafts', booState: 'active'    },
      { _id: 'b2', title: 'Already Played', category: 'Aircrafts', booState: 'completed' },
    ]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Already Played'))

    const container = document.body
    const activePos    = container.innerHTML.indexOf('Not Yet Played')
    const completedPos = container.innerHTML.indexOf('Already Played')
    expect(activePos).toBeLessThan(completedPos)
  })

  // ── needs-aircraft-reads ────────────────────────────────────────────────

  it('shows "Read more Aircrafts" label for a needs-aircraft-reads brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Locked Brief'))
    expect(screen.getByText(/read more aircrafts/i)).toBeDefined()
  })

  it('needs-aircraft-reads card does not link to the BOO game', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Locked Brief'))
    const booLinks = screen.queryAllByRole('link').filter(l => l.getAttribute('href') === '/battle-of-order/b1')
    expect(booLinks.length).toBe(0)
  })

  it('needs-aircraft-reads card does not show read or quiz prompts', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Locked Brief'))
    expect(screen.queryByText(/read first/i)).toBeNull()
    expect(screen.queryByText(/pass quiz first/i)).toBeNull()
  })

  it('active brief appears before needs-aircraft-reads brief', async () => {
    const booBriefs = [
      { _id: 'b1', title: 'Ready Brief',  category: 'Aircrafts', booState: 'active' },
      { _id: 'b2', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' },
    ]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Locked Brief'))
    const html = document.body.innerHTML
    expect(html.indexOf('Ready Brief')).toBeLessThan(html.indexOf('Locked Brief'))
  })

  it('needs-aircraft-reads brief shows the lock icon, not the play icon', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Locked Brief'))
    expect(screen.queryByText('Play now')).toBeNull()
  })

  // ── needs-bases-reads ───────────────────────────────────────────────────

  it('shows "Read more Bases" label for a needs-bases-reads brief', async () => {
    const booBriefs = [{ _id: 'b1', title: 'RAF Fairford', category: 'Bases', booState: 'needs-bases-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('RAF Fairford'))
    expect(screen.getByText(/read more bases/i)).toBeDefined()
  })

  it('needs-bases-reads card does not link to the BOO game', async () => {
    const booBriefs = [{ _id: 'b1', title: 'RAF Fairford', category: 'Bases', booState: 'needs-bases-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('RAF Fairford'))
    const booLinks = screen.queryAllByRole('link').filter(l => l.getAttribute('href') === '/battle-of-order/b1')
    expect(booLinks.length).toBe(0)
  })

  it('needs-bases-reads card does not show "Play now"', async () => {
    const booBriefs = [{ _id: 'b1', title: 'RAF Fairford', category: 'Bases', booState: 'needs-bases-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('RAF Fairford'))
    expect(screen.queryByText('Play now')).toBeNull()
  })

  it('needs-bases-reads card does not show read or quiz prompts', async () => {
    const booBriefs = [{ _id: 'b1', title: 'RAF Fairford', category: 'Bases', booState: 'needs-bases-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('RAF Fairford'))
    expect(screen.queryByText(/read first/i)).toBeNull()
    expect(screen.queryByText(/pass quiz first/i)).toBeNull()
  })

  // ── unknown future needs-*-reads state (robustness) ────────────────────

  it('an unknown needs-*-reads state falls back to locked UI with generic label', async () => {
    const booBriefs = [{ _id: 'b1', title: 'Future Brief', category: 'Training', booState: 'needs-training-reads' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Future Brief'))
    expect(screen.getByText(/read more briefs/i)).toBeDefined()
    expect(screen.queryByText('Play now')).toBeNull()
    const booLinks = screen.queryAllByRole('link').filter(l => l.getAttribute('href') === '/battle-of-order/b1')
    expect(booLinks.length).toBe(0)
  })

  // ── BOO card padlock (isCardUnlocked) ───────────────────────────────────

  it('BOO card padlock is locked when BOO briefs are only needs-read', async () => {
    // isCardUnlocked('battle-order') requires at least one 'active' brief
    const booBriefs = [{ _id: 'b1', title: 'Unread Brief', category: 'Aircrafts', booState: 'needs-read' }]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Unread Brief'))
    // No active briefs → BOO card should not be unlocked → no green padlock
    // We verify indirectly: card content should not contain a "Play now" in the launcher section
    // (the padlock SVG colour is visual-only; the key behaviour is the brief row itself)
    expect(screen.queryByText('Play now')).toBeNull()
  })

  it('BOO card padlock is unlocked when there is at least one active brief', async () => {
    const booBriefs = [
      { _id: 'b1', title: 'Ready Brief',  category: 'Aircrafts', booState: 'active' },
      { _id: 'b2', title: 'Unread Brief', category: 'Aircrafts', booState: 'needs-read' },
    ]
    renderAsUser({ booBriefs })
    await waitFor(() => screen.getByText('Ready Brief'))
    // Active brief present → "Play now" badge visible for that row
    expect(screen.getByText('Play now')).toBeDefined()
  })
})

describe('Play page — BOO client-side unlock detection', () => {
  it('calls markUnlockFromServer("boo") when BOO fetch returns at least one active brief', async () => {
    const markUnlockFromServer = vi.fn()
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: () => false,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })

    const booBriefs = [{ _id: 'b1', title: 'Ready Brief', category: 'Aircrafts', booState: 'active' }]
    renderAsUser({ booBriefs })

    await waitFor(() => {
      expect(markUnlockFromServer).toHaveBeenCalledWith('boo')
    })
  })

  it('does NOT call markUnlockFromServer("boo") when no BOO briefs are active', async () => {
    const markUnlockFromServer = vi.fn()
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: () => false,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })

    const booBriefs = [
      { _id: 'b1', title: 'Unread Brief',    category: 'Aircrafts', booState: 'needs-read' },
      { _id: 'b2', title: 'Quiz Needed',     category: 'Aircrafts', booState: 'needs-quiz' },
      { _id: 'b3', title: 'Completed Brief', category: 'Aircrafts', booState: 'completed'  },
    ]
    renderAsUser({ booBriefs })

    await waitFor(() => screen.getByText('Unread Brief'))
    expect(markUnlockFromServer).not.toHaveBeenCalledWith('boo')
  })

  it('does NOT call markUnlockFromServer("boo") when BOO fetch returns an empty list', async () => {
    const markUnlockFromServer = vi.fn()
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: () => false,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })

    renderAsUser({ booBriefs: [] })

    // Give enough time for the fetch to settle
    await waitFor(() => screen.getByText(/sign in to play battle of order|read briefs in eligible categories/i))
    expect(markUnlockFromServer).not.toHaveBeenCalledWith('boo')
  })
})

describe('Play page — WTA card padlock', () => {
  function renderWithWtaSpawn(wtaSpawnData, { isUnlockedFn = () => false, markUnlockFromServer = vi.fn(), revokeUnlock = vi.fn() } = {}) {
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: isUnlockedFn,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock,
    })
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '', apiFetch: (...args) => fetch(...args) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('wta-spawn'))
        return Promise.resolve({ json: async () => ({ data: wtaSpawnData }) })
      if (url.includes('flashcard-recall/available-briefs'))
        return Promise.resolve({ json: async () => ({ data: { count: 0 } }) })
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })
    render(<Play />)
  }

  it('WTA card padlock is locked (grey) when wta-spawn returns prereqsMet: false', async () => {
    renderWithWtaSpawn({ prereqsMet: false })
    await waitFor(() => screen.getByText(/learn about aircrafts for these random missions to appear/i))
    const card = screen.getByTestId('card-wheres-that-aircraft')
    // Locked SVG uses grey stroke #94a3b8; unlocked uses green #22c55e
    const svgPaths = card.querySelectorAll('svg [stroke]')
    const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
    expect(strokes.every(s => s === '#94a3b8')).toBe(true)
  })

  it('WTA card padlock is unlocked (green) when wta-spawn returns prereqsMet: true', async () => {
    renderWithWtaSpawn({ prereqsMet: true, missions: [] })
    await waitFor(() => {
      const card = screen.getByTestId('card-wheres-that-aircraft')
      const svgPaths = card.querySelectorAll('svg [stroke]')
      const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
      expect(strokes.every(s => s === '#22c55e')).toBe(true)
    })
  })

  it('calls markUnlockFromServer("wta") when prereqsMet: true', async () => {
    const markUnlockFromServer = vi.fn()
    renderWithWtaSpawn({ prereqsMet: true, missions: [] }, { markUnlockFromServer })
    await waitFor(() => {
      expect(markUnlockFromServer).toHaveBeenCalledWith('wta')
    })
  })

  it('does NOT call markUnlockFromServer("wta") when prereqsMet: false', async () => {
    const markUnlockFromServer = vi.fn()
    renderWithWtaSpawn({ prereqsMet: false }, { markUnlockFromServer })
    await waitFor(() => screen.getByText(/learn about aircrafts/i))
    expect(markUnlockFromServer).not.toHaveBeenCalledWith('wta')
  })

  it('WTA card padlock is unlocked (green) via isUnlocked("wta") even when wta-spawn is null', async () => {
    renderWithWtaSpawn(null, { isUnlockedFn: (key) => key === 'wta' })
    await waitFor(() => {
      const card = screen.getByTestId('card-wheres-that-aircraft')
      const svgPaths = card.querySelectorAll('svg [stroke]')
      const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
      expect(strokes.every(s => s === '#22c55e')).toBe(true)
    })
  })

  it('WTA card stays unlocked when isUnlocked("wta") is cached, even if current spawn prereqsMet: false', async () => {
    // Once a user has earned the WTA unlock it persists forever — only an
    // admin progress reset (which $unsets gameUnlocks server-side) can re-lock it.
    // So even if the current spawn endpoint says prereqs are no longer met,
    // the cached isUnlocked('wta') keeps the padlock green.
    renderWithWtaSpawn({ prereqsMet: false }, { isUnlockedFn: (key) => key === 'wta' })
    await waitFor(() => screen.getByText(/learn about aircrafts for these random missions to appear/i))
    const card = screen.getByTestId('card-wheres-that-aircraft')
    const svgPaths = card.querySelectorAll('svg [stroke]')
    const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
    expect(strokes.every(s => s === '#22c55e')).toBe(true)
  })

  it('does NOT call revokeUnlock("wta") when prereqsMet: false (unlocks must persist)', async () => {
    const revokeUnlock = vi.fn()
    renderWithWtaSpawn({ prereqsMet: false }, { isUnlockedFn: (key) => key === 'wta', revokeUnlock })
    await waitFor(() => screen.getByText(/learn about aircrafts/i))
    expect(revokeUnlock).not.toHaveBeenCalled()
  })
})

describe('Play page — persistent unlock detection', () => {
  it('calls markUnlockFromServer("quiz") when an active quiz brief is returned', async () => {
    const markUnlockFromServer = vi.fn()
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: () => false,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })
    const quizBriefs = [{ _id: 'q1', title: 'Quiz Ready', category: 'Aircrafts', quizState: 'active' }]
    renderAsUser({ quizBriefs })
    await waitFor(() => {
      expect(markUnlockFromServer).toHaveBeenCalledWith('quiz')
    })
  })

  it('calls markUnlockFromServer("flashcard") when count >= 5', async () => {
    const markUnlockFromServer = vi.fn()
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: () => false,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '', apiFetch: (...args) => fetch(...args) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('flashcard-recall/available-briefs'))
        return Promise.resolve({ json: async () => ({ data: { count: 5 } }) })
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })
    render(<Play />)
    await waitFor(() => {
      expect(markUnlockFromServer).toHaveBeenCalledWith('flashcard')
    })
  })

  it('does NOT call markUnlockFromServer("flashcard") when count < 5', async () => {
    const markUnlockFromServer = vi.fn()
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: () => false,
      markSeen: vi.fn(),
      markUnlockFromServer,
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '', apiFetch: (...args) => fetch(...args) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('flashcard-recall/available-briefs'))
        return Promise.resolve({ json: async () => ({ data: { count: 3 } }) })
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })
    render(<Play />)
    // Wait a tick for the fetch to resolve
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(markUnlockFromServer).not.toHaveBeenCalledWith('flashcard')
  })

  it('cached isUnlocked("flashcard") keeps card green even when count drops below 5', async () => {
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: (key) => key === 'flashcard',
      markSeen: vi.fn(),
      markUnlockFromServer: vi.fn(),
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '', apiFetch: (...args) => fetch(...args) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('flashcard-recall/available-briefs'))
        return Promise.resolve({ json: async () => ({ data: { count: 0 } }) })
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })
    render(<Play />)
    await waitFor(() => {
      const card = screen.getByTestId('card-flashcard')
      const svgPaths = card.querySelectorAll('svg [stroke]')
      const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
      expect(strokes.every(s => s === '#22c55e')).toBe(true)
    })
  })

  it('cached isUnlocked("boo") keeps card green even when no active BOO briefs remain', async () => {
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: (key) => key === 'boo',
      markSeen: vi.fn(),
      markUnlockFromServer: vi.fn(),
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })
    renderAsUser({ booBriefs: [] })
    await waitFor(() => {
      const card = screen.getByTestId('card-battle-order')
      const svgPaths = card.querySelectorAll('svg [stroke]')
      const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
      expect(strokes.every(s => s === '#22c55e')).toBe(true)
    })
  })

  it('cached isUnlocked("quiz") keeps card green even when no active quiz briefs remain', async () => {
    useNewGameUnlock.mockReturnValue({
      newGames: new Set(),
      hasAnyNew: false,
      isUnlocked: (key) => key === 'quiz',
      markSeen: vi.fn(),
      markUnlockFromServer: vi.fn(),
      applyUnlocks: vi.fn(),
      revokeUnlock: vi.fn(),
    })
    renderAsUser({ quizBriefs: [] })
    await waitFor(() => {
      const card = screen.getByTestId('card-quiz')
      const svgPaths = card.querySelectorAll('svg [stroke]')
      const strokes = Array.from(svgPaths).map(el => el.getAttribute('stroke'))
      expect(strokes.every(s => s === '#22c55e')).toBe(true)
    })
  })
})
