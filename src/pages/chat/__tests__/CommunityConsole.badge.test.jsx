import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Arriving at the console from the badge, you still have to pick a tab. Only
// Conversations has a queue behind it, so only Conversations counts.
const mockQueue = vi.hoisted(() => ({ value: 0 }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
  useSearchParams: () => [new URLSearchParams()],
}))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ API: '' }) }))
vi.mock('../../../context/ChatUnreadContext', () => ({
  useChatUnread: () => ({ totalUnreadConversations: mockQueue.value }),
}))
vi.mock('../../../hooks/useGameBodyClass', () => ({ useGameBodyClass: () => {} }))
// Every tab body fetches its own data; this file is about the tab strip.
vi.mock('../AdminChatView', () => ({ default: () => <div data-testid="conversations" /> }))
vi.mock('../../admin/ChatChannelsEditor', () => ({ default: () => null }))
vi.mock('../../admin/ChatGuidesEditor', () => ({ default: () => null }))
vi.mock('../../admin/ChatBotEditor', () => ({ default: () => null }))
vi.mock('../../admin/CommunitySoundEditor', () => ({ default: () => null }))

import CommunityConsole from '../CommunityConsole'

describe('CommunityConsole — the queue badge', () => {
  beforeEach(() => { mockQueue.value = 0 })

  it('counts waiting threads on the Conversations tab', () => {
    mockQueue.value = 2
    render(<CommunityConsole />)
    const badge = screen.getByLabelText('2 support threads waiting for a reply')
    expect(badge.textContent).toBe('2')
    expect(badge.closest('button').textContent).toContain('Conversations')
  })

  it('leaves the settings tabs unbadged', () => {
    mockQueue.value = 2
    render(<CommunityConsole />)
    for (const label of ['Guides', 'Channels', 'Bots', 'Sound']) {
      expect(screen.getByText(label).closest('button').textContent).toBe(label)
    }
  })

  it('shows nothing when the queue is empty', () => {
    render(<CommunityConsole />)
    expect(screen.queryByLabelText(/waiting for a reply/)).toBeNull()
  })
})
