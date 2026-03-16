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

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: null }),
}))

vi.mock('../../../utils/subscription', () => ({
  isCategoryLocked: () => false,
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
 * - All provided briefs are treated as "playable" (have quiz questions) and "read" (fully read).
 * - No quizzes are passed yet.
 * - No BOO categories are available.
 */
function renderAsUser(briefs = []) {
  const briefIds = briefs.map(b => b._id)
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('playable-brief-ids')) {
      return Promise.resolve({ json: async () => ({ data: { ids: briefIds } }) })
    }
    if (url.includes('briefs/completed-brief-ids')) {
      return Promise.resolve({ json: async () => ({ data: { ids: briefIds } }) })
    }
    if (url.includes('quiz/completed-brief-ids')) {
      return Promise.resolve({ json: async () => ({ data: { ids: [] } }) })
    }
    if (url.includes('available-categories')) {
      return Promise.resolve({ json: async () => ({ data: { categories: [] } }) })
    }
    return Promise.resolve({ json: async () => ({ data: { briefs } }) })
  })
  useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '' })
  render(<Play />)
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Component uses window.scrollTo (not scrollIntoView) for scroll-with-offset
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
    expect(screen.getAllByText("Who's that Aircraft?").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Battle of Order').length).toBeGreaterThanOrEqual(1)
  })

  // In jsdom, getBoundingClientRect() returns all zeros and scrollY=0,
  // so the offset formula yields Math.max(0, 0 + 0 - 72) = 0.
  // These tests confirm scrollTo is called with smooth behaviour and a
  // non-negative top value (the 72px TopBar+gap offset clamped by Math.max).
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

  it("clicking Who's that Aircraft? card calls window.scrollTo with smooth behaviour", () => {
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
    // Each section has an h2 — ensure all 4 are present
    const headings = screen.getAllByRole('heading', { level: 2 })
    const titles = headings.map(h => h.textContent)
    expect(titles).toContain('Intel Quiz')
    expect(titles).toContain('Flashcard Recall')
    expect(titles).toContain("Who's that Aircraft?")
    expect(titles).toContain('Battle of Order')
  })

  it('Flashcard Recall section has a disabled "Start Drill" button', () => {
    renderAsGuest()
    expect(screen.getByRole('button', { name: /start drill/i })).toBeDisabled()
  })

  it("Who's that Aircraft? section has a disabled 'Identify Aircraft' button", () => {
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
    renderAsUser([])
    await waitFor(() => screen.getByText(/Read briefs in eligible categories/i))
  })

  it('Intel Quiz section "Browse briefs" link points to /play/quiz', () => {
    renderAsGuest()
    // Find browse links — quiz section is first
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

  it('shows Browse Briefs CTA when logged-in user has no recent briefs', async () => {
    renderAsUser([])
    await waitFor(() => screen.getByText('Browse Briefs', { selector: 'a' }))
  })

  it('shows brief cards when user has recent briefs', async () => {
    // Use non-BOO categories so briefs only appear in quiz section, not BOO section too
    const briefs = [
      { _id: 'b1', title: 'F-35 Lightning II', category: 'Bases' },
      { _id: 'b2', title: 'RAF Lossiemouth', category: 'Bases' },
    ]
    renderAsUser(briefs)
    await waitFor(() => screen.getByText('F-35 Lightning II'))
    expect(screen.getByText('RAF Lossiemouth')).toBeDefined()
  })

  it('each brief card links to its quiz route', async () => {
    // Use non-BOO category so the brief only appears once in quiz section
    const briefs = [{ _id: 'brief42', title: 'Typhoon FGR4', category: 'Bases' }]
    renderAsUser(briefs)
    await waitFor(() => screen.getByText('Typhoon FGR4'))
    const link = screen.getByRole('link', { name: /typhoon fgr4/i })
    expect(link.getAttribute('href')).toBe('/quiz/brief42')
  })

  it('does not show game history link for guests', () => {
    renderAsGuest()
    expect(screen.queryByText(/view game history/i)).toBeNull()
  })

  it('shows game history link for logged-in users', async () => {
    renderAsUser([])
    await waitFor(() => screen.getByText(/view game history/i))
  })
})

describe('Play page — Intel Quiz passed state', () => {
  /**
   * All provided briefs are treated as "playable" and "read".
   * passedIds controls which quiz completions are returned.
   */
  function renderWithPassedIds(briefs, passedIds = []) {
    const briefIds = briefs.map(b => b._id)
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '' })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('playable-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: briefIds } }) })
      }
      if (url.includes('briefs/completed-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: briefIds } }) })
      }
      if (url.includes('quiz/completed-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: passedIds } }) })
      }
      if (url.includes('available-categories')) {
        return Promise.resolve({ json: async () => ({ data: { categories: [] } }) })
      }
      return Promise.resolve({ json: async () => ({ data: { briefs } }) })
    })
    render(<Play />)
  }

  it('shows "✓ Passed" badge on a brief whose quiz has been passed', async () => {
    const briefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Aircrafts' }]
    renderWithPassedIds(briefs, ['b1'])

    await waitFor(() => expect(screen.getByText('✓ Passed')).toBeDefined())
  })

  it('does not show "✓ Passed" badge on a brief whose quiz has not been passed', async () => {
    // Use non-BOO category so brief only appears in quiz section once
    const briefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Bases' }]
    renderWithPassedIds(briefs, [])

    await waitFor(() => screen.getByText('Typhoon FGR4'))
    expect(screen.queryByText('✓ Passed')).toBeNull()
  })

  it('shows "✓ Passed" only on the passed brief when list is mixed', async () => {
    const briefs = [
      { _id: 'b1', title: 'Typhoon FGR4', category: 'Aircrafts' },
      { _id: 'b2', title: 'RAF Lossiemouth', category: 'Bases' },
    ]
    renderWithPassedIds(briefs, ['b1'])

    await waitFor(() => expect(screen.getByText('✓ Passed')).toBeDefined())
    // Only one badge — b2 has not been passed
    expect(screen.getAllByText('✓ Passed').length).toBe(1)
  })
})

describe('Play page — locked and hint states', () => {
  function renderWithFullState({ briefs = [], readIds = [], playableIds = [], passedIds = [], booCategories = [] } = {}) {
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '' })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('playable-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: playableIds } }) })
      }
      if (url.includes('briefs/completed-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: readIds } }) })
      }
      if (url.includes('quiz/completed-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: passedIds } }) })
      }
      if (url.includes('available-categories')) {
        return Promise.resolve({ json: async () => ({ data: { categories: booCategories } }) })
      }
      return Promise.resolve({ json: async () => ({ data: { briefs } }) })
    })
    render(<Play />)
  }

  it('shows "No questions yet" locked state for brief without quiz questions', async () => {
    const briefs = [{ _id: 'b1', title: 'Locked Brief', category: 'Bases' }]
    // b1 is NOT in playableIds → no-questions locked state
    renderWithFullState({ briefs, readIds: ['b1'], playableIds: [], passedIds: [] })

    await waitFor(() => screen.getByText('Locked Brief'))
    expect(screen.getByText('No questions yet')).toBeDefined()
  })

  it('shows "Read first →" hint for brief that has questions but not been fully read', async () => {
    const briefs = [{ _id: 'b1', title: 'Unread Brief', category: 'Bases' }]
    // b1 is playable but NOT in readIds → needs-read hint
    renderWithFullState({ briefs, readIds: [], playableIds: ['b1'], passedIds: [] })

    await waitFor(() => screen.getByText('Unread Brief'))
    expect(screen.getByText('Read first →')).toBeDefined()
  })

  it('"Read first →" hint links to the brief page', async () => {
    const briefs = [{ _id: 'b1', title: 'Unread Brief', category: 'Bases' }]
    renderWithFullState({ briefs, readIds: [], playableIds: ['b1'], passedIds: [] })

    await waitFor(() => screen.getByText('Unread Brief'))
    const link = screen.getByRole('link', { name: /unread brief/i })
    expect(link.getAttribute('href')).toBe('/brief/b1')
  })

  it('shows "No data yet" locked state for BOO brief in category with no data', async () => {
    const briefs = [{ _id: 'b1', title: 'No Data Brief', category: 'Aircrafts' }]
    // Aircrafts is a BOO category but NOT in booCategories → no-data locked state
    renderWithFullState({
      briefs,
      readIds: ['b1'],
      playableIds: ['b1'],
      passedIds: ['b1'],
      booCategories: [], // empty → no BOO data
    })

    await waitFor(() => screen.getAllByText('No Data Brief'))
    // BOO section should show "No data yet"
    expect(screen.getByText('No data yet')).toBeDefined()
  })

  it('shows "Pass quiz first →" hint in BOO section when quiz not yet passed', async () => {
    const briefs = [{ _id: 'b1', title: 'Aircraft Brief', category: 'Aircrafts' }]
    // Category has BOO data but quiz not passed → needs-quiz hint
    renderWithFullState({
      briefs,
      readIds: ['b1'],
      playableIds: ['b1'],
      passedIds: [],
      booCategories: ['Aircrafts'],
    })

    await waitFor(() => screen.getAllByText('Aircraft Brief'))
    expect(screen.getByText('Pass quiz first →')).toBeDefined()
  })

  it('"Pass quiz first →" hint links to the quiz page', async () => {
    const briefs = [{ _id: 'b1', title: 'Aircraft Brief', category: 'Aircrafts' }]
    renderWithFullState({
      briefs,
      readIds: ['b1'],
      playableIds: ['b1'],
      passedIds: [],
      booCategories: ['Aircrafts'],
    })

    await waitFor(() => screen.getAllByText('Aircraft Brief'))
    // The hint link in BOO section points to the quiz
    const hintLink = screen.getByRole('link', { name: /pass quiz first/i })
    expect(hintLink.getAttribute('href')).toBe('/quiz/b1')
  })

  it('BOO section shows play link when quiz is passed and category has data', async () => {
    const briefs = [{ _id: 'b1', title: 'Ready Brief', category: 'Aircrafts' }]
    renderWithFullState({
      briefs,
      readIds: ['b1'],
      playableIds: ['b1'],
      passedIds: ['b1'],
      booCategories: ['Aircrafts'],
    })

    await waitFor(() => screen.getAllByText('Ready Brief'))
    // Should have a link to the BOO game
    const booLinks = screen.getAllByRole('link').filter(l => l.getAttribute('href') === '/battle-of-order/b1')
    expect(booLinks.length).toBeGreaterThanOrEqual(1)
  })

  it('active (not-yet-passed) briefs sort before passed briefs in quiz section', async () => {
    const briefs = [
      { _id: 'b1', title: 'Already Passed', category: 'Bases' },
      { _id: 'b2', title: 'Not Yet Passed', category: 'Bases' },
    ]
    renderWithFullState({
      briefs,
      readIds: ['b1', 'b2'],
      playableIds: ['b1', 'b2'],
      passedIds: ['b1'],
    })

    await waitFor(() => screen.getByText('Already Passed'))
    const links = screen.getAllByRole('link').filter(l =>
      l.getAttribute('href')?.startsWith('/quiz/')
    )
    // Not Yet Passed should come before Already Passed
    const titles = links.map(l => l.textContent)
    const notYetIdx = titles.findIndex(t => t.includes('Not Yet Passed'))
    const passedIdx = titles.findIndex(t => t.includes('Already Passed'))
    expect(notYetIdx).toBeLessThan(passedIdx)
  })

  it('locked briefs sort after active and passed briefs in quiz section', async () => {
    const briefs = [
      { _id: 'b1', title: 'Locked Brief',  category: 'Bases' },
      { _id: 'b2', title: 'Active Brief',  category: 'Bases' },
    ]
    // b1 has no questions (locked), b2 is active
    renderWithFullState({
      briefs,
      readIds: ['b1', 'b2'],
      playableIds: ['b2'],
      passedIds: [],
    })

    await waitFor(() => screen.getByText('Locked Brief'))

    // Active Brief should be in the DOM before Locked Brief
    const container = document.body
    const activePos = container.innerHTML.indexOf('Active Brief')
    const lockedPos = container.innerHTML.indexOf('Locked Brief')
    expect(activePos).toBeLessThan(lockedPos)
  })
})
