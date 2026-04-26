import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BottomNav from '../BottomNav'

const consumePlayNavFlash = vi.hoisted(() => vi.fn())
const useGameChromeMock   = vi.hoisted(() => vi.fn())

vi.mock('../../../context/GameChromeContext', () => ({
  useGameChrome: () => useGameChromeMock(),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'u1', isAdmin: false } }),
}))

vi.mock('../../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: () => ({ hasAnyNew: false }),
}))

vi.mock('../../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({ hasAnyNew: false, firstNewCategory: null }),
}))

vi.mock('../../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0 }),
}))

vi.mock('../../ProfileBadge', () => ({ default: () => null }))

vi.mock('react-router-dom', () => ({
  NavLink: ({ children, to, ref, ...rest }) => (
    <a href={to} ref={ref} {...rest}>{children}</a>
  ),
  useLocation: () => ({ pathname: '/home' }),
  useNavigate: () => vi.fn(),
}))

beforeEach(() => {
  consumePlayNavFlash.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: false })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function chromeState({ immersive, pendingPlayNavFlash }) {
  return {
    immersive,
    enterImmersive: () => {},
    exitImmersive: () => {},
    pendingPlayNavFlash,
    requestPlayNavFlash: () => {},
    consumePlayNavFlash,
  }
}

describe('BottomNav — deferred play-nav flash consumer', () => {
  it('does not flash while immersive even if flag is pending', () => {
    useGameChromeMock.mockReturnValue(chromeState({ immersive: true, pendingPlayNavFlash: true }))
    const { container } = render(<BottomNav />)
    act(() => { vi.advanceTimersByTime(2000) })

    const playEl = container.querySelector('[data-nav="play"]')
    expect(playEl?.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()
  })

  it('flashes the play button after the slide-in delay when chrome is back', () => {
    useGameChromeMock.mockReturnValue(chromeState({ immersive: false, pendingPlayNavFlash: true }))
    const { container } = render(<BottomNav />)

    // Before slide-in delay: not yet flashing
    act(() => { vi.advanceTimersByTime(100) })
    const playEl = container.querySelector('[data-nav="play"]')
    expect(playEl?.classList.contains('play-nav-flash')).toBe(false)

    // After slide-in delay (>=320ms): flash applied + flag consumed
    act(() => { vi.advanceTimersByTime(300) })
    expect(playEl?.classList.contains('play-nav-flash')).toBe(true)
    expect(consumePlayNavFlash).toHaveBeenCalledTimes(1)

    // After flash duration: class removed
    act(() => { vi.advanceTimersByTime(1300) })
    expect(playEl?.classList.contains('play-nav-flash')).toBe(false)
  })

  it('does nothing when no flash is pending', () => {
    useGameChromeMock.mockReturnValue(chromeState({ immersive: false, pendingPlayNavFlash: false }))
    const { container } = render(<BottomNav />)
    act(() => { vi.advanceTimersByTime(2000) })

    const playEl = container.querySelector('[data-nav="play"]')
    expect(playEl?.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()
  })
})
