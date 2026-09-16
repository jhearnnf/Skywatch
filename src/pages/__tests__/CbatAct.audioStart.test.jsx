import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatAct from '../CbatAct'

// ── Mocks ─────────────────────────────────────────────────────────────────
//
// The engine is the thing under test here, so it is a controllable fake: each
// test decides whether the clips load and whether the context wakes up, and
// the page's job is to react correctly on the intro screen.

const mockUseAuth = vi.hoisted(() => vi.fn())
const engineState = vi.hoisted(() => ({
  loadOk: true,
  running: true,
  ctx: {},
  resolveInit: null,
  instances: [],
}))

vi.mock('../../utils/cbat/actAudio', async (importOriginal) => {
  const actual = await importOriginal()
  class FakeEngine {
    constructor() {
      this.ctx = engineState.ctx
      this.init = vi.fn(() => new Promise((resolve) => { engineState.resolveInit = resolve }))
      this.loadClips = vi.fn(() => Promise.resolve())
      this.ensureRunning = vi.fn(() => Promise.resolve(engineState.running))
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
      this.playDistraction = vi.fn(() => ({ played: false, cancel() {} }))
      this.playCode = vi.fn(() => ({ promise: Promise.resolve(), cancel() {}, played: true }))
      this.codeDurationS = vi.fn(() => 0)
      this.msSinceLastBleep = vi.fn(() => null)
      engineState.instances.push(this)
    }
    get loadOk() { return engineState.loadOk }
  }
  return { ...actual, ActAudioEngine: FakeEngine }
})

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
vi.mock('../../utils/cbat/useStickPresence', () => ({ useStickPresence: () => false }))
vi.mock('../../utils/cbat/useMockStick', () => ({ useMockStick: () => null }))
vi.mock('../../utils/cbat/useAdminRoundParam', () => ({ useAdminRoundParam: () => {} }))
vi.mock('../../utils/cbat/useRightClickBleep', () => ({ useRightClickBleep: () => {} }))
// The round itself is a WebGL canvas; the intro is all this test needs.
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

// ── Helpers ───────────────────────────────────────────────────────────────

function setupUser() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com' },
    API: '',
    apiFetch: vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ data: null }) })),
  })
}

const startBtn = () => screen.getByRole('button', { name: /start mission|loading audio|retry/i })

async function finishLoad() {
  await act(async () => {
    engineState.resolveInit()
    await Promise.resolve()
  })
}

beforeEach(() => {
  setupUser()
  engineState.loadOk = true
  engineState.running = true
  engineState.ctx = {}
  engineState.resolveInit = null
  engineState.instances.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatAct intro audio start', () => {
  it('greys the button while the clips load, then starts the round', async () => {
    render(<CbatAct />)
    fireEvent.click(startBtn())
    expect(startBtn().disabled).toBe(true)
    expect(startBtn().textContent).toMatch(/loading audio/i)

    await finishLoad()
    await waitFor(() => expect(screen.getByText(/your callsign for this round/i)).toBeDefined())
    expect(engineState.instances[0].ensureRunning).toHaveBeenCalled()
  })

  it('a second tap during the load does not build a second engine', async () => {
    render(<CbatAct />)
    fireEvent.click(startBtn())
    // The button is disabled, but a keyboard Enter or a stale event could
    // still reach the handler — the memo is what makes it safe.
    fireEvent.click(startBtn())
    fireEvent.click(startBtn())
    await finishLoad()
    expect(engineState.instances).toHaveLength(1)
    expect(engineState.instances[0].init).toHaveBeenCalledTimes(1)
  })

  it('stays on the intro with a retry when a clip never loaded', async () => {
    engineState.loadOk = false
    render(<CbatAct />)
    fireEvent.click(startBtn())
    await finishLoad()

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/audio failed to load/i))
    expect(screen.queryByText(/your callsign for this round/i)).toBeNull()
    expect(startBtn().textContent).toMatch(/retry/i)
    // The missing clips were retried, not the whole load.
    expect(engineState.instances[0].loadClips).toHaveBeenCalledTimes(1)
    expect(engineState.instances[0].init).toHaveBeenCalledTimes(1)
  })

  it('stays on the intro when the browser keeps the context suspended', async () => {
    engineState.running = false
    render(<CbatAct />)
    fireEvent.click(startBtn())
    await finishLoad()

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/blocked the audio/i))
    expect(screen.queryByText(/your callsign for this round/i)).toBeNull()
  })

  it('retry re-checks the context from the tap and starts once it wakes', async () => {
    engineState.running = false
    render(<CbatAct />)
    fireEvent.click(startBtn())
    await finishLoad()
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())

    engineState.running = true
    fireEvent.click(startBtn())
    await waitFor(() => expect(screen.getByText(/your callsign for this round/i)).toBeDefined())
    expect(engineState.instances).toHaveLength(1)
    expect(engineState.instances[0].ensureRunning).toHaveBeenCalledTimes(2)
  })

  it('offers a silent start after a failure', async () => {
    engineState.loadOk = false
    render(<CbatAct />)
    fireEvent.click(startBtn())
    await finishLoad()
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /start without audio/i }))
    await waitFor(() => expect(screen.getByText(/your callsign for this round/i)).toBeDefined())
  })

  it('a demo engine (no context) starts without any audio gating', async () => {
    engineState.ctx = null
    engineState.running = false
    engineState.loadOk = false
    render(<CbatAct />)
    fireEvent.click(startBtn())
    await finishLoad()
    await waitFor(() => expect(screen.getByText(/your callsign for this round/i)).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
