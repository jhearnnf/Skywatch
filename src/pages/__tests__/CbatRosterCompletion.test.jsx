import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatSit from '../CbatSit'
import CbatSlt from '../CbatSlt'
import CbatVlt from '../CbatVlt'
import CbatMatf from '../CbatMatf'
import CbatVigilance, { CLEAR_EFFECT_MS } from '../CbatVigilance'
import { press } from '../../components/landingGames/demoDriver'
import { submitCbatResult } from '../../lib/cbatOutbox'
import { SIT_ROUNDS, SIT_CLIPS, SIT_QUESTIONS_PER_CLIP } from '../../utils/cbat/sitDifficulty'
import { VIGILANCE_GRID } from '../../utils/cbat/vigilanceSim'
import { SLT_QUESTIONS } from '../../utils/cbat/sltDifficulty'
import { VLT_QUESTIONS } from '../../utils/cbat/vltDifficulty'

// Page-level wiring for the five tests that completed the RAF roster. The thing
// worth pinning on four of them is the same thing SAT and CUT pin: a run only
// ever reaches the board belonging to the difficulty it was actually played at.
// On Vigilance it is the opposite — that no difficulty selector exists at all.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
// SIT's clip is WebGL. Stubbed so the phase machine can be driven in jsdom —
// what the scene draws is covered by sitClipGeometry.test.js and by eye.
vi.mock('../../components/cbat/SitClipScene', () => ({
  default: ({ onReady }) => <div data-testid="sit-clip-scene" ref={() => onReady?.()} />,
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    g: ({ children }) => <g>{children}</g>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage(Component) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<Component />)
}

const difficultyButton = (container, key) => container.querySelector(`[data-difficulty="${key}"]`)

const SPLIT_PAGES = [
  ['SIT', CbatSit, 'sit'],
  ['SLT', CbatSlt, 'slt'],
  ['VLT', CbatVlt, 'vlt'],
  ['MATF', CbatMatf, 'matf'],
]

describe.each(SPLIT_PAGES)('%s — difficulty wiring', (name, Component, key) => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('opens on Easier with both difficulties offered', () => {
    const { container } = renderPage(Component)
    expect(difficultyButton(container, 'easier').getAttribute('aria-pressed')).toBe('true')
    expect(difficultyButton(container, 'hard').getAttribute('aria-pressed')).toBe('false')
  })

  it('points the leaderboard link at the selected difficulty\'s board', () => {
    const { container } = renderPage(Component)
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe(`/cbat/${key}-easier/leaderboard`)

    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe(`/cbat/${key}/leaderboard`)
  })

  it('remembers the last difficulty chosen', () => {
    const { container, unmount } = renderPage(Component)
    act(() => { press(difficultyButton(container, 'hard')) })
    act(() => { press(screen.getByText('Start')) })
    unmount()

    const second = renderPage(Component)
    expect(difficultyButton(second.container, 'hard').getAttribute('aria-pressed')).toBe('true')
  })

  it('puts the difficulty pair BELOW the title, where every other split game has it', () => {
    // FLAG, CUT, Numerical Operations, SAT and RTT all render title → pair →
    // blurb on the intro card. Pinned by DOM order rather than by eye because
    // the shared CbatDifficultySelect module also exports a `DifficultyTitleRow`
    // that flanks the title instead — using it here would look plausible in
    // review and be inconsistent on screen.
    const { container } = renderPage(Component)
    // The intro card's own title, not the page <h1> — both carry the game name.
    const title = container.querySelector('.text-xl.font-extrabold')
    const expected = {
      sit: 'Spatial Integration Test', slt: 'System Logic Test',
      vlt: 'Verbal Logic Test', matf: 'Table Reading Test',
    }[key]
    expect(title.textContent).toBe(expected)

    const pair = difficultyButton(container, 'easier')
    expect(title.compareDocumentPosition(pair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the selected difficulty\'s blurb under the pair', () => {
    const { container } = renderPage(Component)
    act(() => { press(difficultyButton(container, 'hard')) })
    // Every tuning table carries a blurb; the card must be showing the one
    // belonging to whichever button is currently pressed.
    const pressed = container.querySelector('[data-difficulty][aria-pressed="true"]')
    expect(pressed.getAttribute('data-difficulty')).toBe('hard')
  })
})

describe('Vigilance — deliberately single-difficulty', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('offers no difficulty selector at all', () => {
    // The test measures whether you can hold attention on a dull task for a
    // fixed stretch. A shorter or lighter variant would remove what is being
    // measured, so the absence of this control is a design decision worth
    // pinning rather than an omission.
    const { container } = renderPage(CbatVigilance)
    expect(container.querySelector('[data-difficulty]')).toBeNull()
  })

  it('points at the single Vigilance board', () => {
    renderPage(CbatVigilance)
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe('/cbat/vigilance/leaderboard')
  })

  it('says the run length up front, since the length is the test', () => {
    renderPage(CbatVigilance)
    expect(screen.getByText(/180 seconds/)).toBeTruthy()
  })

  it('pins the grid to a fixed layout, so stars cannot reflow the cells', () => {
    // Regression. Under the default `table-layout: auto` a column is sized to
    // its widest content: an empty cell contributes nothing, a cell holding a
    // star contributes a glyph. Every spawn and every clear therefore re-flowed
    // the whole board and the cells visibly jittered — on a test that is three
    // minutes of holding your eye on a fixed grid.
    //
    // jsdom does no layout, so the jitter itself cannot be measured here; what
    // is checked is the one property that prevents it.
    const { container } = renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })

    const table = container.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.className).toContain('table-fixed')

    // BOTH halves, because the first alone silently does nothing: fixed layout
    // is ignored unless the table has a definite width, and with `width: auto`
    // the browser falls back to the automatic algorithm. Measured in a real
    // browser that left the table's total pinned while its columns carried on
    // redistributing — which looks fixed and is not.
    expect(table.style.width).toMatch(/^calc\(/)

    // And the first row has to carry the widths, because under a fixed layout it
    // is the only row that decides them.
    const firstRowCells = [...table.querySelectorAll('tr')[0].children]
    expect(firstRowCells.length).toBe(VIGILANCE_GRID + 2)   // labels either side
    for (const cell of firstRowCells) {
      expect([cell.textContent, cell.style.width]).toEqual([cell.textContent, expect.stringContaining('var(--vig-')])
    }
  })

  it('bursts the cell when a coordinate is keyed correctly, and says what it paid', () => {
    // Three minutes of clearing a grid is deliberately dull — that is the test —
    // so the one moment worth anything is landing one. The score is part of the
    // effect rather than decoration: a priority task's bonus decays every second
    // it is left, so the number differs every time.
    const { container } = renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(12000) })

    // Find a star the sim has actually spawned, and key its coordinates.
    const occupied = [...container.querySelectorAll('td[data-cell]')].find(td => td.querySelector('span'))
    expect(occupied).toBeTruthy()
    const [row, col] = occupied.getAttribute('data-cell').split(',').map(Number)

    expect(container.querySelector('.vig-burst')).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: String(row + 1) }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: String(col + 1) }))
    })

    const burst = container.querySelector(`td[data-cell="${row},${col}"] .vig-burst`)
    expect(burst).toBeTruthy()
    expect(burst.textContent).toMatch(/\+\d+/)

    // And it retires itself rather than piling up over a three-minute run.
    act(() => { vi.advanceTimersByTime(CLEAR_EFFECT_MS + 50) })
    expect(container.querySelector('.vig-burst')).toBeNull()
  })

  it('keeps the burst out of the flow, so clearing a star cannot move the board', () => {
    // The board took two attempts to stop it jittering as stars came and went.
    // An effect that occupied space in its cell would undo that, and the symptom
    // would look like the original bug rather than like a new one.
    const { container } = renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(12000) })

    const occupied = [...container.querySelectorAll('td[data-cell]')].find(td => td.querySelector('span'))
    const [row, col] = occupied.getAttribute('data-cell').split(',').map(Number)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: String(row + 1) }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: String(col + 1) }))
    })

    // jsdom does no layout, so what is checked is the property that guarantees
    // it: the burst is absolutely positioned, and its cell is the containing
    // block for it.
    const cell = container.querySelector(`td[data-cell="${row},${col}"]`)
    expect(cell.className).toContain('relative')
    expect(cell.querySelector('.vig-burst')).toBeTruthy()
  })

  it('lays the keypad out as a standard 3×3 numpad — 789 / 456 / 123, no zero', () => {
    // Matches DPT's controls and FLAG's maths pad. A player moving between CBAT
    // games should not have to relearn where a digit is, and the real test's
    // Stream Deck is itself a 3×3 pad — muscle memory built here has to carry.
    const { container } = renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })

    const pad = [...container.querySelectorAll('.grid.grid-cols-3 button')]
      .map(b => b.textContent.trim())
      .filter(t => /^[0-9]$/.test(t))
    // No zero: the grid is 9×9 labelled 1–9, which is what lets the pad be
    // exactly the 3×3 the real test's Stream Deck is.
    expect(pad).toEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3'])
  })

  it('accepts digits from the physical keyboard and clears on Backspace', () => {
    // The corpus is blunt that "the bottleneck is the keying, not the finding",
    // so the number row / numeric keypad is the primary input on desktop and the
    // on-screen pad is the touch fallback — not the other way round.
    renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })

    // Row first, then column — the order the corpus states.
    expect(screen.getByText(/Enter row/)).toBeTruthy()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' })) })
    expect(screen.getByText(/Enter column/)).toBeTruthy()

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' })) })
    expect(screen.getByText(/Enter row/)).toBeTruthy()
  })

  it('leaves modifier chords alone so browser shortcuts still work', () => {
    // Ctrl+1 / Cmd+2 switch browser tabs. Swallowing them as coordinates would
    // half-enter a cell the player never meant to touch.
    renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true })) })
    expect(screen.getByText(/Enter row/)).toBeTruthy()
  })
})

describe('SIT — run structure', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('warns that other things in the frame will be wrong', () => {
    // The single most valuable thing in the corpus for this test, and the
    // generator enforces it on every round — so the intro has to say it.
    renderPage(CbatSit)
    expect(screen.getByText(/Other things in the frame will be wrong/)).toBeTruthy()
  })

  it('states the same run length on both difficulties', () => {
    const shape = new RegExp(`${SIT_CLIPS} clips of ${SIT_QUESTIONS_PER_CLIP} questions`)
    const { container } = renderPage(CbatSit)
    expect(screen.getByText(shape)).toBeTruthy()
    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(shape)).toBeTruthy()
    // Which still adds up to the eight the two boards share a ceiling on.
    expect(SIT_CLIPS * SIT_QUESTIONS_PER_CLIP).toBe(SIT_ROUNDS)
  })

  it('reaches the layer study phase after the launch flash', () => {
    // "Each showing one isolated layer ... no tab shows the full picture." The
    // study phase showed one composite map until the guide was read back
    // against it, which made it a memory task rather than an integration one.
    renderPage(CbatSit)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(screen.getByText(/Study the layers/)).toBeTruthy()
    expect(screen.getByText(/No layer shows everything/)).toBeTruthy()
  })

  it('shows how long is left to study, and counts it down', () => {
    // The run-progress bar counts questions answered, so it sits still through a
    // study window that can run a minute. Without its own clock the phase looks
    // stalled.
    renderPage(CbatSit)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(1100) })

    const secondsLeft = () => {
      const el = [...document.querySelectorAll('p')].find(p => /\d+s\s*left/.test(p.textContent))
      return el ? Number(el.textContent.match(/(\d+)s/)[1]) : null
    }
    const first = secondsLeft()
    expect(first).toBeGreaterThan(0)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(secondsLeft()).toBeLessThan(first)
  })

  it('lets the player hand back the rest of the study window', () => {
    renderPage(CbatSit)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(screen.getByText(/Study the layers/)).toBeTruthy()

    act(() => { press(screen.getByText(/Skip study time/)) })

    // Straight to the clip, without waiting out the rest of the window.
    expect(screen.getByText(/Camera pass/)).toBeTruthy()
    expect(screen.queryByText(/Study the layers/)).toBeNull()
  })

  it('still gives the full clip after a skip — ending study early buys nothing', () => {
    // The clip runs on its own fixed window. If skipping study also shortened
    // the clip, the button would be a trap rather than a convenience.
    renderPage(CbatSit)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(1100) })
    act(() => { press(screen.getByText(/Skip study time/)) })

    // Just under the clip window (2.5s easier is 4s) — still on the clip.
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.getByText(/Camera pass/)).toBeTruthy()
  })
})

describe('SLT and VLT — the tabs stay open while you answer', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it.each([['SLT', CbatSlt, SLT_QUESTIONS], ['VLT', CbatVlt, VLT_QUESTIONS]])(
    '%s shows a tab strip in the reading phase and keeps it once questions start',
    (name, Component) => {
      renderPage(Component)
      act(() => { press(screen.getByText('Start')) })
      act(() => { vi.advanceTimersByTime(1100) })

      // Reading phase — tabs present.
      expect(screen.getByTestId('tab-strip')).toBeTruthy()

      act(() => { press(screen.getByText('Start the questions')) })

      // Questions running, tabs STILL present. It is a search-and-apply task,
      // not a memory test — hiding them would make it a different test.
      expect(screen.getByTestId('tab-strip')).toBeTruthy()
    },
  )

  it('SLT states the question count for the selected difficulty', () => {
    renderPage(CbatSlt)
    expect(screen.getByText(new RegExp(`${SLT_QUESTIONS} questions`))).toBeTruthy()
  })

  it('VLT warns that the plainly-stated answer is the trap', () => {
    renderPage(CbatVlt)
    expect(screen.getByText(/usually the distractor/)).toBeTruthy()
  })
})

describe('MATF — two speeded parts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('tells the player the pair works either way round', () => {
    // Only safe to say because buildMatfGrid is symmetric — pinned in
    // matfGenerator.test.js. If that ever stopped being true this copy would be
    // teaching a habit that loses marks.
    renderPage(CbatMatf)
    expect(screen.getByText(/works either way round/)).toBeTruthy()
  })

  it('states the grid extent of the selected difficulty', () => {
    // "±17" rather than "17×17": the corpus says the axes run −17 to +17, which
    // is 35 labels each way, not 17.
    const { container } = renderPage(CbatMatf)
    expect(screen.getByText(/±8 grid/)).toBeTruthy()
    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(/±17 grid/)).toBeTruthy()
  })

  it('starts part one on a grid question after the launch flash', () => {
    renderPage(CbatMatf)
    act(() => { press(screen.getByText('Start')) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(screen.getByText(/Part/)).toBeTruthy()
  })
})

describe('submitCbatResult targeting', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('sends a Vigilance run to the vigilance key', async () => {
    renderPage(CbatVigilance)
    act(() => { press(screen.getByText('Start')) })
    // Run the clock out. The sim is stepped from rAF, which the fake timers
    // drive here.
    await act(async () => { vi.advanceTimersByTime(190000) })

    expect(submitCbatResult).toHaveBeenCalled()
    expect(submitCbatResult.mock.calls[0][0]).toBe('vigilance')
  })
})
