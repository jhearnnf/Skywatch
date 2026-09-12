import { render, screen, within } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

// Unread DMs are lifted above the channels, because the navbar badge already
// says they are the most important thing in the rail. The one you are reading
// stays lifted until you leave it, so the row never moves under your cursor.
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
  ),
}))
vi.mock('../components/AdminDmSearch', () => ({ default: () => <div data-testid="dm-search" /> }))

import ChatSidebar from '../ChatSidebar'

const CHANNEL = {
  _id: 'c1', type: 'channel', name: 'General', emoji: '💬',
  description: 'Anything', order: 0, unread: false, personalUnread: 0,
  lastMessageAt: new Date().toISOString(),
  preview: { body: 'hello', senderDisplayName: 'Viper' },
}
const dm = (id, title, unread) => ({
  _id: id, type: 'dm', title, unread, personalUnread: unread ? 1 : 0,
  lastMessageAt: new Date().toISOString(),
  preview: { body: 'hi', senderDisplayName: title },
})

const renderRail = (props = {}) =>
  render(<ChatSidebar channels={[CHANNEL]} viewer={{ displayName: 'Falcon' }} {...props} />)

const waitingSection = () => screen.queryByRole('region', { name: 'New direct messages' })
const dmSection      = () => screen.queryByRole('region', { name: 'Direct messages' })

describe('ChatSidebar — new direct messages', () => {
  it('lifts an unread DM above the channels and leaves read ones below', () => {
    renderRail({ dms: [dm('d1', 'Viper', true), dm('d2', 'Hawk', false)] })

    const waiting = waitingSection()
    expect(within(waiting).getByText('Viper')).toBeTruthy()
    expect(within(waiting).queryByText('Hawk')).toBeNull()
    expect(within(dmSection()).getByText('Hawk')).toBeTruthy()
    expect(within(dmSection()).queryByText('Viper')).toBeNull()

    // Above, not beside: the section comes before the channels in the column.
    const channelsLabel = screen.getByText('Channels')
    expect(waiting.compareDocumentPosition(channelsLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no section at all when nothing is waiting', () => {
    renderRail({ dms: [dm('d1', 'Viper', false)] })
    expect(waitingSection()).toBeNull()
    expect(within(dmSection()).getByText('Viper')).toBeTruthy()
  })

  it('keeps the DM you are reading lifted after it is marked read', () => {
    const { rerender } = renderRail({ dms: [dm('d1', 'Viper', true)], activeId: 'd1' })
    expect(within(waitingSection()).getByText('Viper')).toBeTruthy()

    // The rail reloads with the thread now read. Same conversation still open.
    rerender(<ChatSidebar channels={[CHANNEL]} viewer={{ displayName: 'Falcon' }} dms={[dm('d1', 'Viper', false)]} activeId="d1" />)
    expect(within(waitingSection()).getByText('Viper')).toBeTruthy()
    expect(dmSection()).toBeNull()
  })

  it('lets it fall back to Direct messages once you leave it', () => {
    const { rerender } = renderRail({ dms: [dm('d1', 'Viper', true)], activeId: 'd1' })
    rerender(<ChatSidebar channels={[CHANNEL]} viewer={{ displayName: 'Falcon' }} dms={[dm('d1', 'Viper', false)]} activeId="d1" />)
    rerender(<ChatSidebar channels={[CHANNEL]} viewer={{ displayName: 'Falcon' }} dms={[dm('d1', 'Viper', false)]} activeId="c1" />)

    expect(waitingSection()).toBeNull()
    expect(within(dmSection()).getByText('Viper')).toBeTruthy()
  })

  it('does not lift a DM just because you opened it', () => {
    // Only unread DMs earn the top slot; opening an old thread is not news.
    renderRail({ dms: [dm('d1', 'Viper', false)], activeId: 'd1' })
    expect(waitingSection()).toBeNull()
  })

  it('keeps the Direct messages section for an admin, for the search box', () => {
    renderRail({ isAdmin: true, dms: [dm('d1', 'Viper', true)] })
    expect(within(dmSection()).getByTestId('dm-search')).toBeTruthy()
  })
})
