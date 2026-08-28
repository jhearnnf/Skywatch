import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatLoungeChat from '../CbatLoungeChat'
import { REACTION_EMOJI } from '../../pages/chat/reactionEmoji'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockSettings    = vi.hoisted(() => ({ value: { chatEnabled: true } }))
const mockNative      = vi.hoisted(() => ({ value: false }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: mockSettings.value }),
}))
vi.mock('../../utils/appMode', () => ({ get NATIVE_APP() { return mockNative.value } }))
vi.mock('../../pages/chat/components/DisplayNameGate', () => ({
  default: () => <div>Choose a display name</div>,
}))
// Stubbed for the same reason as the picker: what belongs here is that the
// lounge opens the dialog for the right message and closes it again. The
// dialog's own fetching is not the lounge's business.
vi.mock('../../pages/chat/components/SeenByDialog', () => ({
  default: ({ message, onClose }) => (
    <div data-testid="seen-by">
      {message._id}
      <button type="button" onClick={onClose}>close seen-by</button>
    </div>
  ),
}))
// Stubbed so these tests exercise the lounge's wiring of the picker — when it
// is offered and what happens to the draft on a pick — rather than the
// picker's own debounced search.
vi.mock('../../pages/chat/components/MentionPicker', () => ({
  default: ({ query, onPick }) => (
    <div data-testid="mention-picker">
      <span>query:{query}</span>
      <button type="button" onClick={() => onPick({ _id: 'u2', displayName: 'Viper' })}>
        pick Viper
      </button>
    </div>
  ),
}))

// A stand-in for the browser's EventSource, so a test can push a message down
// the wire the way the server does.
class FakeEventSource {
  static last = null
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.closed = false
    FakeEventSource.last = this
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  close() { this.closed = true }
  emit(type, data) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) })
  }
}

const LOUNGE = {
  conversationId: 'convo-1',
  title: '🛩️ CBAT Lounge',
  unread: false,
  canPost: true,
  displayNameRequired: false,
  chatBanned: false,
  postBlockedMessage: null,
  botName: 'Guide Bot',
}

const MESSAGES = [
  { _id: 'm1', senderUserId: 'u2', senderDisplayName: 'Viper', body: 'anyone about?', createdAt: new Date().toISOString(), mentions: [] },
]

// Routes the component's fetches. `overrides` swaps one response without having
// to restate the rest.
function stubFetch({ lounge = LOUNGE, loungeStatus = 200, messages = MESSAGES, senders = {}, onPost } = {}) {
  const json = (status, data) => Promise.resolve({
    ok: status < 400,
    status,
    json: async () => ({ status: status < 400 ? 'success' : 'error', data }),
  })
  const fetchMock = vi.fn((url, opts) => {
    if (String(url).includes('/api/chat/lounge')) return json(loungeStatus, lounge)
    if (String(url).includes('/messages') && opts?.method === 'POST') return onPost(url, opts)
    if (String(url).includes('/messages')) return json(200, { messages, senders, botTyping: null })
    return json(200, {})
  })
  global.fetch = fetchMock
  return fetchMock
}

const apiFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockSettings.value = { chatEnabled: true }
  mockNative.value = false
  FakeEventSource.last = null
  global.EventSource = FakeEventSource
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', displayName: 'Falcon' }, API: '', apiFetch })
})
afterEach(cleanup)

const renderOpen   = (props = {}) => render(<CbatLoungeChat open onToggle={vi.fn()} {...props} />)
const renderClosed = (props = {}) => render(<CbatLoungeChat open={false} onToggle={vi.fn()} {...props} />)

// ── Tests ─────────────────────────────────────────────────────────────────

describe('when it should not be there at all', () => {
  it('renders nothing for a signed-out visitor', () => {
    stubFetch()
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch })
    const { container } = renderOpen()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when chat is switched off', () => {
    stubFetch()
    mockSettings.value = { chatEnabled: false }
    const { container } = renderOpen()
    expect(container.firstChild).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('renders nothing in the native app, which has no chat', () => {
    stubFetch()
    mockNative.value = true
    const { container } = renderOpen()
    expect(container.firstChild).toBeNull()
  })

  it('disappears when an admin has archived the room', async () => {
    stubFetch({ loungeStatus: 404, lounge: null })
    const { container } = renderOpen()
    await waitFor(() => expect(container.firstChild).toBeNull())
  })
})

describe('closed', () => {
  it('leaves a tab that opens it', async () => {
    stubFetch()
    const onToggle = vi.fn()
    renderClosed({ onToggle })

    const tab = await screen.findByRole('button', { name: /CBAT Lounge/i })
    fireEvent.click(tab)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('shows a dot when there is something unread', async () => {
    stubFetch({ lounge: { ...LOUNGE, unread: true } })
    renderClosed()
    expect(await screen.findByLabelText('New messages')).toBeTruthy()
  })

  it('shows no dot when there is not', async () => {
    stubFetch()
    renderClosed()
    await screen.findByRole('button', { name: /CBAT Lounge/i })
    expect(screen.queryByLabelText('New messages')).toBeNull()
  })

  // The panel is collapsed, not disconnected: a dot that only appeared after
  // you opened the thing it is meant to tell you about would be useless.
  it('lights the dot when a message arrives while collapsed', async () => {
    stubFetch()
    renderClosed()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())

    FakeEventSource.last.emit('message', {
      _id: 'm2', senderUserId: 'u2', senderDisplayName: 'Viper', body: 'oi', mentions: [],
    })
    expect(await screen.findByLabelText('New messages')).toBeTruthy()
  })

  it('does not light the dot for your own message', async () => {
    stubFetch()
    renderClosed()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())

    FakeEventSource.last.emit('message', {
      _id: 'm2', senderUserId: 'u1', senderDisplayName: 'Falcon', body: 'hello', mentions: [],
    })
    await waitFor(() => expect(screen.queryByLabelText('New messages')).toBeNull())
  })
})

describe('open', () => {
  it('shows what has been said', async () => {
    stubFetch()
    renderOpen()
    expect(await screen.findByText('anyone about?')).toBeTruthy()
    expect(screen.getByText('Viper')).toBeTruthy()
  })

  it('marks the room read, so the dot does not come back', async () => {
    const fetchMock = stubFetch()
    renderOpen()
    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url, opts]) => String(url).includes('/read') && opts?.method === 'POST'),
    ).toBe(true))
  })

  it('appends a message pushed down the stream', async () => {
    stubFetch()
    renderOpen()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())

    FakeEventSource.last.emit('message', {
      _id: 'm2', senderUserId: 'u2', senderDisplayName: 'Viper', body: 'still here', mentions: [],
    })
    expect(await screen.findByText('still here')).toBeTruthy()
  })

  it('shows a message only once when the stream echoes what was just sent', async () => {
    const sent = {
      _id: 'm2', senderUserId: 'u1', senderDisplayName: 'Falcon', body: 'hello all', mentions: [],
    }
    stubFetch({
      onPost: async () => ({ ok: true, status: 200, json: async () => ({ data: { message: sent } }) }),
    })
    // The POST goes through apiFetch rather than fetch.
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { message: sent } }) })
    renderOpen()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())

    fireEvent.change(screen.getByPlaceholderText(/Message the lounge/i), { target: { value: 'hello all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('hello all')

    FakeEventSource.last.emit('message', sent)
    await waitFor(() => expect(screen.getAllByText('hello all')).toHaveLength(1))
  })

  it('says who is typing when the server pushes it', async () => {
    stubFetch()
    renderOpen()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())

    FakeEventSource.last.emit('typing', { name: 'Guide Bot' })
    expect(await screen.findByText(/Guide Bot is typing/i)).toBeTruthy()

    FakeEventSource.last.emit('typing', { name: null })
    await waitFor(() => expect(screen.queryByText(/is typing/i)).toBeNull())
  })

  it('refetches rather than trusting a push when a moderator changes something', async () => {
    const fetchMock = stubFetch()
    renderOpen()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())
    const before = fetchMock.mock.calls.filter(([url]) => String(url).includes('/messages')).length

    FakeEventSource.last.emit('refresh', { reason: 'moderated' })
    await waitFor(() => expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/messages')).length,
    ).toBeGreaterThan(before))
  })

  it('closes the stream when it goes away', async () => {
    stubFetch()
    const { unmount } = renderOpen()
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull())
    const source = FakeEventSource.last
    unmount()
    expect(source.closed).toBe(true)
  })
})

describe('posting', () => {
  it('sends what you typed and clears the box', async () => {
    stubFetch()
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { message: {
        _id: 'm9', senderUserId: 'u1', senderDisplayName: 'Falcon', body: 'hello all', mentions: [],
      } } }),
    })
    renderOpen()
    const box = await screen.findByPlaceholderText(/Message the lounge/i)

    fireEvent.change(box, { target: { value: 'hello all' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const [, opts] = apiFetch.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ body: 'hello all', replyToId: null })
    await waitFor(() => expect(box.value).toBe(''))
  })

  // The bot only speaks when addressed, so the button writes the mention and
  // leaves the question to the user rather than sending anything.
  it('prefills the mention when you reach for the bot', async () => {
    stubFetch()
    renderOpen()
    const box = await screen.findByPlaceholderText(/Message the lounge/i)

    fireEvent.click(screen.getByTitle('Ask Guide Bot a question'))
    await waitFor(() => expect(box.value).toBe('@Guide Bot '))
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for a display name instead of a composer when there is none', async () => {
    stubFetch({ lounge: { ...LOUNGE, canPost: false, displayNameRequired: true } })
    renderOpen()
    expect(await screen.findByText('Choose a display name')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Message the lounge/i)).toBeNull()
  })

  it('says so plainly when the reader is chat-banned', async () => {
    stubFetch({ lounge: { ...LOUNGE, canPost: false, chatBanned: true } })
    renderOpen()
    expect(await screen.findByText('You cannot post in chat.')).toBeTruthy()
  })

  it('surfaces a send failure rather than swallowing it', async () => {
    stubFetch()
    apiFetch.mockResolvedValue({
      ok: false, json: async () => ({ message: 'You are sending messages too quickly. Wait a moment.' }),
    })
    renderOpen()
    const box = await screen.findByPlaceholderText(/Message the lounge/i)

    fireEvent.change(box, { target: { value: 'spam' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/sending messages too quickly/i)).toBeTruthy()
  })
})

// The activity strip. Every number it shows is a real count from
// /api/games/cbat/activity — the component's only job is to render or withhold.
describe('activity strip', () => {
  function stubWithActivity(activity) {
    const json = (status, data) => Promise.resolve({
      ok: status < 400, status,
      json: async () => ({ status: 'success', data }),
    })
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/api/chat/lounge')) return json(200, LOUNGE)
      if (String(url).includes('/api/games/cbat/activity')) return json(200, activity)
      if (String(url).includes('/messages')) return json(200, { messages: MESSAGES, botTyping: null })
      return json(200, {})
    })
  }

  it('shows both counters when the site has been busy', async () => {
    stubWithActivity({ plays7d: 1340, agentsToday: 84, quiet: false })
    renderOpen()
    expect(await screen.findByText(/1,340 games played this week · 84 agents today/)).toBeDefined()
  })

  it('drops the agents half when nobody has played today yet', async () => {
    stubWithActivity({ plays7d: 400, agentsToday: 0, quiet: false })
    renderOpen()
    const strip = await screen.findByText(/400 games played this week/)
    expect(strip.textContent).not.toMatch(/agents/)
  })

  it('says nothing at all on a quiet week rather than showing a small number', async () => {
    stubWithActivity({ plays7d: 4, agentsToday: 1, quiet: true })
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.queryByText(/games played this week/)).toBeNull()
  })

  it('renders nothing when the activity request fails', async () => {
    stubWithActivity({})
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.queryByText(/games played this week/)).toBeNull()
  })

  it('singularises a lone game and a lone agent', async () => {
    stubWithActivity({ plays7d: 1, agentsToday: 1, quiet: false })
    renderOpen()
    expect(await screen.findByText('1 game played this week · 1 agent today')).toBeDefined()
  })
})

// The lounge is a second view of a real channel, so replying, reacting and
// mentioning are the same server features the full room uses. What is tested
// here is that the small panel actually offers them and sends the right thing.

describe('replying', () => {
  const REPLY = {
    _id: 'm2', senderUserId: 'u3', senderDisplayName: 'Hawk',
    body: 'yep, standing by', createdAt: new Date().toISOString(), mentions: [],
    replyTo: { messageId: 'm1', displayName: 'Viper', excerpt: 'anyone about?' },
  }

  it('shows what a message is answering', async () => {
    stubFetch({ messages: [...MESSAGES, REPLY] })
    renderOpen()
    await screen.findByText('yep, standing by')
    expect(screen.getAllByText('Viper').length).toBeGreaterThan(0)
    expect(screen.getAllByText('anyone about?').length).toBe(2)
  })

  // The parent may well have scrolled out of the forty messages this panel
  // holds, which is exactly why the server snapshots the quote.
  it('still shows the quote when the parent is not loaded', async () => {
    stubFetch({ messages: [REPLY] })
    renderOpen()
    await screen.findByText('yep, standing by')
    expect(screen.getByText('anyone about?')).toBeTruthy()
  })

  it('names the target in the composer and sends it with the message', async () => {
    stubFetch({ onPost: vi.fn() })
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', data: { message: null } }),
    })
    renderOpen()
    await screen.findByText('anyone about?')

    fireEvent.click(screen.getByLabelText('Reply'))
    expect(screen.getByText('Replying to')).toBeTruthy()

    const box = screen.getByPlaceholderText('Message the lounge…')
    fireEvent.change(box, { target: { value: 'on my way' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const [, opts] = apiFetch.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ body: 'on my way', replyToId: 'm1' })
    // Cleared once sent, or the next message would answer the same person.
    await waitFor(() => expect(screen.queryByText('Replying to')).toBeNull())
  })

  it('lets you back out of a reply', async () => {
    stubFetch()
    renderOpen()
    await screen.findByText('anyone about?')
    fireEvent.click(screen.getByLabelText('Reply'))
    fireEvent.click(screen.getByLabelText('Cancel reply'))
    expect(screen.queryByText('Replying to')).toBeNull()
  })

  it('offers no reply control when you cannot post', async () => {
    stubFetch({ lounge: { ...LOUNGE, canPost: false } })
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.queryByLabelText('Reply')).toBeNull()
  })
})

describe('reactions', () => {
  const REACTED = [{
    ...MESSAGES[0],
    reactions: [{ emoji: '🔥', count: 2, mine: false }],
  }]

  it('shows what has already been reacted, with counts', async () => {
    stubFetch({ messages: REACTED })
    renderOpen()
    expect(await screen.findByLabelText('🔥 2')).toBeTruthy()
  })

  // The response carries this viewer's own counts, so the message is swapped in
  // place rather than refetching the room.
  it('swaps in the counts the server returns when you react', async () => {
    stubFetch({ messages: REACTED })
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', data: { message: {
        ...REACTED[0], reactions: [{ emoji: '🔥', count: 3, mine: true }],
      } } }),
    })
    renderOpen()
    fireEvent.click(await screen.findByLabelText('🔥 2'))

    const chip = await screen.findByLabelText('🔥 3')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    const [url, opts] = apiFetch.mock.calls[0]
    expect(url).toContain('/api/chat/messages/m1/reactions')
    expect(JSON.parse(opts.body)).toEqual({ emoji: '🔥' })
  })

  it('opens the emoji whitelist inline rather than as a popup', async () => {
    stubFetch()
    renderOpen()
    await screen.findByText('anyone about?')
    // Nothing on offer until asked for, so forty rows stay readable.
    expect(screen.queryByText('👍')).toBeNull()
    fireEvent.click(screen.getByLabelText('Add a reaction'))
    for (const emoji of REACTION_EMOJI) expect(screen.getByText(emoji)).toBeTruthy()
  })

  it('reacts with a picked emoji and closes the picker', async () => {
    stubFetch()
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', data: { message: {
        ...MESSAGES[0], reactions: [{ emoji: '👍', count: 1, mine: true }],
      } } }),
    })
    renderOpen()
    await screen.findByText('anyone about?')
    fireEvent.click(screen.getByLabelText('Add a reaction'))
    fireEvent.click(screen.getByText('👍'))

    expect(await screen.findByLabelText('👍 1')).toBeTruthy()
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ emoji: '👍' })
  })

  it('says so rather than silently doing nothing when a reaction is refused', async () => {
    stubFetch({ messages: REACTED })
    apiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'You cannot react in chat.' }),
    })
    renderOpen()
    fireEvent.click(await screen.findByLabelText('🔥 2'))
    expect(await screen.findByText('You cannot react in chat.')).toBeTruthy()
  })

  it('offers no reaction control when you cannot post', async () => {
    stubFetch({ lounge: { ...LOUNGE, canPost: false } })
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.queryByLabelText('Add a reaction')).toBeNull()
  })
})

describe('mentions', () => {
  const MENTIONING = [{
    _id: 'm3', senderUserId: 'u2', senderDisplayName: 'Viper',
    body: 'nice one @Falcon', createdAt: new Date().toISOString(), mentions: ['u1'],
  }]
  const SENDERS = { u1: { _id: 'u1', displayName: 'Falcon' } }

  it('picks the mention out of the body', async () => {
    stubFetch({ messages: MENTIONING, senders: SENDERS })
    renderOpen()
    // Split into its own run rather than left inside the surrounding text.
    expect(await screen.findByText('@Falcon')).toBeTruthy()
  })

  it('offers the picker once you type an @ and completes the name', async () => {
    stubFetch()
    renderOpen()
    await screen.findByText('anyone about?')
    const box = screen.getByPlaceholderText('Message the lounge…')
    expect(screen.queryByTestId('mention-picker')).toBeNull()

    fireEvent.change(box, { target: { value: 'ta @vi', selectionStart: 6 } })
    expect(screen.getByTestId('mention-picker')).toBeTruthy()
    expect(screen.getByText('query:vi')).toBeTruthy()

    fireEvent.click(screen.getByText('pick Viper'))
    await waitFor(() => expect(box.value).toBe('ta @Viper '))
  })

  // Enter belongs to the picker while it is open, or a half-typed name would be
  // sent instead of completed.
  it('does not send on Enter while the picker is open', async () => {
    stubFetch({ onPost: vi.fn() })
    renderOpen()
    await screen.findByText('anyone about?')
    const box = screen.getByPlaceholderText('Message the lounge…')
    fireEvent.change(box, { target: { value: 'hi @vi', selectionStart: 6 } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('offers nothing to complete when you cannot post', async () => {
    stubFetch({ lounge: { ...LOUNGE, canPost: false } })
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.queryByTestId('mention-picker')).toBeNull()
  })
})

// Same rule as the full room, and enforced again by the endpoint: your own
// messages, and admins on anyone's. Not admin-only.
describe('seen by', () => {
  const MINE   = { _id: 'm9', senderUserId: 'u1', senderDisplayName: 'Falcon', body: 'on station', createdAt: new Date().toISOString(), mentions: [] }
  const THEIRS = MESSAGES[0]

  it('offers it on your own message', async () => {
    stubFetch({ messages: [MINE] })
    renderOpen()
    await screen.findByText('on station')
    expect(screen.getByLabelText('Seen by')).toBeTruthy()
  })

  it('does not offer an agent the readership of someone else\'s message', async () => {
    stubFetch({ messages: [THEIRS] })
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.queryByLabelText('Seen by')).toBeNull()
  })

  it('offers an admin any message, since they already read every transcript', async () => {
    mockUseAuth.mockReturnValue({
      user: { _id: 'u1', displayName: 'Control', isAdmin: true }, API: '', apiFetch,
    })
    stubFetch({ messages: [THEIRS] })
    renderOpen()
    await screen.findByText('anyone about?')
    expect(screen.getByLabelText('Seen by')).toBeTruthy()
  })

  // Losing the ability to speak is no reason to lose sight of who read what you
  // already said, so this one is not gated on being able to post.
  it('still offers it on your own message when you cannot post', async () => {
    stubFetch({ messages: [MINE], lounge: { ...LOUNGE, canPost: false } })
    renderOpen()
    await screen.findByText('on station')
    expect(screen.getByLabelText('Seen by')).toBeTruthy()
    // The reply and reaction controls do go, though.
    expect(screen.queryByLabelText('Reply')).toBeNull()
    expect(screen.queryByLabelText('Add a reaction')).toBeNull()
  })

  it('opens the readership of the message you asked about', async () => {
    stubFetch({ messages: [MINE] })
    renderOpen()
    await screen.findByText('on station')
    expect(screen.queryByTestId('seen-by')).toBeNull()

    fireEvent.click(screen.getByLabelText('Seen by'))
    expect(screen.getByTestId('seen-by').textContent).toContain('m9')
  })

  it('closes again', async () => {
    stubFetch({ messages: [MINE] })
    renderOpen()
    await screen.findByText('on station')
    fireEvent.click(screen.getByLabelText('Seen by'))
    fireEvent.click(screen.getByText('close seen-by'))
    expect(screen.queryByTestId('seen-by')).toBeNull()
  })
})
