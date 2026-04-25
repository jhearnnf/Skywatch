import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AppShell from '../AppShell'

const mockUseLocation   = vi.hoisted(() => vi.fn())
const mockUseGameChrome = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useLocation: () => mockUseLocation(),
  Link:    ({ children, ...rest }) => <a {...rest}>{children}</a>,
  NavLink: ({ children, ...rest }) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

vi.mock('../../../context/GameChromeContext', () => ({
  useGameChrome: () => mockUseGameChrome(),
}))

// Stub TopBar/Sidebar/BottomNav so we don't drag in their dependency trees.
vi.mock('../TopBar',    () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock('../Sidebar',   () => ({ default: () => <div data-testid="sidebar" /> }))
vi.mock('../BottomNav', () => ({ default: () => <div data-testid="bottomnav" /> }))

function shellRoot(container) {
  return container.querySelector('.app-shell')
}

describe('AppShell — immersive + cbat-route classes', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue({ pathname: '/home' })
    mockUseGameChrome.mockReturnValue({ immersive: false })
  })

  it('adds neither class on a non-cbat route with immersive off', () => {
    const { container } = render(<AppShell><div /></AppShell>)
    const root = shellRoot(container)
    expect(root).toBeTruthy()
    expect(root.className).not.toContain('chrome-immersive')
    expect(root.className).not.toContain('cbat-route')
  })

  it('adds chrome-immersive when useGameChrome().immersive is true', () => {
    mockUseGameChrome.mockReturnValue({ immersive: true })
    const { container } = render(<AppShell><div /></AppShell>)
    expect(shellRoot(container).className).toContain('chrome-immersive')
  })

  it('adds cbat-route on /cbat/* paths but not on /cbat itself', () => {
    mockUseLocation.mockReturnValue({ pathname: '/cbat/target' })
    const { container: c1 } = render(<AppShell><div /></AppShell>)
    expect(shellRoot(c1).className).toContain('cbat-route')

    mockUseLocation.mockReturnValue({ pathname: '/cbat' })
    const { container: c2 } = render(<AppShell><div /></AppShell>)
    expect(shellRoot(c2).className).not.toContain('cbat-route')
  })

  it('returns bare children (no shell, no classes) for BARE_PAGES', () => {
    mockUseLocation.mockReturnValue({ pathname: '/login' })
    mockUseGameChrome.mockReturnValue({ immersive: true })
    const { container } = render(<AppShell><div data-testid="bare-child" /></AppShell>)
    expect(shellRoot(container)).toBeNull()
    expect(container.querySelector('[data-testid="bare-child"]')).toBeTruthy()
  })

  it('tags inner wrapper with app-shell-content for CSS hooks', () => {
    mockUseLocation.mockReturnValue({ pathname: '/cbat/target' })
    const { container } = render(<AppShell><div /></AppShell>)
    expect(container.querySelector('.app-shell-content')).toBeTruthy()
    expect(container.querySelector('.app-shell-body')).toBeTruthy()
    expect(container.querySelector('.app-shell-main')).toBeTruthy()
  })
})
