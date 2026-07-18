import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatTarget from '../CbatTarget'

// The three scrolling system columns used to build a fixed 20-row list on every
// device (floor of `Math.max(20, ...)`). On a short phone that was a list twice
// as long as the column itself, so a code that scrolled off the top took ~24s to
// come back — and the panel held a 240px min-height that pushed the arena past
// the viewport. Row count now tracks the column's share of the device height.

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

const BRIEF_ID = 'b1'
const MOCK_AIRCRAFT = [{ briefId: BRIEF_ID, title: 'F-35', cutoutUrl: 'http://example.com/f35.png' }]

function setupUser() {
  const apiFetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/aircraft-cutouts'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_AIRCRAFT }) })
    if (url.includes('/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
  })
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', email: 'a@b.com' }, API: '', apiFetch })
  mockUseAppSettings.mockReturnValue({ settings: { cbatTargetAircraftBriefIds: [BRIEF_ID] } })
}

function setViewport(width, height) {
  Object.defineProperty(window, 'innerWidth',  { value: width,  configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

// Renders, starts a game, and reports the system columns' shape.
async function startAndMeasure(container) {
  await waitFor(() => {
    const btn = screen.queryByRole('button', { name: /^start$/i })
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

  let inners
  await waitFor(() => {
    inners = container.querySelectorAll('.sys-column-inner')
    expect(inners.length).toBe(3)
  })
  // Each column renders its codes twice so the loop wraps seamlessly.
  const rows = inners[0].querySelectorAll('.sys-row').length / 2
  const durationMs = parseFloat(inners[0].style.animationDuration)
  return { rows, durationMs }
}

const ORIGINAL = { w: window.innerWidth, h: window.innerHeight }

describe('CbatTarget — system column sizing scales with device height', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => setViewport(ORIGINAL.w, ORIGINAL.h))

  it('renders fewer codes on a short phone than on a desktop', async () => {
    setupUser()

    setViewport(375, 560)
    const phone = await startAndMeasure(render(<CbatTarget />).container)

    setViewport(1440, 900)
    const desktop = await startAndMeasure(render(<CbatTarget />).container)

    // Substantially fewer, not incidentally fewer: under the old fixed floor a
    // 560px phone got 20 rows against the desktop's 21, which "less than" would
    // have waved through.
    expect(phone.rows).toBeLessThanOrEqual(desktop.rows * 0.6)
  })

  it('keeps a code off-screen for less time on a short phone', async () => {
    setupUser()

    setViewport(375, 560)
    const phone = await startAndMeasure(render(<CbatTarget />).container)

    setViewport(412, 840)
    const tallPhone = await startAndMeasure(render(<CbatTarget />).container)

    // One full loop = one list length. Shorter list, constant speed, so a code
    // that leaves the top reappears sooner rather than after a fixed 20 rows.
    expect(phone.durationMs).toBeLessThan(tallPhone.durationMs)
  })

  it('scrolls at a constant speed regardless of list length', async () => {
    setupUser()

    setViewport(375, 560)
    const phone = await startAndMeasure(render(<CbatTarget />).container)

    setViewport(1440, 900)
    const desktop = await startAndMeasure(render(<CbatTarget />).container)

    // durationMs = rows * 32px / speed, so ms-per-row is the speed constant.
    // If these drift apart the columns scroll at different rates by device.
    expect(phone.durationMs / phone.rows).toBeCloseTo(desktop.durationMs / desktop.rows, 0)
  })

  it('always renders enough rows to overflow the column and wrap seamlessly', async () => {
    setupUser()

    // Absurdly short viewport — the list must still be long enough that the
    // duplicated copy covers the column, or a blank gap shows at the wrap.
    setViewport(320, 400)
    const tiny = await startAndMeasure(render(<CbatTarget />).container)

    expect(tiny.rows).toBeGreaterThanOrEqual(10)
  })
})
