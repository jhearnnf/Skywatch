import { render, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useEffect } from 'react'

// Stub AuthContext: the provider destructures user/setUser/API/apiFetch.
// Track gameUnlocks across setUser calls so applyUnlocks's "is this a NEW
// unlock?" check can be exercised properly.
let mockUser = { _id: 'u1', gameUnlocks: {} }
const setUserMock = vi.fn((updater) => {
  mockUser = typeof updater === 'function' ? updater(mockUser) : updater
})

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user:     mockUser,
    setUser:  setUserMock,
    API:      '',
    apiFetch: vi.fn(),
  }),
}))

import { NewGameUnlockProvider, useNewGameUnlock } from '../NewGameUnlockContext'

function Capture({ sink }) {
  const ctx = useNewGameUnlock()
  useEffect(() => { sink.ctx = ctx })
  return null
}

function reset() {
  mockUser = { _id: 'u1', gameUnlocks: {} }
  setUserMock.mockClear()
}

describe('NewGameUnlockContext — pending play-nav flash', () => {
  it('starts with pendingPlayNavFlash false', () => {
    reset()
    const sink = {}
    render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)
  })

  it('applyUnlocks with a genuinely new key sets the flag', () => {
    reset()
    const sink = {}
    render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks(['quiz']) })
    expect(sink.ctx.pendingPlayNavFlash).toBe(true)
  })

  it('applyUnlocks with empty / null does NOT set the flag', () => {
    reset()
    const sink = {}
    render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks([]) })
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)

    act(() => { sink.ctx.applyUnlocks(null) })
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)
  })

  it('applyUnlocks with an already-unlocked key does NOT set the flag (avoids spurious second flash)', () => {
    reset()
    // Pre-unlock 'flashcard' — this matches the BriefReader case where the
    // user has already unlocked the flashcard game from a previous brief, but
    // BriefReader's badgePendingRef path still calls applyUnlocks(['flashcard']).
    mockUser = {
      _id: 'u1',
      gameUnlocks: { flashcard: { unlockedAt: '2025-01-01T00:00:00Z', badgeSeen: true } },
    }
    const sink = {}
    render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks(['flashcard']) })
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)
  })

  it('applyUnlocks fires the flag when even ONE key in a mixed batch is genuinely new', () => {
    reset()
    // 'quiz' already unlocked, 'boo' is new → flag should fire
    mockUser = {
      _id: 'u1',
      gameUnlocks: { quiz: { unlockedAt: '2025-01-01T00:00:00Z', badgeSeen: true } },
    }
    const sink = {}
    render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks(['quiz', 'boo']) })
    expect(sink.ctx.pendingPlayNavFlash).toBe(true)
  })

  it('consumePlayNavFlash clears the flag', () => {
    reset()
    const sink = {}
    render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks(['boo']) })
    expect(sink.ctx.pendingPlayNavFlash).toBe(true)

    act(() => { sink.ctx.consumePlayNavFlash() })
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)
  })

  it('flashes for any of the four game keys (quiz, flashcard, boo, wta)', () => {
    for (const key of ['quiz', 'flashcard', 'boo', 'wta']) {
      reset()
      const sink = {}
      const { unmount } = render(<NewGameUnlockProvider><Capture sink={sink} /></NewGameUnlockProvider>)
      act(() => { sink.ctx.applyUnlocks([key]) })
      expect(sink.ctx.pendingPlayNavFlash).toBe(true)
      unmount()
    }
  })
})
