import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import UpdateNotificationsEditor from '../UpdateNotificationsEditor'

// Optional areas of the editor start faded so the eye lands on title + body,
// and come back to full strength once they actually carry a setting.

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

vi.mock('../../../components/ui/RichTextEditor', () => ({
  default: ({ value, onChange, ariaLabel }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

const ConfirmModal = ({ title, onConfirm }) => (
  <button onClick={() => onConfirm('because')}>confirm: {title}</button>
)
const Toast = ({ msg }) => <div>{msg}</div>

const CHOSEN = { _id: 'u1', email: 'chosen@test.com', agentNumber: '1234567', displayName: 'Maverick' }

const PLAIN_NOTIF = {
  _id: 'n2', title: 'Everyone', body: 'Hello', enabled: true,
  imageMode: 'none', imageUrl: '', targetPath: '', viewersCount: 0,
  targetOs: [], targetUsers: [],
}

// Every optional area already set — used to prove an edit opens undimmed.
const CONFIGURED_NOTIF = {
  _id: 'n3', title: 'Configured', body: 'Hello', enabled: true,
  imageMode: 'placeholder', imageUrl: '', targetPath: '/home', viewersCount: 0,
  validFrom: '2026-01-01T09:00:00.000Z', expiresAt: '2026-02-01T09:00:00.000Z',
  targetOs: ['ios'], targetUsers: [CHOSEN],
}

const OPTIONAL_FIELDS = ['Image', 'Valid from', 'Expires', 'Target page', 'Operating systems', 'Specific users']

let container

function setupFetch(notifications) {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (String(url).includes('/api/admin/users/lookup')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { users: [CHOSEN] } }) })
    }
    if (String(url).includes('/api/admin/update-notifications')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { notifications } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function openEditor(notifications = [PLAIN_NOTIF], mode = 'new') {
  setupFetch(notifications)
  container = render(<UpdateNotificationsEditor API="" ConfirmModal={ConfirmModal} Toast={Toast} />).container
  await screen.findByText(notifications[0].title)
  fireEvent.click(screen.getByRole('button', { name: mode === 'new' ? /new update/i : 'Edit' }))
}

const isDimmed = (label) =>
  container.querySelector(`[data-field="${label}"]`).getAttribute('data-dimmed') === 'true'

afterEach(() => { vi.restoreAllMocks() })

describe('UpdateNotificationsEditor — optional areas start dimmed', () => {
  it('dims every optional area on a new notification', async () => {
    await openEditor()
    OPTIONAL_FIELDS.forEach(label => expect(isDimmed(label)).toBe(true))
  })

  it('never dims the title or the body', async () => {
    await openEditor()
    expect(isDimmed('Title')).toBe(false)
    expect(isDimmed('Body (emojis ok)')).toBe(false)
  })

  it('leaves dimmed controls fully usable — nothing is disabled', async () => {
    await openEditor()
    const os = container.querySelector('[data-field="Operating systems"]')
    expect(isDimmed('Operating systems')).toBe(true)
    expect([...os.querySelectorAll('input')].some(i => i.disabled)).toBe(false)
  })
})

describe('UpdateNotificationsEditor — an area un-dims once it is set', () => {
  it('un-dims Image when a mode other than None is picked, and re-dims on None', async () => {
    await openEditor()

    fireEvent.click(screen.getByLabelText('Use placeholder image'))
    expect(isDimmed('Image')).toBe(false)

    fireEvent.click(screen.getByLabelText('None'))
    expect(isDimmed('Image')).toBe(true)
  })

  it('un-dims Operating systems on the first tick and re-dims when all are unticked', async () => {
    await openEditor()

    fireEvent.click(screen.getByLabelText('Android'))
    expect(isDimmed('Operating systems')).toBe(false)

    fireEvent.click(screen.getByLabelText('iOS'))
    expect(isDimmed('Operating systems')).toBe(false)

    // Only when the last one goes does it fade back.
    fireEvent.click(screen.getByLabelText('Android'))
    expect(isDimmed('Operating systems')).toBe(false)
    fireEvent.click(screen.getByLabelText('iOS'))
    expect(isDimmed('Operating systems')).toBe(true)
  })

  it('un-dims Specific users when a user is picked and re-dims when removed', async () => {
    await openEditor()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'mav' } })
    fireEvent.click(await screen.findByText('Maverick'))
    await waitFor(() => expect(isDimmed('Specific users')).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Maverick' }))
    expect(isDimmed('Specific users')).toBe(true)
  })

  it('un-dims Target page for a real page and re-dims on "any page"', async () => {
    await openEditor()
    const select = container.querySelector('[data-field="Target page"] select')

    fireEvent.change(select, { target: { value: '/home' } })
    expect(isDimmed('Target page')).toBe(false)

    fireEvent.change(select, { target: { value: '' } })
    expect(isDimmed('Target page')).toBe(true)
  })

  it('un-dims each date independently', async () => {
    await openEditor()
    const validFrom = container.querySelector('[data-field="Valid from"] input')

    fireEvent.change(validFrom, { target: { value: '2026-09-01T10:00' } })
    expect(isDimmed('Valid from')).toBe(false)
    // Setting one must not light up the other.
    expect(isDimmed('Expires')).toBe(true)

    fireEvent.change(validFrom, { target: { value: '' } })
    expect(isDimmed('Valid from')).toBe(true)
  })

  it('opens an already-configured notification with those areas undimmed', async () => {
    await openEditor([CONFIGURED_NOTIF], 'edit')
    OPTIONAL_FIELDS.forEach(label => expect(isDimmed(label)).toBe(false))
  })
})
