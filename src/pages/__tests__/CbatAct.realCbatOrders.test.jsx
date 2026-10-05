import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatAct from '../CbatAct'

// Colour / number orders: Real CBAT theme only, rounds 3-5. The round is
// reached with the admin cheat (333) so the test doesn't fly two rounds first.

const mockUseAuth = vi.hoisted(() => vi.fn())
const env = vi.hoisted(() => ({ realCbat: true, touch: false, instances: [] }))

vi.mock('../../utils/cbat/actAudio', async (importOriginal) => {
  const actual = await importOriginal()
  class FakeEngine {
    constructor() {
      this.ctx = {}
      this.init = vi.fn(() => Promise.resolve())
      this.loadClips = vi.fn(() => Promise.resolve())
      this.loadOrderClips = vi.fn(() => Promise.resolve())
      this.ensureRunning = vi.fn(() => Promise.resolve(true))
      this.setVolumes = vi.fn()
      this.dispose = vi.fn()
      this.stopAll = vi.fn()
      this.stopStatic = vi.fn()
      this.startStatic = vi.fn()
      this.suspend = vi.fn()
      this.resume = vi.fn()
      this.onBleep = vi.fn(() => () => {})
      this.playBleep = vi.fn()
      this.playSequence = vi.fn(() => ({ promise: Promise.resolve(), cancel() {}, played: true }))
      this.playOrder = vi.fn(() => ({ promise: Promise.resolve(), cancel() {}, played: true, durationS: 3 }))
      this.playDistraction = vi.fn(() => ({ played: false, cancel() {} }))
      this.playCode = vi.fn(() => ({ promise: Promise.resolve(), cancel() {}, played: true }))
      this.codeDurationS = vi.fn(() => 0)
      this.msSinceLastBleep = vi.fn(() => null)
      env.instances.push(this)
    }
    get loadOk() { return true }
  }
  return { ...actual, ActAudioEngine: FakeEngine }
})

vi.mock('../../hooks/useCbatTheme', () => ({
  useCbatTheme: () => env.realCbat,
  default: () => env.realCbat,
}))
vi.mock('../../hooks/useIsTouch', () => ({ useIsTouch: () => env.touch }))
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: {} }),
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), markCompleted: vi.fn(), setRound: vi.fn() }),
}))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../lib/offlineRoster', () => ({
  getAircraftRoster: vi.fn(() => Promise.resolve([])),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/cbat/ActCraftPicker', () => ({ default: () => null }))
vi.mock('../../components/cbat/ActPlayerCraft', () => ({ default: () => null }))
vi.mock('../../components/cbat/StickSetup', () => ({ default: () => null }))
vi.mock('../../components/cbat/CbatStickLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/cbat/CbatArcadeNotice', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/cbat/CbatTestChrome', () => ({ CbatGameHeader: () => null }))
vi.mock('../../components/cbat/TouchSteerPad', () => ({ default: () => null }))
vi.mock('../../utils/cbat/useStickPresence', () => ({ useStickPresence: () => false }))
vi.mock('../../utils/cbat/useMockStick', () => ({ useMockStick: () => null }))
vi.mock('../../utils/cbat/useAdminRoundParam', () => ({ useAdminRoundParam: () => {} }))
vi.mock('../../utils/cbat/useRightClickBleep', () => ({ useRightClickBleep: () => {} }))
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="canvas" />,
  useFrame: () => {},
  useThree: () => ({}),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, style, onClick, disabled }) => (
      <button className={className} style={style} onClick={onClick} disabled={disabled}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function setupAdmin() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com', isAdmin: true },
    API: '',
    apiFetch: vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ data: null }) })),
  })
}

// Type the admin cheat for a round, then wait out the 3s callsign card.
async function playRound(n) {
  await act(async () => {
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: String(n) })
  })
  await waitFor(() => expect(screen.queryByText(/your callsign for this round/i)).toBeNull(), { timeout: 4500 })
}

const ballLabel = () => screen.getByTestId('act-ball-state').querySelector('[aria-label]').getAttribute('aria-label')

beforeEach(() => {
  setupAdmin()
  env.realCbat = true
  env.touch = false
  env.instances.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ACT colour / number orders (Real CBAT)', () => {
  it('loads the order clips and shows the ball state from round 3', async () => {
    render(<CbatAct />)
    await playRound(3)
    expect(env.instances[0].loadOrderClips).toHaveBeenCalled()
    expect(ballLabel()).toMatch(/^(red|green|yellow) [1-9]$/)
  }, 10000)

  it('R / G / Y set the colour and 1-9 the number', async () => {
    render(<CbatAct />)
    await playRound(3)
    await act(async () => { fireEvent.keyDown(window, { key: 'r' }) })
    expect(ballLabel()).toMatch(/^red /)
    await act(async () => { fireEvent.keyDown(window, { key: 'Y' }) })
    expect(ballLabel()).toMatch(/^yellow /)
    await act(async () => { fireEvent.keyDown(window, { key: 'g' }) })
    await act(async () => { fireEvent.keyDown(window, { key: '7' }) })
    expect(ballLabel()).toBe('green 7')
  }, 10000)

  it('leaves Ctrl+R alone', async () => {
    render(<CbatAct />)
    await playRound(3)
    await act(async () => { fireEvent.keyDown(window, { key: 'g' }) })
    await act(async () => { fireEvent.keyDown(window, { key: 'r', ctrlKey: true }) })
    expect(ballLabel()).toMatch(/^green /)
  }, 10000)

  it('gives a touch player colour and number buttons', async () => {
    // The typed cheat is desktop-only, so the round is reached as a desktop
    // player and touch is switched on afterwards.
    const view = render(<CbatAct />)
    await playRound(4)
    env.touch = true
    view.rerender(<CbatAct />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'yellow' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(ballLabel()).toBe('yellow 4'))
  }, 10000)

  it('has no orders in rounds 1 and 2', async () => {
    render(<CbatAct />)
    await playRound(2)
    expect(screen.queryByTestId('act-ball-state')).toBeNull()
  }, 10000)
})

describe('ACT under the SkyWatch theme', () => {
  it('never fetches the order clips or shows the ball state', async () => {
    env.realCbat = false
    render(<CbatAct />)
    await playRound(3)
    expect(env.instances[0].loadOrderClips).not.toHaveBeenCalled()
    expect(screen.queryByTestId('act-ball-state')).toBeNull()
  }, 10000)
})
