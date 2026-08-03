import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import Admin from '../Admin'

// The Discord section of Admin → Content: the kill switch for medal broadcasts,
// plus the test-message button that proves the webhook URL reaches the right
// channel. Both are useless without DISCORD_WEBHOOK_URL set on the server, so
// the API reports whether it is (a boolean — never the URL) and the UI locks the
// controls when it isn't.

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
  // The Content tab also mounts SocialsSection, which reads the query string.
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: {},
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
  previewActVoiceCommand: vi.fn(), previewActChatter: vi.fn(),
  previewActStatic: vi.fn(), previewActBleep: vi.fn(), stopActPreview: vi.fn(),
  previewCbatMenuMusic: vi.fn(), previewHangarLobbyMusic: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function setupFetch({ discordWebhookConfigured = true, testStatus = 'success' } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/api/admin/discord/test')) {
      return Promise.resolve({
        ok: true,
        json: async () => (testStatus === 'success'
          ? { status: 'success', message: 'Test message posted to Discord' }
          : { status: 'error', message: 'Discord rejected the message' }),
      })
    }
    if (url.includes('/api/admin/settings') && (!opts?.method || opts.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { settings: { discordBroadcastEnabled: false }, discordWebhookConfigured } }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function openDiscordSection(opts) {
  global.fetch = setupFetch(opts)
  render(<Admin />)

  fireEvent.click(await screen.findByRole('button', { name: /content/i }))
  await waitFor(() => screen.getByText('Medal Broadcasts'))
  fireEvent.click(screen.getByText('Medal Broadcasts'))
  await waitFor(() => screen.getByText('Post new medals to Discord'))
}

// The Toggle renders its label inside a wrapper div that sits beside the switch,
// so the row containing both is one level up from the label's own container.
function toggleRow(label) {
  return screen.getByText(label).closest('div').parentElement
}

afterEach(() => vi.restoreAllMocks())

describe('Admin → Content → Discord', () => {
  it('offers the medal broadcast switch under its own Discord heading', async () => {
    await openDiscordSection()

    expect(screen.getByText('Discord')).toBeInTheDocument()
    expect(screen.getByText(/1st, 2nd or 3rd/i)).toBeInTheDocument()
    expect(within(toggleRow('Post new medals to Discord')).getByRole('button')).not.toBeDisabled()
  })

  it('locks the switch when the server has no webhook URL', async () => {
    await openDiscordSection({ discordWebhookConfigured: false })

    expect(within(toggleRow('Post new medals to Discord')).getByRole('button')).toBeDisabled()
    expect(screen.getByText(/DISCORD_WEBHOOK_URL is not set/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send Test Message/i })).toBeDisabled()
  })

  it('posts a test message and reports the result', async () => {
    await openDiscordSection()

    fireEvent.click(screen.getByRole('button', { name: /Send Test Message/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/discord/test'),
        expect.objectContaining({ method: 'POST' })
      )
    })
    await waitFor(() => expect(screen.getByText(/Test message posted to Discord/i)).toBeInTheDocument())
  })

  it('surfaces a failed test post instead of claiming success', async () => {
    await openDiscordSection({ testStatus: 'error' })

    fireEvent.click(screen.getByRole('button', { name: /Send Test Message/i }))

    await waitFor(() => expect(screen.getByText(/Discord rejected the message/i)).toBeInTheDocument())
  })
})
