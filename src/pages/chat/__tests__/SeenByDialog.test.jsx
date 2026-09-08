import { render, screen, waitFor } from '@testing-library/react'
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
