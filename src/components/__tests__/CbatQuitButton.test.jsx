import { StrictMode } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatQuitButton from '../CbatQuitButton'

// Run the deferred (setTimeout 0) guard-entry removal.
const flushTimers = () => act(() => { vi.runAllTimers() })

// The back-gesture guard drives window.history directly. Mock it so tests are
// deterministic (the guard's own JS flags, not jsdom's history stack, decide
// behaviour) and no real navigation happens between tests. Fake timers keep the
// deferred removal under each test's control so it can't leak across tests.
let pushSpy, backSpy
beforeEach(() => {
  vi.useFakeTimers()
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})
afterEach(() => {
  vi.clearAllTimers()   // discard any pending removal so it can't fire in a later test
  vi.useRealTimers()
  pushSpy.mockRestore()
  backSpy.mockRestore()
})

describe('CbatQuitButton — header button', () => {
  it('quits immediately without a prompt when no game is in progress', () => {
    const onConfirm = vi.fn()
    render(<CbatQuitButton onConfirm={onConfirm} confirmNeeded={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Instructions/ }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('cbat-quit-modal')).not.toBeInTheDocument()
  })

  it('asks for confirmation before quitting an in-progress game', () => {
    const onConfirm = vi.fn()
    render(<CbatQuitButton onConfirm={onConfirm} confirmNeeded />)

    fireEvent.click(screen.getByRole('button', { name: /Instructions/ }))

    // Prompt shown, but the game is not abandoned yet.
    expect(screen.getByTestId('cbat-quit-modal')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps playing when the player cancels', () => {
    const onConfirm = vi.fn()
    render(<CbatQuitButton onConfirm={onConfirm} confirmNeeded />)

    fireEvent.click(screen.getByRole('button', { name: /Instructions/ }))
    fireEvent.click(screen.getByTestId('cbat-quit-cancel'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cbat-quit-modal')).not.toBeInTheDocument()
  })

  it('quits once the player confirms', () => {
    const onConfirm = vi.fn()
    render(<CbatQuitButton onConfirm={onConfirm} confirmNeeded />)

    fireEvent.click(screen.getByRole('button', { name: /Instructions/ }))
    fireEvent.click(screen.getByTestId('cbat-quit-confirm'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('cbat-quit-modal')).not.toBeInTheDocument()
  })

  it('dismisses the prompt on Escape without quitting', () => {
    const onConfirm = vi.fn()
    render(<CbatQuitButton onConfirm={onConfirm} confirmNeeded />)

    fireEvent.click(screen.getByRole('button', { name: /Instructions/ }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cbat-quit-modal')).not.toBeInTheDocument()
  })

  it('supports a custom label for the odd game out', () => {
    render(<CbatQuitButton onConfirm={vi.fn()} label={<>&larr; Quit</>} />)
    expect(screen.getByRole('button', { name: /Quit/ })).toBeInTheDocument()
  })
})

describe('CbatQuitButton — mobile back-gesture guard', () => {
  it('pushes a guard history entry while a game is in progress', () => {
    render(<CbatQuitButton onConfirm={vi.fn()} confirmNeeded />)
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('does not guard, and ignores back presses, when no game is in progress', () => {
    render(<CbatQuitButton onConfirm={vi.fn()} confirmNeeded={false} />)
    expect(pushSpy).not.toHaveBeenCalled()

    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(screen.queryByTestId('cbat-quit-modal')).not.toBeInTheDocument()
  })

  it('turns a back press into the quit prompt instead of leaving', () => {
    const onConfirm = vi.fn()
    render(<CbatQuitButton onConfirm={onConfirm} confirmNeeded />)
    pushSpy.mockClear()

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    // Re-holds the user on the page and opens the prompt, without quitting.
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('cbat-quit-modal')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not stack a second prompt on a repeated back press', () => {
    render(<CbatQuitButton onConfirm={vi.fn()} confirmNeeded />)

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(screen.getAllByTestId('cbat-quit-modal')).toHaveLength(1)
  })

  it('drops the guard entry when the game ends', () => {
    const { rerender } = render(<CbatQuitButton onConfirm={vi.fn()} confirmNeeded />)
    rerender(<CbatQuitButton onConfirm={vi.fn()} confirmNeeded={false} />)
    flushTimers()
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('drops the guard entry on unmount', () => {
    const { unmount } = render(<CbatQuitButton onConfirm={vi.fn()} confirmNeeded />)
    unmount()
    flushTimers()
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('does not prompt or pop history on entry under a StrictMode double-mount', () => {
    // Regression: the cleanup used to pop history synchronously between the two
    // StrictMode mounts, firing a popstate the remounted listener read as a
    // back press — so entering a game immediately showed the quit prompt.
    render(
      <StrictMode>
        <CbatQuitButton onConfirm={vi.fn()} confirmNeeded />
      </StrictMode>
    )
    flushTimers()

    expect(screen.queryByTestId('cbat-quit-modal')).not.toBeInTheDocument()
    expect(backSpy).not.toHaveBeenCalled()
  })
})
