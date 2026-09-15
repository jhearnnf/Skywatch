import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import TopBar from '../TopBar'
import ThemeHoldSwitch, { HOLD_MS, LOCKED_LABEL } from '../ThemeHoldSwitch'
import ThemeSelector from '../ThemeSelector'
import { UI_THEME_TAGLINES } from '../../../lib/uiTheme'
import { FLASH_MS } from '../ThemeFlash'

// A phone's bar has no room for the two-option selector, so it gets a faint
// "Switch theme" label instead. A press-and-hold fills a bar along the top
// of the screen and, once full, flips the theme and flashes its name over the
// page; letting go early turns the label into "Hold to switch" for a moment.
// Desktop keeps the full selector, which runs the same sweep and flash from
// the clicked key.

const auth = vi.hoisted(() => ({
  user: { _id: 'u1', uiTheme: 'skywatch' },
  setUser: vi.fn(),
  apiFetch: vi.fn(),
  API: '',
  logout: vi.fn(),
}))
const transition = vi.hoisted(() => ({ animate: vi.fn() }))
const inProgress = vi.hoisted(() => ({ value: false }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/cbat', state: null, search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))
vi.mock('../../../hooks/useCbatGameInProgress', () => ({
  useCbatGameInProgress: () => inProgress.value,
}))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../../hooks/useSlimMode', () => ({
  useSlimMode: () => true,
  useLandingPageEnabled: () => true,
}))
vi.mock('../OfflineBadge', () => ({ default: () => null }))
vi.mock('../../ProfileBadge', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))
// The page sweep is DOM/animation work covered by the browser; here it just
// runs the commit so the flow can be followed.
vi.mock('../../../lib/themeTransition', () => ({
  animateThemeSwitch: (commit, at, theme) => { transition.animate(at, theme); commit(); return Promise.resolve() },
}))

const hold = (ms) => act(() => { vi.advanceTimersByTime(ms) })
// Fake timers stall waitFor, so settle the promise chain by hand
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

describe('TopBar theme controls', () => {
  it('carries the full selector for desktop and the hold control for the phone', () => {
    render(<TopBar />)
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByTestId('theme-hold-switch')).toHaveTextContent('Switch theme')
  })
})

describe('ThemeHoldSwitch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    auth.user = { _id: 'u1', uiTheme: 'skywatch' }
    auth.setUser.mockReset()
    auth.apiFetch.mockReset()
    transition.animate.mockReset()
    inProgress.value = false
  })
  afterEach(() => { vi.useRealTimers() })

  describe('while a CBAT test is running', () => {
    beforeEach(() => { inProgress.value = true })

    it('a full hold changes nothing and the label says the theme is locked', async () => {
      render(<ThemeHoldSwitch />)
      const btn = screen.getByTestId('theme-hold-switch')
      expect(btn.getAttribute('aria-disabled')).toBe('true')
      fireEvent.pointerDown(btn, { button: 0, pointerId: 1 })
      expect(btn).toHaveTextContent(LOCKED_LABEL)
      hold(HOLD_MS + 50)
      // No fill bar, no sweep, no flip, no save
      expect(screen.queryByTestId('theme-hold-bar')).toBeNull()
      expect(transition.animate).not.toHaveBeenCalled()
      fireEvent.pointerUp(btn, { pointerId: 1 })
      await settle()
      expect(auth.setUser).not.toHaveBeenCalled()
      expect(auth.apiFetch).not.toHaveBeenCalled()
      expect(btn).toHaveTextContent(LOCKED_LABEL)
    })
  })

  it('a plain tap changes nothing and turns the label into the hint for a moment', () => {
    render(<ThemeHoldSwitch />)
    const btn = screen.getByTestId('theme-hold-switch')
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1 })
    hold(200)
    fireEvent.pointerUp(btn, { pointerId: 1 })
    expect(auth.apiFetch).not.toHaveBeenCalled()
    expect(btn).toHaveTextContent('Hold to switch')
    expect(screen.queryByTestId('theme-hold-bar')).toBeNull()
    hold(2000)
    expect(btn).toHaveTextContent('Switch theme')
  })

  it('fills the bar while held and flips the theme once full', async () => {
    auth.apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { user: { _id: 'u1', uiTheme: 'cbat' } } }) })
    render(<ThemeHoldSwitch />)
    const btn = screen.getByTestId('theme-hold-switch')
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1 })
    hold(HOLD_MS / 2)
    const bar = screen.getByTestId('theme-hold-bar')
    const half = Number(bar.style.transform.match(/scaleX\(([\d.]+)\)/)[1])
    expect(half).toBeGreaterThan(0.3)
    expect(half).toBeLessThan(0.7)
    expect(auth.apiFetch).not.toHaveBeenCalled()

    hold(HOLD_MS / 2 + 50)
    expect(transition.animate).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), 'cbat')
    expect(screen.queryByTestId('theme-hold-bar')).toBeNull()
    await settle()
    expect(auth.apiFetch).toHaveBeenCalledWith('/api/users/me/theme', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'cbat' }) }))
    expect(screen.getByTestId('theme-flash')).toHaveTextContent('Real CBAT')
    expect(screen.getByTestId('theme-flash')).toHaveTextContent(UI_THEME_TAGLINES.cbat)
    expect(auth.setUser).toHaveBeenCalledWith({ _id: 'u1', uiTheme: 'cbat' })
    // Still there after the old one-beat flash would have gone: the tagline needs reading time
    hold(1200)
    expect(screen.getByTestId('theme-flash')).toHaveTextContent(UI_THEME_TAGLINES.cbat)
    hold(FLASH_MS - 1200 + 50)
    expect(screen.queryByTestId('theme-flash')).toBeNull()
  })

  it('offers the way back from Real CBAT', () => {
    auth.user = { _id: 'u1', uiTheme: 'cbat' }
    render(<ThemeHoldSwitch />)
    expect(screen.getByRole('button', { name: /switch theme to SkyWatch/ })).toBeInTheDocument()
  })

  it('pulls the flash when the save fails', async () => {
    auth.apiFetch.mockRejectedValue(new Error('offline'))
    render(<ThemeHoldSwitch />)
    const btn = screen.getByTestId('theme-hold-switch')
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1 })
    hold(HOLD_MS + 50)
    await settle()
    expect(screen.queryByTestId('theme-flash')).toBeNull()
  })
})

describe('ThemeSelector (desktop)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    auth.user = { _id: 'u1', uiTheme: 'skywatch' }
    auth.setUser.mockReset()
    auth.apiFetch.mockReset()
    transition.animate.mockReset()
  })
  afterEach(() => { vi.useRealTimers() })

  it('sweeps from the clicked key and flashes the name', async () => {
    auth.apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { user: { _id: 'u1', uiTheme: 'cbat' } } }) })
    render(<ThemeSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'Real CBAT' }))
    expect(transition.animate).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), 'cbat')
    await settle()
    expect(screen.getByTestId('theme-flash')).toHaveTextContent('Real CBAT')
    expect(screen.getByTestId('theme-flash')).toHaveTextContent(UI_THEME_TAGLINES.cbat)
    expect(auth.apiFetch).toHaveBeenCalledWith('/api/users/me/theme', expect.objectContaining({ method: 'PATCH' }))
    hold(FLASH_MS + 50)
    expect(screen.queryByTestId('theme-flash')).toBeNull()
  })
})
