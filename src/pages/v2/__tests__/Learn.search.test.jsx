import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Learn from '../Learn'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: null }),
}))

vi.mock('../../../utils/subscription', () => ({
  isCategoryLocked: () => false,
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COUNTS_RESPONSE = {
  ok: true,
  json: async () => ({ data: { counts: { Aircrafts: 3, Bases: 2, Threats: 1 } } }),
}

const BRIEFS_RESPONSE = {
  ok: true,
  json: async () => ({
    data: {
      briefs: [
        { _id: 'b1', title: 'Eurofighter Typhoon FGR4', category: 'Aircrafts' },
        { _id: 'b2', title: 'RAF Brize Norton',          category: 'Bases'     },
        { _id: 'b3', title: 'S-400 Triumf SAM System',   category: 'Threats'   },
      ],
    },
  }),
}

function setupFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('category-counts')) return Promise.resolve(COUNTS_RESPONSE)
    if (url.includes('category-stats'))  return Promise.resolve({ ok: true, json: async () => ({ data: { stats: {} } }) })
    // /api/briefs?limit=500
    return Promise.resolve(BRIEFS_RESPONSE)
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Learn — extended search (category, subcategory, brief title)', () => {
  beforeEach(() => {
    global.fetch = setupFetch()
    mockUseAuth.mockReturnValue({ user: null, API: '' })
  })

  afterEach(() => { vi.restoreAllMocks() })

  async function type(text) {
    const input = screen.getByPlaceholderText(/search subjects/i)
    fireEvent.change(input, { target: { value: text } })
  }

  it('shows all categories when search is empty', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Aircrafts'))
    expect(screen.getByText('Bases')).toBeDefined()
    expect(screen.getByText('Threats')).toBeDefined()
  })

  it('matches by category name (case-insensitive)', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Aircrafts'))

    await type('aircraft')

    expect(screen.getByText('Aircrafts')).toBeDefined()
    expect(screen.queryByText('Bases')).toBeNull()
    expect(screen.queryByText('Threats')).toBeNull()
  })

  it('matches by subcategory name — shows the parent category', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Aircrafts'))

    // "Fast Jet" is a subcategory of Aircrafts
    await type('Fast Jet')

    expect(screen.getByText('Aircrafts')).toBeDefined()
    expect(screen.queryByText('Bases')).toBeNull()
  })

  it('matches by subcategory name across different category (SAM)', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Threats'))

    // "Surface-to-Air Missiles" is a subcategory of Threats
    await type('Surface-to-Air')

    expect(screen.getByText('Threats')).toBeDefined()
    expect(screen.queryByText('Aircrafts')).toBeNull()
  })

  it('matches by brief title — shows the parent category', async () => {
    render(<Learn />)
    // Wait for brief titles to load (briefs fetch resolves after counts)
    await waitFor(() => screen.getByText('Aircrafts'))
    // Give brief titles time to load
    await waitFor(() => {})

    await type('Eurofighter')

    expect(screen.getByText('Aircrafts')).toBeDefined()
    expect(screen.queryByText('Bases')).toBeNull()
    expect(screen.queryByText('Threats')).toBeNull()
  })

  it('matches a brief title in a different category', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Bases'))
    await waitFor(() => {})

    await type('Brize Norton')

    expect(screen.getByText('Bases')).toBeDefined()
    expect(screen.queryByText('Aircrafts')).toBeNull()
  })

  it('matches by brief title case-insensitively', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Threats'))
    await waitFor(() => {})

    await type('s-400')

    expect(screen.getByText('Threats')).toBeDefined()
    expect(screen.queryByText('Aircrafts')).toBeNull()
  })

  it('shows empty state when nothing matches', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Aircrafts'))

    await type('xyzzy')

    expect(screen.getByText(/No subjects match/i)).toBeDefined()
    expect(screen.queryByText('Aircrafts')).toBeNull()
  })

  it('shows all categories again after clearing search', async () => {
    render(<Learn />)
    await waitFor(() => screen.getByText('Aircrafts'))

    await type('xyzzy')
    expect(screen.queryByText('Aircrafts')).toBeNull()

    // Clear via input change
    await type('')
    expect(screen.getByText('Aircrafts')).toBeDefined()
    expect(screen.getByText('Bases')).toBeDefined()
  })
})
