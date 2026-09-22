import { render, screen, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import SeenByDialog from '../components/SeenByDialog'

const mockUseAuth = vi.hoisted(() => vi.fn())
vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
// Overlay portals to document.body and traps focus; neither is what these
// tests are about.
vi.mock('../../../components/ui/Overlay', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

const apiFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue({ API: '', apiFetch })
  apiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { readers: [], truncated: false, total: 0 } }),
  })
})

// Routes each endpoint to its own payload, so one dialog can be asked about
// readers and reactors in the same render.
const route = ({ seenBy = { readers: [], truncated: false, total: 0 }, reactions = [] }) => {
  apiFetch.mockImplementation((url) => Promise.resolve({
    ok: true,
    json: async () => ({ data: url.includes('/reactions') ? { reactions } : seenBy }),
  }))
}

const MESSAGE = {
  _id: 'm1',
  body: 'anyone doing cbat on 23rd of september',
  createdAt: '2026-09-04T20:16:08.012Z',
}

describe('SeenByDialog — reading order', () => {
  // "Seen by" as the dialog's title put two lines of context between a heading
  // and the names it introduced. The message is the subject; the label belongs
  // on the list it labels.
  it('leads with the message, then the label above the names', async () => {
    render(<SeenByDialog message={MESSAGE} onClose={vi.fn()} />)

    const subject = await screen.findByText(MESSAGE.body)
    const label   = screen.getByText('Seen by')
    expect(subject.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const posted = screen.getByTestId('seen-by-posted')
    expect(posted.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('counts the readers beside the label', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {
        readers: [{ _id: 'r1', displayName: 'Anna', seenAt: new Date().toISOString() }],
        truncated: false,
        total: 7,
      } }),
    })
    render(<SeenByDialog message={MESSAGE} onClose={vi.fn()} />)

    expect(await screen.findByTestId('seen-by-count')).toHaveTextContent('7 agents')
  })

  it('shows no count while there is nothing to count', async () => {
    render(<SeenByDialog message={MESSAGE} onClose={vi.fn()} />)

    await screen.findByText(/Nobody has opened this conversation/)
    expect(screen.queryByTestId('seen-by-count')).toBeNull()
  })
})

describe('SeenByDialog — when it was posted', () => {
  // "Who has read this" is a question about a moment. Three readers means
  // something different an hour after posting than a week after, and without
  // the stamp there is nothing to measure the answer against.
  it('states the posting time in full, with the year', async () => {
    render(<SeenByDialog message={MESSAGE} onClose={vi.fn()} />)

    const posted = await screen.findByTestId('seen-by-posted')
    expect(posted.textContent).toMatch(/^Posted /)
    // formatStamp, not the list's relative time: a dated record carries its
    // date, its year and a clock time.
    expect(posted.textContent).toContain('2026')
    expect(posted.textContent).toContain('Sep')
  })

  it('renders no stamp line for a message with no timestamp', async () => {
    render(<SeenByDialog message={{ _id: 'm2', body: 'x' }} onClose={vi.fn()} />)

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('seen-by-posted')).toBeNull()
  })
})

// Who reacted used to be a second modal, then a second section. Reacting is
// something a reader did, not a separate population, so it belongs on the
// reader's own row.
describe('SeenByDialog — who reacted', () => {
  const REACTED = { ...MESSAGE, reactions: [{ emoji: '👍', count: 1, mine: false }] }
  const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString()

  // First span on each row is the name; the emoji and the relative time follow
  // it, and "5m ago" would otherwise leak a letter into the comparison.
  const names = () => [...document.querySelectorAll('li')].map(li => li.querySelector('span').textContent)

  beforeEach(() => {
    mockUseAuth.mockReturnValue({ API: '', apiFetch, user: { isAdmin: true } })
  })

  it('puts an agent and what they reacted with on one row', async () => {
    route({
      seenBy: { readers: [{ _id: 'a', displayName: 'Sponge', seenAt: ago(60) }], total: 1 },
      reactions: [{ emoji: '👍', count: 1, users: [{ _id: 'a', displayName: 'Sponge' }] }],
    })
    render(<SeenByDialog message={REACTED} onClose={vi.fn()} />)

    const row = (await screen.findByText('Sponge')).closest('li')
    expect(row.textContent).toContain('👍')
    expect(within(row).getByTestId('reacted-with')).toBeTruthy()
    // One row, not one under "seen" and another under "reacted".
    expect(document.querySelectorAll('li')).toHaveLength(1)
  })

  it('carries every emoji one agent tapped on that one row', async () => {
    route({
      seenBy: { readers: [{ _id: 'a', displayName: 'Sponge', seenAt: ago(60) }], total: 1 },
      reactions: [
        { emoji: '👍', count: 1, users: [{ _id: 'a', displayName: 'Sponge' }] },
        { emoji: '🎉', count: 1, users: [{ _id: 'a', displayName: 'Sponge' }] },
      ],
    })
    render(<SeenByDialog message={REACTED} onClose={vi.fn()} />)

    const row = (await screen.findByText('Sponge')).closest('li')
    expect(within(row).getByTestId('reacted-with').textContent).toBe('👍 🎉')
  })

  // Tapping an emoji is a deliberate act; opening the channel is not.
  it('sorts reactors above everyone else, however recently they looked', async () => {
    route({
      seenBy: { readers: [
        { _id: 'a', displayName: 'Newest', seenAt: ago(1) },
        { _id: 'b', displayName: 'Older',  seenAt: ago(90) },
        { _id: 'c', displayName: 'Oldest', seenAt: ago(600) },
      ], total: 3 },
      reactions: [{ emoji: '👍', count: 1, users: [{ _id: 'c', displayName: 'Oldest' }] }],
    })
    render(<SeenByDialog message={REACTED} onClose={vi.fn()} />)

    await screen.findByText('Oldest')
    expect(names()).toEqual(['Oldest', 'Newest', 'Older'])
  })

  // The sender is left out of the reader list on purpose — posting marks the
  // thread read for them — but a reaction of their own still puts them here.
  it('lists a reactor the read markers missed', async () => {
    route({
      seenBy: { readers: [{ _id: 'a', displayName: 'Sponge', seenAt: ago(5) }], total: 1 },
      reactions: [{ emoji: '🔥', count: 1, users: [{ _id: 'z', displayName: 'Author' }] }],
    })
    render(<SeenByDialog message={REACTED} onClose={vi.fn()} />)

    await screen.findByText('Author')
    expect(names()).toEqual(['Author', 'Sponge'])
  })

  it('says how many reactions it could not put a name to', async () => {
    route({
      seenBy: { readers: [], total: 0 },
      reactions: [{ emoji: '👍', count: 3, users: [{ _id: 'a', displayName: 'Sponge' }] }],
    })
    render(<SeenByDialog message={REACTED} onClose={vi.fn()} />)

    expect(await screen.findByText(/Plus 2 reactions we cannot put a name to/)).toBeTruthy()
  })

  // The endpoint is admin-only by design: an anonymous pill is a cheap thing
  // to tap, and reacting is the only interaction a read-only channel has.
  it('shows a member nothing but their own reader list', async () => {
    mockUseAuth.mockReturnValue({ API: '', apiFetch, user: { isAdmin: false } })
    route({
      seenBy: { readers: [{ _id: 'a', displayName: 'Sponge', seenAt: ago(5) }], total: 1 },
      reactions: [{ emoji: '👍', count: 1, users: [{ _id: 'a', displayName: 'Sponge' }] }],
    })
    render(<SeenByDialog message={REACTED} onClose={vi.fn()} />)

    await screen.findByText('Sponge')
    expect(screen.queryByTestId('reacted-with')).toBeNull()
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/reactions'), expect.anything(),
    )
  })

  it('asks for nothing on a message nobody has reacted to', async () => {
    render(<SeenByDialog message={MESSAGE} onClose={vi.fn()} />)

    await screen.findByText('Seen by')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})
