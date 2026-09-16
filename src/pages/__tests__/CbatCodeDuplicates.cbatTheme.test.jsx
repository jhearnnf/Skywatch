import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCodeDuplicates, {
  cbatSequenceLength,
  cbatCountOptions,
  CBAT_MIN_LENGTH,
  CBAT_MAX_LENGTH,
  CBAT_OPTION_COUNT,
} from '../CbatCodeDuplicates'

// The Real CBAT theme turns Code Duplicates into the real Digit Recognition
// screen: the number alone, large on the navy, for five seconds; then "How
// many fours were there?" answered from five numbered counts (1-5 keys or a
// click marks, Enter commits) with no right/wrong shown; and the number
// growing from 5 to 15 digits across the run. The SkyWatch theme keeps its
// tiles, typed count and three tiers.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSubmitCbatResult = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../utils/cbat/recordStart', () => ({ recordCbatStart: vi.fn() }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmitCbatResult }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ score }) => <div data-testid="game-over">score {score}</div> }))
vi.mock('framer-motion', () => ({
  motion: {
    div:  ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    span: ({ children, className }) => <span className={className}>{children}</span>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function setupUser(uiTheme) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com', uiTheme },
    API: '',
    apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: null }) }),
  })
}

const press = (key) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
// Each count button reads as its key cap then the count, e.g. "1" + "3".
const optionButtons = () => screen.getAllByRole('button').filter(b => /^\d{2,}$/.test(b.textContent))
// Unmounting a running game leaves the quit button's deferred history.back()
// (its back-button guard) on a timer. Run it out under the fake clock so the
// popstate lands here and not in the next test as a quit prompt.
async function flushAndRestore() {
  cleanup()
  await act(async () => { await vi.runAllTimersAsync() })
  vi.useRealTimers()
}

const showNumber = () => act(async () => { await vi.advanceTimersByTimeAsync(5100) })

describe('Real CBAT theme — the ramp and the five counts', () => {
  it('grows the number from 5 to 15 digits, never shrinking', () => {
    expect(cbatSequenceLength(1)).toBe(CBAT_MIN_LENGTH)
    expect(cbatSequenceLength(15)).toBe(CBAT_MAX_LENGTH)
    for (let r = 2; r <= 15; r++) {
      expect(cbatSequenceLength(r)).toBeGreaterThanOrEqual(cbatSequenceLength(r - 1))
    }
  })

  it('offers five consecutive counts that include the real one and fit the number', () => {
    for (let t = 0; t < 200; t++) {
      const length = 5 + Math.floor(Math.random() * 11)
      const actual = 1 + Math.floor(Math.random() * length)
      const opts = cbatCountOptions(actual, length)
      expect(opts).toHaveLength(CBAT_OPTION_COUNT)
      expect(opts).toContain(actual)
      expect(opts[0]).toBeGreaterThanOrEqual(0)
      expect(opts[CBAT_OPTION_COUNT - 1]).toBeLessThanOrEqual(length)
      for (let i = 1; i < opts.length; i++) expect(opts[i]).toBe(opts[i - 1] + 1)
    }
  })

  it('puts the real count in different positions', () => {
    const positions = new Set()
    for (let t = 0; t < 100; t++) positions.add(cbatCountOptions(6, 15).indexOf(6))
    expect(positions.size).toBeGreaterThan(1)
  })
})

describe('CbatCodeDuplicates under the Real CBAT theme', () => {
  beforeEach(() => {
    setupUser('cbat')
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(flushAndRestore)

  it('shows the number alone for five seconds, then five numbered counts with no feedback', async () => {
    render(<CbatCodeDuplicates />)
    fireEvent.click(screen.getByText('Start'))

    // Item 1 of 15 in the title bar, the five-digit number alone on screen
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Digit Recognition - Testing (1 of 15)')
    expect(screen.getByTestId('cbat-drt-number')).toHaveTextContent(/^\d{5}$/)
    expect(screen.queryByText(/Memorise this sequence/)).toBeNull()
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Remember this number.')

    await showNumber()

    // The question names the digit, five counts carry the 1-5 key caps, no text box
    expect(screen.getByText(/^How many (zeros|ones|twos|threes|fours|fives|sixes|sevens|eights|nines) were there\?$/)).toBeTruthy()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    const opts = optionButtons()
    expect(opts).toHaveLength(5)
    expect(opts.map(b => b.querySelector('.cbat-keycap').textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ ]')

    // A key marks, the footer echoes it, Enter commits
    press('2')
    expect(opts[1]).toHaveClass('cbat-option-pending')
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ 2 ]')
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (1 of 15)')
    press('Enter')

    // No right/wrong: straight on to the next number
    expect(screen.queryByText(/Correct|Wrong/)).toBeNull()
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (2 of 15)')
    expect(screen.getByTestId('cbat-drt-number')).toHaveTextContent(new RegExp(`^\\d{${cbatSequenceLength(2)}}$`))
  })

  it('clicking a count only marks it until the arrow key', async () => {
    render(<CbatCodeDuplicates />)
    fireEvent.click(screen.getByText('Start'))
    await showNumber()
    fireEvent.click(optionButtons()[3])
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (1 of 15)')
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ 4 ]')
    fireEvent.click(screen.getByTestId('cbat-footer-submit'))
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (2 of 15)')
  })

  it('ramps the number to 15 digits by the last item and submits the run as cbat', async () => {
    render(<CbatCodeDuplicates />)
    fireEvent.click(screen.getByText('Start'))
    for (let r = 1; r <= 15; r++) {
      expect(screen.getByTestId('cbat-drt-number')).toHaveTextContent(new RegExp(`^\\d{${cbatSequenceLength(r)}}$`))
      await showNumber()
      press('1')
      press('Enter')
    }
    await waitFor(() => expect(mockSubmitCbatResult).toHaveBeenCalled())
    expect(mockSubmitCbatResult.mock.calls[0][0]).toBe('code-duplicates')
    expect(mockSubmitCbatResult.mock.calls[0][1].uiTheme).toBe('cbat')
    expect(screen.getByTestId('game-over')).toBeTruthy()
  })
})

describe('CbatCodeDuplicates under the SkyWatch theme', () => {
  beforeEach(() => {
    setupUser('skywatch')
    mockSubmitCbatResult.mockClear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(flushAndRestore)

  it('keeps the tiles, the typed count and the feedback', async () => {
    render(<CbatCodeDuplicates />)
    fireEvent.click(screen.getByText('Start'))
    expect(screen.queryByTestId('cbat-drt-number')).toBeNull()
    expect(screen.getByText(/Memorise this sequence/)).toBeTruthy()

    await showNumber()
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.click(screen.getByText('Submit'))
    expect(screen.getByText('Wrong')).toBeTruthy()
    expect(screen.getByText('Next Round')).toBeTruthy()
  })
})
