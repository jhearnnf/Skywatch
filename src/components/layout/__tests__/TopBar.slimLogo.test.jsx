import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import TopBar from '../TopBar'

// The logo is the only route back to the landing page in slim mode — the nav
// there is CBAT + Profile only. So it must track exactly whether a landing page
// exists to reach: on when web slim keeps it, off on native and when an admin
// turns it off. A link to a page that redirects straight back is worse than no
// link at all.

const landingEnabled = vi.hoisted(() => ({ value: true }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}))
vi.mock('../../../hooks/useSlimMode', () => ({
  useSlimMode: () => true,
  useLandingPageEnabled: () => landingEnabled.value,
}))
vi.mock('../OfflineBadge', () => ({ default: () => null }))

const homeLink = () =>
  screen.queryAllByRole('link').find((a) => a.getAttribute('href') === '/')

describe('TopBar logo in slim mode', () => {
  beforeEach(() => { landingEnabled.value = true })

  it('links to the landing page when there is one', () => {
    render(<TopBar />)
    expect(homeLink()).toBeDefined()
  })

  it('is inert when the landing page is turned off', () => {
    landingEnabled.value = false
    render(<TopBar />)
    expect(homeLink()).toBeUndefined()
  })

  it('still shows the brand mark either way', () => {
    landingEnabled.value = false
    render(<TopBar />)
    expect(screen.getByText('SKYWATCH')).toBeDefined()
  })
})
