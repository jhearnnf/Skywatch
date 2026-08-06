import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MessageList from '../components/MessageList'

const CUTOUT = 'https://cdn.test/typhoon.png'

const SENDERS = {
  u1: {
    _id: 'u1', displayName: 'Falcon', agentNumber: '1234567',
    selectedBadge: { briefId: 'b1', title: 'Typhoon', cutoutUrl: CUTOUT },
    rank: { rankNumber: 4, rankAbbreviation: 'Cpl' },
  },
  u2: {
    _id: 'u2', displayName: 'Viper', agentNumber: '7654321',
    selectedBadge: null,
    rank: { rankNumber: 5, rankAbbreviation: 'Sgt' },
  },
}

let seq = 0
const msg = (senderUserId, body, extra = {}) => ({
  _id: `m${++seq}`,
  senderUserId,
  senderRole: extra.senderRole ?? 'user',
  senderDisplayName: SENDERS[senderUserId]?.displayName ?? null,
  body,
  deleted: false,
  createdAt: new Date().toISOString(),
  ...extra,
})

const avatars = () => document.querySelectorAll(`img[src="${CUTOUT}"]`)

const renderList = (messages, props = {}) =>
  render(
    <MessageList
      messages={messages}
      currentUserId="me"
      conversationType="channel"
      senders={SENDERS}
      {...props}
    />,
  )

describe('MessageList — avatars', () => {
  it('shows the sender\'s selected profile image beside their message', () => {
    renderList([msg('u1', 'hello')])
    expect(avatars()).toHaveLength(1)
  })

  it('shows the image once for a run of consecutive messages', () => {
    renderList([
      msg('u1', 'one'),
      msg('u1', 'two'),
      msg('u1', 'three'),
    ])
    // Three messages, one avatar — the whole point of the grouping.
    expect(screen.getByText('one')).toBeTruthy()
    expect(screen.getByText('three')).toBeTruthy()
    expect(avatars()).toHaveLength(1)
  })

  it('shows the name once per run too', () => {
    renderList([msg('u1', 'one'), msg('u1', 'two')])
    expect(screen.getAllByText('Falcon')).toHaveLength(1)
  })

  it('starts a new run when a different sender interrupts', () => {
    renderList([
      msg('u1', 'one'),
      msg('u1', 'two'),
      msg('u2', 'hi'),
      msg('u1', 'three'),
    ])
    // u1 heads two separate runs, so two cutouts.
    expect(avatars()).toHaveLength(2)
    expect(screen.getAllByText('Falcon')).toHaveLength(2)
  })

  it('breaks a run across a system message', () => {
    renderList([
      msg('u1', 'one'),
      msg(null, 'Admin closed this chat', { senderRole: 'system' }),
      msg('u1', 'two'),
    ])
    expect(avatars()).toHaveLength(2)
  })

  it('falls back to the rank badge when no cutout is selected', () => {
    renderList([msg('u2', 'hi')])
    expect(avatars()).toHaveLength(0)
    // ProfileBadge renders a RankBadge SVG for rank > 1 rather than nothing.
    expect(document.querySelector('svg')).toBeTruthy()
  })

  it('reserves the avatar gutter so a run stays aligned', () => {
    const { container } = renderList([msg('u1', 'one'), msg('u1', 'two')])
    // Second message gets a spacer of the same width, not a missing element.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })
})

describe('MessageList — removed messages', () => {
  // The server already withholds these from users; this is the client-side
  // guard so nothing flashes up from a cached or in-flight response.
  const removed = (senderUserId) =>
    msg(senderUserId, null, { deleted: true, body: null })

  it('renders nothing at all for a user — no tombstone text', () => {
    renderList([msg('u1', 'visible'), removed('u2')])

    expect(screen.getByText('visible')).toBeTruthy()
    expect(screen.queryByText(/removed by a moderator/i)).toBeNull()
    expect(screen.queryByText('Viper')).toBeNull()
  })

  it('shows the empty state when every message has been removed', () => {
    renderList([removed('u1')], { emptyLabel: 'Nothing here yet.' })
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
  })

  it('closes the gap rather than splitting a run', () => {
    // u1 speaks either side of a removal by u2. With the removal gone the two
    // remaining messages are consecutive, so they group into one run.
    renderList([msg('u1', 'one'), removed('u2'), msg('u1', 'two')])

    expect(avatars()).toHaveLength(1)
    expect(screen.getAllByText('Falcon')).toHaveLength(1)
  })

  it('still shows the original and the label to an admin', () => {
    renderList(
      [msg('u1', 'something rude', { deleted: true })],
      { viewerIsAdmin: true },
    )
    expect(screen.getByText('something rude')).toBeTruthy()
    expect(screen.getByText(/removed by a moderator/i)).toBeTruthy()
  })
})

describe('MessageList — support identity', () => {
  const supportMsgs = [
    msg('a1', 'Hi, how can I help?', { senderRole: 'admin', senderDisplayName: 'Skywatch Support' }),
    msg('a2', 'Any update?',          { senderRole: 'admin', senderDisplayName: 'Skywatch Support' }),
  ]

  it('groups two different admins as one support identity', () => {
    // The user sees one "Skywatch Support", so two admins replying in a row is
    // one visual run — and must not expose either admin's personal badge.
    renderList(supportMsgs, { conversationType: 'support', senders: {} })
    expect(screen.getAllByTitle('Skywatch Support')).toHaveLength(1)
    expect(avatars()).toHaveLength(0)
  })

  it('does not collapse admins for an admin viewer', () => {
    renderList(supportMsgs, {
      conversationType: 'support', viewerIsAdmin: true, senders: {},
    })
    expect(screen.queryAllByTitle('Skywatch Support')).toHaveLength(0)
  })
})
