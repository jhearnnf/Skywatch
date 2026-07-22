import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatAnt from '../CbatAnt'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function mockApiFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupUser() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com' },
    API: '',
    apiFetch: mockApiFetch(),
  })
}

function openTutorial() {
  render(<CbatAnt />)
  fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatAnt — tutorial / practice mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens on the first reading step with only the Map unlocked', () => {
    setupUser()
    openTutorial()

    expect(screen.getByText(/practice mode/i)).toBeTruthy()
    expect(screen.getByText(/read the route/i)).toBeTruthy()

    // The four other panels are locked while step 1 teaches the map.
    expect(screen.getByText(/Journey Data/)).toBeTruthy()
    expect(screen.getByText(/Solve For/)).toBeTruthy()
    expect(screen.getByText(/Weight Reference/)).toBeTruthy()
    expect(screen.getByText(/Answer/)).toBeTruthy()
  })

  it('lets the user page between sections with the arrows', () => {
    setupUser()
    openTutorial()

    expect(screen.getByRole('button', { name: /previous section/i }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/read the flight data/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/solve: arrival time/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))
    expect(screen.getByText(/read the flight data/i)).toBeTruthy()
  })

  it('flashes the active parcel-weight row and the 200 kg value only on step 2', () => {
    setupUser()
    openTutorial()

    // Step 1 — nothing flashing yet.
    expect(document.querySelectorAll('.cbat-cell-flash').length).toBe(0)

    // Step 2 — the weight-table active row and the data-table kg value both flash.
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/read the flight data/i)).toBeTruthy()
    expect(document.querySelectorAll('.cbat-cell-flash').length).toBe(2)

    // Step 3 (a solve step) — flashing stops.
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(document.querySelectorAll('.cbat-cell-flash').length).toBe(0)
  })

  it('rejects a wrong answer on a solve step and keeps the section', () => {
    setupUser()
    openTutorial()
    // Jump straight to the first solve step via the arrows.
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/solve: arrival time/i)).toBeTruthy()

    const input = screen.getByPlaceholderText(/HHMM/i)
    fireEvent.change(input, { target: { value: '0000' } })
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(screen.getByText(/not quite/i)).toBeTruthy()
    expect(screen.getByText(/solve: arrival time/i)).toBeTruthy()
  })

  it('advances a solve step when the correct answer is entered', async () => {
    setupUser()
    openTutorial()
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    fireEvent.click(screen.getByRole('button', { name: /next section/i }))

    // Arrival = 1000 + 20 min = 1020.
    const input = screen.getByPlaceholderText(/HHMM/i)
    fireEvent.change(input, { target: { value: '1020' } })
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(screen.getByText(/solve: total distance/i)).toBeTruthy())
  })

  it('walks through every step to completion', async () => {
    setupUser()
    openTutorial()

    // Reading steps advance via the Next button.
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText(/read the flight data/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText(/solve: arrival time/i)).toBeTruthy()

    // Solve each of the four types (fixed practice journey).
    const solve = async (value, nextTitle) => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: /^submit$/i }))
      await waitFor(() => expect(screen.getByText(nextTitle)).toBeTruthy())
    }
    await solve('1020', /solve: total distance/i)   // arrival
    await solve('120', /solve: fuel/i)              // distance
    await solve('2', /solve: speed/i)               // fuel
    await solve('360', /tutorial complete/i)        // speed → done
  })

  it('Exit practice returns to the intro', async () => {
    setupUser()
    openTutorial()
    fireEvent.click(screen.getByRole('button', { name: /exit practice/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy()
    })
  })
})
