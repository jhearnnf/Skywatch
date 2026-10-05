import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatSat from '../CbatSat'
import { press, START_SELECTOR } from '../../components/landingGames/demoDriver'

// The SkyWatch theme's game feel (radar sweep, pips, streak, stars) must show
// there and never under the Real CBAT theme, which stays as plain as the real
// test software.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../utils/cbat/satSpeech', () => ({
  speak: vi.fn(), stopSpeech: vi.fn(), primeSpeech: vi.fn(),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage(uiTheme) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', uiTheme },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatSat />)
}

function startHard(container) {
  act(() => { press(container.querySelector('[data-difficulty="hard"]')) })
  act(() => { press(container.querySelector(START_SELECTOR)) })
  act(() => { vi.advanceTimersByTime(1100) })
}

describe('SAT — SkyWatch theme game feel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('sweeps the grid and shows the facts as pips', () => {
    const { container } = renderPage()
    startHard(container)
    expect(container.querySelector('.sat-radar-sweep')).toBeTruthy()
    expect(container.querySelectorAll('.sat-pip').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.sat-pip-current')).toHaveLength(1)
  })

  it('tracks the streak and marks each answered question\'s pip', () => {
    const { container } = renderPage()
    startHard(container)
    act(() => { vi.advanceTimersByTime(90_000) }) // observe window

    expect(container.querySelector('[data-sat-streak]').getAttribute('data-sat-streak')).toBe('0')
    expect(container.querySelectorAll('.sat-pip')).toHaveLength(18)

    let expected = 0
    for (let q = 0; q < 4; q++) {
      const option = container.querySelector('.grid button')
      act(() => { press(option) })
      const right = !!screen.queryByText('✓ Correct')
      expected = right ? expected + 1 : 0
      expect(container.querySelector('[data-sat-streak]').getAttribute('data-sat-streak')).toBe(String(expected))
      act(() => { press(screen.getByRole('button', { name: /^Next/ })) })
    }
    const marked = container.querySelectorAll('.sat-pip-correct, .sat-pip-wrong').length
    expect(marked).toBe(4)
  })

  it('awards no stars to a run that answered nothing', () => {
    const { container } = renderPage()
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })
    for (let s = 0; s < 2; s++) {
      act(() => { vi.advanceTimersByTime(90_000) })
      for (let q = 0; q < 5; q++) {
        act(() => { vi.advanceTimersByTime(22_500) })
        act(() => { press(screen.getByRole('button', { name: /Next|See Results/ })) })
      }
    }
    expect(container.querySelector('[data-sat-stars]').getAttribute('data-sat-stars')).toBe('0')
    expect(screen.getByText('best streak')).toBeTruthy()
    // Every Easier run asks about contacts; the breakdown lists what was asked.
    expect(container.querySelector('[data-sat-skill="unit"]')).toBeTruthy()
  })

  // The instructions page is deliberately left as it is on every other game:
  // the game feel starts at Start, never before.
  it('keeps the instructions page plain', () => {
    const { container } = renderPage()
    const gamey = [...container.querySelectorAll('*')].filter(el => [...el.classList].some(c => c.startsWith('sat-')))
    expect(gamey).toHaveLength(0)
  })

  it('announces each situation', () => {
    const { container } = renderPage()
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(screen.getByText('Situation 1 of 2')).toBeTruthy()
    expect(container.querySelector('.sat-hud')).toBeTruthy()
  })
})

describe('SAT — Real CBAT theme stays plain', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('has no sweep, pips, streak or icons', () => {
    const { container } = renderPage('cbat')
    startHard(container)
    expect(screen.queryByText(/Situation 1 of/)).toBeNull()
    expect(container.querySelector('.sat-hud')).toBeNull()
    expect(container.querySelector('.sat-radar-sweep')).toBeNull()
    expect(container.querySelector('.sat-pip')).toBeNull()
    act(() => { vi.advanceTimersByTime(90_000) })
    expect(container.querySelector('[data-sat-streak]')).toBeNull()
  })
})
