import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatInstruments from '../CbatInstruments'
import { DRILL_SECONDS } from '../../utils/cbat/instrumentsDrill'

// The Practise drill: the third pill in the Instruments mode row, ranked on
// its own board (ANT Practise's arrangement), launched by the same Start button. The 3D view is stubbed
// (jsdom has no WebGL); the stub hands its frame callback out so a test can
// fly the drill a frame at a time, the way the real canvas does.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSubmit = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))
const sceneProps = vi.hoisted(() => ({ current: null }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useSearchParams: () => [new URLSearchParams('')],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
const mockSettings = vi.hoisted(() => ({ current: {} }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: mockSettings.current }) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({
  default: ({ confirmNeeded }) => <span data-testid="quit" data-confirm={String(!!confirmNeeded)} />,
}))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey, score }) => (
    <div data-testid="game-over" data-game-key={gameKey} data-score={score}>{children}</div>
  ),
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmit }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../components/cbat/OrientationAircraft3D', () => ({ default: () => null }))
vi.mock('../../components/cbat/InstrumentsDrillScene', () => ({
  default: (props) => { sceneProps.current = props; return <div data-testid="drill-scene" /> },
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => (
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>
    ),
    p: ({ children, className }) => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

let apiFetch
function renderPage(props = {}) {
  apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
  return render(<CbatInstruments {...props} />)
}

const practisePill = container => container.querySelector('[data-mode="practise"]')

async function openAndStart(container) {
  fireEvent.click(practisePill(container))
  fireEvent.click(container.querySelector('[data-demo-start]'))
  await screen.findByTestId('drill-scene')
}

function flySeconds(seconds, dt = 1 / 60) {
  const frames = Math.round(seconds / dt)
  for (let i = 0; i < frames; i++) {
    act(() => { sceneProps.current.onFrame(dt) })
  }
}

describe('Instruments Practice Drill', () => {
  beforeEach(() => {
    sceneProps.current = null
    mockSettings.current = {}
    mockSubmit.mockClear()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('sits in the mode row as Practise with a Drill badge, like ANT', () => {
    const { container } = renderPage()
    const pill = practisePill(container)
    expect(pill).toBeTruthy()
    expect(pill.textContent).toContain('Practise')
    expect(pill.textContent).toContain('Drill')
    // Row order: the two boards, then the drill.
    const order = [...container.querySelectorAll('[data-mode]')].map(el => el.getAttribute('data-mode'))
    expect(order).toEqual(['reading', 'orientation', 'practise'])
  })

  it('points the leaderboard link at its own board, like ANT Practise', () => {
    const { container } = renderPage()
    fireEvent.click(practisePill(container))
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe('/cbat/instruments-practise/leaderboard')
  })

  it('hangs the joystick and throttle panels beside the card on Practise only', () => {
    const { container } = renderPage()
    expect(container.querySelector('[data-throttle-mode]')).toBeNull()
    fireEvent.click(practisePill(container))
    expect(container.querySelector('[data-throttle-mode]').getAttribute('data-throttle-mode')).toBe('lever')
  })

  it('offers the aircraft picker on the Practise card, with the Typhoon', () => {
    const { container } = renderPage()
    expect(screen.queryByText(/your craft/i)).toBeNull()
    fireEvent.click(practisePill(container))
    expect(screen.getByText(/your craft/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /typhoon/i })).toBeTruthy()
  })

  it('flies with the SkyWatch overlay: score, timer and a bullseye hint', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    const hud = screen.getByTestId('sky-hud')
    expect(hud.textContent).toMatch(/score/i)
    expect(hud.textContent).toMatch(/bullseye/i)
  })

  describe('on a phone', () => {
    let width
    beforeEach(() => { width = window.innerWidth; window.innerWidth = 390 })
    afterEach(() => { window.innerWidth = width })

    it('flies from a pad under the dials that prompts until first touched, with the throttle beside it', async () => {
      const { container } = renderPage()
      await openAndStart(container)
      const pad = screen.getByTestId('drill-pad')
      // Below the dials, not on the view.
      expect(screen.getByTestId('drill-dials').compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getByTestId('drill-view').contains(pad)).toBe(false)
      expect(screen.getByTestId('drill-pad-prompt').textContent).toMatch(/use this pad to fly/i)
      expect(pad.parentElement.querySelector('[aria-label="More throttle"]')).toBeTruthy()
      expect(screen.getByTestId('drill-view').querySelector('[aria-label="More throttle"]')).toBeNull()

      fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 50 })
      expect(screen.queryByTestId('drill-pad-prompt')).toBeNull()
    })
  })

  it('has no pad on a desktop, where the mouse drags on the view', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    expect(screen.queryByTestId('drill-pad')).toBeNull()
    expect(screen.getByTestId('drill-view').querySelector('[aria-label="More throttle"]')).toBeTruthy()
  })

  it('drops out of the row when an admin switches its board off', () => {
    mockSettings.current = { cbatGameEnabled: { 'instruments-practise': false } }
    const { container } = renderPage()
    expect(practisePill(container)).toBeNull()
  })

  it('opens from Start and posts nothing mid-flight', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    expect(screen.getByTestId('drill-dials')).toBeTruthy()
    flySeconds(1)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('is not offered on the landing page demo', () => {
    const { container } = renderPage({ forcedMode: 'reading' })
    expect(practisePill(container)).toBeNull()
  })

  it('greys out every dial but one when a challenge starts, and shows its target', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    flySeconds(4.2)
    const dials = screen.getByTestId('drill-dials')
    const targets = dials.querySelectorAll('[data-target]')
    expect(targets.length).toBe(1)
    const dimmed = [...dials.children].filter(el => el.className.includes('grayscale'))
    expect(dimmed.length).toBe(5)
    expect(screen.getByText(/^Match the .* dial$/)).toBeTruthy()
  })

  it('files the minute under instruments-practise and ends on the game-over screen', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    flySeconds(DRILL_SECONDS + 0.5, 0.1)
    const over = await screen.findByTestId('game-over')
    expect(over.getAttribute('data-game-key')).toBe('instruments-practise')
    expect(screen.getByTestId('drill-results')).toBeTruthy()

    expect(mockSubmit).toHaveBeenCalledTimes(1)
    const [key, body] = mockSubmit.mock.calls[0]
    expect(key).toBe('instruments-practise')
    expect(body).toMatchObject({ totalTime: DRILL_SECONDS })
    expect(typeof body.totalScore).toBe('number')
    expect(Number(over.getAttribute('data-score'))).toBe(body.totalScore)
  })

  // The drill's results live inside the page's 'drill' phase, and the quit
  // prompt used to cover the whole phase: backing out after the minute asked
  // "Quit this game?" over a game that was already over and saved.
  it('asks before quitting mid-flight but not from the results', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    expect(screen.getByTestId('quit').getAttribute('data-confirm')).toBe('true')
    flySeconds(DRILL_SECONDS + 0.5, 0.1)
    await screen.findByTestId('game-over')
    expect(screen.getByTestId('quit').getAttribute('data-confirm')).toBe('false')
  })

  // The results used to sit flush left: CbatGameOver is a max-w-md column that
  // relies on its parent to centre it, and the page kept the wide flying stage
  // on for the results screen.
  it('centres the results and drops the wide stage once the minute is up', async () => {
    const { container } = renderPage()
    await openAndStart(container)
    expect(document.body.classList.contains('cbat-stage-wide')).toBe(true)
    flySeconds(DRILL_SECONDS + 0.5, 0.1)
    const over = await screen.findByTestId('game-over')
    expect(over.parentElement.className).toContain('items-center')
    expect(document.body.classList.contains('cbat-stage-wide')).toBe(false)
  })
})
