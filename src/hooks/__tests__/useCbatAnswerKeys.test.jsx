import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const authRef = vi.hoisted(() => ({ user: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: authRef.user }),
}))

import { answerKeyIndex, useCbatMcq } from '../useCbatAnswerKeys'

const press = (key, extra = {}) => {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra })) })
}

describe('answerKeyIndex', () => {
  const ev = (key, extra = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, ...extra })

  it('maps number keys to option indexes within count', () => {
    expect(answerKeyIndex(ev('1'), 'number', 5)).toBe(0)
    expect(answerKeyIndex(ev('5'), 'number', 5)).toBe(4)
    expect(answerKeyIndex(ev('6'), 'number', 5)).toBe(-1)
    expect(answerKeyIndex(ev('0'), 'number', 5)).toBe(-1)
  })

  it('maps letter keys A-G, either case, for lettered options', () => {
    expect(answerKeyIndex(ev('a'), 'letter', 5)).toBe(0)
    expect(answerKeyIndex(ev('E'), 'letter', 5)).toBe(4)
    expect(answerKeyIndex(ev('f'), 'letter', 5)).toBe(-1)
    expect(answerKeyIndex(ev('1'), 'letter', 5)).toBe(-1)
  })

  it('ignores modified keys so browser shortcuts survive', () => {
    expect(answerKeyIndex(ev('1', { ctrlKey: true }), 'number', 5)).toBe(-1)
    expect(answerKeyIndex(ev('a', { metaKey: true }), 'both', 5)).toBe(-1)
  })
})

describe('useCbatMcq', () => {
  beforeEach(() => { authRef.user = null })

  it('SkyWatch theme: a number key commits the option at once', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useCbatMcq({ count: 5, onCommit, resetKey: 0 }))
    expect(result.current.cbat).toBe(false)
    press('3')
    expect(onCommit).toHaveBeenCalledWith(2)
    expect(result.current.pending).toBe(null)
  })

  it('SkyWatch theme: Enter does nothing', () => {
    const onCommit = vi.fn()
    renderHook(() => useCbatMcq({ count: 5, onCommit, resetKey: 0 }))
    press('Enter')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Real CBAT theme: a key marks the answer and Enter commits it', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const onCommit = vi.fn()
    const { result } = renderHook(() => useCbatMcq({ count: 5, onCommit, resetKey: 0 }))
    expect(result.current.cbat).toBe(true)
    press('2')
    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(1)
    // Change of mind before committing
    press('4')
    expect(result.current.pending).toBe(3)
    press('Enter')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(3)
    expect(result.current.pending).toBe(null)
  })

  it('Real CBAT theme: Enter with nothing marked is a no-op', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const onCommit = vi.fn()
    renderHook(() => useCbatMcq({ count: 5, onCommit, resetKey: 0 }))
    press('Enter')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Real CBAT theme: select() from a click marks too, and commit() commits', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const onCommit = vi.fn()
    const { result } = renderHook(() => useCbatMcq({ count: 5, onCommit, resetKey: 0 }))
    act(() => result.current.select(4))
    expect(result.current.pending).toBe(4)
    act(() => result.current.commit())
    expect(onCommit).toHaveBeenCalledWith(4)
  })

  it('clears the marked answer when the question moves on', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const { result, rerender } = renderHook(({ q }) => useCbatMcq({ count: 5, onCommit: () => {}, resetKey: q }), { initialProps: { q: 0 } })
    press('1')
    expect(result.current.pending).toBe(0)
    rerender({ q: 1 })
    expect(result.current.pending).toBe(null)
  })

  it('ignores keys while typing in a field and while disabled', () => {
    const onCommit = vi.fn()
    const { rerender } = renderHook(({ enabled }) => useCbatMcq({ enabled, count: 5, onCommit }), { initialProps: { enabled: true } })
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })) })
    expect(onCommit).not.toHaveBeenCalled()
    input.remove()
    rerender({ enabled: false })
    press('1')
    expect(onCommit).not.toHaveBeenCalled()
  })
})
