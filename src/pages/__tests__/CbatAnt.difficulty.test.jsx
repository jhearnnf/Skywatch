import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatAnt from '../CbatAnt'
import { ANT_TUNING, ANT_LAUNCH_MS } from '../../utils/cbat/antDifficulty'

// ANT's tile holds three boards and they are three different GAMES, not one at
// three settings: Easier is the original eight-round board on the plain `ant`
// key (so its existing scores keep ranking), Hard is the rebuilt realistic board
// on `ant-hard` from zero, and Practise is the arithmetic drill on
// `ant-practise`. All three are picked in the one row at the top.
//
// Two things are pinned here.
//
// 1. WHERE THE PAIR SITS. Title, then the pair on its own row UNDER it, then the
//    selected blurb. A `DifficultyTitleRow` helper that flanked the title used
//    to live in CbatDifficultySelect; it was deleted because it reads as the
//    obvious helper and is wrong on screen. This test and the matching ones in
//    CbatDpt.difficulty.test.jsx / CbatRosterCompletion.test.jsx keep it deleted.
//
// 2. THAT THE TWO BOARDS STAY SEPARATE. Picking Hard has to reach the Hard game
//    and file its run under `ant-hard`. A split that quietly played one board
//    and scored the other would be worse than no split at all.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => mockSettings(),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick }) => (
      <button className={className} onClick={onClick}>{children}</button>
    ),
    g: ({ children }) => <g>{children}</g>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatAnt />)
}

const difficultyButton = (container, key) => container.querySelector(`[data-difficulty="${key}"]`)
const antTitle = container => [...container.querySelectorAll('p')].find(p => p.textContent === 'ANT')

describe('CbatAnt difficulty selector placement', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: {} } })
  })

  it('renders all three boards in the row', () => {
    const { container } = renderPage()
    expect(difficultyButton(container, 'easier')).toBeTruthy()
    expect(difficultyButton(container, 'hard')).toBeTruthy()
    expect(difficultyButton(container, 'practise')).toBeTruthy()
  })

  // Practise is a drill, not the easy end of a scale, so it carries a badge
  // where the two difficulties carry the 1-of-3 / 3-of-3 meter.
  it('gives Practise a badge instead of difficulty bars', () => {
    const { container } = renderPage()
    const bars = el => el.querySelectorAll('span[aria-hidden="true"] > span').length
    expect(bars(difficultyButton(container, 'easier'))).toBe(3)
    expect(bars(difficultyButton(container, 'hard'))).toBe(3)
    expect(bars(difficultyButton(container, 'practise'))).toBe(0)
    expect(difficultyButton(container, 'practise').textContent).toContain('Drill')
  })

  it('puts the pair BELOW the title, where every other split game has it', () => {
    const { container } = renderPage()
    const title = antTitle(container)
    expect(title).toBeTruthy()
    for (const key of ['easier', 'hard']) {
      const button = difficultyButton(container, key)
      expect(title.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('keeps the pair on its own row rather than flanking the title', () => {
    const { container } = renderPage()
    const easier = difficultyButton(container, 'easier')
    const hard = difficultyButton(container, 'hard')
    expect(easier.parentElement).toBe(hard.parentElement)
    expect(easier.parentElement.contains(antTitle(container))).toBe(false)
  })

  it('orders the row easier, hard, then the drill', () => {
    const { container } = renderPage()
    const [easier, hard, practise] = ['easier', 'hard', 'practise'].map(k => difficultyButton(container, k))
    expect(easier.compareDocumentPosition(hard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hard.compareDocumentPosition(practise) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the selected difficulty blurb under the pair', () => {
    const { container } = renderPage()
    const blurb = [...container.querySelectorAll('p')]
      .find(el => el.textContent === ANT_TUNING.easier.blurb)
    expect(blurb).toBeTruthy()
    const easier = difficultyButton(container, 'easier')
    expect(easier.compareDocumentPosition(blurb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('CbatAnt difficulty picks the board', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: {} } })
  })

  it('defaults to Easier and sends its leaderboard link there', () => {
    const { container } = renderPage()
    const link = [...container.querySelectorAll('a')].find(a => a.textContent.includes('View Leaderboard'))
    expect(link.getAttribute('href')).toBe('/cbat/ant/leaderboard')
  })

  // Practise used to need a second "Practise Leaderboard" link because the drill
  // had nowhere to sit. It sits in the row now, so there is one link and it
  // follows the selection.
  it('shows exactly one leaderboard link, whichever mode is picked', () => {
    const { container } = renderPage()
    const links = () => [...container.querySelectorAll('a')].filter(a => a.textContent.includes('Leaderboard'))
    expect(links()).toHaveLength(1)
    act(() => { difficultyButton(container, 'practise').click() })
    expect(links()).toHaveLength(1)
    expect(links()[0].getAttribute('href')).toBe('/cbat/ant-practise/leaderboard')
  })

  it('follows the picked difficulty to the other board', () => {
    const { container } = renderPage()
    act(() => { difficultyButton(container, 'hard').click() })
    const link = [...container.querySelectorAll('a')].find(a => a.textContent.includes('View Leaderboard'))
    expect(link.getAttribute('href')).toBe('/cbat/ant-hard/leaderboard')
    // And the choice is remembered for next time, exactly like FLAG's.
    expect(localStorage.getItem('sw_cbat_ant_difficulty')).toBe('hard')
  })

  // Tutorial sits beside Start on every CBAT game that has one, and it stays put
  // when the mode changes — the row at the top is the only thing that switches
  // board, so nothing down by Start is allowed to move around.
  it('keeps Tutorial beside Start in every mode, and offers no Practise button', () => {
    const { container } = renderPage()
    const named = label => [...container.querySelectorAll('button')].find(b => b.textContent === label)
    for (const mode of ['easier', 'hard', 'practise']) {
      act(() => { difficultyButton(container, mode).click() })
      expect([mode, !!named('Tutorial')]).toEqual([mode, true])
      expect([mode, !!named('Practise')]).toEqual([mode, false])
      expect([mode, !!container.querySelector('[data-demo-start]')]).toEqual([mode, true])
    }
  })

  it('states each board’s own ceiling, which are not the same number', () => {
    const { container } = renderPage()
    expect(container.textContent).toContain(`Max score ${ANT_TUNING.easier.maxScore}`)
    act(() => { difficultyButton(container, 'hard').click() })
    expect(container.textContent).toContain(`Max score ${ANT_TUNING.hard.maxScore}`)
    expect(ANT_TUNING.easier.maxScore).not.toBe(ANT_TUNING.hard.maxScore)
  })

  it('drops Practise out of the row when an admin disables the drill', () => {
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: { 'ant-practise': false } } })
    const { container } = renderPage()
    expect(difficultyButton(container, 'practise')).toBeFalsy()
    expect(difficultyButton(container, 'easier')).toBeTruthy()
    expect(difficultyButton(container, 'hard')).toBeTruthy()
  })
})

describe('CbatAnt launches the board it advertised', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockSettings.mockReturnValue({ settings: { cbatGameEnabled: {} } })
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers() })

  it('runs the Hard board through the launch flash and onto its own key', async () => {
    const { container } = renderPage()
    act(() => { difficultyButton(container, 'hard').click() })
    act(() => { container.querySelector('[data-demo-start]').click() })

    // The flash holds the card up with the chosen button still alive.
    expect(difficultyButton(container, 'hard')).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(ANT_LAUNCH_MS + 50) })

    // Round 1 of the Hard board: an objective box whose last line is the ask.
    expect(screen.getByText('Objective')).toBeTruthy()
    expect(container.textContent).toContain('Give the arrival time at')
    // Twelve rounds, not the original board's eight.
    expect(container.textContent).toContain(`/${ANT_TUNING.hard.rounds}`)
  })

  it('scores a Hard round and moves on to the next one', async () => {
    const { container } = renderPage()
    act(() => { difficultyButton(container, 'hard').click() })
    act(() => { container.querySelector('[data-demo-start]').click() })
    await act(async () => { vi.advanceTimersByTime(ANT_LAUNCH_MS + 50) })

    // Round 1 is always an arrival question, so the answer is derivable here
    // without reaching into the generator: departure time plus the flying time
    // the objective's own figures give.
    const input = container.querySelector('input')
    const objective = container.textContent
    const depart = objective.match(/wheels-up at (\d{4})/)[1]
    expect(depart).toBeTruthy()

    act(() => { fireEvent.change(input, { target: { value: depart } }) })
    act(() => {
      [...container.querySelectorAll('button')].find(b => b.textContent === 'Submit').click()
    })

    // Wrong on purpose (the departure time is not the arrival time), so the
    // debrief has to show its working rather than just say well done.
    expect(container.textContent).toContain("How it's worked out")
    expect(container.textContent).toContain('Correct:')

    act(() => {
      [...container.querySelectorAll('button')].find(b => b.textContent.includes('Next Round')).click()
    })
    expect(container.textContent).toContain('Round')
    expect(container.querySelector('input')).toBeTruthy()
  })

  it('runs the Practise drill from the row, with no separate button', async () => {
    const { container } = renderPage()
    act(() => { difficultyButton(container, 'practise').click() })
    act(() => { container.querySelector('[data-demo-start]').click() })
    await act(async () => { vi.advanceTimersByTime(ANT_LAUNCH_MS + 50) })

    // The drill puts every question on one page, so there is no round counter.
    expect(container.textContent).not.toContain('Round 1/')
    expect(screen.queryByText('Objective')).toBeNull()
  })

  it('runs the Easier board on the original eight-round board', async () => {
    const { container } = renderPage()
    act(() => { container.querySelector('[data-demo-start]').click() })
    await act(async () => { vi.advanceTimersByTime(ANT_LAUNCH_MS + 50) })

    expect(screen.queryByText('Objective')).toBeNull()
    expect(container.textContent).toContain(`/${ANT_TUNING.easier.rounds}`)
  })
})
