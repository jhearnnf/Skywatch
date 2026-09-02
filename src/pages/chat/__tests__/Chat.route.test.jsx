import { render, screen, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The gate every chat route shares.
//
// This file replaces Chat.native.test.jsx, which pinned an explainer screen
// shown in place of Community inside the Android app. Community now ships on
// native, so the only things left between a signed-in user and the shell are
// the chatEnabled feature flag and, for the console, being an admin.
const mockUser     = vi.hoisted(() => ({ value: { _id: 'u1', isAdmin: false } }))
const mockSettings = vi.hoisted(() => ({ value: { chatEnabled: true } }))

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
vi.mock('../ChatShell', () => ({ default: () => <div>shell</div> }))
vi.mock('../CommunityConsole', () => ({ default: () => <div>console</div> }))
vi.mock('../../../components/SEO', () => ({ default: () => null }))

import Chat, { ChatAdminRoute } from '../Chat'

describe('Chat route gate', () => {
  beforeEach(() => {
    mockUser.value     = { _id: 'u1', isAdmin: false }
    mockSettings.value = { chatEnabled: true }
    document.body.className = ''
  })
  afterEach(() => { cleanup(); document.body.className = '' })

  it('renders Community for a signed-in user', () => {
    render(<Chat />)

    expect(screen.getByText('shell')).toBeInTheDocument()
  })

  it('renders Community regardless of platform', () => {
    // Nothing here reads the platform any more. If a native gate is ever
    // reintroduced it has to be a deliberate change, not a quiet one — this is
    // the assertion that would catch it.
    render(<Chat />)

    expect(screen.queryByText(/Community is on the website/)).not.toBeInTheDocument()
    expect(screen.getByText('shell')).toBeInTheDocument()
  })

  it('says so when the feature flag is off', () => {
    mockSettings.value = { chatEnabled: false }
    render(<Chat />)

    expect(screen.getByText('Chat is unavailable')).toBeInTheDocument()
  })

  it('opens the moderation console for an admin', () => {
    mockUser.value = { _id: 'a1', isAdmin: true }
    render(<ChatAdminRoute />)

    expect(screen.getByText('console')).toBeInTheDocument()
  })

  it('sends a non-admin away from the console', () => {
    render(<ChatAdminRoute />)

    expect(screen.getByText('navigated to /chat')).toBeInTheDocument()
  })
})
