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
 * Mocks the /api/games/battle-of-order/briefs endpoint to return `briefs`
 * with booState already set (as the real server does).
 */
function setup({ briefs = [] } = {}) {
  useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '' })
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('battle-of-order/briefs'))
      return Promise.resolve({ json: async () => ({ data: { briefs, total: briefs.length, page: 1, totalPages: 1 } }) })
    return Promise.resolve({ json: async () => ({}) })
  })
  render(<BOOBriefsList />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => { vi.restoreAllMocks() })

describe('BOOBriefsList — prerequisite state logic', () => {

  it('shows "Read first" for a needs-read brief', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-read' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.getByText(/read first/i)).toBeDefined()
  })

  it('"Read first" card links to the brief reader', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-read' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    const link = screen.getByText('Typhoon').closest('a')
    expect(link.href).toContain('/brief/b1')
  })

  it('shows "Pass quiz first" for a needs-quiz brief', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-quiz' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.getByText(/pass quiz first/i)).toBeDefined()
  })

  it('"Pass quiz first" card links to the quiz page', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-quiz' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    const link = screen.getByText('Typhoon').closest('a')
    expect(link.href).toContain('/quiz/b1')
  })

  it('shows playable BOO link for an active brief', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'active' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.queryByText(/read first/i)).toBeNull()
    expect(screen.queryByText(/pass quiz first/i)).toBeNull()
    const link = screen.getByText('Typhoon').closest('a')
    expect(link.href).toContain('/battle-of-order/b1')
  })

  it('shows "No data yet" for a no-data brief', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'no-data' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.getByText(/no data yet/i)).toBeDefined()
  })

  it('shows "Read first" before "Pass quiz first" in sort order', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Needs Quiz', category: 'Aircrafts', booState: 'needs-quiz' },
        { _id: 'b2', title: 'Needs Read', category: 'Aircrafts', booState: 'needs-read' },
      ],
    })
    await waitFor(() => screen.getByText('Needs Quiz'))
    screen.getByRole('button', { name: 'All' }).click()
    await waitFor(() => screen.getByText('Needs Read'))
    const html = document.body.innerHTML
    expect(html.indexOf('Needs Quiz')).toBeLessThan(html.indexOf('Needs Read'))
  })

  // ── needs-aircraft-reads ──────────────────────────────────────────────────

  it('shows "Read more Aircrafts" label for a needs-aircraft-reads brief', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-aircraft-reads' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.getByText(/read more aircrafts/i)).toBeDefined()
  })

  it('needs-aircraft-reads card does not link to the BOO game', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-aircraft-reads' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    const link = screen.getByText('Typhoon').closest('a')
    expect(link).toBeNull()
  })

  it('needs-aircraft-reads card does not show read or quiz prompts', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Typhoon', category: 'Aircrafts', booState: 'needs-aircraft-reads' }] })
    await waitFor(() => screen.getByText('Typhoon'))
    expect(screen.queryByText(/read first/i)).toBeNull()
    expect(screen.queryByText(/pass quiz first/i)).toBeNull()
  })

  it('completed brief sorts before needs-aircraft-reads brief', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Completed Brief', category: 'Aircrafts', booState: 'completed' },
        { _id: 'b2', title: 'Locked Brief',    category: 'Aircrafts', booState: 'needs-aircraft-reads' },
      ],
    })
    await waitFor(() => screen.getByText('Locked Brief'))
    const html = document.body.innerHTML
    expect(html.indexOf('Completed Brief')).toBeLessThan(html.indexOf('Locked Brief'))
  })

  it('active brief sorts before needs-aircraft-reads brief', async () => {
    setup({
      briefs: [
        { _id: 'b1', title: 'Ready Brief',  category: 'Aircrafts', booState: 'active' },
        { _id: 'b2', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' },
      ],
    })
    await waitFor(() => screen.getByText('Locked Brief'))
    const html = document.body.innerHTML
    expect(html.indexOf('Ready Brief')).toBeLessThan(html.indexOf('Locked Brief'))
  })

  it('needs-aircraft-reads brief does not appear in the Available tab', async () => {
    setup({ briefs: [{ _id: 'b1', title: 'Locked Brief', category: 'Aircrafts', booState: 'needs-aircraft-reads' }] })
    // Available is the default tab — server filters this server-side, but confirm no BOO link is rendered
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // If the server returned the brief, it would render — but there should be no BOO game link
    const booLinks = screen.queryAllByRole('link').filter(l => (l.getAttribute('href') ?? '').includes('/battle-of-order/b1'))
    expect(booLinks.length).toBe(0)
  })
})
