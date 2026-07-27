import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LoginPage from '../Login'

// Google sign-in used to live only on the chooser you get from the navbar, so
// every route that deep-links into the form — the landing CTA, the locked-brief
// modal, the welcome flow, the game tiles — offered email and password only.
// Whichever door a visitor comes through, the account they already have has to
// be on the screen.

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())
const search       = vi.hoisted(() => ({ value: '' }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ search: search.value }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
  storeNativeToken: vi.fn(),
}))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: {} }) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../lib/posthog', () => ({ captureEvent: vi.fn() }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const renderAt = (query) => {
  search.value = query
  return render(<LoginPage />)
}

describe('Login — Google is offered wherever you land', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      setUser: vi.fn(), awardAirstars: vi.fn(), API: '', apiFetch: vi.fn(),
    })
  })
  afterEach(() => { vi.clearAllMocks(); search.value = '' })

  it('offers it on the chooser, as it always did', () => {
    renderAt('')
    expect(screen.getByTestId('google-signin')).toBeTruthy()
  })

  it('offers it when the landing CTA drops you straight into signup', () => {
    // /login?tab=register — "Start practising free", the locked-brief modal,
    // the welcome flow and every demo game tile.
    renderAt('?tab=register')
    expect(screen.getByText('Join SkyWatch')).toBeTruthy()
    expect(screen.getByTestId('google-signin')).toBeTruthy()
  })

  it('offers it on the sign-in form too', () => {
    renderAt('?tab=signin')
    expect(screen.getByText('Welcome back')).toBeTruthy()
    expect(screen.getByTestId('google-signin')).toBeTruthy()
  })

  it('keeps it in view when the visitor switches between the two forms', () => {
    renderAt('?tab=register')
    fireEvent.click(screen.getByText('Sign in'))
    expect(screen.getByText('Welcome back')).toBeTruthy()
    expect(screen.getByTestId('google-signin')).toBeTruthy()
  })

  it('puts it above the email form, not buried under it', () => {
    const { container } = renderAt('?tab=register')
    const google = screen.getByTestId('google-signin')
    const form = container.querySelector('form')
    // Node.compareDocumentPosition: 4 = form follows google.
    expect(google.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
