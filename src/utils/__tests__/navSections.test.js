import { describe, it, expect } from 'vitest'
import { getActiveNavTo, transitionKeyFor } from '../navSections'

describe('transitionKeyFor', () => {
  // This is the fix for "clicking a channel reloads the whole page": App.jsx
  // keys the route subtree on this value, so any two URLs sharing a key stay
  // mounted across the navigation.
  it('collapses every chat URL to one page key', () => {
    expect(transitionKeyFor('/chat')).toBe('/chat')
    expect(transitionKeyFor('/chat/507f1f77bcf86cd799439011')).toBe('/chat')
    expect(transitionKeyFor('/chat/admin')).toBe('/chat')
  })

  it('leaves every other route keyed on its own pathname', () => {
    for (const p of ['/home', '/cbat', '/cbat/target', '/profile', '/rankings']) {
      expect(transitionKeyFor(p)).toBe(p)
    }
  })

  it('does not let /chat swallow a similarly-named route', () => {
    // Guard against a regression to a bare startsWith.
    expect(transitionKeyFor('/chatter')).toBe('/chatter')
    expect(transitionKeyFor('/chat-history')).toBe('/chat-history')
  })
})

describe('getActiveNavTo', () => {
  it('highlights chat for every chat surface', () => {
    expect(getActiveNavTo('/chat')).toBe('/chat')
    expect(getActiveNavTo('/chat/507f1f77bcf86cd799439011')).toBe('/chat')
    expect(getActiveNavTo('/chat/admin')).toBe('/chat')
  })

  it('does not let a prefix swallow a sibling route', () => {
    expect(getActiveNavTo('/cbat-game-history')).toBe('/play')
    expect(getActiveNavTo('/learn-priority')).toBe('/learn-priority')
  })
})
