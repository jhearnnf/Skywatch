import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import UpdateNotificationsEditor from '../UpdateNotificationsEditor'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiFetch: (...args) => fetch(...args) }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, onClick, onMouseDown }) => (
      <div className={className} onClick={onClick} onMouseDown={onMouseDown}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// The rich-text editor is contentEditable; this feature never touches the body,
// so a plain textarea keeps the test about targeting.
vi.mock('../../../components/ui/RichTextEditor', () => ({
  default: ({ value, onChange, ariaLabel }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

// Confirm gate: fires straight through with a canned reason.
const ConfirmModal = ({ title, onConfirm }) => (
  <button onClick={() => onConfirm('because')}>confirm: {title}</button>
)
const Toast = ({ msg }) => <div>{msg}</div>

// ── Fixtures ──────────────────────────────────────────────────────────────

const CHOSEN = { _id: 'u1', email: 'chosen@test.com', agentNumber: '1234567', displayName: 'Maverick' }

const TARGETED_NOTIF = {
  _id: 'n1', title: 'Android beta', body: 'Hello', enabled: true,
  imageMode: 'none', imageUrl: '', targetPath: '', viewersCount: 0,
  targetOs: ['android'], targetUsers: [CHOSEN],
}

const PLAIN_NOTIF = {
  _id: 'n2', title: 'Everyone', body: 'Hello', enabled: true,
  imageMode: 'none', imageUrl: '', targetPath: '', viewersCount: 0,
  targetOs: [], targetUsers: [],
}

let posted

function setupFetch(notifications) {
  posted = []
  global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
    if (String(url).includes('/api/admin/users/lookup')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { users: [CHOSEN] } }) })
    }
    if (String(url).includes('/api/admin/update-notifications')) {
      if (opts.method === 'POST' || opts.method === 'PUT') {
        posted.push({ url: String(url), method: opts.method, body: JSON.parse(opts.body) })
        return Promise.resolve({ ok: true, json: async () => ({ data: { notification: {} } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: { notifications } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

let container

async function renderEditor(notifications = [PLAIN_NOTIF]) {
  setupFetch(notifications)
  container = render(<UpdateNotificationsEditor API="" ConfirmModal={ConfirmModal} Toast={Toast} />).container
  await screen.findByText(notifications[0].title)
}

// Fill the two required fields so saveDraft gets past validation. The title
// input has no associated <label>, hence the query by type.
function fillRequired() {
  fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: 'A title' } })
  fireEvent.change(screen.getByLabelText('Notification body'), { target: { value: 'Body text' } })
}

afterEach(() => { vi.restoreAllMocks() })

describe('UpdateNotificationsEditor — OS targeting', () => {
  it('sends the checked operating systems on save', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))

    fillRequired()
    fireEvent.click(screen.getByLabelText('Android'))
    fireEvent.click(screen.getByLabelText('Windows'))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm:/ }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body.targetOs).toEqual(['android', 'windows'])
  })

  it('defaults to no OS selected, which the hint describes as every OS', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))

    expect(screen.getByLabelText('Windows')).not.toBeChecked()
    expect(screen.getByLabelText('iOS')).not.toBeChecked()
    expect(screen.getByText(/shows on every operating system/i)).toBeInTheDocument()
  })

  it('unchecking an OS removes it again', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))
    fillRequired()

    fireEvent.click(screen.getByLabelText('macOS'))
    expect(screen.getByLabelText('macOS')).toBeChecked()
    fireEvent.click(screen.getByLabelText('macOS'))
    expect(screen.getByLabelText('macOS')).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm:/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body.targetOs).toEqual([])
  })

  it('pre-checks the stored OSes when editing', async () => {
    await renderEditor([TARGETED_NOTIF])
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Android')).toBeChecked()
    expect(screen.getByLabelText('Windows')).not.toBeChecked()
  })

  it('shows the OS targeting on the list row without opening the editor', async () => {
    await renderEditor([TARGETED_NOTIF])
    expect(screen.getByTitle('Only shows on Android')).toBeInTheDocument()
  })
})

describe('UpdateNotificationsEditor — user targeting', () => {
  beforeEach(() => { posted = [] })

  it('searches users and sends the picked ids on save', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))
    fillRequired()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'mav' } })
    const hit = await screen.findByText('Maverick')
    fireEvent.click(hit)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm:/ }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body.targetUsers).toEqual(['u1'])
  })

  it('queries the lightweight lookup endpoint, not the enriched user search', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'mav' } })

    await waitFor(() => {
      const urls = global.fetch.mock.calls.map(c => String(c[0]))
      expect(urls.some(u => u.includes('/api/admin/users/lookup?q=mav'))).toBe(true)
    })
  })

  it('sends an empty list when nobody is picked', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))
    fillRequired()

    expect(screen.getByText(/shows to everyone/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm:/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body.targetUsers).toEqual([])
  })

  it('removes a picked user again via the chip', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /new update/i }))
    fillRequired()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'mav' } })
    fireEvent.click(await screen.findByText('Maverick'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Maverick' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: /^confirm:/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body.targetUsers).toEqual([])
  })

  it('pre-fills chips for the users an existing notification targets', async () => {
    await renderEditor([TARGETED_NOTIF])
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('button', { name: 'Remove Maverick' })).toBeInTheDocument()
    expect(screen.getByText(/only this user will see it/i)).toBeInTheDocument()
  })

  it('shows a recipient count on the list row', async () => {
    await renderEditor([TARGETED_NOTIF])
    expect(screen.getByTitle('Maverick')).toBeInTheDocument()
    expect(screen.getByText('1 user')).toBeInTheDocument()
  })
})
