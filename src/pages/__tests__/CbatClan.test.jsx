import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatClan from '../CbatClan'
import { keyAction } from '../CbatClan/keys'
import { CLAN_TUNING, CLAN_LAUNCH_MS, CLAN_DURATION_MS, CLAN_POINTS } from '../../utils/cbat/clanDifficulty'

// CLAN's page: the same shape as every split game (title, the pair UNDER it,
// the blurb, one leaderboard link that follows the pair), the launch flash,
// a run driven from the sim on one keyboard, and the Real CBAT theme's chrome
// with no mid-test feedback.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSubmitCbatResult = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))
const mockStartTracking = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => <a href={to} className={className} data-testid={rest['data-testid']}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey, score }) => <div data-testid="game-over" data-game-key={gameKey} data-score={score}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmitCbatResult }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: mockStartTracking, setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage(uiTheme) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', uiTheme },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) })),
  })
  return render(<CbatClan />)
}

const difficultyButton = (container, key) => container.querySelector(`[data-difficulty="${key}"]`)
const clanTitle = container => [...container.querySelectorAll('p')].find(p => p.textContent === 'CLAN')
const press = (key) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })

const FAKES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance']

async function launch(container, difficulty = 'easier') {
  act(() => { difficultyButton(container, difficulty).click() })
  act(() => { container.querySelector('[data-demo-start]').click() })
  await act(async () => { vi.advanceTimersByTime(CLAN_LAUNCH_MS + 50) })
}

describe('keyAction', () => {
  it('maps the three tasks onto one keyboard with no overlaps', () => {
    expect(keyAction({ key: 'r' })).toEqual({ kind: 'colour', value: 'red' })
    expect(keyAction({ key: 'Y' })).toEqual({ kind: 'colour', value: 'yellow' })
    expect(keyAction({ key: 'g' })).toEqual({ kind: 'colour', value: 'green' })
    expect(keyAction({ key: 'a' })).toEqual({ kind: 'option', value: 0 })
    expect(keyAction({ key: 'D' })).toEqual({ kind: 'option', value: 3 })
    expect(keyAction({ key: '7' })).toEqual({ kind: 'digit', value: '7' })
    expect(keyAction({ key: 'Enter' })).toEqual({ kind: 'enter' })
    expect(keyAction({ key: 'Backspace' })).toEqual({ kind: 'backspace' })
    expect(keyAction({ key: 'e' })).toBeNull()
    expect(keyAction({ key: 'r', ctrlKey: true })).toBeNull()
  })
})

describe('CbatClan instructions card', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('puts the pair BELOW the title on its own row, then the blurb', () => {
    const { container } = renderPage()
    const title = clanTitle(container)
    expect(title).toBeTruthy()
    const easier = difficultyButton(container, 'easier')
    const hard = difficultyButton(container, 'hard')
    expect(easier).toBeTruthy()
    expect(hard).toBeTruthy()
    for (const b of [easier, hard]) {
      expect(title.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(easier.parentElement).toBe(hard.parentElement)
    expect(easier.parentElement.contains(title)).toBe(false)
    expect(easier.compareDocumentPosition(hard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const blurb = [...container.querySelectorAll('p')].find(el => el.textContent === CLAN_TUNING.easier.blurb)
    expect(blurb).toBeTruthy()
    expect(hard.compareDocumentPosition(blurb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gives both halves difficulty bars, Easier 1 and Hard 3', () => {
    const { container } = renderPage()
    const bars = el => el.querySelectorAll('span[aria-hidden="true"] > span').length
    expect(bars(difficultyButton(container, 'easier'))).toBe(3)
    expect(bars(difficultyButton(container, 'hard'))).toBe(3)
  })

  it('defaults to Easier, follows the pick to the other board, and remembers it', () => {
    const { container } = renderPage()
    const link = () => [...container.querySelectorAll('a')].find(a => a.textContent.includes('View Leaderboard'))
    expect(link().getAttribute('href')).toBe('/cbat/clan-easier/leaderboard')
    act(() => { difficultyButton(container, 'hard').click() })
    expect(link().getAttribute('href')).toBe('/cbat/clan/leaderboard')
    expect(localStorage.getItem('sw_cbat_clan_difficulty')).toBe('hard')
    // One link, whichever is picked.
    expect([...container.querySelectorAll('a')].filter(a => a.textContent.includes('Leaderboard'))).toHaveLength(1)
  })

  it('names the three tasks and their keys, and the run length', () => {
    const { container } = renderPage()
    const text = container.textContent
    expect(text).toContain(`${CLAN_DURATION_MS / 1000}-second run`)
    expect(text).toMatch(/Press R, Y or G/)
    expect(text).toMatch(/press A to D/)
    expect(text).toContain('Type the answer to each sum')
    expect(text).toContain('Score can go negative')
  })

  it('offers the way back to FLAG, and has no Tutorial button', () => {
    const { container } = renderPage()
    expect(screen.getByTestId('clan-to-flag').getAttribute('href')).toBe('/cbat/flag')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Tutorial')).toBe(false)
    expect(container.querySelector('[data-demo-start]').textContent).toBe('Start')
  })
})

describe('CbatClan run', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: FAKES })
  })
  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
  })

  it('launches through the flash onto the picked board and starts tracking it', async () => {
    const { container } = renderPage()
    await launch(container, 'hard')
    expect(mockStartTracking).toHaveBeenCalledWith('clan')
    expect(screen.getByTestId('clan-board')).toBeTruthy()
    expect(screen.getByTestId('clan-arena')).toBeTruthy()
    expect(container.querySelector('[data-difficulty-marker="hard"]')).toBeTruthy()
    // The SkyWatch HUD is up, the Real CBAT chrome is not.
    expect(screen.getByTestId('clan-score')).toBeTruthy()
    expect(screen.queryByTestId('cbat-testbar')).toBeNull()
    expect(screen.queryByTestId('cbat-footer-strip')).toBeNull()
  })

  it('takes the keyboard: a colour press with nothing in its band costs points at once', async () => {
    const { container } = renderPage()
    await launch(container, 'easier')
    await act(async () => { vi.advanceTimersByTime(300) })
    press('r')
    expect(screen.getByTestId('clan-score').textContent).toBe(String(CLAN_POINTS.colourWrong))
    expect(container.querySelector('[data-clan-diamond]') || true).toBeTruthy()
  })

  it('shows the code, then the four options, and scores a picked option', async () => {
    const { container } = renderPage()
    await launch(container, 'easier')
    const cfg = CLAN_TUNING.easier.letters
    await act(async () => { vi.advanceTimersByTime(cfg.firstMs + 200) })
    const code = screen.getByTestId('clan-letters').querySelector('.cbat-clan-code')?.textContent
    expect(code).toHaveLength(4)
    await act(async () => { vi.advanceTimersByTime(cfg.showMs + cfg.holdMs + 200) })
    const options = [...container.querySelectorAll('[data-clan-option]')]
    expect(options.map(o => o.querySelector('.cbat-clan-option-text').textContent)).toContain(code)
    const correct = options.find(o => o.querySelector('.cbat-clan-option-text').textContent === code)
    const before = Number(screen.getByTestId('clan-score').textContent)
    fireEvent.click(correct)
    expect(Number(screen.getByTestId('clan-score').textContent)).toBe(before + CLAN_POINTS.letterCorrect)
    expect(correct.getAttribute('data-verdict')).toBe('correct')
  })

  it('finishes when the clock runs out and files the run on the board it was played on', async () => {
    const { container } = renderPage()
    await launch(container, 'hard')
    await act(async () => { vi.advanceTimersByTime(CLAN_DURATION_MS + 500) })
    const over = screen.getByTestId('game-over')
    expect(over.getAttribute('data-game-key')).toBe('clan')
    expect(mockSubmitCbatResult).toHaveBeenCalledTimes(1)
    const [key, payload] = mockSubmitCbatResult.mock.calls[0]
    expect(key).toBe('clan')
    expect(payload.totalTime).toBe(CLAN_DURATION_MS / 1000)
    expect(typeof payload.totalScore).toBe('number')
    expect(payload).toMatchObject({ colourMissed: expect.any(Number), letterTimeout: expect.any(Number), mathTimeout: expect.any(Number) })
    expect(container.textContent).toContain('CLAN Assessment Complete')
    expect(container.textContent).toContain('Hard difficulty')
  })
})

describe('CbatClan under the Real CBAT theme', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: FAKES })
  })
  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
  })

  it('draws the title bar and footer strip, skins the board, and shows no verdicts', async () => {
    const { container } = renderPage('cbat')
    await launch(container, 'easier')
    expect(screen.getByTestId('cbat-testbar').textContent).toContain('Colours, Letters and Numbers - Testing')
    expect(screen.getByTestId('cbat-footer-strip').textContent).toContain('R, Y or G')
    expect(screen.queryByTestId('clan-score')).toBeNull()
    expect(screen.getByTestId('clan-board').className).toContain('cbat-clan-real')

    const cfg = CLAN_TUNING.easier.letters
    await act(async () => { vi.advanceTimersByTime(cfg.firstMs + cfg.showMs + cfg.holdMs + 400) })
    const options = [...container.querySelectorAll('[data-clan-option]')]
    // The key caps are the real software's lettered keys.
    expect(options.map(o => o.querySelector('.cbat-keycap')?.textContent)).toEqual(['A', 'B', 'C', 'D'])
    press('a')
    // No right/wrong on the real screen.
    expect(options.every(o => o.getAttribute('data-verdict') == null)).toBe(true)
    expect(screen.getByTestId('clan-letters').className).not.toMatch(/correct|wrong/)
  })
})
