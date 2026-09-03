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

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
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

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const AGENT = {
  _id: 'u1', agentNumber: '001', email: 'plain@test.com',
  subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0, logins: [],
  difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false,
  cbatPassed: false, cbatPassedAt: null,
  redditUsername: null, cbatResultImages: [],
  profileStats: { brifsRead: 0 },
}

const IMAGE = {
  _id: 'img1',
  url: 'https://res.cloudinary.com/test/cbat-results/sheet.png',
  publicId: 'cbat-results/sheet',
  caption: 'sheet.png',
  uploadedAt: new Date('2026-02-01T10:00:00Z').toISOString(),
}

function setupFetch(users, { spy, ok = true, message = 'nope' } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/cbat-results') && opts?.method === 'POST') {
      spy?.(url, opts)
      if (!ok) return Promise.resolve({ ok: false, json: async () => ({ message }) })
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', data: { image: IMAGE, images: [IMAGE] } }),
      })
    }
    if (url.includes('/cbat-results/') && opts?.method === 'DELETE') {
      spy?.(url, opts)
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { images: [] } }) })
    }
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function expandRow(users, opts) {
  global.fetch = setupFetch(users, opts)
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  await waitFor(() => screen.getByText('plain@test.com'))
  fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
}

async function openPanel(users, opts) {
  await expandRow(users, opts)
  fireEvent.click(screen.getByRole('button', { name: /cbat result images/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: CBAT result images', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('offers the button only once the row is expanded', async () => {
    global.fetch = setupFetch([AGENT])

    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: /users/i }))
    await waitFor(() => screen.getByText('plain@test.com'))

    expect(screen.queryByRole('button', { name: /cbat result images/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByRole('button', { name: /cbat result images/i })).toBeTruthy()
  })

  it('keeps the panel closed until the button is pressed', async () => {
    await expandRow([AGENT])

    expect(screen.queryByRole('button', { name: 'Upload CBAT results' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /cbat result images/i }))
    expect(screen.getByRole('button', { name: 'Upload CBAT results' })).toBeTruthy()
  })

  // The two panels are independent buttons; opening one must not open the other.
  it('does not open the Reddit panel', async () => {
    await openPanel([AGENT])
    expect(screen.queryByLabelText('Reddit username')).toBeNull()
  })

  it('uploads a picked image and shows it as a thumbnail', async () => {
    const spy = vi.fn()
    await openPanel([AGENT], { spy })

    const file = new File(['x'], 'sheet.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('cbat-results-file-u1'), { target: { files: [file] } })

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [url, opts] = spy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/cbat-results$/)
    const body = JSON.parse(opts.body)
    expect(body.dataUrl).toMatch(/^data:image\/png/)
    expect(body.caption).toBe('sheet.png')

    const thumb = await screen.findByAltText('sheet.png')
    expect(thumb.getAttribute('src')).toBe(IMAGE.url)
  })

  it('rejects a file that is not an image without calling the API', async () => {
    const spy = vi.fn()
    await openPanel([AGENT], { spy })

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('cbat-results-file-u1'), { target: { files: [file] } })

    await screen.findByText('notes.txt is not an image')
    expect(spy).not.toHaveBeenCalled()
  })

  it('badges the button with the number of result images', async () => {
    await expandRow([{ ...AGENT, cbatResultImages: [IMAGE] }])

    const button = screen.getByRole('button', { name: /cbat result images/i })
    expect(button.textContent).toContain('1')
  })

  // Deleting is two clicks: the ✕ arms, the confirm fires. A single stray click
  // must never remove evidence that cannot be re-derived.
  it('needs a second click to delete a result image', async () => {
    const spy = vi.fn()
    await openPanel([{ ...AGENT, cbatResultImages: [IMAGE] }], { spy })

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }))
    expect(spy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete image' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [url, opts] = spy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/cbat-results\/img1$/)
    expect(opts.method).toBe('DELETE')
    await waitFor(() => expect(screen.queryByAltText('sheet.png')).toBeNull())
  })

  it('opens a result image full size and closes again', async () => {
    await openPanel([{ ...AGENT, cbatResultImages: [IMAGE] }])

    fireEvent.click(screen.getByAltText('sheet.png').closest('button'))
    await waitFor(() => expect(screen.getAllByAltText('sheet.png')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.getAllByAltText('sheet.png')).toHaveLength(1))
  })
})
