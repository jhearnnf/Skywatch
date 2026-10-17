import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ API: '' }),
}))

import ChatSearch from '../components/ChatSearch'
import { excerptAround } from '../searchExcerpt'

const ROOMS = [
  { key: 'lounge',        conversationId: 'c-lounge', title: 'Lounge' },
  { key: 'general',       conversationId: 'c-general', title: 'General' },
  { key: 'announcements', conversationId: 'c-news', title: 'Announcements' },
]

const result = (over = {}) => ({
  _id: 'm1', conversationId: 'c-general', senderUserId: 'u2', senderDisplayName: 'Viper',
  body: 'anyone got radar tips?', createdAt: new Date(2026, 0, 1).toISOString(), ...over,
})

const stub = (data = { results: [result()], senders: {}, hasMore: false }) => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'success', data }) }))
}
const searchUrl = (i = 0) => new URL(String(globalThis.fetch.mock.calls[i][0]), 'http://x')

beforeEach(() => stub())
afterEach(cleanup)

const type = (value) => fireEvent.change(screen.getByLabelText('Search messages'), { target: { value } })

describe('ChatSearch', () => {
  it('waits for two characters before searching', async () => {
    render(<ChatSearch rooms={ROOMS} />)
    type('r')
    await new Promise(r => setTimeout(r, 400))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('searches the rooms switched on, and only those', async () => {
    render(<ChatSearch rooms={ROOMS} initialSelected={['lounge', 'general']} />)
    type('radar')
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    expect(searchUrl().searchParams.get('q')).toBe('radar')
    expect(searchUrl().searchParams.get('in')).toBe('c-lounge,c-general')

    fireEvent.click(screen.getByRole('button', { name: 'Announcements' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(searchUrl(1).searchParams.get('in')).toBe('c-lounge,c-general,c-news')
  })

  it('never lets the last room be switched off', async () => {
    render(<ChatSearch rooms={ROOMS} initialSelected={['general']} />)
    const general = screen.getByRole('button', { name: 'General' })
    fireEvent.click(general)
    expect(general).toHaveAttribute('aria-pressed', 'true')
  })

  it('lists each result with its room and the match marked, and hands the pick back', async () => {
    const onPick = vi.fn()
    render(<ChatSearch rooms={ROOMS} onPick={onPick} />)
    type('radar')
    const row = await screen.findByTestId('search-result')
    expect(row).toHaveTextContent('Viper')
    expect(row).toHaveTextContent('General')
    expect(row.querySelector('mark')).toHaveTextContent('radar')

    fireEvent.click(row)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ _id: 'm1' }), ROOMS[1])
  })

  it('says so when nothing matches', async () => {
    stub({ results: [], senders: {}, hasMore: false })
    render(<ChatSearch rooms={ROOMS} />)
    type('zzz')
    expect(await screen.findByText('No messages match "zzz".')).toBeInTheDocument()
  })

  it('pages back through older matches', async () => {
    stub({ results: [result()], senders: {}, hasMore: true })
    render(<ChatSearch rooms={ROOMS} />)
    type('radar')
    fireEvent.click(await screen.findByRole('button', { name: 'Show older matches' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(searchUrl(1).searchParams.get('before')).toBe(result().createdAt)
  })

  it('has no room picker for a single room', () => {
    render(<ChatSearch rooms={[ROOMS[0]]} />)
    expect(screen.queryByRole('group', { name: 'Rooms to search' })).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ChatSearch rooms={ROOMS} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('excerptAround', () => {
  it('leaves a short message whole', () => {
    expect(excerptAround('short one', 'one')).toBe('short one')
  })

  it('cuts a long message down to the match', () => {
    const body = `${'a '.repeat(150)}needle${' b'.repeat(150)}`
    const out = excerptAround(body, 'needle')
    expect(out).toContain('needle')
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })
})
