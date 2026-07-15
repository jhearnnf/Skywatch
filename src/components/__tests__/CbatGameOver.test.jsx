import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatGameOver from '../CbatGameOver'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, state }) => (
    <a href={to} data-state={state ? JSON.stringify(state) : undefined}>{children}</a>
  ),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
}))

// Drive the score count-up (a requestAnimationFrame loop) to its final frame
// synchronously so the displayed score settles within a single render pass.
beforeEach(() => {
  let t = 0
  vi.stubGlobal('requestAnimationFrame', (cb) => { t += 800; cb(t); return t })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

const weeklyData = (over = {}) => ({
  played: true, rank: 3, weekTotal: 300, plays: 2,
  resetsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  neighbors: [
    { rank: 2, weekTotal: 420, plays: 3, name: 'Maverick', isMe: false },
    { rank: 3, weekTotal: 300, plays: 2, name: 'Agent A001', isMe: true },
    { rank: 4, weekTotal: 240, plays: 1, name: 'Goose', isMe: false },
  ],
  ...over,
})

function setup({ apiFetch } = {}) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' }, API: '',
    apiFetch: apiFetch || vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: weeklyData() }) }),
  })
}

const baseProps = {
  gameKey: 'target', score: 300, scoreSaved: true, queued: false,
  personalBest: { bestScore: 250, attempts: 4 }, onPlayAgain: vi.fn(),
}

describe('CbatGameOver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the score and the breakdown inline on one screen (no View Results step)', () => {
    setup()
    render(<CbatGameOver {...baseProps}><div>BREAKDOWN_PANEL</div></CbatGameOver>)

    expect(screen.getByText('300')).toBeDefined()              // personal beat score
    expect(screen.getByText('BREAKDOWN_PANEL')).toBeDefined()  // breakdown always visible
    expect(screen.queryByRole('button', { name: /view results/i })).toBeNull()
  })

  it('renders a View Leaderboard link and any extra tertiary actions', () => {
    setup()
    const onExtra = vi.fn()
    render(
      <CbatGameOver {...baseProps} extraActions={[{ label: 'Change Aircraft', onClick: onExtra }]}>
        <div />
      </CbatGameOver>
    )
    expect(screen.getByRole('link', { name: /view leaderboard/i })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /change aircraft/i }))
    expect(onExtra).toHaveBeenCalled()
  })

  it('the View Leaderboard link carries fromGame state so the destination can play the rank-move slide', () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    const link = screen.getByRole('link', { name: /view leaderboard/i })
    expect(link.getAttribute('data-state')).toBe(JSON.stringify({ fromGame: true }))
  })

  it('flags a personal best when the run beats the previous best', () => {
    setup()
    render(<CbatGameOver {...baseProps} score={300} personalBest={{ bestScore: 250 }}><div /></CbatGameOver>)
    expect(screen.getByText(/personal best/i)).toBeDefined()
  })

  it('shows the previous best (not a PB) when the run is lower', () => {
    setup()
    render(<CbatGameOver {...baseProps} score={100} personalBest={{ bestScore: 250 }}><div /></CbatGameOver>)
    expect(screen.getByText(/Best\s*250/i)).toBeDefined()
    expect(screen.queryByText(/personal best/i)).toBeNull()
  })

  it('renders the weekly chase window with a "pts to pass" target', async () => {
    setup()
    render(<CbatGameOver {...baseProps}><div /></CbatGameOver>)
    // 420 (Maverick, rank above) - 300 (me) = 120 pts to pass
    await waitFor(() => expect(screen.getByText(/120 pts to pass/i)).toBeDefined())
    expect(screen.getAllByText(/Maverick/).length).toBeGreaterThan(0) // appears in row + chase line
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })

  it('skips the weekly fetch and shows an offline notice when queued', async () => {
    const apiFetch = vi.fn()
    setup({ apiFetch })
    render(<CbatGameOver {...baseProps} queued={true} scoreSaved={false}><div /></CbatGameOver>)

    await waitFor(() => expect(screen.getByText(/updates when you reconnect/i)).toBeDefined())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('calls onPlayAgain from the reveal', () => {
    setup()
    const onPlayAgain = vi.fn()
    render(<CbatGameOver {...baseProps} onPlayAgain={onPlayAgain}><div /></CbatGameOver>)
    fireEvent.click(screen.getByRole('button', { name: /play again/i }))
    expect(onPlayAgain).toHaveBeenCalled()
  })
})
