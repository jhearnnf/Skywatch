import { render, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useEffect } from 'react'

// Stub AuthContext: provide a user so applyUnlocks doesn't early-return,
// plus the setUser/API/apiFetch fields the provider destructures.
vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user:     { _id: 'u1', categoryUnlocks: {} },
    setUser:  vi.fn(),
    API:      '',
    apiFetch: vi.fn(),
  }),
}))

import { NewCategoryUnlockProvider, useNewCategoryUnlock } from '../NewCategoryUnlockContext'

function Capture({ sink }) {
  const ctx = useNewCategoryUnlock()
  useEffect(() => { sink.ctx = ctx })
  return null
}

describe('NewCategoryUnlockContext — pending learn-nav flash', () => {
  it('starts with pendingLearnNavFlash false', () => {
    const sink = {}
    render(<NewCategoryUnlockProvider><Capture sink={sink} /></NewCategoryUnlockProvider>)
    expect(sink.ctx.pendingLearnNavFlash).toBe(false)
  })

  it('applyUnlocks with non-empty grant sets the flag', () => {
    const sink = {}
    render(<NewCategoryUnlockProvider><Capture sink={sink} /></NewCategoryUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks([{ category: 'Aircraft', unlockedAt: new Date().toISOString() }]) })
    expect(sink.ctx.pendingLearnNavFlash).toBe(true)
  })

  it('applyUnlocks with empty grant does NOT set the flag', () => {
    const sink = {}
    render(<NewCategoryUnlockProvider><Capture sink={sink} /></NewCategoryUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks([]) })
    expect(sink.ctx.pendingLearnNavFlash).toBe(false)

    act(() => { sink.ctx.applyUnlocks(null) })
    expect(sink.ctx.pendingLearnNavFlash).toBe(false)

    act(() => { sink.ctx.applyUnlocks(undefined) })
    expect(sink.ctx.pendingLearnNavFlash).toBe(false)
  })

  it('consumeLearnNavFlash clears the flag', () => {
    const sink = {}
    render(<NewCategoryUnlockProvider><Capture sink={sink} /></NewCategoryUnlockProvider>)

    act(() => { sink.ctx.applyUnlocks([{ category: 'Tech' }]) })
    expect(sink.ctx.pendingLearnNavFlash).toBe(true)

    act(() => { sink.ctx.consumeLearnNavFlash() })
    expect(sink.ctx.pendingLearnNavFlash).toBe(false)
  })
})
