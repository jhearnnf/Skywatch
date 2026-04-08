import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import AircoinNotification from '../../components/AircoinNotification'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, 'aria-live': ariaLive, ...rest }) =>
           <div className={className} aria-live={ariaLive}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AircoinNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the awarded amount', () => {
    render(<AircoinNotification amount={15} label="Brief Read Reward" onDone={vi.fn()} />)
    expect(screen.getByText('+15 Aircoins')).toBeDefined()
  })

  it('renders the label', () => {
    render(<AircoinNotification amount={7} label="Daily Brief" onDone={vi.fn()} />)
    expect(screen.getByText('Daily Brief')).toBeDefined()
  })

  it('uses default label when none is supplied', () => {
    render(<AircoinNotification amount={5} onDone={vi.fn()} />)
    expect(screen.getByText('Brief Read Reward')).toBeDefined()
  })

  it('calls onDone after 2800ms', () => {
    const onDone = vi.fn()
    render(<AircoinNotification amount={10} label="Test" onDone={onDone} />)

    expect(onDone).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(2799) })
    expect(onDone).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('does not call onDone before the timer fires', () => {
    const onDone = vi.fn()
    render(<AircoinNotification amount={10} label="Test" onDone={onDone} />)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('renders with aria-live for accessibility', () => {
    render(<AircoinNotification amount={5} label="Test" onDone={vi.fn()} />)
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('displays different amounts correctly', () => {
    const { rerender } = render(<AircoinNotification amount={1} label="x" onDone={vi.fn()} />)
    expect(screen.getByText('+1 Aircoins')).toBeDefined()

    rerender(<AircoinNotification amount={9999} label="x" onDone={vi.fn()} />)
    expect(screen.getByText('+9999 Aircoins')).toBeDefined()
  })
})
