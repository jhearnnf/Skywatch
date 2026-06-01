import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
vi.mock('../../components/AircraftTopDown', () => ({ default: () => <div data-testid="aircraft" /> }))
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
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupUser() {
  mockUseAuth.mockReturnValue({
    user:     { _id: 'u1', email: 'a@b.com' },
    API:      '',
    apiFetch: mockApiFetch(),
  })
  mockUseAppSettings.mockReturnValue({
    settings: { cbatTargetAircraftBriefIds: [BRIEF_ID] },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatTarget — tutorial / practice mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in section 1 with only Scene/Key/Scene Targets active', () => {
    setupUser()
    render(<CbatTarget />)

    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

    expect(screen.getByText(/practice mode/i)).toBeTruthy()
    expect(screen.getByText(/spot the targets/i)).toBeTruthy()

    // Section 2+ panels are locked during section 1 (label is "🔒 <name>")
    expect(screen.getByText(/Light$/)).toBeTruthy()
    expect(screen.getByText(/Scan$/)).toBeTruthy()
    expect(screen.getByText(/System$/)).toBeTruthy()

    // Scene Targets panel is active and shows the always-present "unknown" target
    expect(screen.getAllByText(/^unknown$/i).length).toBeGreaterThanOrEqual(1)
  })

  it('lets the user jump between sections with the arrows', () => {
    setupUser()
    render(<CbatTarget />)
    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

    expect(screen.getByText(/spot the targets/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /previous section/i }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/match the lights/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/identify the aircraft/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/catch the code/i)).toBeTruthy()
    // Last section — next is disabled
    expect(screen.getByRole('button', { name: /next section/i }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))
    expect(screen.getByText(/identify the aircraft/i)).toBeTruthy()
  })

  it('Exit practice returns to the intro', async () => {
    setupUser()
    render(<CbatTarget />)

    fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))
    fireEvent.click(screen.getByRole('button', { name: /exit practice/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeNull()
    })
  })

  it('advances Scene → Light → Scan → System and completes on a system code click', async () => {
    setupUser()
    // Deterministic geometry + RNG: every shape lands at (80,80); the light
    // pattern/target are identical; and the scan panel always shows the target
    // aircraft — so each section's action is a guaranteed match.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON() {},
    })

    try {
      render(<CbatTarget />)
      // Wait for aircraft to load so the Scan section has a target.
      await waitFor(() => expect(mockGetModelUrl).toHaveBeenCalled())

      fireEvent.click(screen.getByRole('button', { name: /^tutorial$/i }))

      // Section 1 — clear all five unknown diamonds (stacked at 80,80).
      const scene = document.querySelector('.cbat-target-scene')
      for (let i = 0; i < 5; i++) fireEvent.click(scene, { clientX: 80, clientY: 80 })

      // Section 2 — LOCK matches the target pattern and flashes; press it.
      const lock = screen.getByRole('button', { name: /^lock$/i })
      expect(lock.className).toContain('cbat-btn-flash')
      fireEvent.click(lock)

      // Section 3 — the scan panel resolves to the target aircraft; the ID
      // button flashes once matched. Press it to advance to the System section.
      const id = await screen.findByRole('button', { name: /^id$/i })
      await waitFor(() => expect(id.className).toContain('cbat-btn-flash'))
      fireEvent.click(id)

      // Section 4 — the target code is injected after a measure pass; once the
      // System Target panel shows it, clicking a matching feed row finishes.
      expect(screen.getByText(/catch the code/i)).toBeTruthy()
      const sysTargetPanel = document.querySelector('.grid-system-target')
      await waitFor(() => expect(within(sysTargetPanel).queryByText('AAAA')).not.toBeNull())
      const sysPanel = document.querySelector('.grid-system')
      fireEvent.click(within(sysPanel).getAllByRole('button')[0])

      expect(screen.getByText(/tutorial complete/i)).toBeTruthy()
    } finally {
      randomSpy.mockRestore()
      rectSpy.mockRestore()
    }
  })
})
