import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

// Support tickets: the viewer's own problem reports, listed in the rail with
// the team's replies. Replaced the toast that used to pop a reply up over
// whatever page you were on.
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

const TICKET = {
  _id: 'r1', title: 'The needles are off the dial', description: 'The needles are off the dial',
  pageReported: 'CBAT · Instruments', time: new Date().toISOString(), solved: false,
  updates: [{ _id: 'u1', time: new Date().toISOString(), description: 'On it, thanks.' }],
  unread: true, unreadCount: 1, lastActivityAt: new Date().toISOString(),
  preview: { body: 'On it, thanks.' },
}

const renderRail = (props = {}) =>
  render(<ChatSidebar channels={[CHANNEL]} groups={[]} viewer={{ displayName: 'Falcon' }} {...props} />)

describe('ChatSidebar — support tickets', () => {
  it('has no Support tickets section for a member with nothing open', () => {
    renderRail({ tickets: [] })
    expect(screen.queryByRole('region', { name: 'Support tickets' })).toBeNull()
  })

  it('lists an open ticket between Channels and Groups, linking to its page', () => {
    renderRail({ tickets: [TICKET] })
    const section = screen.getByRole('region', { name: 'Support tickets' })
    expect(section).toBeTruthy()
    expect(screen.getByText('The needles are off the dial').closest('a').getAttribute('href')).toBe('/chat/ticket/r1')
    expect(screen.getByText('Open · CBAT · Instruments')).toBeTruthy()
    expect(screen.getByText(/SkyWatch Support: On it, thanks\./)).toBeTruthy()

    // Order in the column: channels, then tickets, then groups.
    const labels = [...document.querySelectorAll('p')].map(p => p.textContent)
    expect(labels.indexOf('Channels')).toBeLessThan(labels.indexOf('Support tickets'))
    expect(labels.indexOf('Support tickets')).toBeLessThan(labels.indexOf('Groups'))
  })

  it('puts the unread reply count on the row, like a DM', () => {
    renderRail({ tickets: [TICKET] })
    expect(screen.getByLabelText('1 new message for you').textContent).toBe('1')
  })

  it('marks a resolved ticket as such', () => {
    renderRail({ tickets: [{ ...TICKET, solved: true }] })
    expect(screen.getByText('Resolved · CBAT · Instruments')).toBeTruthy()
  })

  it('highlights the ticket that is open in the pane', () => {
    renderRail({ tickets: [TICKET], activeTicketId: 'r1' })
    expect(screen.getByText('The needles are off the dial').closest('a').getAttribute('aria-current')).toBe('page')
  })
})
