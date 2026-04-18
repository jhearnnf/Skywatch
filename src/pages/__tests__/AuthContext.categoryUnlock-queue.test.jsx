// Verifies that awardAirstars queues notifications in the right order:
// airstar → (levelup × N | rankpromotion) → categoryUnlock (final).

import { render, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { AuthProvider, useAuth } from '../../context/AuthContext'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

const INITIAL_USER = {
  _id: 'user1', email: 'u@example.com', totalAirstars: 0, cycleAirstars: 0,
}

function setupFetch() {
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/api/auth/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { user: INITIAL_USER } }) })
    }
    if (typeof url === 'string' && url.includes('/api/users/levels')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { levels: [
        { levelNumber: 1, cumulativeAirstars: 0   },
        { levelNumber: 2, cumulativeAirstars: 100 },
        { levelNumber: 3, cumulativeAirstars: 350 },
      ] } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function Capture({ sink }) {
  const ctx = useAuth()
  useEffect(() => { sink.ctx = ctx }, [ctx, sink])
  return null
}

describe('awardAirstars notification queue ordering', () => {
  beforeEach(() => { setupFetch() })
  afterEach(() => { vi.restoreAllMocks() })

  it('queues categoryUnlock as the final item after airstar+levelup', async () => {
    const sink = {}
    render(<AuthProvider><Capture sink={sink} /></AuthProvider>)
    await waitFor(() => expect(sink.ctx?.user?._id).toBe('user1'))

    act(() => {
      sink.ctx.awardAirstars(120, 'Brief read', {
        cycleAfter: 120, totalAfter: 120,
        unlockedCategories: ['Aircraft', 'Tech'],
      })
    })

    await waitFor(() => expect(sink.ctx.notifQueue.length).toBeGreaterThan(0))
    const types = sink.ctx.notifQueue.map(n => n.type)
    expect(types[0]).toBe('airstar')
    expect(types).toContain('levelup')
    expect(types[types.length - 1]).toBe('categoryUnlock')
    expect(sink.ctx.notifQueue.at(-1).categories).toEqual(['Aircraft', 'Tech'])
  })

  it('queues categoryUnlock after a rank promotion notif', async () => {
    const sink = {}
    render(<AuthProvider><Capture sink={sink} /></AuthProvider>)
    await waitFor(() => expect(sink.ctx?.user?._id).toBe('user1'))

    act(() => {
      sink.ctx.awardAirstars(50, 'Quiz', {
        cycleAfter: 50, totalAfter: 14750,
        rankPromotion: { from: { rankNumber: 1 }, to: { rankNumber: 2, rankName: 'LAC' } },
        unlockedCategories: ['Missions'],
      })
    })

    await waitFor(() => expect(sink.ctx.notifQueue.length).toBeGreaterThan(0))
    const types = sink.ctx.notifQueue.map(n => n.type)
    expect(types[0]).toBe('airstar')
    expect(types).toContain('rankpromotion')
    expect(types).not.toContain('levelup') // rankpromotion supersedes
    expect(types[types.length - 1]).toBe('categoryUnlock')
  })

  it('queues no categoryUnlock notif when unlockedCategories is empty or absent', async () => {
    const sink = {}
    render(<AuthProvider><Capture sink={sink} /></AuthProvider>)
    await waitFor(() => expect(sink.ctx?.user?._id).toBe('user1'))

    act(() => {
      sink.ctx.awardAirstars(10, 'Test', { cycleAfter: 10, totalAfter: 10 })
    })

    await waitFor(() => expect(sink.ctx.notifQueue.length).toBeGreaterThan(0))
    const types = sink.ctx.notifQueue.map(n => n.type)
    expect(types).not.toContain('categoryUnlock')
  })
})
