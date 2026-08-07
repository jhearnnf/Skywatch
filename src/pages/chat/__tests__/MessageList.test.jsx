import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
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

describe('MessageList — replies', () => {
  const withReply = (senderUserId, body, replyTo) =>
    msg(senderUserId, body, { replyTo })

  it('quotes the parent above the message', () => {
    renderList([
      msg('u1', 'original'),
      withReply('u2', 'answering that', {
        messageId: 'm-orig', displayName: 'Falcon', excerpt: 'original',
      }),
    ])
    expect(screen.getByText('answering that')).toBeTruthy()
    // The quote renders from the snapshot, so the parent's name shows twice:
    // once as its own author, once in the quote.
    expect(screen.getAllByText('Falcon').length).toBeGreaterThanOrEqual(2)
  })

  it('renders the quote even when the parent is gone', () => {
    // The snapshot is why this works — resolving the parent live would leave a
    // hole whenever it was deleted or simply out of the loaded page.
    renderList([
      withReply('u2', 'answering', {
        messageId: 'missing', displayName: 'Falcon', excerpt: 'the old message',
      }),
    ])
    expect(screen.getByText('the old message')).toBeTruthy()
  })

  it('always starts a new run, so the quote is never orphaned', () => {
    // Without this, a reply grouped under the previous message would show its
    // quote beneath someone else's name.
    renderList([
      msg('u1', 'one'),
      withReply('u1', 'two', {
        messageId: 'x', displayName: 'Viper', excerpt: 'something',
      }),
    ])
    expect(screen.getAllByText('Falcon')).toHaveLength(2)
  })

  it('offers reply on other people\'s messages and on your own', () => {
    const onReply = vi.fn()
    renderList([msg('u1', 'hello')], { onReply })
    fireEvent.click(screen.getByTitle('Reply'))
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ body: 'hello' }))
  })

  it('does not offer reply on a removed message', () => {
    renderList([msg('u1', 'gone', { deleted: true })], { onReply: vi.fn(), viewerIsAdmin: true })
    expect(screen.queryByTitle('Reply')).toBeNull()
  })
})

describe('MessageList — seen by', () => {
  // `mine` is decided by currentUserId, so 'me' is the sender under test.
  const mine = (body, extra = {}) => msg('u1', body, { senderUserId: 'me', ...extra })

  it('opens the list from the eye control on your own message', () => {
    const onSeenBy = vi.fn()
    renderList([mine('hello')], { onSeenBy })
    fireEvent.click(screen.getByTitle('Seen by'))
    expect(onSeenBy).toHaveBeenCalledWith(expect.objectContaining({ body: 'hello' }))
  })

  it('does not offer it on someone else\'s message', () => {
    renderList([msg('u1', 'theirs')], { onSeenBy: vi.fn() })
    expect(screen.queryByTitle('Seen by')).toBeNull()
  })

  it('does not offer it on a removed message', () => {
    renderList([mine('gone', { deleted: true })], { onSeenBy: vi.fn(), viewerIsAdmin: true })
    expect(screen.queryByTitle('Seen by')).toBeNull()
  })

})

describe('MessageList — edited messages', () => {
  it('marks an edited message for every reader, not just admins', () => {
    renderList([msg('u1', 'tidied up', { edited: true })])
    expect(screen.getByText('(edited)')).toBeTruthy()
  })

  it('leaves an untouched message unmarked', () => {
    renderList([msg('u1', 'as sent')])
    expect(screen.queryByText('(edited)')).toBeNull()
  })

  it('offers the edit control to an admin only', () => {
    renderList([msg('u1', 'hello')], { onEdit: vi.fn(), viewerIsAdmin: true })
    expect(screen.getByTitle('Edit')).toBeTruthy()

    cleanup()
    renderList([msg('u1', 'hello')], { onEdit: vi.fn() })
    expect(screen.queryByTitle('Edit')).toBeNull()
  })

  it('saves the corrected body', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined)
    renderList([msg('u1', 'somethign')], { onEdit, viewerIsAdmin: true })

    fireEvent.click(screen.getByTitle('Edit'))
    const box = screen.getByLabelText('Edit message')
    expect(box.value).toBe('somethign')
    fireEvent.change(box, { target: { value: 'something' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'somethign' }),
      'something',
    )
  })

  it('cancels without calling out', () => {
    const onEdit = vi.fn()
    renderList([msg('u1', 'hello')], { onEdit, viewerIsAdmin: true })

    fireEvent.click(screen.getByTitle('Edit'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('does not offer editing on a removed message', () => {
    renderList([msg('u1', 'gone', { deleted: true })], { onEdit: vi.fn(), viewerIsAdmin: true })
    expect(screen.queryByTitle('Edit')).toBeNull()
  })
})

describe('MessageList — feeds', () => {
  it('gives every message its own name and timestamp when grouping is off', () => {
    // The medals channel: one bot posts everything, so grouped runs would hide
    // when each entry was actually posted behind the first one's timestamp.
    renderList([msg('u1', 'one'), msg('u1', 'two'), msg('u1', 'three')], { groupRuns: false })
    expect(screen.getAllByText('Falcon')).toHaveLength(3)
    expect(avatars()).toHaveLength(3)
  })

  it('still groups by default', () => {
    renderList([msg('u1', 'one'), msg('u1', 'two')])
    expect(screen.getAllByText('Falcon')).toHaveLength(1)
  })
})

describe('MessageList — name colours', () => {
  it('gives different agents different colours, stably', () => {
    const { container } = renderList([msg('u1', 'a'), msg('u2', 'b')])
    const names = [...container.querySelectorAll('[style*="color"]')]
      .map(el => el.getAttribute('style'))
    expect(new Set(names).size).toBeGreaterThan(1)
  })
})

describe('MessageList — avatar medals', () => {
  const withMedals = (medals) => ({
    ...SENDERS,
    u1: { ...SENDERS.u1, medals },
  })

  const render1 = (medals) =>
    render(
      <MessageList
        messages={[msg('u1', 'hello')]}
        currentUserId="me"
        conversationType="channel"
        senders={withMedals(medals)}
      />,
    )

  it('hangs a gold medal off the avatar for a board leader', () => {
    render1([{ gameKey: 'target', gameLabel: 'Target', rank: 1 }])
    expect(screen.getByTitle('Gold — Target')).toBeTruthy()
  })

  it('names silver and bronze correctly', () => {
    render1([
      { gameKey: 'a', gameLabel: 'Alpha', rank: 2 },
      { gameKey: 'b', gameLabel: 'Bravo', rank: 3 },
    ])
    expect(screen.getByTitle('Silver — Alpha')).toBeTruthy()
    expect(screen.getByTitle('Bronze — Bravo')).toBeTruthy()
  })

  it('shows nothing for an agent with no medals', () => {
    render1([])
    expect(screen.queryByTitle(/Gold|Silver|Bronze/)).toBeNull()
  })

  const many = (n) => Array.from({ length: n }, (_, i) => ({
    gameKey: `g${i}`, gameLabel: `Game ${i}`, rank: (i % 3) + 1,
  }))

  const medalEls = () => [...document.querySelectorAll('span[title*="—"]')]

  it('shows at most three, then counts the rest', () => {
    render1(many(7))
    expect(medalEls()).toHaveLength(3)
    expect(screen.getByTitle('4 more')).toBeTruthy()
    expect(screen.getByText('+4')).toBeTruthy()
  })

  it('shows no counter when three or fewer are held', () => {
    render1(many(3))
    expect(medalEls()).toHaveLength(3)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('overlaps each medal heavily onto the one before', () => {
    // Not a token nudge: each medal covers two-thirds of the previous one, so
    // the stack reads as stacked rather than as a row.
    render1(many(3))
    const [first, ...rest] = medalEls()
    expect(parseFloat(first.style.marginLeft) || 0).toBe(0)
    for (const el of rest) {
      expect(parseFloat(el.style.marginLeft)).toBe(-8)
    }
  })

  it('keeps three medals narrower than three laid side by side', () => {
    render1(many(3))
    const width = medalEls().reduce((sum, el, i) => (
      sum + (i === 0 ? 12 : 12 + parseFloat(el.style.marginLeft))
    ), 0)
    expect(width).toBe(20)      // vs 36 laid side by side
    expect(width).toBeLessThan(24)
  })

  it('keeps the best medal on top of the stack', () => {
    // Gold must never be the one tucked behind a bronze.
    render1([
      { gameKey: 'a', gameLabel: 'Alpha', rank: 1 },
      { gameKey: 'b', gameLabel: 'Bravo', rank: 3 },
    ])
    const items = medalEls()
    expect(Number(items[0].style.zIndex)).toBeGreaterThan(Number(items[1].style.zIndex))
  })

  it('shows the medal once per run, with the avatar', () => {
    render(
      <MessageList
        messages={[msg('u1', 'one'), msg('u1', 'two')]}
        currentUserId="me"
        conversationType="channel"
        senders={withMedals([{ gameKey: 'target', gameLabel: 'Target', rank: 1 }])}
      />,
    )
    expect(screen.getAllByTitle('Gold — Target')).toHaveLength(1)
  })
})

describe('MessageList — support identity', () => {
  const supportMsgs = [
    msg('a1', 'Hi, how can I help?', { senderRole: 'admin', senderDisplayName: 'SkyWatch Support' }),
    msg('a2', 'Any update?',          { senderRole: 'admin', senderDisplayName: 'SkyWatch Support' }),
  ]

  it('groups two different admins as one support identity', () => {
    // The user sees one "SkyWatch Support", so two admins replying in a row is
    // one visual run — and must not expose either admin's personal badge.
    renderList(supportMsgs, { conversationType: 'support', senders: {} })
    expect(screen.getAllByTitle('SkyWatch Support')).toHaveLength(1)
    expect(avatars()).toHaveLength(0)
  })

  it('does not collapse admins for an admin viewer', () => {
    renderList(supportMsgs, {
      conversationType: 'support', viewerIsAdmin: true, senders: {},
    })
    expect(screen.queryAllByTitle('SkyWatch Support')).toHaveLength(0)
  })
})

describe('MessageList — mentions', () => {
  const pinged = (body, ids) => msg('u1', body, { mentions: ids })

  it('highlights a mention of someone else', () => {
    renderList([pinged('nice one @Viper', ['u2'])])
    // The name is lifted out of the paragraph into its own element.
    expect(screen.getByText('@Viper')).toBeTruthy()
  })

  it('leaves an @word that nobody was mentioned by as plain text', () => {
    // Driven by the resolved mention list, so "@nobody" is not a ping.
    renderList([pinged('@nobody at all', [])])
    expect(screen.queryByText('@nobody')).toBeNull()
    expect(screen.getByText('@nobody at all')).toBeTruthy()
  })

  it('tints the whole row when the mention is of you', () => {
    // Still findable after the jump banner has been dismissed.
    const { container } = renderList([pinged('over here @Falcon', ['me'])])
    expect(container.querySelector('[class*="amber"]')).toBeTruthy()
  })

  it('does not tint a row that mentions somebody else', () => {
    const { container } = renderList([pinged('over here @Viper', ['u2'])])
    expect(container.querySelector('[class*="amber"]')).toBeNull()
  })
})

describe('MessageList — the new-messages line', () => {
  const at = (iso, body) => msg('u1', body, { createdAt: iso })

  const OLD = '2026-08-01T10:00:00.000Z'
  const MID = '2026-08-01T11:00:00.000Z'
  const NEW = '2026-08-01T12:00:00.000Z'

  it('draws the line above the first message you have not seen', () => {
    const { container } = renderList(
      [at(OLD, 'before'), at(NEW, 'after')],
      { dividerAfter: MID },
    )
    const line = container.querySelector('[aria-label="New messages"]')
    expect(line).toBeTruthy()
    // Above the unread one, below the read one.
    expect(line.nextElementSibling.textContent).toContain('after')
  })

  it('draws it exactly once, however many messages are unread', () => {
    const { container } = renderList(
      [at(OLD, 'before'), at(NEW, 'one'), at(NEW, 'two'), at(NEW, 'three')],
      { dividerAfter: MID },
    )
    expect(container.querySelectorAll('[aria-label="New messages"]')).toHaveLength(1)
  })

  it('draws nothing on a first visit', () => {
    // Never been here is not the same as a pile of unread messages.
    const { container } = renderList([at(NEW, 'hello')], { dividerAfter: null })
    expect(container.querySelector('[aria-label="New messages"]')).toBeNull()
  })

  it('draws nothing when everything has already been seen', () => {
    const { container } = renderList([at(OLD, 'hello')], { dividerAfter: NEW })
    expect(container.querySelector('[aria-label="New messages"]')).toBeNull()
  })
})

describe('MessageList — typing indicator', () => {
  it('names the bot that is composing a reply', () => {
    renderList([msg('u1', 'hello')], { typingName: 'Guide Bot' })
    expect(screen.getByText('Guide Bot is typing…')).toBeTruthy()
  })

  it('shows nothing when no reply is in flight', () => {
    renderList([msg('u1', 'hello')])
    expect(screen.queryByText(/is typing/)).toBeNull()
  })
})
