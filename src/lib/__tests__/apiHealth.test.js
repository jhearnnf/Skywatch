import { describe, it, expect, beforeEach } from 'vitest'
import {
  getApiHealth,
  noteApiReachable,
  noteApiUnauthorized,
  noteApiUnreachable,
  onApiHealthChange,
  __resetApiHealth,
} from '../apiHealth'

// The distinction this module exists to draw: a rejected fetch (no status code
// at all — offline, DNS, dead backend, CORS) is NOT the same as a 401. The old
// code couldn't tell them apart, so a dead session looked exactly like being
// offline: the app kept the cached user, queued everything, and said nothing.

beforeEach(() => __resetApiHealth())

describe('failure classification', () => {
  it('starts healthy', () => {
    expect(getApiHealth().status).toBe('ok')
  })

  it('needs two consecutive failures before crying wolf', () => {
    noteApiUnreachable(new Error('Failed to fetch'))
    expect(getApiHealth().status).toBe('ok')

    noteApiUnreachable(new Error('Failed to fetch'))
    expect(getApiHealth().status).toBe('unreachable')
  })

  it('treats a 401 as signed-out immediately — no threshold', () => {
    noteApiUnauthorized()
    expect(getApiHealth().status).toBe('signedOut')
  })

  it('recovers on the next good response', () => {
    noteApiUnreachable(new Error('x'))
    noteApiUnreachable(new Error('x'))
    expect(getApiHealth().status).toBe('unreachable')

    noteApiReachable()
    expect(getApiHealth().status).toBe('ok')
  })

  it('resets the failure run after a success, so blips never accumulate', () => {
    noteApiUnreachable(new Error('x'))
    noteApiReachable()
    noteApiUnreachable(new Error('x'))
    expect(getApiHealth().status).toBe('ok')
  })

  it('tracks how long it has been failing, for the diagnostic report', () => {
    expect(getApiHealth().failingSince).toBeNull()
    noteApiUnreachable(new Error('x'))
    noteApiUnreachable(new Error('x'))
    expect(getApiHealth().failingSince).toBeTruthy()
    expect(getApiHealth().failingForMs).toBeGreaterThanOrEqual(0)
  })

  it('keeps the last error message for the log row', () => {
    noteApiUnreachable(new Error('Failed to fetch'))
    noteApiUnreachable(new Error('Failed to fetch'))
    expect(getApiHealth().lastError).toContain('Failed to fetch')
  })

  it('clears the failure clock when the session is merely rejected', () => {
    noteApiUnreachable(new Error('x'))
    noteApiUnreachable(new Error('x'))
    noteApiUnauthorized()
    expect(getApiHealth().failingSince).toBeNull()
  })
})

describe('subscribers', () => {
  it('notifies on a state change', () => {
    const seen = []
    onApiHealthChange((h) => seen.push(h.status))

    noteApiUnreachable(new Error('x'))
    noteApiUnreachable(new Error('x'))
    noteApiReachable()

    expect(seen).toEqual(['unreachable', 'ok'])
  })

  it('does not re-notify for an unchanged state', () => {
    const seen = []
    onApiHealthChange((h) => seen.push(h.status))

    noteApiReachable()
    noteApiReachable()
    expect(seen).toEqual([])
  })

  it('survives a listener that throws', () => {
    const seen = []
    onApiHealthChange(() => { throw new Error('bad listener') })
    onApiHealthChange((h) => seen.push(h.status))

    noteApiUnauthorized()
    expect(seen).toEqual(['signedOut'])
  })

  it('unsubscribes cleanly', () => {
    const seen = []
    const off = onApiHealthChange((h) => seen.push(h.status))
    off()

    noteApiUnauthorized()
    expect(seen).toEqual([])
  })
})
