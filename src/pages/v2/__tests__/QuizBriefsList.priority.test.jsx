import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizBriefsList from '../QuizBriefsList'

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
 * Set up fetch mock and render QuizBriefsList.
 *
 * @param {object[]} briefs        — all briefs returned by /api/briefs
 * @param {string[]} readIds       — IDs the user has read
 * @param {string[]} playableIds   — IDs that have quiz questions
 * @param {string[]} passedIds     — IDs the user has passed the quiz for
 */
function setup({ briefs = [], readIds = [], playableIds = [], passedIds = [] } = {}) {
  useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '' })
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/completed-brief-ids'))
      return Promise.resolve({ json: async () => ({ data: { ids: readIds } }) })
    if (url.includes('/api/games/quiz/playable-brief-ids'))
      return Promise.resolve({ json: async () => ({ data: { ids: playableIds } }) })
    if (url.includes('/api/games/quiz/completed-brief-ids'))
      return Promise.resolve({ json: async () => ({ data: { ids: passedIds } }) })
    if (url.includes('/api/briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs } }) })
    return Promise.resolve({ json: async () => ({}) })
  })
  render(<QuizBriefsList />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => { vi.restoreAllMocks() })

describe('QuizBriefsList — Available tab priority logic', () => {

  it('shows only active briefs when active ones exist (not needs-read alongside them)', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Active Brief',     category: 'Aircrafts' },
        { _id: 'b2', title: 'Needs Read Brief', category: 'Aircrafts' },
      ],
      readIds:     ['b1'],       // b1 is read
      playableIds: ['b1', 'b2'], // both have questions
      passedIds:   [],
    })

    await waitFor(() => screen.getByText('Active Brief'))
    expect(screen.queryByText('Needs Read Brief')).toBeNull()
  })

  it('shows needs-read briefs when there are no active ones', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Needs Read Brief', category: 'Aircrafts' },
      ],
      readIds:     [],
      playableIds: ['b1'],
      passedIds:   [],
    })

    await waitFor(() => screen.getByText('Needs Read Brief'))
  })

  it('shows the "read to unlock" banner when in needs-read mode', async () => {
    setup({
      briefs:      [{ _id: 'b1', title: 'Needs Read Brief', category: 'Aircrafts' }],
      readIds:     [],
      playableIds: ['b1'],
      passedIds:   [],
    })

    await waitFor(() => screen.getByText(/read these briefs to unlock their quizzes/i))
  })

  it('does not show the "read to unlock" banner when active briefs exist', async () => {
    setup({
      briefs:      [{ _id: 'b1', title: 'Active Brief', category: 'Aircrafts' }],
      readIds:     ['b1'],
      playableIds: ['b1'],
      passedIds:   [],
    })

    await waitFor(() => screen.getByText('Active Brief'))
    expect(screen.queryByText(/read these briefs to unlock their quizzes/i)).toBeNull()
  })

  it('shows passed briefs with "all complete" banner when everything is passed', async () => {
    setup({
      briefs:      [{ _id: 'b1', title: 'Passed Brief', category: 'Aircrafts' }],
      readIds:     ['b1'],
      playableIds: ['b1'],
      passedIds:   ['b1'],
    })

    await waitFor(() => screen.getByText('Passed Brief'))
    expect(screen.getByText(/all quizzes complete/i)).toBeDefined()
  })

  it('does not show "all complete" banner when there are active briefs', async () => {
    setup({
      briefs:      [{ _id: 'b1', title: 'Active Brief', category: 'Aircrafts' }],
      readIds:     ['b1'],
      playableIds: ['b1'],
      passedIds:   [],
    })

    await waitFor(() => screen.getByText('Active Brief'))
    expect(screen.queryByText(/all quizzes complete/i)).toBeNull()
  })

  it('active briefs are shown before needs-read in the All tab', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Needs Read Brief', category: 'Aircrafts' },
        { _id: 'b2', title: 'Active Brief',     category: 'Aircrafts' },
      ],
      readIds:     ['b2'],
      playableIds: ['b1', 'b2'],
      passedIds:   [],
    })

    // Switch to All tab — need to find the tab button and click it
    await waitFor(() => screen.getByText('Active Brief'))
    const allTab = screen.getByRole('button', { name: 'All' })
    allTab.click()

    await waitFor(() => screen.getByText('Needs Read Brief'))
    const html = document.body.innerHTML
    expect(html.indexOf('Active Brief')).toBeLessThan(html.indexOf('Needs Read Brief'))
  })

  it('Completed tab always shows passed briefs regardless of active state', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Active Brief',  category: 'Aircrafts' },
        { _id: 'b2', title: 'Passed Brief',  category: 'Aircrafts' },
      ],
      readIds:     ['b1', 'b2'],
      playableIds: ['b1', 'b2'],
      passedIds:   ['b2'],
    })

    await waitFor(() => screen.getByText('Active Brief'))
    const completedTab = screen.getByRole('button', { name: 'Completed' })
    completedTab.click()

    await waitFor(() => screen.getByText('Passed Brief'))
    expect(screen.queryByText('Active Brief')).toBeNull()
  })
})
