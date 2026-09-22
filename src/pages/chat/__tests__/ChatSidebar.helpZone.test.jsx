import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

// Support and the guides used to be flat rows in the same column as the
// channels, which made the two things a newcomer needs first look like two more
// places to chat. They now sit in a help zone above the message list, as cards
// that say what tapping them does. These tests pin that apart-ness down: the
// wording, and the fact that a guide is not a sibling of a channel row.
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => (
    <a href={to} className={className} {...rest}>{children}</a>
  ),
}))
vi.mock('../components/AdminDmSearch', () => ({ default: () => null }))

import ChatSidebar from '../ChatSidebar'

const CHANNEL = {
  _id: 'c1', type: 'channel', name: 'General', emoji: '💬',
  description: 'Anything', unread: false, personalUnread: 0,
  lastMessageAt: new Date().toISOString(),
}
const GUIDE = {
  _id: 'g1', title: 'CBAT Community Guide', url: '/cbat-guide.html',
  description: 'What candidates reported', emoji: '📖',
}

const renderRail = (props = {}) =>
  render(<ChatSidebar channels={[CHANNEL]} viewer={{ displayName: 'Falcon' }} {...props} />)

describe('ChatSidebar — the help zone', () => {
  it('labels a guide with what tapping it does, not just its name', () => {
    renderRail({ guides: [GUIDE] })
    expect(screen.getByText('Read')).toBeTruthy()
  })

  it('marks an off-site guide as leaving the site', () => {
    renderRail({ guides: [{ ...GUIDE, url: 'https://cbatguide.com/' }] })
    expect(screen.getByText('Read ↗')).toBeTruthy()
  })

  it('keeps a guide out of the message list it used to sit in', () => {
    renderRail({ guides: [GUIDE] })
    const guide   = screen.getByText('CBAT Community Guide').closest('a')
    const channel = screen.getByText('General').closest('a')
    // Same flat column before; now the guide lives in the help panel and the
    // channel in the list below the rule.
    expect(guide.parentElement).not.toBe(channel.parentElement)
  })

  // The card is only ever the way to open a NEW ticket; the tickets
  // themselves are rows further down, one per problem.
  it('offers a new support ticket as an action, not a thread to keep up with', () => {
    const onStartSupport = vi.fn()
    renderRail({ onStartSupport })
    expect(screen.getByText(/Report a problem or ask the team/)).toBeTruthy()
    fireEvent.click(screen.getByText('Message'))
    expect(onStartSupport).toHaveBeenCalled()
  })
})
