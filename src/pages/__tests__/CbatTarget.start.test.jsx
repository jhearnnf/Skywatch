import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatTarget from '../CbatTarget'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth        = vi.hoisted(() => vi.fn())
const mockHas3DModel     = vi.hoisted(() => vi.fn(() => true))
const mockGetModelUrl    = vi.hoisted(() => vi.fn(() => null))
const mockUseAppSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseAppSettings }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../data/aircraftModels', () => ({
  getModelUrl: mockGetModelUrl,
  has3DModel:  mockHas3DModel,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => (
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

const BRIEF_ID = 'b1'
const MOCK_AIRCRAFT = [
  { briefId: BRIEF_ID, title: 'F-35', cutoutUrl: 'http://example.com/f35.png' },
]

function mockApiFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/aircraft-cutouts'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_AIRCRAFT }) })
    if (url.includes('/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    if (url.includes('/start'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupUser(apiFetch = mockApiFetch()) {
  mockUseAuth.mockReturnValue({
    user:     { _id: 'u1', email: 'a@b.com' },
    API:      '',
    apiFetch,
  })
  mockUseAppSettings.mockReturnValue({
    settings: { cbatTargetAircraftBriefIds: [BRIEF_ID] },
  })
  return apiFetch
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatTarget — start endpoint called on game start', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the /cbat/target/start endpoint when the Start button is clicked', async () => {
    const apiFetch = setupUser()
    render(<CbatTarget />)

    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /^start$/i })
      expect(btn).not.toBeNull()
      expect(btn.disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      const startCalls = apiFetch.mock.calls.filter(([url]) => url.includes('/cbat/target/start'))
      expect(startCalls.length).toBe(1)
    })
  })

  it('calls /cbat/target/start exactly once per click (not on re-render)', async () => {
    const apiFetch = setupUser()
    render(<CbatTarget />)

    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /^start$/i })
      expect(btn).not.toBeNull()
      expect(btn.disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      const startCalls = apiFetch.mock.calls.filter(([url]) => url.includes('/cbat/target/start'))
      expect(startCalls.length).toBe(1)
    })
  })
})
