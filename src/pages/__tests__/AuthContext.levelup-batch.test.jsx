// Verifies that awardAirstars emits a SINGLE level-up notif per award even
// when the cycle gain crosses multiple level thresholds (e.g. admin awarding
// a large test grant). The notif should reflect the highest level reached.

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
        { levelNumber: 1,  cumulativeAirstars: 0     },
        { levelNumber: 2,  cumulativeAirstars: 100   },
        { levelNumber: 3,  cumulativeAirstars: 350   },
        { levelNumber: 4,  cumulativeAirstars: 850   },
        { levelNumber: 5,  cumulativeAirstars: 1700  },
        { levelNumber: 6,  cumulativeAirstars: 3000  },
        { levelNumber: 7,  cumulativeAirstars: 4850  },
        { levelNumber: 8,  cumulativeAirstars: 7350  },
        { levelNumber: 9,  cumulativeAirstars: 10600 },
        { levelNumber: 10, cumulativeAirstars: 14700 },
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

describe('awardAirstars — level-up batching', () => {
  beforeEach(() => { setupFetch() })
  afterEach(() => { vi.restoreAllMocks() })

  it('emits exactly one levelup notif when an award crosses multiple level thresholds', async () => {
    const sink = {}
    render(<AuthProvider><Capture sink={sink} /></AuthProvider>)
    await waitFor(() => expect(sink.ctx?.user?._id).toBe('user1'))
    // Wait for levels fetch to resolve so getLevelNumber has thresholds
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/levels'), expect.anything()))

    // 0 → 5000 crosses levels 2,3,4,5,6,7 (cumulative 100/350/850/1700/3000/4850).
    act(() => {
      sink.ctx.awardAirstars(5000, 'Test Airstars', { cycleAfter: 5000, totalAfter: 5000 })
    })

    await waitFor(() => expect(sink.ctx.notifQueue.length).toBeGreaterThan(0))
    const levelUps = sink.ctx.notifQueue.filter(n => n.type === 'levelup')
    expect(levelUps).toHaveLength(1)
    // Notif shows the highest level reached, not an intermediate one
    expect(levelUps[0].level).toBe(7)
  })

  it('still emits a levelup notif for a single-threshold crossing', async () => {
    const sink = {}
    render(<AuthProvider><Capture sink={sink} /></AuthProvider>)
    await waitFor(() => expect(sink.ctx?.user?._id).toBe('user1'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/levels'), expect.anything()))

    act(() => {
      sink.ctx.awardAirstars(120, 'Brief read', { cycleAfter: 120, totalAfter: 120 })
    })

    await waitFor(() => expect(sink.ctx.notifQueue.length).toBeGreaterThan(0))
    const levelUps = sink.ctx.notifQueue.filter(n => n.type === 'levelup')
    expect(levelUps).toHaveLength(1)
    expect(levelUps[0].level).toBe(2)
  })

  it('emits no levelup notif when no level threshold is crossed', async () => {
    const sink = {}
    render(<AuthProvider><Capture sink={sink} /></AuthProvider>)
    await waitFor(() => expect(sink.ctx?.user?._id).toBe('user1'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/users/levels'), expect.anything()))

    act(() => {
      sink.ctx.awardAirstars(50, 'Brief read', { cycleAfter: 50, totalAfter: 50 })
    })

    await waitFor(() => expect(sink.ctx.notifQueue.length).toBeGreaterThan(0))
    const levelUps = sink.ctx.notifQueue.filter(n => n.type === 'levelup')
    expect(levelUps).toHaveLength(0)
  })
})
