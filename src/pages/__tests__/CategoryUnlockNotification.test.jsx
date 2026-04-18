import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CategoryUnlockNotification from '../../components/CategoryUnlockNotification'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, 'aria-live': ariaLive }) =>
           <div className={className} aria-live={ariaLive}>{children}</div>,
    span: ({ children, className }) => <span className={className}>{children}</span>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

describe('CategoryUnlockNotification', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('renders the singular label and category when one category is unlocked', () => {
    render(<CategoryUnlockNotification categories={['Aircraft']} onDone={vi.fn()} />)
    expect(screen.getByText('Pathway Unlocked')).toBeDefined()
    expect(screen.getByText('Aircraft')).toBeDefined()
    expect(screen.getByText(/New Pathway now available/)).toBeDefined()
  })

  it('joins multiple categories with a middle dot and uses plural label', () => {
    render(<CategoryUnlockNotification categories={['Aircraft', 'Tech', 'Threats']} onDone={vi.fn()} />)
    expect(screen.getByText('Aircraft · Tech · Threats')).toBeDefined()
    expect(screen.getByText(/New Pathways now available/)).toBeDefined()
  })

  it('handles empty array gracefully', () => {
    render(<CategoryUnlockNotification categories={[]} onDone={vi.fn()} />)
    expect(screen.getByText('Pathway Unlocked')).toBeDefined()
  })

  it('calls onDone after 5000ms', () => {
    const onDone = vi.fn()
    render(<CategoryUnlockNotification categories={['Aircraft']} onDone={onDone} />)
    expect(onDone).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(4999) })
    expect(onDone).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
