import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatMatf from '../CbatMatf'
import { MATF_LAUNCH_MS } from '../../utils/cbat/matfDifficulty'
import { recordMatfPrintout, readMatfPrintouts, matfSheetCode } from '../../utils/cbat/matfPrint'

// The printing helper on the Table Reading Test.
//
// The real test is worked against a pre-printed sheet beside the screen, and
// the corpus is explicit that managing both surfaces at once is most of what
// the test costs you. So a run can print its own reference tables, and a kept
// sheet can be replayed later.
//
// Four things are pinned here, because each is silently wrong in a way nobody
// would notice from the screen:
//
//  1. The print question comes AFTER Start. The tables do not exist until Start
//     is pressed, so offering to print them beforehand offers something we have
//     not built.
//  2. Saying no changes nothing. This is a helper, not a new step in the test.
//  3. Printing covers the on-screen table, and the cover is dismissible. A
//     player who prints and then decides they preferred the screen is not stuck.
//  4. A replay of a saved sheet is NOT submitted. The player has seen those
//     numbers; the real test's numbers are ones they never have.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSubmit = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmit }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick }) => (
      <button className={className} onClick={onClick}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

let apiFetch
function renderPage() {
  apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch,
  })
  return render(<CbatMatf />)
}

const click = (name) => fireEvent.click(screen.getByRole('button', { name }))

// Start, then let the mode flash finish. The flash belongs to the instructions
// card, so it runs before the print question rather than after it.
function pressStart() {
  click('Start')
  act(() => { vi.advanceTimersByTime(MATF_LAUNCH_MS + 10) })
}

// Both parts are speeded, so a part ends when its clock does. Run both out,
// stepping through the interstitial in between, and land on the results.
function runBothParts() {
  act(() => { vi.advanceTimersByTime(200000) })
  click(/start part 2/i)
  act(() => { vi.advanceTimersByTime(200000) })
}

describe('CbatMatf printing helper', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    window.print = vi.fn()
  })
  afterEach(() => { vi.useRealTimers() })

  it('does not offer printing before Start, because the tables do not exist yet', () => {
    renderPage()
    expect(screen.queryByText(/print the reference tables/i)).not.toBeInTheDocument()
  })

  it('asks about printing once the run has been built', () => {
    renderPage()
    pressStart()
    expect(screen.getByText(/print the reference tables/i)).toBeInTheDocument()
  })

  it('plays exactly as before when the player says no', () => {
    renderPage()
    pressStart()
    click(/no, play on screen/i)
    expect(screen.queryByText(/use your printed sheet/i)).not.toBeInTheDocument()
    expect(document.querySelector('.overflow-auto table')).toBeTruthy()
  })

  it('shows both parts on the print sheet, and says a sheet is good for one run', () => {
    renderPage()
    pressStart()
    click(/yes, print the tables/i)
    const sheet = document.querySelector('.matf-print-sheet')
    expect(sheet).toBeTruthy()
    expect(within(sheet).getByText(/part one . coordinate grid/i)).toBeInTheDocument()
    expect(within(sheet).getByText(/part two . wind sheet/i)).toBeInTheDocument()
    // The note has to be on the PAPER, not only on the screen that offered it.
    expect(within(sheet).getByText(/good for one run/i)).toBeInTheDocument()
    expect(within(sheet).getByText(/different set of numbers on purpose/i)).toBeInTheDocument()
  })

  it('counts the print for the admin Reports page when the print dialog opens', () => {
    renderPage()
    pressStart()
    click(/yes, print the tables/i)
    const printCalls = () => apiFetch.mock.calls.filter(([url]) => url.endsWith('/api/games/cbat/matf/print'))
    expect(printCalls()).toHaveLength(0)
    click(/print these sheets/i)
    expect(printCalls()).toHaveLength(1)
    const body = JSON.parse(printCalls()[0][1].body)
    expect(['matf', 'matf-easier']).toContain(body.gameKey)
    expect(body.seed).toBe(readMatfPrintouts()[0].seed)
  })

  it('saves the sheet the moment the print dialog opens, not on the way out', () => {
    // A player who prints and then quits still has the paper, and should still
    // find it on the rail.
    renderPage()
    pressStart()
    click(/yes, print the tables/i)
    click(/print these sheets/i)
    expect(window.print).toHaveBeenCalled()
    const saved = readMatfPrintouts()
    expect(saved).toHaveLength(1)
    expect(saved[0].difficulty).toBe('easier')
  })

  it('covers the on-screen table once the player has printed, and lets them uncover it', () => {
    renderPage()
    pressStart()
    click(/yes, print the tables/i)
    click(/print these sheets/i)
    click(/start the test/i)

    expect(screen.getByText(/use your printed sheet/i)).toBeInTheDocument()
    // Covered IN PLACE OF, not on top of: a half-readable table is worse than
    // either surface on its own.
    expect(document.querySelector('.overflow-auto table')).toBeFalsy()

    click(/show the table on screen instead/i)
    expect(screen.queryByText(/use your printed sheet/i)).not.toBeInTheDocument()
    expect(document.querySelector('.overflow-auto table')).toBeTruthy()
  })

  it('leaves the table on screen when the player skipped printing', () => {
    renderPage()
    pressStart()
    click(/yes, print the tables/i)
    click(/skip printing and start/i)
    expect(screen.queryByText(/use your printed sheet/i)).not.toBeInTheDocument()
    expect(readMatfPrintouts()).toEqual([])
  })
})

describe('CbatMatf saved sheets', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    window.print = vi.fn()
  })
  afterEach(() => { vi.useRealTimers() })

  it('shows no rail until the player has printed something', () => {
    renderPage()
    expect(screen.queryByText(/your printed sheets/i)).not.toBeInTheDocument()
  })

  it('offers a printed sheet back on the instructions screen', () => {
    recordMatfPrintout({ seed: 0xABCDEF, difficulty: 'hard' }, 1000)
    renderPage()
    // Beside the card on desktop and under it on a phone, so it is in the DOM
    // twice; both are the same shelf.
    expect(screen.getAllByText(/your printed sheets/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ABCDEF').length).toBeGreaterThan(0)
  })

  it('starts a replay straight into part one, already on paper', () => {
    // No print question: the player picked the sheet off the rail because it is
    // already in front of them.
    recordMatfPrintout({ seed: 0xABCDEF, difficulty: 'hard' }, 1000)
    renderPage()
    fireEvent.click(screen.getAllByText('ABCDEF')[0])
    expect(screen.queryByText(/print the reference tables/i)).not.toBeInTheDocument()
    expect(screen.getByText(/use your printed sheet/i)).toBeInTheDocument()
    expect(screen.getByText(matfSheetCode(0xABCDEF))).toBeInTheDocument()
  })

  it('never submits a replay, and says so on the results screen', () => {
    recordMatfPrintout({ seed: 0xABCDEF, difficulty: 'hard' }, 1000)
    renderPage()
    fireEvent.click(screen.getAllByText('ABCDEF')[0])
    runBothParts()
    expect(mockSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/not submitted to the leaderboard/i)).toBeInTheDocument()
  })

  it('still submits a normal run', () => {
    renderPage()
    pressStart()
    click(/no, play on screen/i)
    runBothParts()
    expect(mockSubmit).toHaveBeenCalledWith('matf-easier', expect.anything(), expect.anything())
  })
})
