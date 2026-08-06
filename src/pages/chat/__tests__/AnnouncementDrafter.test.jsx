import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockApiFetch = vi.hoisted(() => vi.fn())

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: mockApiFetch }),
}))

import AnnouncementDrafter from '../components/AnnouncementDrafter'

const ok = (data) => ({ ok: true, json: async () => ({ status: 'success', data }) })

describe('AnnouncementDrafter', () => {
  beforeEach(() => { mockApiFetch.mockReset() })

  it('shows each AI draft as an editable card and posts nothing on its own', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({
      updates: [
        { text: 'Trace 2 is live.', shas: ['aaa1111'] },
        { text: 'Leaderboards are faster.', shas: ['bbb2222'] },
      ],
      commitsConsidered: 2,
      skipped: 0,
    }))

    render(<AnnouncementDrafter conversationId="c1" />)
    fireEvent.click(screen.getByText(/Draft updates from GitHub/))

    await waitFor(() => expect(screen.getByDisplayValue('Trace 2 is live.')).toBeTruthy())
    expect(screen.getByDisplayValue('Leaderboards are faster.')).toBeTruthy()
    expect(screen.getByText(/2 drafts/)).toBeTruthy()

    // Drafting must never publish — exactly one call, the draft request.
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(mockApiFetch.mock.calls[0][0]).toMatch(/draft-updates$/)
  })

  it('posts an edited draft with the commits it covered', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({
      updates: [{ text: 'Trace 2 is live.', shas: ['aaa1111'] }],
      commitsConsidered: 1, skipped: 0,
    }))

    const onPosted = vi.fn()
    render(<AnnouncementDrafter conversationId="c1" onPosted={onPosted} />)
    fireEvent.click(screen.getByText(/Draft updates from GitHub/))

    const box = await screen.findByDisplayValue('Trace 2 is live.')
    fireEvent.change(box, { target: { value: 'Trace 2 is now available.' } })

    mockApiFetch.mockResolvedValueOnce(ok({ message: { _id: 'm1' } }))
    fireEvent.click(screen.getByText('Approve & post'))

    await waitFor(() => expect(onPosted).toHaveBeenCalled())
    const [url, opts] = mockApiFetch.mock.calls[1]
    expect(url).toMatch(/\/announce$/)
    expect(JSON.parse(opts.body)).toEqual({
      body: 'Trace 2 is now available.',
      shas: ['aaa1111'],
    })
    // The posted card leaves the queue.
    expect(screen.queryByDisplayValue('Trace 2 is now available.')).toBeNull()
  })

  it('discards a draft without calling the server', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({
      updates: [{ text: 'Not worth announcing.', shas: [] }],
      commitsConsidered: 1, skipped: 0,
    }))

    render(<AnnouncementDrafter conversationId="c1" />)
    fireEvent.click(screen.getByText(/Draft updates from GitHub/))

    await screen.findByDisplayValue('Not worth announcing.')
    fireEvent.click(screen.getByText('Discard'))

    await waitFor(() => expect(screen.queryByDisplayValue('Not worth announcing.')).toBeNull())
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('says so plainly when nothing is worth announcing', async () => {
    mockApiFetch.mockResolvedValueOnce(ok({ updates: [], commitsConsidered: 3, skipped: 4 }))

    render(<AnnouncementDrafter conversationId="c1" />)
    fireEvent.click(screen.getByText(/Draft updates from GitHub/))

    await waitFor(() =>
      expect(screen.getByText(/Nothing player-facing in the recent commits/)).toBeTruthy())
    expect(screen.getByText(/4 already announced/)).toBeTruthy()
  })

  it('lets an admin write one by hand', async () => {
    render(<AnnouncementDrafter conversationId="c1" />)

    fireEvent.change(screen.getByPlaceholderText('Write an announcement…'), {
      target: { value: 'Scheduled maintenance tonight.' },
    })
    mockApiFetch.mockResolvedValueOnce(ok({ message: { _id: 'm1' } }))
    fireEvent.click(screen.getByText('Post'))

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    const [url, opts] = mockApiFetch.mock.calls[0]
    expect(url).toMatch(/\/announce$/)
    expect(JSON.parse(opts.body)).toEqual({ body: 'Scheduled maintenance tonight.', shas: [] })
  })

  it('surfaces a drafting failure instead of failing silently', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false, json: async () => ({ message: 'GitHub is not configured on the server.' }),
    })

    render(<AnnouncementDrafter conversationId="c1" />)
    fireEvent.click(screen.getByText(/Draft updates from GitHub/))

    await waitFor(() =>
      expect(screen.getByText('GitHub is not configured on the server.')).toBeTruthy())
  })
})
