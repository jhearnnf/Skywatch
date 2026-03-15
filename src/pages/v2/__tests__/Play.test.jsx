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

function renderAsUser(briefs = []) {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ data: { briefs } }),
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
    expect(screen.getAllByText('Battle Order').length).toBeGreaterThanOrEqual(1)
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

  it('clicking Battle Order card calls window.scrollTo with smooth behaviour', () => {
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
    expect(screen.getByTestId('card-battle-order').textContent).toMatch(/coming soon/i)
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
    expect(titles).toContain('Battle Order')
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

  it('Battle Order section has a disabled "Order Units" button', () => {
    renderAsGuest()
    expect(screen.getByRole('button', { name: /order units/i })).toBeDisabled()
  })

  it('Flashcard Recall section shows dummy keyword rows', () => {
    renderAsGuest()
    expect(screen.getByText('ISTAR')).toBeDefined()
    expect(screen.getByText('QRA')).toBeDefined()
    expect(screen.getByText('COMAO')).toBeDefined()
  })

  it('Battle Order section shows numbered skeleton rows', () => {
    renderAsGuest()
    const numbered = screen.getAllByText(/^[123]\.$/)
    expect(numbered.length).toBeGreaterThanOrEqual(3)
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
    const briefs = [
      { _id: 'b1', title: 'F-35 Lightning II', category: 'Aircrafts' },
      { _id: 'b2', title: 'RAF Lossiemouth', category: 'Bases' },
    ]
    renderAsUser(briefs)
    await waitFor(() => screen.getByText('F-35 Lightning II'))
    expect(screen.getByText('RAF Lossiemouth')).toBeDefined()
  })

  it('each brief card links to its quiz route', async () => {
    const briefs = [{ _id: 'brief42', title: 'Typhoon FGR4', category: 'Aircrafts' }]
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
  function renderWithPassedIds(briefs, passedIds = []) {
    useAuth.mockReturnValue({ user: { _id: 'u1', subscriptionTier: 'gold' }, API: '' })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('completed-brief-ids')) {
        return Promise.resolve({ json: async () => ({ data: { ids: passedIds } }) })
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
    const briefs = [{ _id: 'b1', title: 'Typhoon FGR4', category: 'Aircrafts' }]
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
