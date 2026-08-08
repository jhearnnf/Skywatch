import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Community does not ship in the native app. Reaching /chat there used to
// redirect to /cbat, which read as a broken link; it now explains where
// Community lives. These tests pin both halves of that: the explainer shows on
// native, and nothing about the web behaviour moved.
const mockUser      = vi.hoisted(() => ({ value: { _id: 'u1', isAdmin: false } }))
const mockSettings  = vi.hoisted(() => ({ value: { chatEnabled: true } }))
const mockNativeApp = vi.hoisted(() => ({ value: false }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  Navigate: ({ to }) => <div>navigated to {to}</div>,
  Link: ({ children }) => <span>{children}</span>,
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.value, API: '', apiFetch: vi.fn() }),
}))
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: mockSettings.value, loading: false }),
}))
// NATIVE_APP is a module-load constant; mock it per-test via the shared ref.
vi.mock('../../../utils/appMode', () => ({
  get NATIVE_APP() { return mockNativeApp.value },
}))
vi.mock('../ChatShell', () => ({ default: () => <div>shell</div> }))
vi.mock('../CommunityConsole', () => ({ default: () => <div>console</div> }))
vi.mock('../../../components/SEO', () => ({ default: () => null }))

import Chat, { ChatAdminRoute } from '../Chat'

describe('Community in the native app', () => {
  beforeEach(() => {
    mockNativeApp.value = false
    mockUser.value      = { _id: 'u1', isAdmin: false }
    document.body.className = ''
  })
  afterEach(() => { cleanup(); document.body.className = '' })

  it('explains where Community lives instead of silently redirecting', () => {
    mockNativeApp.value = true
    render(<Chat />)

    expect(screen.getByText('Community is on the website')).toBeInTheDocument()
    expect(screen.getByText('skywatch.academy/chat')).toBeInTheDocument()
    // The old behaviour — a bounce to the games screen — is what made a deep
    // link look broken.
    expect(screen.queryByText(/navigated to/)).not.toBeInTheDocument()
  })

  it('offers the address as copyable text rather than a link', () => {
    // A link would open the messages inside the WebView, which is precisely
    // what keeping Community off native is meant to avoid.
    mockNativeApp.value = true
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    const { container } = render(<Chat />)
    expect(container.querySelector('a')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }))
    expect(writeText).toHaveBeenCalledWith('https://skywatch.academy/chat')
    return waitFor(() => expect(screen.getByRole('button', { name: '✓ Copied!' })).toBeInTheDocument())
      .finally(() => vi.unstubAllGlobals())
  })

  it('covers the admin console too, which shows the same messages', () => {
    mockNativeApp.value = true
    mockUser.value = { _id: 'a1', isAdmin: true }
    render(<ChatAdminRoute />)

    expect(screen.getByText('Community is on the website')).toBeInTheDocument()
    expect(screen.queryByText('console')).not.toBeInTheDocument()
  })

  it('still renders Community on the web', () => {
    render(<Chat />)

    expect(screen.getByText('shell')).toBeInTheDocument()
    expect(screen.queryByText('Community is on the website')).not.toBeInTheDocument()
  })

  it('leaves the disabled-feature message alone on the web', () => {
    mockSettings.value = { chatEnabled: false }
    render(<Chat />)

    expect(screen.getByText('Chat is unavailable')).toBeInTheDocument()
    mockSettings.value = { chatEnabled: true }
  })
})
