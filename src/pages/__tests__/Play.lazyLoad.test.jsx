import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Play from '../Play'

// ── Mocks (mirror Play.test.jsx) ──────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
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

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/FlashcardGameModal',     () => ({ default: () => null }))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: vi.fn(() => ({
    newGames: new Set(),
    hasAnyNew: false,
    isUnlocked: () => false,
    markSeen: vi.fn(),
    markUnlockFromServer: vi.fn(),
    applyUnlocks: vi.fn(),
    revokeUnlock: vi.fn(),
  })),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...rest }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import { useAuth } from '../../context/AuthContext'

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.scrollTo = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────

function getLauncherHeadings() {
  return screen.queryAllByRole('heading', { level: 2 })
}

// A fetch implementation whose promise we control — lets us assert the
// pre-resolution state synchronously (sections hidden) and post-resolution
// state after we manually resolve.
function makeDeferredFetch() {
  const deferred = {}
  deferred.promise = new Promise((resolve) => { deferred.resolve = resolve })
  const fetchImpl = vi.fn().mockImplementation(() =>
    deferred.promise.then(() => ({ json: async () => ({ data: { briefs: [], count: 0 } }) }))
  )
  return { fetchImpl, resolve: deferred.resolve }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Play page — lazy launcher sections', () => {
  it('renders all 4 launcher sections immediately for guests (no fetches)', () => {
    useAuth.mockReturnValue({ user: null, API: '', apiFetch: vi.fn() })
    render(<Play />)
    const titles = getLauncherHeadings().map(h => h.textContent)
    expect(titles).toContain('Intel Recall')
    expect(titles).toContain('Flashcards')
    expect(titles).toContain("Where's that Aircraft?")
    expect(titles).toContain('Battle of Order')
  })

  it('renders all 4 launcher sections with skeleton bodies for logged-in user before fetches resolve', () => {
    const { fetchImpl } = makeDeferredFetch()
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: fetchImpl })
    render(<Play />)
    // Sections always mount so the page is full-height immediately and the
    // launcher refs have real positions for click-to-scroll. The body of each
    // section shows a shimmer skeleton until its fetch resolves.
    expect(getLauncherHeadings().length).toBe(4)
    expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0)
  })

  it('reveals all 4 launcher sections after fetches resolve', async () => {
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...a) => fetch(...a) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('flashcard-recall/available-briefs'))
        return Promise.resolve({ json: async () => ({ data: { count: 0 } }) })
      if (url.includes('wta-spawn'))
        return Promise.resolve({ json: async () => ({ data: { prereqsMet: false } }) })
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })
    render(<Play />)
    await waitFor(() => {
      expect(getLauncherHeadings().length).toBe(4)
    })
  })

  it('each section swaps its skeleton for real content as its own fetch resolves (no global gate)', async () => {
    // Sections all mount immediately with skeleton bodies. As each fetch
    // resolves, that section's skeleton is replaced by real content — there
    // is no global "wait for everything" gate.
    const deferreds = {
      quiz:      newDeferred(),
      boo:       newDeferred(),
      flashcard: newDeferred(),
      wta:       newDeferred(),
    }

    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...a) => fetch(...a) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('quiz/recommended-briefs'))             return deferreds.quiz.promise
      if (url.includes('battle-of-order/recommended-briefs'))  return deferreds.boo.promise
      if (url.includes('flashcard-recall/available-briefs'))   return deferreds.flashcard.promise
      if (url.includes('wta-spawn'))                           return deferreds.wta.promise
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })

    render(<Play />)

    // All 4 launcher sections render synchronously, each with a skeleton body
    expect(getLauncherHeadings().length).toBe(4)
    expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0)

    // Resolving fetches one by one drops skeletons progressively
    deferreds.flashcard.resolve({ json: async () => ({ data: { count: 0 } }) })
    deferreds.quiz.resolve({     json: async () => ({ data: { briefs: [] } }) })
    deferreds.wta.resolve({      json: async () => ({ data: { prereqsMet: false } }) })
    deferreds.boo.resolve({      json: async () => ({ data: { briefs: [] } }) })

    await waitFor(() => {
      expect(document.querySelectorAll('.skeleton-shimmer').length).toBe(0)
    })
    expect(getLauncherHeadings().length).toBe(4)
  })

  it('section still appears when its fetch errors (so user is never left staring at a blank slot)', async () => {
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...a) => fetch(...a) })
    global.fetch = vi.fn().mockImplementation((url) => {
      // Every fetch rejects
      return Promise.reject(new Error('boom'))
    })
    render(<Play />)
    await waitFor(() => {
      expect(getLauncherHeadings().length).toBe(4)
    })
  })

  it('Start Drill button is not visible while flashcard fetch is pending', () => {
    const { fetchImpl } = makeDeferredFetch()
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: fetchImpl })
    render(<Play />)
    // Until the section reveals, the button must not exist — this is the original bug
    expect(screen.queryByTestId('flashcard-launch-btn')).toBeNull()
  })

  it('"View game history" link is hidden until launcher sections are ready (no top-of-page flash)', async () => {
    // Without this gate, the link briefly renders directly under the game-mode
    // grid because the launcher sections below it are still empty placeholders
    // — then jumps down once the cascade plays.
    const { fetchImpl } = makeDeferredFetch()
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: fetchImpl })
    render(<Play />)
    expect(screen.queryByText(/view game history/i)).toBeNull()
  })

  it('shows the locked-state CTA link (no disabled button) once flashcard fetch resolves with count < 5', async () => {
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...a) => fetch(...a) })
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('flashcard-recall/available-briefs'))
        return Promise.resolve({ json: async () => ({ data: { count: 2 } }) })
      if (url.includes('wta-spawn'))
        return Promise.resolve({ json: async () => ({ data: { prereqsMet: false } }) })
      return Promise.resolve({ json: async () => ({ data: { briefs: [] } }) })
    })
    render(<Play />)
    const cta = await screen.findByTestId('flashcard-locked-cta')
    // No false-affordance disabled button — the locked state is now a Link
    // that takes the user to /learn-priority where they can read more briefs.
    expect(cta.tagName).toBe('A')
    expect(cta.getAttribute('href')).toBe('/learn-priority')
    expect(cta.textContent).toMatch(/read at least 5 briefs/i)
    expect(screen.queryByTestId('flashcard-launch-btn')).toBeNull()
  })
})

// Local helper — small deferred-promise factory
function newDeferred() {
  const d = {}
  d.promise = new Promise((resolve) => { d.resolve = (value) => resolve(value) })
  return d
}
