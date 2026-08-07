import { render, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Text selection is OFF app-wide (body { user-select: none }) so the site feels
// like an app rather than a document. Community is the exception, for admins:
// moderation means quoting what someone actually said.
const mockUser     = vi.hoisted(() => ({ value: null }))
const mockSettings = vi.hoisted(() => ({ value: { chatEnabled: true } }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  Navigate: () => null,
  Link: ({ children }) => <span>{children}</span>,
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.value, API: '', apiFetch: vi.fn() }),
}))
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: mockSettings.value, loading: false }),
}))
// The panes fetch their own data; this file is only about the body class.
vi.mock('../ChatShell', () => ({ default: () => <div>shell</div> }))
vi.mock('../CommunityConsole', () => ({ default: () => <div>console</div> }))
vi.mock('../../../components/SEO', () => ({ default: () => null }))

import Chat, { ChatAdminRoute } from '../Chat'

const selectable = () => document.body.classList.contains('community-selectable')

describe('Community text selection', () => {
  beforeEach(() => { document.body.className = '' })
  afterEach(() => { cleanup(); document.body.className = '' })

  it('lets an admin select text in Community', () => {
    mockUser.value = { _id: 'a1', isAdmin: true }
    render(<Chat />)
    expect(selectable()).toBe(true)
  })

  it('leaves an ordinary agent with the app-wide behaviour', () => {
    mockUser.value = { _id: 'u1', isAdmin: false }
    render(<Chat />)
    expect(selectable()).toBe(false)
  })

  it('applies in the admin console too, not just the channel list', () => {
    // Moderation reads all three Community surfaces, which is why the class is
    // applied at the shared route gate rather than in one pane.
    mockUser.value = { _id: 'a1', isAdmin: true }
    render(<ChatAdminRoute />)
    expect(selectable()).toBe(true)
  })

  it('stops applying once Community is left', () => {
    mockUser.value = { _id: 'a1', isAdmin: true }
    const view = render(<Chat />)
    expect(selectable()).toBe(true)

    view.unmount()
    expect(selectable()).toBe(false)
  })
})
