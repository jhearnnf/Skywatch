import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Play from '../Play'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className}>{children}</a>
  ),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, API: '' })),
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...rest }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

import { useAuth } from '../../../context/AuthContext'

function renderAsGuest() {
  useAuth.mockReturnValue({ user: null, API: '' })
  render(<Play />)
}

/**
 * Renders Play as a logged-in user.
 * quizBriefs and booBriefs must already have their state embedded
 * (e.g. { _id, title, category, quizState: 'active' }).
 * The backend recommended-briefs endpoints are mocked to return them directly.
 */
function renderAsUser({ quizBriefs = [], booBriefs = [] } = {}) {
  useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '' })
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('quiz/recommended-briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs: quizBriefs } }) })
    if (url.includes('battle-of-order/recommended-briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs: booBriefs } }) })
    return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
  })
  render(<Play />)
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.scrollTo = vi.fn()
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ data: { briefs: [] } }) })
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
  it('clicking Intel Quiz card calls window.scrollTo with smooth behaviour', () => {
    renderAsGuest()
    fireEvent.click(screen.getByTestId('card-quiz'))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('clicking Flashcard Recall card calls window.scrollTo with smooth behaviour', () => {
    renderAsGuest()
    fireEvent.click(screen.getByTestId('card-flashcard'))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it("clicking Where's that Aircraft? card calls window.scrollTo with smooth behaviour", () => {
    renderAsGuest()
    fireEvent.click(screen.getByTestId('card-whos-that-aircraft'))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('clicking Battle of Order card calls window.scrollTo with smooth behaviour', () => {
    renderAsGuest()
    fireEvent.click(screen.getByTestId('card-battle-order'))
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

  it('unavailable game cards show "Coming soon" badge', () => {
    renderAsGuest()
    expect(screen.getByTestId('card-flashcard').textContent).toMatch(/coming soon/i)
    expect(screen.getByTestId('card-whos-that-aircraft').textContent).toMatch(/coming soon/i)
  })

  it('Battle of Order card has no "Coming soon" badge (it is now available)', () => {
    renderAsGuest()
    expect(screen.getByTestId('card-battle-order').textContent).not.toMatch(/coming soon/i)
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

  it('Flashcard Recall section has a disabled "Start Drill" button', () => {
    renderAsGuest()
    expect(screen.getByRole('button', { name: /start drill/i })).toBeDisabled()
  })

  it("Where's that Aircraft? section has a disabled 'Identify Aircraft' button", () => {
    renderAsGuest()
    const btn = screen.getByText('Identify Aircraft', { selector: 'button' })
    expect(btn).toBeDisabled()
  })

  it('Battle of Order section shows sign-in prompt for guests', () => {
    renderAsGuest()
    expect(screen.getByText(/sign in to play battle of order/i)).toBeDefined()
  })

  it('Flashcard Recall section shows dummy keyword rows', () => {
    renderAsGuest()
    expect(screen.getByText('ISTAR')).toBeDefined()
    expect(screen.getByText('QRA')).toBeDefined()
    expect(screen.getByText('COMAO')).toBeDefined()
  })

  it('Battle of Order section shows eligible categories hint for logged-in users with no BOO briefs', async () => {
    renderAsUser({ quizBriefs: [], booBriefs: [] })
    await waitFor(() => screen.getByText(/Read briefs in eligible categories/i))
  })

  it('Intel Quiz section "Browse briefs" link points to /play/quiz', () => {
    renderAsGuest()
    const links = screen.getAllByRole('link', { name: /browse briefs/i })
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
})
