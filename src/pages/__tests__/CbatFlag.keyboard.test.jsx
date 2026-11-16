// Under Real CBAT the maths answer goes in by clicking the on-screen number
// pad only. A digit key (top row or numpad) enters nothing and briefly shows a
// notice saying so. Under SkyWatch the keyboard still types digits.

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatFlag from '../CbatFlag'

const mockUseAuth        = vi.hoisted(() => vi.fn())
const theme              = vi.hoisted(() => ({ cbat: false }))
const mockUseAppSettings = vi.hoisted(() => vi.fn())
// Captures the callbacks the real PlayField would fire, so a test can script
// exactly which contacts are up and which have shown their callsign.
const field              = vi.hoisted(() => ({ current: null }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext',        () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseAppSettings }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({
    enterImmersive: vi.fn(), exitImmersive: vi.fn(),
    enterGameOver: vi.fn(), exitGameOver: vi.fn(),
  }),
}))
vi.mock('../../hooks/useCbatTheme', () => ({
  useCbatTheme: () => theme.cbat,
  default:      () => theme.cbat,
}))
// A two-digit answer, so one key or click never submits it on its own.
vi.mock('../CbatFlag/mathBank', () => ({
  generateMath: () => ({ question: '59 - 43', answer: 16, expectedDigits: 2 }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../data/aircraftModels', () => ({
  getModelUrl: vi.fn(() => '/models/test.glb'),
  has3DModel:  vi.fn(() => true),
}))
vi.mock('../../utils/cbat/recordStart', () => ({ recordCbatStart: vi.fn() }))
vi.mock('@react-three/drei', () => ({
  useGLTF: Object.assign(vi.fn(() => ({ scene: {} })), { preload: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) =>
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// Deterministic, disjoint pools, set per test: F* fly, D* are the reserved
// decoys that never reach the field. Kept to one entry each so a run has no
// randomness left in it — with a large pool the old bug only surfaced on maybe
// one question in fifty, which is precisely why it survived this long. The
// second call is the one that passes an exclude set, so it gets the decoys.
const pools = vi.hoisted(() => ({ field: ['F0'], decoys: ['D0'] }))
vi.mock('../CbatFlag/symbols', () => ({
  generateUniqueSymbols: (_count, exclude) =>
    [...(exclude && exclude.size ? pools.decoys : pools.field)],
}))

vi.mock('../CbatFlag/PlayField', () => ({
  default: ({ onAircraftSpawn, onAircraftSeen, onAircraftDespawn }) => {
    field.current = { onAircraftSpawn, onAircraftSeen, onAircraftDespawn }
    return <div data-testid="play-field" />
  },
}))

const MOCK_AIRCRAFT = [{ briefId: 'b1', title: 'F-35', cutoutUrl: 'http://example.com/f35.png' }]

function mockApiFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/aircraft-cutouts'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_AIRCRAFT }) })
    if (url.includes('/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) })
  })
}

async function renderAndStart() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', email: 'a@b.com' }, API: '', apiFetch: mockApiFetch() })
  mockUseAppSettings.mockReturnValue({ settings: { cbatFlagAircraftBriefIds: ['b1'] } })
  render(<CbatFlag />)
  await waitFor(() => {
    const btn = screen.queryByRole('button', { name: /^start$/i })
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  await act(async () => { vi.advanceTimersByTime(1100) })  // launch flash
}


// Waits until a maths question is live (the pad leaves its Standby state).
async function waitForQuestion() {
  for (let i = 0; i < 60 && screen.queryByText(/standby/i); i++) {
    await act(async () => { vi.advanceTimersByTime(500) })
  }
  expect(screen.queryByText(/standby/i)).toBeNull()
}

const entryText = () => document.querySelector('.cbat-flag-entry').textContent

describe('CbatFlag keyboard input', () => {
  beforeEach(() => { vi.clearAllMocks(); theme.cbat = false })
  afterEach(() => { vi.useRealTimers() })

  it('Real CBAT: digit keys enter nothing and show the click-the-pad notice', async () => {
    theme.cbat = true
    await renderAndStart()
    await waitForQuestion()

    fireEvent.keyDown(window, { key: '5', code: 'Digit5' })
    expect(entryText()).toBe('_')
    expect(screen.getByTestId('flag-keyboard-notice').textContent).toMatch(/click the numbers/i)

    // Numpad with NumLock off reports a navigation key, not a digit.
    fireEvent.keyDown(window, { key: 'End', code: 'Numpad1' })
    expect(entryText()).toBe('_')

    await act(async () => { vi.advanceTimersByTime(2300) })
    expect(screen.queryByTestId('flag-keyboard-notice')).toBeNull()

    // The on-screen pad still works.
    fireEvent.click(screen.getByRole('button', { name: '7' }))
    expect(entryText()).toBe('7')
  })

  it('SkyWatch: digit keys still type into the answer', async () => {
    await renderAndStart()
    await waitForQuestion()

    fireEvent.keyDown(window, { key: '7', code: 'Digit7' })
    expect(entryText()).toBe('7')
    expect(screen.queryByTestId('flag-keyboard-notice')).toBeNull()
  })
})
