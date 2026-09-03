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
    if (url.includes('/reddit') && opts?.method === 'PATCH') {
      spy?.(url, opts)
      if (!ok) return Promise.resolve({ ok: false, json: async () => ({ message }) })
      const { redditUsername } = JSON.parse(opts.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', data: { redditUsername: redditUsername || null } }),
      })
    }
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

async function openPanel(users, opts) {
  global.fetch = setupFetch(users, opts)
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  await waitFor(() => screen.getByText('plain@test.com'))
  fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
  fireEvent.click(screen.getByRole('button', { name: /reddit account and cbat results/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: Reddit link + CBAT results', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('offers the panel button only once the row is expanded', async () => {
    global.fetch = setupFetch([AGENT])

    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: /users/i }))
    await waitFor(() => screen.getByText('plain@test.com'))

    expect(screen.queryByRole('button', { name: /reddit account and cbat results/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByRole('button', { name: /reddit account and cbat results/i })).toBeTruthy()
  })

  it('keeps the panel closed until the button is pressed', async () => {
    global.fetch = setupFetch([AGENT])

    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: /users/i }))
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    expect(screen.queryByLabelText('Reddit username')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /reddit account and cbat results/i }))
    expect(screen.getByLabelText('Reddit username')).toBeTruthy()
  })

  it('saves a typed handle to /reddit', async () => {
    const spy = vi.fn()
    await openPanel([AGENT], { spy })

    fireEvent.change(screen.getByLabelText('Reddit username'), { target: { value: 'flying_badger' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [url, opts] = spy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/reddit$/)
    expect(JSON.parse(opts.body)).toEqual({ redditUsername: 'flying_badger' })
    await screen.findByText('Linked u/flying_badger')
  })

  it('links out to the profile and unlinks an already-linked account', async () => {
    const spy = vi.fn()
    await openPanel([{ ...AGENT, redditUsername: 'flying_badger' }], { spy })

    const link = screen.getByRole('link', { name: 'Open profile' })
    expect(link.getAttribute('href')).toBe('https://www.reddit.com/user/flying_badger/')

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ redditUsername: '' })
    await screen.findByText('Reddit account unlinked')
  })

  it('surfaces a rejected handle as a toast', async () => {
    await openPanel([AGENT], { ok: false, message: 'Reddit usernames are 3–20 characters.' })

    fireEvent.change(screen.getByLabelText('Reddit username'), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Reddit usernames are 3–20 characters.')
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
    global.fetch = setupFetch([{ ...AGENT, cbatResultImages: [IMAGE] }])

    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: /users/i }))
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    const button = screen.getByRole('button', { name: /reddit account and cbat results/i })
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
