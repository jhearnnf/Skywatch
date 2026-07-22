import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatFlag from '../CbatFlag'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth        = vi.hoisted(() => vi.fn())
const mockUseAppSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext',        () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseAppSettings }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../lib/offlineRoster', () => ({
  getAircraftRoster: vi.fn(() => Promise.resolve({ data: [{ briefId: 'b1', title: 'F-35' }] })),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../data/aircraftModels', () => ({
  getModelUrl: vi.fn(() => '/models/test.glb'),
  has3DModel: vi.fn(() => true),
}))

// PlayField is a WebGL component — stub it so the targets step can be driven
// with a simulated strike event.
vi.mock('../CbatFlag/PlayField', () => ({
  default: ({ onScoreEvent }) => (
    <div data-testid="play-field">
      <button onClick={() => onScoreEvent?.({ type: 'targetHit' })}>sim-hit</button>
    </div>
  ),
}))

vi.mock('@react-three/drei', () => ({
  useGLTF: Object.assign(vi.fn(() => ({ scene: {} })), { preload: vi.fn() }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, disabled }) =>
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
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
  mockUseAppSettings.mockReturnValue({ settings: { cbatFlagAircraftBriefIds: ['b1'] } })
}

async function openTutorial() {
  render(<CbatFlag />)
  fireEvent.click(await screen.findByRole('button', { name: /^tutorial$/i }))
}

// The mocked PlayField never spawns aircraft, so nothing is "on screen" — every
// prompt's correct answer is therefore NO. Answer NO the required number of times.
async function clearAircraftStep() {
  const answerNo = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: 'NO' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'NO' }))
  }
  await answerNo()
  await answerNo()
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatFlag — tutorial / practice mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens on the targets step with the other controls greyed out', async () => {
    setupUser()
    await openTutorial()

    expect(screen.getByText(/practice mode/i)).toBeTruthy()
    expect(screen.getByText(/strike the targets/i)).toBeTruthy()
    expect(screen.getByTestId('play-field')).toBeTruthy()

    // Numpad + aircraft Y/N controls are greyed while step 1 teaches the targets.
    const dimmed = document.querySelectorAll('.cbat-tutorial-dim')
    expect(dimmed.length).toBeGreaterThanOrEqual(2)
  })

  it('pages between sections with the arrows', async () => {
    setupUser()
    await openTutorial()

    expect(screen.getByRole('button', { name: /previous section/i }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/monitor the aircraft/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next section/i }))
    expect(screen.getByText(/solve the maths/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /previous section/i }))
    expect(screen.getByText(/monitor the aircraft/i)).toBeTruthy()
  })

  it('advances off the targets step after four strikes', async () => {
    setupUser()
    await openTutorial()

    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'sim-hit' }))
    }

    await waitFor(() => expect(screen.getByText(/monitor the aircraft/i)).toBeTruthy())
  })

  it('keeps the aircraft step on a wrong YES/NO answer', async () => {
    setupUser()
    await openTutorial()
    fireEvent.click(screen.getByRole('button', { name: /next section/i })) // → aircraft

    // Nothing is on screen (mocked field), so YES is wrong — the step stays put.
    await waitFor(() => expect(screen.getByRole('button', { name: 'YES' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'YES' }))
    expect(screen.getByText(/not quite/i)).toBeTruthy()
    expect(screen.getByText(/monitor the aircraft/i)).toBeTruthy()
  })

  it('advances off the aircraft step once both prompts are answered', async () => {
    setupUser()
    await openTutorial()
    fireEvent.click(screen.getByRole('button', { name: /next section/i })) // → aircraft

    await clearAircraftStep()
    await waitFor(() => expect(screen.getByText(/solve the maths/i)).toBeTruthy())
  })

  it('completes the tutorial after solving the maths question', async () => {
    setupUser()
    await openTutorial()
    fireEvent.click(screen.getByRole('button', { name: /next section/i })) // → aircraft
    fireEvent.click(screen.getByRole('button', { name: /next section/i })) // → maths
    expect(screen.getByText(/solve the maths/i)).toBeTruthy()

    // 12 + 7 = 19
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '9' }))

    await waitFor(() => expect(screen.getByText(/tutorial complete/i)).toBeTruthy())
  })

  it('Exit practice returns to the intro', async () => {
    setupUser()
    await openTutorial()
    fireEvent.click(screen.getByRole('button', { name: /exit practice/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy())
  })
})
