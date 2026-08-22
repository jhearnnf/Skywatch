import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

// The rail's two badges:
//   • per-conversation counts, which explain the navbar number
//   • the support queue on the Community console link, which is the one place
//     an admin's number can be coming from that is NOT in this rail
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
  ),
}))
vi.mock('../components/AdminDmSearch', () => ({ default: () => null }))

import ChatSidebar from '../ChatSidebar'

const CHANNEL = {
  _id: 'c1', type: 'channel', name: 'General', title: '💬 General', emoji: '💬',
  description: 'Anything', order: 0, unread: false, personalUnread: 0,
  lastMessageAt: new Date().toISOString(),
  preview: { body: 'hello', senderDisplayName: 'Viper' },
}

const renderRail = (props = {}) =>
  render(<ChatSidebar channels={[CHANNEL]} viewer={{ displayName: 'Falcon' }} {...props} />)

describe('ChatSidebar — conversation badges', () => {
  it('counts the messages in a channel that name you', () => {
    renderRail({ channels: [{ ...CHANNEL, unread: true, personalUnread: 2 }] })
    expect(screen.getByLabelText('2 new messages for you').textContent).toBe('2')
  })

  it('leaves a channel you are merely behind on with a plain dot', () => {
    renderRail({ channels: [{ ...CHANNEL, unread: true, personalUnread: 0 }] })
    expect(screen.queryByLabelText(/new message/)).toBeNull()
  })
})

describe('ChatSidebar — the Community console link', () => {
  it('carries the support queue count for an admin', () => {
    renderRail({ isAdmin: true, supportQueueUnread: 3 })
    const badge = screen.getByLabelText('3 support threads waiting for a reply')
    expect(badge.textContent).toBe('3')
    // On the link itself, not floating elsewhere in the rail — the whole point
    // is that it says where to go.
    expect(badge.closest('a').getAttribute('href')).toBe('/chat/admin')
  })

  it('says the singular for one waiting thread', () => {
    renderRail({ isAdmin: true, supportQueueUnread: 1 })
    expect(screen.getByLabelText('1 support thread waiting for a reply')).toBeTruthy()
  })

  it('shows no badge on an empty queue', () => {
    renderRail({ isAdmin: true, supportQueueUnread: 0 })
    expect(screen.queryByLabelText(/waiting for a reply/)).toBeNull()
    expect(screen.getByText('Community console')).toBeTruthy()
  })

  it('is not offered to a member at all', () => {
    renderRail({ isAdmin: false, supportQueueUnread: 3 })
    expect(screen.queryByText('Community console')).toBeNull()
  })
})
