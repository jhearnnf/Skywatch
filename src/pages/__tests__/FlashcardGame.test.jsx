import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import FlashcardGameModal from '../../components/FlashcardGameModal'
import { playSound } from '../../utils/sound'

// ── Mocks ─────────────────────────────────────────────────────────────────

import { useAuth } from '../../context/AuthContext'

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../utils/sound', () => ({
  playSound: vi.fn(() => Promise.resolve()),
  invalidateSoundSettings: vi.fn(),
  getMasterVolume: vi.fn(() => 100),
  setMasterVolume: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, ...rest }) => <div className={className} style={style} {...rest}>{children}</div>,
    ul:  ({ children, className, style, ...rest }) => <ul  className={className} style={style} {...rest}>{children}</ul>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

const MOCK_CARDS = [
  { cardIndex: 0, intelBriefId: 'brief1', category: 'Aircrafts', subcategory: 'Fast Jets', contentSnippet: 'A stealthy multirole aircraft used by the RAF.' },
  { cardIndex: 1, intelBriefId: 'brief2', category: 'Bases',     subcategory: '',          contentSnippet: 'A major operational hub located in northern Scotland.' },
]

const MOCK_TITLES = [
  { _id: 'brief1', title: 'F-35 Lightning II' },
  { _id: 'brief2', title: 'RAF Lossiemouth' },
  { _id: 'brief3', title: 'Typhoon FGR4' },
]

function makeStartResponse(cards = MOCK_CARDS) {
  return {
    status: 'success',
    data: {
      gameId: 'game1',
      gameSessionId: 'sess1',
      cards,
      totalCards: cards.length,
      allBriefTitles: MOCK_TITLES,
    },
  }
}

function setupFetch({ available = 10, startOk = true, cards = MOCK_CARDS, airstarsEarned = 10 } = {}) {
  global.fetch = vi.fn().mockImplementation((url, opts) => {
    if (url.includes('available-briefs'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { count: available } }) })
    if (url.includes('flashcard-recall/start'))
      return Promise.resolve({
        ok: startOk,
        json: async () => startOk ? makeStartResponse(cards) : { message: 'Error' },
      })
    if (url.includes('flashcard-recall/result'))
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: 'success',
          data: { result: { airstarsEarned }, rankPromotion: null, cycleAirstars: 150, totalAirstars: 500 },
        }),
      })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

let mockAwardAirstars

function setupAuth() {
  mockAwardAirstars = vi.fn()
  useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...args) => fetch(...args), awardAirstars: mockAwardAirstars })
}

// ── Setup ─────────────────────────────────────────────────────────────────
// Default to real timers — fake timers + waitFor's polling interleave badly
// under parallel CPU pressure and produce flaky timeouts on the typeahead.
// The single test that needs fake timers (the 30s card-timeout case) opts in
// locally below.

beforeEach(() => {
  setupFetch()
  setupAuth()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('FlashcardGameModal — count picker', () => {
  it('renders the modal', async () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    expect(screen.getByTestId('flashcard-modal')).toBeDefined()
  })

  it('shows all 4 count options', async () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('count-option-5'))
    expect(screen.getByTestId('count-option-5')).toBeDefined()
    expect(screen.getByTestId('count-option-10')).toBeDefined()
    expect(screen.getByTestId('count-option-15')).toBeDefined()
    expect(screen.getByTestId('count-option-20')).toBeDefined()
  })

  it('disables count options exceeding available count', async () => {
    setupFetch({ available: 7 })
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('count-option-5'))
    expect(screen.getByTestId('count-option-5')).not.toBeDisabled()
    expect(screen.getByTestId('count-option-10')).toBeDisabled()
    expect(screen.getByTestId('count-option-15')).toBeDisabled()
    expect(screen.getByTestId('count-option-20')).toBeDisabled()
  })

  it('shows "not enough briefs" message when fewer than 5 available', async () => {
    setupFetch({ available: 3 })
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByText(/not enough completed briefs/i))
    expect(screen.queryByTestId('flashcard-start-btn')).toBeNull()
  })

  it('START DRILL button calls /start with selected count', async () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('flashcard-recall/start'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('close button calls onClose', async () => {
    const onClose = vi.fn()
    render(<FlashcardGameModal onClose={onClose} />)
    await waitFor(() => screen.getByLabelText('Close'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('FlashcardGameModal — game screen', () => {
  async function goToGame() {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => screen.getByTestId('blurred-title'))
  }

  it('shows blurred title element (no title text in card)', async () => {
    await goToGame()
    expect(screen.getByTestId('blurred-title')).toBeDefined()
    // The title should NOT be visible
    expect(screen.queryByText('F-35 Lightning II')).toBeNull()
  })

  it('shows category and subcategory', async () => {
    await goToGame()
    // First card is Aircrafts · Fast Jets
    expect(screen.getByText(/aircrafts/i)).toBeDefined()
  })

  it('shows section-4 content snippet (no subtitle)', async () => {
    await goToGame()
    // contentSnippet is section 4 — should show the name-free description text
    expect(screen.getByText(/stealthy multirole aircraft/i)).toBeDefined()
    // No subtitle element (subtitle is not part of card data)
    expect(screen.queryByText(/multirole fighter/i)).toBeNull()
  })

  it('search input is rendered', async () => {
    await goToGame()
    expect(screen.getByTestId('flashcard-search')).toBeDefined()
  })

  it('typeahead filters titles by typed text', async () => {
    await goToGame()
    const input = screen.getByTestId('flashcard-search')
    fireEvent.change(input, { target: { value: 'f-35' } })
    await waitFor(() => screen.getByTestId('flashcard-suggestions'))
    const items = screen.getAllByTestId('flashcard-suggestion-item')
    expect(items.some(el => el.textContent.includes('F-35 Lightning II'))).toBe(true)
  })

  it('selecting correct title shows green CORRECT feedback', async () => {
    await goToGame()
    const input = screen.getByTestId('flashcard-search')
    fireEvent.change(input, { target: { value: 'F-35' } })
    await waitFor(() => screen.getByTestId('flashcard-suggestion-item'))
    const correctItem = screen.getAllByTestId('flashcard-suggestion-item')
      .find(el => el.textContent === 'F-35 Lightning II')
    fireEvent.mouseDown(correctItem)
    await waitFor(() => screen.getByTestId('flashcard-feedback'))
    expect(screen.getByTestId('flashcard-feedback').textContent).toMatch(/correct/i)
  })

  it('selecting wrong title shows red INCORRECT feedback', async () => {
    await goToGame()
    const input = screen.getByTestId('flashcard-search')
    fireEvent.change(input, { target: { value: 'lossie' } })
    await waitFor(() => screen.getByTestId('flashcard-suggestion-item'))
    const wrongItem = screen.getAllByTestId('flashcard-suggestion-item')
      .find(el => el.textContent === 'RAF Lossiemouth')
    fireEvent.mouseDown(wrongItem)
    await waitFor(() => screen.getByTestId('flashcard-feedback'))
    expect(screen.getByTestId('flashcard-feedback').textContent).toMatch(/incorrect/i)
  })
})

describe('FlashcardGameModal — results screen', () => {
  async function completeGame({ airstarsEarned = 10 } = {}) {
    setupFetch({ available: 10, cards: [MOCK_CARDS[0]], airstarsEarned })
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => screen.getByTestId('flashcard-search'))
    const input = screen.getByTestId('flashcard-search')
    fireEvent.change(input, { target: { value: 'F-35' } })
    await waitFor(() => screen.getByTestId('flashcard-suggestion-item'))
    const item = screen.getAllByTestId('flashcard-suggestion-item')
      .find(el => el.textContent === 'F-35 Lightning II')
    fireEvent.mouseDown(item)
    // Wait for result screen
    await waitFor(() => screen.getByTestId('flashcard-breakdown'), { timeout: 3000 })
  }

  it('shows score on result screen', async () => {
    await completeGame()
    expect(screen.getByTestId('flashcard-breakdown')).toBeDefined()
  })

  it('DRILL AGAIN button resets to count picker', async () => {
    await completeGame()
    fireEvent.click(screen.getByTestId('flashcard-play-again'))
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    expect(screen.getByTestId('flashcard-start-btn')).toBeDefined()
  })

  it('calls awardAirstars with earned amount and server-returned cycle/total after game completes', async () => {
    await completeGame({ airstarsEarned: 10 })
    expect(mockAwardAirstars).toHaveBeenCalledTimes(1)
    expect(mockAwardAirstars).toHaveBeenCalledWith(
      10,
      'Flashcards',
      expect.objectContaining({ cycleAfter: 150, totalAfter: 500 }),
    )
  })

  it('does not call awardAirstars when airstarsEarned is 0', async () => {
    await completeGame({ airstarsEarned: 0 })
    expect(mockAwardAirstars).not.toHaveBeenCalled()
  })
})

describe('FlashcardGameModal — sounds', () => {
  beforeEach(() => {
    playSound.mockClear()
  })

  it('plays flashcard_start when the game begins', async () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => screen.getByTestId('blurred-title'))
    expect(playSound).toHaveBeenCalledWith('flashcard_start')
  })

  it('plays flashcard_correct when the correct answer is selected', async () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => screen.getByTestId('flashcard-search'))
    fireEvent.change(screen.getByTestId('flashcard-search'), { target: { value: 'F-35' } })
    await waitFor(() => screen.getByTestId('flashcard-suggestion-item'))
    const correctItem = screen.getAllByTestId('flashcard-suggestion-item')
      .find(el => el.textContent === 'F-35 Lightning II')
    fireEvent.mouseDown(correctItem)
    await waitFor(() => screen.getByTestId('flashcard-feedback'))
    expect(playSound).toHaveBeenCalledWith('flashcard_correct')
  })

  it('plays flashcard_incorrect when a wrong answer is selected', async () => {
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => screen.getByTestId('flashcard-search'))
    fireEvent.change(screen.getByTestId('flashcard-search'), { target: { value: 'lossie' } })
    await waitFor(() => screen.getByTestId('flashcard-suggestion-item'))
    const wrongItem = screen.getAllByTestId('flashcard-suggestion-item')
      .find(el => el.textContent === 'RAF Lossiemouth')
    fireEvent.mouseDown(wrongItem)
    await waitFor(() => screen.getByTestId('flashcard-feedback'))
    expect(playSound).toHaveBeenCalledWith('flashcard_incorrect')
  })

  it('plays flashcard_incorrect exactly once on timeout', async () => {
    // Fake timers must be installed BEFORE render, otherwise the modal's
    // setInterval is scheduled in real time and advanceTimersByTime can't
    // fire it. shouldAdvanceTime keeps wall clock ticking so waitFor's
    // polling still works.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<FlashcardGameModal onClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('flashcard-start-btn'))
    fireEvent.click(screen.getByTestId('flashcard-start-btn'))
    await waitFor(() => screen.getByTestId('blurred-title'))
    playSound.mockClear()
    // advanceTimersByTimeAsync yields to microtasks between each setInterval
    // tick so the React state updates from setTimeLeft can commit and the
    // t<=1 branch runs handleTimeout — sync advance batches everything and
    // the timeout never fires.
    await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
    await waitFor(() => expect(playSound).toHaveBeenCalledWith('flashcard_incorrect'))
    expect(playSound).toHaveBeenCalledTimes(1)
  }, 15000)
})
