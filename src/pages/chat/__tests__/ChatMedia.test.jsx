import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'

// Photos and videos in chat, on the client: the paperclip only where the
// server allows it, the tray uploads before Send, Send carries the signed
// receipts, messages draw their files, and the admin tools (upload switch,
// session replay) say the right thing.
const mockApiFetch = vi.hoisted(() => vi.fn())
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch, user: { _id: 'a1', isAdmin: true } }),
}))

// The network half of the upload, replaced: signing resolves, and the
// Cloudinary POST resolves when the test says so.
const mockUploads = vi.hoisted(() => ({ resolvers: [] }))
vi.mock('../../../lib/chatMedia', async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    compressImage: vi.fn(async (file) => ({ blob: file, width: 800, height: 600 })),
    signUpload: vi.fn(async () => ({ uploadUrl: 'https://api.cloudinary.com/v1_1/t/image/upload', fields: { signature: 's' } })),
    uploadToCloudinary: vi.fn(() => ({
      promise: new Promise(resolve => mockUploads.resolvers.push(resolve)),
      abort: vi.fn(),
    })),
  }
})

import ComposeBox from '../components/ComposeBox'
import MessageList from '../components/MessageList'
import { MediaPermissionToggle, ReplayLinks } from '../components/TicketAdminTools'

beforeAll(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})
beforeEach(() => {
  mockApiFetch.mockReset()
  mockUploads.resolvers = []
})
afterEach(() => cleanup())

const photo = () => new File(['x'], 'shot.png', { type: 'image/png' })

describe('ComposeBox with photos and videos', () => {
  it('has no paperclip unless the thread allows this viewer to attach', () => {
    render(<ComposeBox onSend={vi.fn()} />)
    expect(screen.queryByTestId('attach-button')).toBeNull()
  })

  it('uploads a file, holds Send until it is done, then sends its receipt', async () => {
    const onSend = vi.fn()
    render(<ComposeBox onSend={onSend} mediaConversationId="c1" />)
    expect(screen.getByTestId('attach-button')).toBeTruthy()

    fireEvent.change(screen.getByTestId('attach-input'), { target: { files: [photo()] } })
    expect(await screen.findByTestId('attachment-tray')).toBeTruthy()

    const send = screen.getByRole('button', { name: 'Send' })
    await waitFor(() => expect(mockUploads.resolvers).toHaveLength(1))
    expect(send.disabled).toBe(true)

    await act(async () => {
      mockUploads.resolvers[0]({ public_id: 'chat-attachments/c1/img_1', version: 9, signature: 'good', width: 800, height: 600 })
    })
    await waitFor(() => expect(send.disabled).toBe(false))

    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledTimes(1)
    const [text, files] = onSend.mock.calls[0]
    expect(text).toBe('')
    expect(files[0].receipt).toMatchObject({ publicId: 'chat-attachments/c1/img_1', version: 9, signature: 'good' })
    expect(screen.queryByTestId('attachment-tray')).toBeNull()
  })

  it('refuses anything that is not a photo or video', async () => {
    render(<ComposeBox onSend={vi.fn()} mediaConversationId="c1" />)
    fireEvent.change(screen.getByTestId('attach-input'), {
      target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] },
    })
    expect(await screen.findByText('Only photos and videos can be sent.')).toBeTruthy()
  })

  it('warns about ID documents in the attach menu, without an em dash', () => {
    render(<ComposeBox onSend={vi.fn()} mediaConversationId="c1" />)
    fireEvent.click(screen.getByTestId('attach-button'))
    const note = screen.getByText(/don't send ID documents or bank details/)
    expect(note.textContent).not.toMatch(/—/)
  })
})

describe('MessageList with attachments', () => {
  const base = {
    _id: 'm1', senderUserId: 'u1', senderDisplayName: 'Falcon', senderRole: 'user', body: '',
    createdAt: new Date().toISOString(), reactions: [], mentions: [], deleted: false, editedAt: null,
  }

  it('draws a photo thumbnail that opens full size, and a playable video', () => {
    render(
      <MessageList
        messages={[{ ...base, attachments: [
          { kind: 'image', url: 'https://x/full.webp', thumbUrl: 'https://x/thumb.webp', width: 800, height: 600 },
          { kind: 'video', url: 'https://x/clip.mp4', posterUrl: 'https://x/clip.jpg', width: 720, height: 1280 },
        ] }]}
        currentUserId="u1"
        senders={{}}
      />,
    )
    const box = screen.getByTestId('message-attachments')
    expect(box.querySelector('img').getAttribute('src')).toBe('https://x/thumb.webp')
    expect(box.querySelector('video').getAttribute('src')).toBe('https://x/clip.mp4')

    fireEvent.click(screen.getByRole('button', { name: 'Open photo' }))
    const lightbox = screen.getByTestId('attachment-lightbox')
    expect(lightbox.querySelector('img').getAttribute('src')).toBe('https://x/full.webp')
  })
})

describe('admin tools', () => {
  it('turns user uploads on and reports the new state', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { media: { canToggle: true, allowed: true } } }) })
    const onChanged = vi.fn()
    render(<MediaPermissionToggle conversationId="t1" media={{ canToggle: true, allowed: false }} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow user uploaded content for this chat' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ canToggle: true, allowed: true }))
    const [url, opts] = mockApiFetch.mock.calls[0]
    expect(url).toBe('/api/chat/conversations/t1/media-permission')
    expect(JSON.parse(opts.body)).toEqual({ allowed: true })
  })

  it('is not drawn for someone who cannot flip the switch', () => {
    render(<MediaPermissionToggle conversationId="t1" media={{ canToggle: false, allowed: false }} />)
    expect(screen.queryByTestId('media-permission')).toBeNull()
  })

  it('links the session replay and the earlier sessions, matches first', () => {
    render(<ReplayLinks replay={{
      recording: true,
      url: 'https://eu.posthog.com/project/1/replay/s1?t=60',
      earlier: { status: 'ready', sessions: [
        { sessionId: 's2', url: 'https://eu.posthog.com/project/1/replay/s2', startedAt: '2026-11-08T10:00:00Z', durationSec: 300, pages: ['SMA'], matchesReport: true },
      ] },
    }} />)
    const watch = screen.getByRole('link', { name: 'Watch session replay' })
    expect(watch.getAttribute('href')).toBe('https://eu.posthog.com/project/1/replay/s1?t=60')
    expect(watch.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('Visited reported page')).toBeTruthy()
  })

  it('says so when there was no recording, or the lookup failed', () => {
    render(<ReplayLinks replay={{ recording: false, url: null, earlier: { status: 'failed', sessions: [] } }} />)
    expect(screen.getByText(/No recording for this report/)).toBeTruthy()
    expect(screen.getByText("Couldn't load earlier sessions.")).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Watch session replay' })).toBeNull()
  })
})
