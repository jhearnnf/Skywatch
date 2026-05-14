import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatInstruments from '../CbatInstruments'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../utils/cbat/recordStart', () => ({ recordCbatStart: vi.fn() }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, disabled }) =>
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
    p:      ({ children, className }) => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// Stub InstrumentPanel so we can fire the toggle callback directly without
// the SVG / rAF dance. Exposes one button per dial key.
vi.mock('../../components/cbat/InstrumentPanel', () => ({
  default: ({ highlightedKey, onToggleHighlight }) => (
    <div data-testid="instrument-panel" data-highlighted={highlightedKey || ''}>
      {['altitude', 'attitude', 'airspeed', 'heading', 'vs', 'turn'].map(k => (
        <button
          key={k}
          data-testid={`dial-${k}`}
          aria-pressed={highlightedKey === k}
          disabled={!onToggleHighlight}
          onClick={() => onToggleHighlight?.(k)}
        >{k}</button>
      ))}
    </div>
  ),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Calibration is 1000–3000ms; wait for the playing-phase signal — the panel's
// onToggleHighlight prop, which is undefined during calibration.
async function startAndWaitForPlaying() {
  render(<CbatInstruments />)
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  await waitFor(
    () => {
      const btn = screen.getByTestId('dial-altitude')
      expect(btn.disabled).toBe(false)
    },
    { timeout: 4000 },
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CbatInstruments — dial-press answer highlighting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupUser()
  })

  it('renders no highlight marks before any dial is pressed', async () => {
    await startAndWaitForPlaying()
    expect(document.querySelectorAll('mark').length).toBe(0)
  }, 10000)

  it('highlights the matching phrase in every answer when a dial is pressed', async () => {
    await startAndWaitForPlaying()
    fireEvent.click(screen.getByTestId('dial-altitude'))

    const marks = document.querySelectorAll('mark')
    expect(marks.length).toBe(5)
    marks.forEach(m => expect(m.textContent).toMatch(/\d+\s+feet/))
    expect(screen.getByTestId('instrument-panel').getAttribute('data-highlighted')).toBe('altitude')
  }, 10000)

  it('toggles the highlight off when the same dial is pressed again', async () => {
    await startAndWaitForPlaying()
    fireEvent.click(screen.getByTestId('dial-airspeed'))
    expect(document.querySelectorAll('mark').length).toBe(5)

    fireEvent.click(screen.getByTestId('dial-airspeed'))
    expect(document.querySelectorAll('mark').length).toBe(0)
  }, 10000)

  it('switches the highlight when a different dial is pressed', async () => {
    await startAndWaitForPlaying()

    fireEvent.click(screen.getByTestId('dial-heading'))
    document.querySelectorAll('mark').forEach(m =>
      expect(m.textContent).toMatch(/heading [NESW]/))

    fireEvent.click(screen.getByTestId('dial-airspeed'))
    document.querySelectorAll('mark').forEach(m =>
      expect(m.textContent).toMatch(/\d+\s+kt/))
  }, 10000)

  it('attitude dial highlights both the vs phrase and the turn phrase', async () => {
    await startAndWaitForPlaying()
    fireEvent.click(screen.getByTestId('dial-attitude'))

    const marks = document.querySelectorAll('mark')
    // Two marks per answer (vs + turn), 5 answers = 10 marks total
    expect(marks.length).toBe(10)
    const texts = Array.from(marks).map(m => m.textContent)
    // Each answer should contribute one vs phrase and one turn phrase
    const vsPhrases = /(climbing|descending|maintaining height)/
    const turnPhrases = /(Standard turn|Non-standard turn|maintaining direction)/
    expect(texts.filter(t => vsPhrases.test(t)).length).toBe(5)
    expect(texts.filter(t => turnPhrases.test(t)).length).toBe(5)
  }, 10000)

  it('shows the hint until the first dial press, then hides it persistently', async () => {
    await startAndWaitForPlaying()

    expect(screen.queryByText(/tap an instrument/i)).not.toBeNull()
    fireEvent.click(screen.getByTestId('dial-turn'))
    expect(screen.queryByText(/tap an instrument/i)).toBeNull()
    expect(localStorage.getItem('cbat.instruments.highlightHint')).toBe('1')
  }, 10000)
})
