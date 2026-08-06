import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The Community dot honours the per-user opt-out immediately, without waiting
// for the next 30s poll — a preference that takes half a minute to apply reads
// as broken.
const mockUser = vi.hoisted(() => ({ value: null }))

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: mockUser.value, API: '' }),
}))

import { ChatUnreadProvider, useChatUnread } from '../ChatUnreadContext'

function Probe() {
  const { hasUnread, totalUnread, muted, totalUnreadConversations } = useChatUnread()
  return (
    <div>
      <span data-testid="hasUnread">{String(hasUnread)}</span>
      <span data-testid="total">{totalUnread}</span>
      <span data-testid="muted">{String(muted)}</span>
      <span data-testid="queue">{totalUnreadConversations}</span>
    </div>
  )
}

const renderProbe = () =>
  render(<ChatUnreadProvider><Probe /></ChatUnreadProvider>)

describe('ChatUnreadContext — community mute', () => {
  beforeEach(() => {
    mockUser.value = null
    global.fetch = vi.fn((url) => {
      const data = String(url).includes('/unread/admin')
        ? { hasAnyOpenChat: true, hasUnread: true, totalUnreadConversations: 2 }
        : { hasAnyOpenChat: true, hasUnread: true, totalUnread: 3, muted: false }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) })
    })
  })

  it('shows the dot for a user with notifications on', async () => {
    mockUser.value = { _id: 'u1', communityNotificationsEnabled: true }
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('hasUnread').textContent).toBe('true'))
    expect(screen.getByTestId('total').textContent).toBe('3')
  })

  it('treats a missing preference as on, so nothing needs backfilling', async () => {
    mockUser.value = { _id: 'u1' }
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('hasUnread').textContent).toBe('true'))
    expect(screen.getByTestId('muted').textContent).toBe('false')
  })

  it('silences the dot when the user has turned notifications off', async () => {
    mockUser.value = { _id: 'u1', communityNotificationsEnabled: false }
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('muted').textContent).toBe('true'))
    expect(screen.getByTestId('hasUnread').textContent).toBe('false')
    expect(screen.getByTestId('total').textContent).toBe('0')
  })

  it('still surfaces the admin support queue to a muted admin', async () => {
    // Muting is a social-notification preference; the support queue is a
    // moderation duty and must not be silenced with it.
    mockUser.value = { _id: 'u1', isAdmin: true, communityNotificationsEnabled: false }
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('queue').textContent).toBe('2'))
    expect(screen.getByTestId('muted').textContent).toBe('true')
    expect(screen.getByTestId('hasUnread').textContent).toBe('true')
  })

  it('polls nothing for a signed-out visitor', async () => {
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('hasUnread').textContent).toBe('false'))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
