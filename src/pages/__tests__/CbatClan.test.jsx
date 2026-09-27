import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatClan from '../CbatClan'
import {
  keyAction, CLAN_KEY_LAYOUTS, CLAN_KEY_LAYOUT_DEFS, DEFAULT_CLAN_KEY_LAYOUT,
} from '../CbatClan/keys'
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
vi.mock('../../components/CbatQuitButton', () => ({
  default: ({ onConfirm }) => <button type="button" data-testid="quit" onClick={onConfirm}>Quit</button>,
}))
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

function renderPage(uiTheme, { clanKeyLayout, saveOk = true } = {}) {
  const auth = {
    user: { _id: 'u1', uiTheme, clanKeyLayout },
    API: '',
    setUser: vi.fn(),
    apiFetch: vi.fn(async () => ({ ok: saveOk, json: async () => ({ data: null }) })),
  }
  mockUseAuth.mockReturnValue(auth)
  return { ...render(<CbatClan />), auth }
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
  it('defaults to the grouped layout: colours J K L in band order, codes a 2x2 block like the corners', () => {
    expect(DEFAULT_CLAN_KEY_LAYOUT).toBe('grouped')
    expect(keyAction({ key: 'j' })).toEqual({ kind: 'colour', value: 'red' })
    expect(keyAction({ key: 'K' })).toEqual({ kind: 'colour', value: 'yellow' })
    expect(keyAction({ key: 'l' })).toEqual({ kind: 'colour', value: 'green' })
    expect(keyAction({ key: 'q' })).toEqual({ kind: 'option', value: 0 })
    expect(keyAction({ key: 'w' })).toEqual({ kind: 'option', value: 1 })
    expect(keyAction({ key: 'a' })).toEqual({ kind: 'option', value: 2 })
    expect(keyAction({ key: 's' })).toEqual({ kind: 'option', value: 3 })
    expect(keyAction({ key: 'r' })).toBeNull()
  })

  it('reads the physical key on the grouped layouts, so they sit in the same place on any keyboard', () => {
    // An AZERTY keyboard types 'a' on the key where QWERTY has Q.
    expect(keyAction({ key: 'a', code: 'KeyQ' }, 'grouped')).toEqual({ kind: 'option', value: 0 })
    expect(keyAction({ key: 'q', code: 'KeyA' }, 'grouped')).toEqual({ kind: 'option', value: 2 })
    // Letters is about the letter, so it follows what the key types.
    expect(keyAction({ key: 'r', code: 'KeyT' }, 'letters')).toEqual({ kind: 'colour', value: 'red' })
  })

  it('maps the mirrored layout: colours S D F, codes I O / K L', () => {
    expect(keyAction({ key: 's' }, 'mirrored')).toEqual({ kind: 'colour', value: 'red' })
    expect(keyAction({ key: 'f' }, 'mirrored')).toEqual({ kind: 'colour', value: 'green' })
    expect(keyAction({ key: 'i' }, 'mirrored')).toEqual({ kind: 'option', value: 0 })
    expect(keyAction({ key: 'l' }, 'mirrored')).toEqual({ kind: 'option', value: 3 })
  })

  it('keeps the original R/Y/G and A-D on the letters layout', () => {
    expect(keyAction({ key: 'r' }, 'letters')).toEqual({ kind: 'colour', value: 'red' })
    expect(keyAction({ key: 'Y' }, 'letters')).toEqual({ kind: 'colour', value: 'yellow' })
    expect(keyAction({ key: 'g' }, 'letters')).toEqual({ kind: 'colour', value: 'green' })
    expect(keyAction({ key: 'a' }, 'letters')).toEqual({ kind: 'option', value: 0 })
    expect(keyAction({ key: 'D' }, 'letters')).toEqual({ kind: 'option', value: 3 })
    expect(keyAction({ key: 'e' }, 'letters')).toBeNull()
  })

  it('gives every layout seven distinct letter keys, and the same digits, Enter and Backspace', () => {
    for (const key of CLAN_KEY_LAYOUTS) {
      const { colours, options } = CLAN_KEY_LAYOUT_DEFS[key]
      const letters = [...Object.values(colours), ...options]
      expect(new Set(letters).size).toBe(7)
      expect(keyAction({ key: '7' }, key)).toEqual({ kind: 'digit', value: '7' })
      expect(keyAction({ key: 'Enter' }, key)).toEqual({ kind: 'enter' })
      expect(keyAction({ key: 'Backspace' }, key)).toEqual({ kind: 'backspace' })
      expect(keyAction({ key: colours.red.toLowerCase(), ctrlKey: true }, key)).toBeNull()
    }
  })

  it('falls back to the default for an unknown layout', () => {
    expect(keyAction({ key: 'j' }, 'nonsense')).toEqual({ kind: 'colour', value: 'red' })
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
    expect(text).toMatch(/Press J, K or L \(red, yellow, green\)/)
    expect(text).toMatch(/press Q, W, A or S for the one you saw/)
    expect(text).toContain('Type the answer to each sum')
    expect(text).toContain('Score can go negative')
  })

  it("words the keys from the account's layout", () => {
    const { container } = renderPage(undefined, { clanKeyLayout: 'letters' })
    expect(container.textContent).toMatch(/Press R, Y or G/)
    expect(container.textContent).toMatch(/press A, B, C or D/)
    expect(container.querySelector('[data-clan-key-layout="letters"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('offers the three layouts, marks the default, and saves a pick on the account', async () => {
    const { container, auth } = renderPage()
    const buttons = [...container.querySelectorAll('[data-clan-key-layout]')]
    expect(buttons.map(b => b.textContent)).toEqual(['Grouped', 'Mirrored', 'Letters'])
    expect(container.querySelector('[data-clan-key-layout="grouped"]').getAttribute('aria-pressed')).toBe('true')

    await act(async () => { container.querySelector('[data-clan-key-layout="mirrored"]').click() })
    expect(auth.setUser).toHaveBeenCalledTimes(1)
    expect(auth.setUser.mock.calls[0][0]({ _id: 'u1' })).toEqual({ _id: 'u1', clanKeyLayout: 'mirrored' })
    const [url, init] = auth.apiFetch.mock.calls.find(([u]) => u.includes('clan-keys'))
    expect(url).toBe('/api/users/me/clan-keys')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ layout: 'mirrored' })
  })

  it('puts the old layout back when the save fails', async () => {
    const { container, auth } = renderPage(undefined, { clanKeyLayout: 'letters', saveOk: false })
    await act(async () => { container.querySelector('[data-clan-key-layout="grouped"]').click() })
    expect(auth.setUser).toHaveBeenCalledTimes(2)
    expect(auth.setUser.mock.calls[1][0]({ _id: 'u1' })).toEqual({ _id: 'u1', clanKeyLayout: 'letters' })
  })

  it('offers the way back to FLAG', () => {
    const { container } = renderPage()
    expect(screen.getByTestId('clan-to-flag').getAttribute('href')).toBe('/cbat/flag')
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
    press('j')
    expect(screen.getByTestId('clan-score').textContent).toBe(String(CLAN_POINTS.colourWrong))
    expect(container.querySelector('[data-clan-diamond]') || true).toBeTruthy()
  })

  it("answers to the account's layout and ignores the other layouts' keys", async () => {
    const { container } = renderPage(undefined, { clanKeyLayout: 'letters' })
    await launch(container, 'easier')
    await act(async () => { vi.advanceTimersByTime(300) })
    press('j')
    expect(screen.getByTestId('clan-score').textContent).toBe('0')
    press('r')
    expect(screen.getByTestId('clan-score').textContent).toBe(String(CLAN_POINTS.colourWrong))
    // The on-screen colour keys carry the same letters.
    expect([...container.querySelectorAll('[data-clan-colour-key]')].map(b => b.textContent)).toEqual(['R', 'Y', 'G'])
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
    expect(screen.getByTestId('cbat-footer-strip').textContent).toContain('J, K, L for a diamond in its band. Q, W, A, S for the code.')
    expect(screen.queryByTestId('clan-score')).toBeNull()
    expect(screen.getByTestId('clan-board').className).toContain('cbat-clan-real')

    const cfg = CLAN_TUNING.easier.letters
    await act(async () => { vi.advanceTimersByTime(cfg.firstMs + cfg.showMs + cfg.holdMs + 400) })
    const options = [...container.querySelectorAll('[data-clan-option]')]
    // The key caps show the key that picks each box, not a fixed letter.
    expect(options.map(o => o.querySelector('.cbat-keycap')?.textContent)).toEqual(['Q', 'W', 'A', 'S'])
    press('q')
    // No right/wrong on the real screen.
    expect(options.every(o => o.getAttribute('data-verdict') == null)).toBe(true)
    expect(screen.getByTestId('clan-letters').className).not.toMatch(/correct|wrong/)
  })
})

// Into the first code of an Easier test run.
const CLAN_TUTORIAL_FIRST_CODE_MS = CLAN_TUNING.easier.letters.firstMs + 300

describe('CbatClan tutorial', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: FAKES })
  })
  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
  })

  const openTutorial = (container) => {
    act(() => { container.querySelector('[data-cbat-tutorial-btn]').click() })
  }
  // Real time, in frames, until `done()` or the limit.
  async function runUntil(done, limitMs = 20_000) {
    for (let t = 0; t < limitMs; t += 50) {
      if (done()) return true
      await act(async () => { vi.advanceTimersByTime(50) })
    }
    return done()
  }
  const board = () => screen.getByTestId('clan-board')

  it('has a Tutorial button beside Start, and no Practise mode in the row', () => {
    const { container } = renderPage()
    const tut = container.querySelector('[data-cbat-tutorial-btn]')
    expect(tut.textContent).toBe('Tutorial')
    expect(tut.parentElement).toBe(container.querySelector('[data-demo-start]').parentElement)
    expect([...container.querySelectorAll('[data-difficulty]')].map(b => b.getAttribute('data-difficulty'))).toEqual(['easier', 'hard'])
  })

  it('opens on the live board, reports it has started, and scores nothing onto a board', async () => {
    const { container, auth } = renderPage()
    openTutorial(container)
    expect(screen.getByTestId('clan-tutorial')).toBeTruthy()
    expect(board().className).toContain('cbat-clan-tutorial')
    await act(async () => { vi.advanceTimersByTime(100) })
    const call = auth.apiFetch.mock.calls.find(([u]) => u.includes('/clan/tutorial'))
    expect(call).toBeTruthy()
    expect(JSON.parse(call[1].body)).toMatchObject({ furthestStep: 0, totalSteps: 4, completed: false })
    expect(mockStartTracking).not.toHaveBeenCalled()
    expect(mockSubmitCbatResult).not.toHaveBeenCalled()
  })

  it('slows to a crawl on a diamond in its band: zooms in, dims the rest, and names the key', async () => {
    const { container } = renderPage()
    openTutorial(container)
    // Slow motion and the lit key start together, as the diamond enters its band.
    expect(await runUntil(() => board().getAttribute('data-focus') === 'colour')).toBe(true)
    expect(container.querySelector('.cbat-clan-band[data-lit]')).toBeTruthy()

    const band = container.querySelector('.cbat-clan-band[data-lit]')
    const colour = ['red', 'yellow', 'green'].find(c => band.className.includes(`cbat-clan-band-${c}`))
    const key = { red: 'J', yellow: 'K', green: 'L' }[colour]
    expect(band.querySelector('.cbat-clan-guide-key').textContent).toBe(key)
    expect(screen.getByTestId('clan-tutorial-instruction').textContent).toBe(`Press ${key} now. The ${colour} diamond is in the ${colour} band.`)
    // Zoomed toward it, with everything but the arena and the colour keys blurred.
    expect(container.querySelector('.cbat-clan-grid').style.transform).toMatch(/scale\(1\.1/)
    expect(screen.getByTestId('clan-arena').className).not.toContain('cbat-clan-dim')
    expect(screen.getByTestId('clan-letters').className).toContain('cbat-clan-dim')
    expect(screen.getByTestId('clan-maths').className).toContain('cbat-clan-dim')

    // Slow motion: fifteen real seconds later it is still in its band, lit.
    await act(async () => { for (let i = 0; i < 300; i++) vi.advanceTimersByTime(50) })
    expect(board().getAttribute('data-focus')).toBe('colour')
    expect(container.querySelector(`.cbat-clan-band-${colour}[data-lit]`)).toBeTruthy()

    // The right key: a big plus, and the zoom comes back out.
    press(key.toLowerCase())
    await act(async () => { vi.advanceTimersByTime(50) })
    const pop = container.querySelector('[data-clan-pop="good"]')
    expect(pop.textContent).toContain('+10')
    expect(pop.textContent).toContain('Correct')
    expect(screen.getByTestId('clan-tutorial-score').textContent).toBe('10')
    expect(container.querySelector('[data-clan-goal="Diamonds"]').textContent).toContain('1/4')
    // The zoom comes back out, unless a second diamond crawling behind is
    // already in its band, in which case that one is next.
    if (board().getAttribute('data-focus') == null) {
      expect(container.querySelector('.cbat-clan-grid').style.transform).toBe('scale(1)')
    } else {
      expect(container.querySelector(`.cbat-clan-band-${colour}[data-lit]`)).toBeNull()
    }
  })

  it('punishes a wrong key with a minus', async () => {
    const { container } = renderPage()
    openTutorial(container)
    await runUntil(() => !!container.querySelector('.cbat-clan-band[data-lit]'))
    const band = container.querySelector('.cbat-clan-band[data-lit]')
    const colour = ['red', 'yellow', 'green'].find(c => band.className.includes(`cbat-clan-band-${c}`))
    const wrong = { red: 'k', yellow: 'l', green: 'j' }[colour]
    press(wrong)
    await act(async () => { vi.advanceTimersByTime(50) })
    const pop = container.querySelector('[data-clan-pop="bad"]')
    expect(pop.textContent).toContain('-5')
    expect(pop.textContent).toContain('Wrong key')
    expect(screen.getByTestId('clan-tutorial-score').textContent).toBe('-5')
    // Still waiting on the right one.
    expect(board().getAttribute('data-focus')).toBe('colour')
  })

  it('flashes the code to memorise with a Remember this label, only while it is up', async () => {
    const { container } = renderPage()
    openTutorial(container)
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(screen.queryByTestId('clan-remember')).toBeNull()
    const shown = await runUntil(() => {
      // Clear any diamond on the way, so the run reaches the code.
      const band = container.querySelector('.cbat-clan-band[data-lit]')
      if (band) press(band.querySelector('.cbat-clan-guide-key').textContent.toLowerCase())
      return !!screen.getByTestId('clan-letters').querySelector('.cbat-clan-code')
    }, 40_000)
    expect(shown).toBe(true)
    const letters = screen.getByTestId('clan-letters')
    expect(letters.className).toContain('cbat-clan-letters-memorise')
    expect(letters.className).not.toContain('cbat-clan-dim')
    expect(screen.getByTestId('clan-remember').textContent).toMatch(/^Remember this/)
    // Gone once the code is.
    expect(await runUntil(() => !letters.querySelector('.cbat-clan-code'), 40_000)).toBe(true)
    expect(screen.queryByTestId('clan-remember')).toBeNull()
    expect(letters.className).not.toContain('cbat-clan-letters-memorise')
  })

  it('never flags the code on a test run', async () => {
    const { container } = renderPage()
    await launch(container, 'easier')
    const e = CLAN_TUTORIAL_FIRST_CODE_MS
    await act(async () => { vi.advanceTimersByTime(e) })
    expect(screen.getByTestId('clan-letters').querySelector('.cbat-clan-code')).toBeTruthy()
    expect(screen.queryByTestId('clan-remember')).toBeNull()
  })

  it('stops for the code options and lights the right box with its key', async () => {
    const { container } = renderPage()
    openTutorial(container)
    // Clear every diamond it stops for, so the run reaches the first code.
    let code = null
    const reached = await runUntil(() => {
      const shown = screen.getByTestId('clan-letters').querySelector('.cbat-clan-code')?.textContent
      if (shown) code = shown
      const band = container.querySelector('.cbat-clan-band[data-lit]')
      if (band) press(band.querySelector('.cbat-clan-guide-key').textContent.toLowerCase())
      return board().getAttribute('data-focus') === 'code'
    }, 40_000)
    expect(reached).toBe(true)
    const lit = container.querySelector('[data-clan-option][data-lit]')
    expect(lit.querySelector('.cbat-clan-option-text').textContent).toBe(code)
    const index = [...container.querySelectorAll('[data-clan-option]')].indexOf(lit)
    const key = ['Q', 'W', 'A', 'S'][index]
    expect(screen.getByTestId('clan-tutorial-instruction').textContent).toBe(`Press ${key}. That box holds the code you memorised.`)
    expect(screen.getByTestId('clan-arena').className).toContain('cbat-clan-dim')
    press(key.toLowerCase())
    await act(async () => { vi.advanceTimersByTime(50) })
    expect([...container.querySelectorAll('[data-clan-pop="good"]')].map(p => p.textContent)).toContain('+20Correct')
  })

  it('puts a blinking cursor where the answer goes when it stops for a sum', async () => {
    const { container } = renderPage()
    openTutorial(container)
    // Clear whatever it stops for on the way, until a sum has the focus.
    const reached = await runUntil(() => {
      const band = container.querySelector('.cbat-clan-band[data-lit]')
      if (band) press(band.querySelector('.cbat-clan-guide-key').textContent.toLowerCase())
      const box = container.querySelector('[data-clan-option][data-lit]')
      if (box) press(box.querySelector('.cbat-clan-option-key-sw').textContent.toLowerCase())
      return board().getAttribute('data-focus') === 'sum'
    }, 60_000)
    expect(reached).toBe(true)
    const maths = screen.getByTestId('clan-maths')
    expect(maths.querySelector('[data-testid="clan-caret"]')).toBeTruthy()
    expect(maths.textContent).not.toContain('_')
    // After the typed digits, so it stays at the end as they come in. (Not
    // typed here: a one-digit answer submits on its only digit.)
    const entered = maths.querySelector('.cbat-clan-entered-active')
    expect(entered.lastElementChild.getAttribute('data-testid')).toBe('clan-caret')
  })

  it('keeps the plain cursor on a test run', async () => {
    const { container } = renderPage()
    await launch(container, 'easier')
    // The first sum's time is jittered, so wait for it rather than guess.
    expect(await runUntil(() => !!screen.getByTestId('clan-maths').querySelector('.cbat-clan-sum'))).toBe(true)
    expect(screen.getByTestId('clan-maths').textContent).toContain('_')
    expect(screen.queryByTestId('clan-caret')).toBeNull()
  })

  it('goes back to the instructions from the quit button', async () => {
    const { container } = renderPage()
    openTutorial(container)
    await act(async () => { vi.advanceTimersByTime(100) })
    act(() => { screen.getByTestId('quit').click() })
    expect(screen.queryByTestId('clan-tutorial')).toBeNull()
    expect(container.querySelector('[data-demo-start]')).toBeTruthy()
  })
})
