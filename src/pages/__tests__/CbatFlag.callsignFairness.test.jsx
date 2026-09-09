import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatFlag from '../CbatFlag'

// FLAG's one absolute rule: if the aircraft carrying callsign XX is on screen
// right now, the answer is YES — whether or not its label happens to be showing
// at that instant. The player can only obey that rule for callsigns they have
// actually been shown, so the game must never ask about one it hasn't shown.
// A contact used to be counted as on screen from the moment it entered, while
// its label stayed hidden for up to 14s, which made those questions unanswerable
// and cost 15 points each. These tests are that regression.

const mockUseAuth        = vi.hoisted(() => vi.fn())
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

const yesButton = () => screen.getByRole('button', { name: 'YES' })

// The prompt renders as NO · callsign · YES, so the middle is the subject.
function liveQuestion() {
  const yes = yesButton()
  if (yes.disabled) return null
  const m = yes.parentElement.textContent.match(/^NO(.*)YES$/)
  const sym = m?.[1]
  return sym && sym !== '—' ? sym : null
}

describe('CbatFlag — a callsign is only asked about once it has been shown', () => {
  beforeEach(() => { vi.clearAllMocks(); field.current = null })
  afterEach(() => { vi.useRealTimers() })

  // Walks a whole run. `script` fires field events at given seconds; the player
  // answers every prompt the way the rule allows — YES only for a callsign they
  // have been shown and believe is still up. Returns every callsign asked about.
  async function playRun(script) {
    const shown = new Set()
    const onScreen = new Set()
    const asked = []
    let answered = null

    const spawn = (s) => { field.current.onAircraftSpawn(s); onScreen.add(s) }
    const show  = (s) => { field.current.onAircraftSeen(s);  shown.add(s) }
    const leave = (s) => { field.current.onAircraftDespawn(s); onScreen.delete(s) }

    for (let t = 1; t <= 58; t++) {
      await act(async () => {
        script[t]?.({ spawn, show, leave })
        vi.advanceTimersByTime(1000)
      })

      const sym = liveQuestion()
      if (!sym) { answered = null; continue }
      if (sym === answered) continue
      answered = sym
      asked.push(sym)
      const believesOnScreen = shown.has(sym) && onScreen.has(sym)
      fireEvent.click(screen.getByRole('button', { name: believesOnScreen ? 'YES' : 'NO' }))
    }
    return { asked, shown, onScreen }
  }

  function aircraftTally() {
    const card = screen.getByText('Aircraft').parentElement
    const m = card.textContent.match(/(\d+)✓ (\d+)✗/)
    return { correct: Number(m[1]), wrong: Number(m[2]) }
  }

  // F0 is the only callsign that can fly and it never flashes its label, so
  // nothing is ever added to the shown pool and every question has to come from
  // the decoys. Before the fix the fallback pool was "field callsigns not yet
  // shown", which was exactly F0 — a contact sitting on screen, unreadable,
  // graded YES. Both of these fail against that.
  const TRAP = { 1: ({ spawn }) => spawn('F0') }

  it('never asks about a contact that is on screen but has never shown its callsign', async () => {
    pools.field = ['F0']
    pools.decoys = ['D0']
    await renderAndStart()

    const { asked } = await playRun(TRAP)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked).not.toContain('F0')
    for (const sym of asked) expect(sym).toBe('D0')
  })

  it('costs a player who follows the rule exactly nothing', async () => {
    pools.field = ['F0']
    pools.decoys = ['D0']
    await renderAndStart()

    await playRun(TRAP)
    await act(async () => { vi.advanceTimersByTime(5000) })

    const { correct, wrong } = aircraftTally()
    expect(correct).toBeGreaterThan(0)
    expect(wrong).toBe(0)
  })

  // Rule lock rather than a regression: grading stays live, so a shown callsign
  // is YES while its aircraft is up and NO once it has gone, whether or not the
  // label happens to be on at that instant.
  it('still asks about a shown callsign that is up, and grades it live', async () => {
    pools.field = ['F1']
    pools.decoys = ['D0']
    await renderAndStart()

    const { asked } = await playRun({
      2:  ({ spawn, show }) => { spawn('F1'); show('F1') },
      30: ({ leave }) => leave('F1'),
    })
    await act(async () => { vi.advanceTimersByTime(5000) })

    expect(asked).toContain('F1')
    expect(aircraftTally().wrong).toBe(0)
  })
})
