import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
    refreshUser: vi.fn(),
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: [],
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: vi.fn().mockReturnValue(false) }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(),
}))

// Controllable slim-mode flag — flipped per test.
let slimValue = false
vi.mock('../../hooks/useSlimMode', () => ({
  useSlimMode: () => slimValue,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const TARGET = {
  _id: 'u1', agentNumber: '001', displayName: 'Maverick', email: 'plain@test.com',
  subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0, logins: [],
  difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false,
  profileStats: { brifsRead: 0 },
}

function setupFetch(users, emailSpy) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.match(/\/api\/admin\/users\/[^/]+\/email$/) && opts?.method === 'POST') {
      emailSpy?.(url, opts)
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { sentTo: 'plain@test.com' } }) })
    }
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function navigateToUsers() {
  const tab = await screen.findByRole('button', { name: /users/i })
  fireEvent.click(tab)
}

// Expand the single user row so the action buttons render.
async function expandRow() {
  const header = await screen.findByText('Maverick')
  fireEvent.click(header)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: email user', () => {
  beforeEach(() => {
    slimValue = false
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('opens the email modal pre-populated with the Android invite draft and sends', async () => {
    const emailSpy = vi.fn()
    global.fetch = setupFetch([TARGET], emailSpy)

    render(<Admin />)
    await navigateToUsers()
    await expandRow()

    fireEvent.click(screen.getByRole('button', { name: /email this user/i }))

    // Modal populated from the enabled draft
    await waitFor(() => screen.getByText(/Email User/i))
    const subject = screen.getByDisplayValue(/invited to test the SkyWatch Android app/i)
    expect(subject).toBeTruthy()
    // Personalised body references the display name
    expect(screen.getByDisplayValue(/Hello Maverick/i, { exact: false })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /send email/i }))

    await waitFor(() => expect(emailSpy).toHaveBeenCalled())
    const [url, opts] = emailSpy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/email$/)
    const body = JSON.parse(opts.body)
    expect(body.type).toBe('app_invite')
    expect(body.subject).toMatch(/Android app/i)
    expect(body.body).toMatch(/Hello Maverick/)
  })

  it('defaults to the Android invite draft and can switch to the Gold Granted draft', async () => {
    const emailSpy = vi.fn()
    global.fetch = setupFetch([TARGET], emailSpy)

    render(<Admin />)
    await navigateToUsers()
    await expandRow()

    fireEvent.click(screen.getByRole('button', { name: /email this user/i }))
    await waitFor(() => screen.getByText(/Email User/i))

    // Default selection is the invite
    expect(screen.getByDisplayValue(/invited to test the SkyWatch Android app/i)).toBeTruthy()

    // Switch to Gold Granted → fields repopulate
    fireEvent.click(screen.getByRole('button', { name: /gold granted/i }))
    await waitFor(() => screen.getByDisplayValue(/upgraded to Gold/i))
    expect(screen.getByDisplayValue(/We’ve upgraded your SkyWatch account to Gold/i, { exact: false })).toBeTruthy()

    // Gold draft has no CTA button — the preview renders none
    const srcdoc = screen.getByTitle('Email preview').getAttribute('srcdoc')
    expect(srcdoc).not.toMatch(/Explore Gold/)
    expect(srcdoc).not.toMatch(/\{\{button\}\}/)

    fireEvent.click(screen.getByRole('button', { name: /send email/i }))
    await waitFor(() => expect(emailSpy).toHaveBeenCalled())
    const body = JSON.parse(emailSpy.mock.calls[0][1].body)
    expect(body.type).toBe('gold_granted')
    expect(body.subject).toMatch(/Gold/)
  })

  it('renders a live preview iframe that reflects the composed email and body edits', async () => {
    global.fetch = setupFetch([TARGET])

    render(<Admin />)
    await navigateToUsers()
    await expandRow()

    fireEvent.click(screen.getByRole('button', { name: /email this user/i }))
    await waitFor(() => screen.getByText(/Preview/i))

    const iframe = screen.getByTitle('Email preview')
    // Draft content is rendered into the preview via srcDoc
    expect(iframe.getAttribute('srcdoc')).toContain('Hello Maverick')
    expect(iframe.getAttribute('srcdoc')).toContain('Join the Testers Group')

    // Editing the body updates the preview live
    const body = screen.getByDisplayValue(/Hello Maverick/i, { exact: false })
    fireEvent.change(body, { target: { value: 'Fresh body copy here.' } })
    await waitFor(() => expect(screen.getByTitle('Email preview').getAttribute('srcdoc')).toContain('Fresh body copy here.'))
  })

  it('greys out the chat button when CBAT slim mode is enabled', async () => {
    slimValue = true
    global.fetch = setupFetch([TARGET])

    render(<Admin />)
    await navigateToUsers()
    await expandRow()

    const chatBtn = screen.getByRole('button', { name: /messaging unavailable/i })
    expect(chatBtn.disabled).toBe(true)

    // Award Airstars is also disabled — airstars are unused in slim mode
    const awardBtn = screen.getByRole('button', { name: /award airstars unavailable/i })
    expect(awardBtn.disabled).toBe(true)

    // The email button remains available in slim mode
    expect(screen.getByRole('button', { name: /email this user/i })).toBeTruthy()
  })

  it('leaves the chat button active when slim mode is off', async () => {
    slimValue = false
    global.fetch = setupFetch([TARGET])

    render(<Admin />)
    await navigateToUsers()
    await expandRow()

    const chatBtn = screen.getByRole('button', { name: /open chat with this user/i })
    expect(chatBtn.disabled).toBe(false)

    const awardBtn = screen.getByRole('button', { name: /^award airstars$/i })
    expect(awardBtn.disabled).toBe(false)
  })
})
