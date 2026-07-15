import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatFlag from '../CbatFlag'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseAuth        = vi.hoisted(() => vi.fn())
const mockUseAppSettings = vi.hoisted(() => vi.fn())
const mockHas3DModel     = vi.hoisted(() => vi.fn(() => true))
const mockGetModelUrl    = vi.hoisted(() => vi.fn(() => '/models/test.glb'))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext',       () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext',() => ({ useAppSettings: mockUseAppSettings }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../data/aircraftModels', () => ({
  getModelUrl:  mockGetModelUrl,
  has3DModel:   mockHas3DModel,
}))
vi.mock('../../utils/cbat/recordStart', () => ({
  recordCbatStart: vi.fn(),
}))

// PlayField is a WebGL component — stub it to avoid canvas/Three.js setup
vi.mock('../CbatFlag/PlayField', () => ({
  default: ({ onScoreEvent }) => (
    <div data-testid="play-field">
      <button onClick={() => onScoreEvent?.({ type: 'targetHit' })}>sim-hit</button>
      <button onClick={() => onScoreEvent?.({ type: 'targetMiss' })}>sim-miss</button>
    </div>
  ),
}))

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_AIRCRAFT = [{ briefId: 'b1', title: 'F-35', cutoutUrl: 'http://example.com/f35.png' }]
const BRIEF_ID = 'b1'

function mockApiFetch(personalBestData = null) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/aircraft-cutouts'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_AIRCRAFT }) })
    if (url.includes('/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: personalBestData }) })
    if (url.includes('/start'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) })
    if (url.includes('/result'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupUser(apiFetch = mockApiFetch()) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com' },
    API: '',
    apiFetch,
  })
  mockUseAppSettings.mockReturnValue({
    settings: { cbatFlagAircraftBriefIds: [BRIEF_ID] },
  })
  return apiFetch
}

function setupGuest() {
  mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: vi.fn() })
  mockUseAppSettings.mockReturnValue({ settings: {} })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderAndStart() {
  const apiFetch = setupUser()
  render(<CbatFlag />)
  await waitFor(() => {
    const btn = screen.queryByRole('button', { name: /^start$/i })
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  return { apiFetch }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CbatFlag — guest gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows sign-in prompt and no start button when not logged in', () => {
    setupGuest()
    render(<CbatFlag />)
    expect(screen.getByText('Sign in to play')).toBeDefined()
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
  })

  it('sign-in link points to /login', () => {
    setupGuest()
    render(<CbatFlag />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link.getAttribute('href')).toBe('/login')
  })
})

describe('CbatFlag — intro screen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('start button is disabled when aircraft list is empty', async () => {
    mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: vi.fn().mockImplementation((url) => {
      if (url.includes('/aircraft-cutouts'))
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    }) })
    mockUseAppSettings.mockReturnValue({ settings: { cbatFlagAircraftBriefIds: [] } })

    render(<CbatFlag />)
    await act(async () => { await Promise.resolve() })
    const btn = screen.queryByRole('button', { name: /no aircraft/i })
    if (btn) {
      expect(btn.disabled).toBe(true)
    } else {
      // Button text may vary — just ensure start is disabled
      const startBtn = screen.queryByRole('button', { name: /start/i })
      expect(startBtn?.disabled).toBe(true)
    }
  })

  it('renders intro with title and leaderboard link', async () => {
    setupUser()
    render(<CbatFlag />)
    // "FLAG" appears in both breadcrumb h1 and intro card — use getAllByText
    expect(screen.getAllByText('FLAG').length).toBeGreaterThanOrEqual(1)
    await waitFor(() => {
      const link = screen.queryByRole('link', { name: /view leaderboard/i })
      expect(link).not.toBeNull()
      expect(link.getAttribute('href')).toBe('/cbat/flag/leaderboard')
    })
  })

  it('shows personal best when API returns one', async () => {
    setupUser(mockApiFetch({ bestScore: 350, attempts: 5 }))
    render(<CbatFlag />)
    await waitFor(() => expect(screen.getByText(/Personal Best/i)).toBeDefined())
    expect(screen.getByText('350')).toBeDefined()
  })
})

describe('CbatFlag — numpad', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders numpad inside play phase', async () => {
    await renderAndStart()
    expect(screen.getByTestId('play-field')).toBeDefined()
    // Numpad digits should be visible
    expect(screen.getByRole('button', { name: '5' })).toBeDefined()
  })

  it('does not render a DELETE button', async () => {
    await renderAndStart()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})

describe('CbatFlag — math grading via mathBank', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generateMath easy produces integer answer >= 0', async () => {
    const { generateMath } = await import('../CbatFlag/mathBank.js')
    for (let i = 0; i < 20; i++) {
      const q = generateMath('easy')
      expect(typeof q.answer).toBe('number')
      expect(Number.isInteger(q.answer)).toBe(true)
      expect(q.answer).toBeGreaterThanOrEqual(0)
      expect(q.expectedDigits).toBe(String(q.answer).length)
    }
  })

  it('generateMath medium produces integer answer', async () => {
    const { generateMath } = await import('../CbatFlag/mathBank.js')
    for (let i = 0; i < 20; i++) {
      const q = generateMath('medium')
      expect(Number.isInteger(q.answer)).toBe(true)
      expect(q.answer).toBeGreaterThanOrEqual(0)
    }
  })

  it('generateMath hard produces integer answer with correct expectedDigits', async () => {
    const { generateMath } = await import('../CbatFlag/mathBank.js')
    for (let i = 0; i < 20; i++) {
      const q = generateMath('hard')
      expect(Number.isInteger(q.answer)).toBe(true)
      expect(q.expectedDigits).toBe(String(q.answer).length)
    }
  })
})

describe('CbatFlag — symbols utility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generateUniqueSymbols returns N unique 2-letter strings', async () => {
    const { generateUniqueSymbols } = await import('../CbatFlag/symbols.js')
    const syms = generateUniqueSymbols(20)
    expect(syms.length).toBe(20)
    const unique = new Set(syms)
    expect(unique.size).toBe(20)
    for (const s of syms) {
      expect(s.length).toBe(2)
      expect(/^[A-Z]{2}$/.test(s)).toBe(true)
    }
  })

  it('generateUniqueSymbols respects exclude set', async () => {
    const { generateUniqueSymbols } = await import('../CbatFlag/symbols.js')
    const exclude = new Set(['AB', 'CD', 'EF'])
    const syms = generateUniqueSymbols(10, exclude)
    for (const s of syms) {
      expect(exclude.has(s)).toBe(false)
    }
  })
})

describe('CbatFlag — score submission', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it('POSTs to /cbat/flag/result with totalScore on game end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const apiFetch = setupUser()
    render(<CbatFlag />)

    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /^start$/i })
      expect(btn).not.toBeNull()
      expect(btn?.disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

    // Advance past the full game duration
    await act(async () => { vi.advanceTimersByTime(62_000) })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    await waitFor(() => {
      const resultCalls = apiFetch.mock.calls.filter(([url]) => url.includes('/cbat/flag/result'))
      expect(resultCalls.length).toBeGreaterThanOrEqual(1)
      const body = JSON.parse(resultCalls[0][1].body)
      expect('totalScore' in body).toBe(true)
      expect('grade' in body).toBe(true)
      expect(typeof body.totalScore).toBe('number')
    })
  })
})

describe('CbatFlag — aircraft Y/N', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AircraftQuestion renders NO and YES buttons', async () => {
    const { default: AircraftQuestion } = await import('../CbatFlag/AircraftQuestion.jsx')
    const onAnswer = vi.fn()
    render(<AircraftQuestion symbol="BF" onAnswer={onAnswer} disabled={false} />)
    expect(screen.getByRole('button', { name: 'NO' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'YES' })).toBeDefined()
    expect(screen.getByText('BF')).toBeDefined()
  })

  it('AircraftQuestion buttons are disabled when disabled=true', async () => {
    const { default: AircraftQuestion } = await import('../CbatFlag/AircraftQuestion.jsx')
    render(<AircraftQuestion symbol="BF" onAnswer={vi.fn()} disabled={true} />)
    expect(screen.getByRole('button', { name: 'NO' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'YES' }).disabled).toBe(true)
  })

  it('AircraftQuestion shows placeholder when no symbol', async () => {
    const { default: AircraftQuestion } = await import('../CbatFlag/AircraftQuestion.jsx')
    render(<AircraftQuestion symbol={null} onAnswer={vi.fn()} disabled={true} />)
    expect(screen.getByText('—')).toBeDefined()
  })

  it('clicking YES calls onAnswer with "yes"', async () => {
    const { default: AircraftQuestion } = await import('../CbatFlag/AircraftQuestion.jsx')
    const onAnswer = vi.fn()
    render(<AircraftQuestion symbol="TQ" onAnswer={onAnswer} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'YES' }))
    expect(onAnswer).toHaveBeenCalledWith('yes')
  })

  it('clicking NO calls onAnswer with "no"', async () => {
    const { default: AircraftQuestion } = await import('../CbatFlag/AircraftQuestion.jsx')
    const onAnswer = vi.fn()
    render(<AircraftQuestion symbol="TQ" onAnswer={onAnswer} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'NO' }))
    expect(onAnswer).toHaveBeenCalledWith('no')
  })
})

describe('CbatFlag — Numpad unit tests', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders 10 digit buttons and no DELETE button', async () => {
    const { default: Numpad } = await import('../CbatFlag/Numpad.jsx')
    render(
      <Numpad
        question={{ question: '3 + 4', answer: 7, expectedDigits: 1 }}
        entered=""
        onDigit={vi.fn()}
        disabled={false}
      />
    )
    // 0-9
    for (const d of '0123456789') {
      expect(screen.getByRole('button', { name: d })).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('digit buttons are disabled when disabled=true', async () => {
    const { default: Numpad } = await import('../CbatFlag/Numpad.jsx')
    render(
      <Numpad question={null} entered="" onDigit={vi.fn()} disabled={true} />
    )
    expect(screen.getByRole('button', { name: '7' }).disabled).toBe(true)
  })
})
