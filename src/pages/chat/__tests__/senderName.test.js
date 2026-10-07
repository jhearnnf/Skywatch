import { describe, it, expect } from 'vitest'
import { senderName } from '../senderName'

describe('senderName', () => {
  it('prefers the live name over the snapshot', () => {
    const senders = { u1: { displayName: 'New Name', agentNumber: '7431947' } }
    expect(senderName('u1', senders, 'Old Name')).toBe('New Name')
  })

  it('shows Agent N, not the old snapshot, when the live name was cleared', () => {
    const senders = { u1: { displayName: null, agentNumber: '7431947' } }
    expect(senderName('u1', senders, 'Old Name')).toBe('Agent 7431947')
  })

  it('falls back to the snapshot when there is no live profile', () => {
    expect(senderName(null, {}, 'Deleted Person')).toBe('Deleted Person')
    expect(senderName('u2', {}, 'Guide Bot')).toBe('Guide Bot')
  })

  it('returns null when nothing names the author', () => {
    expect(senderName(null, {}, null)).toBeNull()
  })
})
