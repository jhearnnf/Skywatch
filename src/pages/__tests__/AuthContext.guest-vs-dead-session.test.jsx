// A 401 from /auth/me means two completely different things depending on who
// asked. For someone whose session has died it is the alarm this whole
// apiHealth mechanism exists to raise. For a first-time visitor it is simply
// the correct answer to "am I signed in?" — and treating it as a dead session
// put "You're signed out — your scores aren't being saved" (OfflineStatus) on
// the landing page of everyone who had never signed in.

import { render, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AuthProvider } from '../../context/AuthContext'
import { getApiHealth, __resetApiHealth } from '../../lib/apiHealth'
import { AUTH_TOKEN_KEY, USER_CACHE_KEY } from '../../utils/storageKeys'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

const CACHED_USER = { _id: 'user1', email: 'u@example.com' }

// Everything 401s — a server that is up and does not know us. Anything less
// would be unrealistic: once /auth/me rejects the session, the background calls
// a restored cached user triggers (outbox flush, roster warm) reject too, and a
// mock answering them 200 would flip the health state straight back to ok.
function fetchAlways401() {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: false, status: 401, json: async () => ({}) }))
}

describe('mount session check — 401 handling', () => {
  beforeEach(() => {
    __resetApiHealth()
    localStorage.clear()
    fetchAlways401()
  })
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('leaves a never-signed-in visitor healthy — no dead-session warning', async () => {
    render(<AuthProvider><div /></AuthProvider>)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/me'), expect.anything()))
    await waitFor(() => expect(getApiHealth().status).toBe('ok'))
  })

  it('still flags a dead session when a cached user says we were signed in', async () => {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(CACHED_USER))
    render(<AuthProvider><div /></AuthProvider>)

    await waitFor(() => expect(getApiHealth().status).toBe('signedOut'))
  })

  it('flags a dead session on native, where a stored token is the evidence', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'stale.jwt.token')
    render(<AuthProvider><div /></AuthProvider>)

    await waitFor(() => expect(getApiHealth().status).toBe('signedOut'))
  })
})
