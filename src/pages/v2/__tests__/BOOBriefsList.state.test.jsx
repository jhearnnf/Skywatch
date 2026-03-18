import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import BOOBriefsList from '../BOOBriefsList'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { _id: 'u1' }, API: '' })),
}))

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import { useAuth } from '../../../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param {object[]} briefs          - briefs with isRead set
 * @param {string[]} passedQuizIds   - brief IDs the user has passed the quiz for
 * @param {string[]} booCategories   - categories with enough BOO data
 */
function setup({ briefs = [], passedQuizIds = [], booCategories = ['Aircrafts'] } = {}) {
  useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '' })
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs } }) })
    if (url.includes('/api/games/quiz/completed-brief-ids'))
      return Promise.resolve({ json: async () => ({ data: { ids: passedQuizIds } }) })
    if (url.includes('/api/games/battle-of-order/available-categories'))
      return Promise.resolve({ json: async () => ({ data: { categories: booCategories } }) })
    return Promise.resolve({ json: async () => ({}) })
  })
  render(<BOOBriefsList />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => { vi.restoreAllMocks() })

describe('BOOBriefsList — prerequisite state logic', () => {

  it('shows "Read first" for an unread brief with BOO data', async () => {
    setup({
      briefs:       [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', isRead: false }],
      passedQuizIds: [],
    })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.getByText(/read first/i)).toBeDefined()
  })

  it('links "Read first" card to the brief reader, not the quiz', async () => {
    setup({
      briefs:       [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', isRead: false }],
      passedQuizIds: [],
    })
    await waitFor(() => screen.getByText('Typhoon'))
    const link = screen.getByText('Typhoon').closest('a')
    expect(link.href).toContain('/brief/b1')
  })

  it('shows "Pass quiz first" for a read brief whose quiz is not yet passed', async () => {
    setup({
      briefs:       [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', isRead: true }],
      passedQuizIds: [],
    })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.getByText(/pass quiz first/i)).toBeDefined()
  })

  it('links "Pass quiz first" card to the quiz', async () => {
    setup({
      briefs:       [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', isRead: true }],
      passedQuizIds: [],
    })
    await waitFor(() => screen.getByText('Typhoon'))
    const link = screen.getByText('Typhoon').closest('a')
    expect(link.href).toContain('/quiz/b1')
  })

  it('shows playable BOO card when brief is read and quiz is passed', async () => {
    setup({
      briefs:        [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', isRead: true }],
      passedQuizIds: ['b1'],
    })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.queryByText(/read first/i)).toBeNull()
    expect(screen.queryByText(/pass quiz first/i)).toBeNull()
    const link = screen.getByText('Typhoon').closest('a')
    expect(link.href).toContain('/battle-of-order/b1')
  })

  it('shows "Read first" before "Pass quiz first" in sort order', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Needs Quiz', category: 'Aircrafts', isRead: true  },
        { _id: 'b2', title: 'Needs Read', category: 'Aircrafts', isRead: false },
      ],
      passedQuizIds: [],
    })
    // Click "All" tab so both are visible
    await waitFor(() => screen.getByText('Needs Quiz'))
    screen.getByRole('button', { name: 'All' }).click()
    await waitFor(() => screen.getByText('Needs Read'))
    const html = document.body.innerHTML
    expect(html.indexOf('Needs Quiz')).toBeLessThan(html.indexOf('Needs Read'))
  })

  it('does not show BOO card for a brief in a category with no BOO data', async () => {
    setup({
      briefs:       [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', isRead: true }],
      passedQuizIds: ['b1'],
      booCategories: [], // no categories have BOO data
    })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // Brief should still render but as no-data (not in Available tab)
    screen.getByRole('button', { name: 'All' }).click()
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.queryByText(/read first/i)).toBeNull()
    expect(screen.queryByText(/pass quiz first/i)).toBeNull()
    expect(screen.getByText(/no data yet/i)).toBeDefined()
  })
})
