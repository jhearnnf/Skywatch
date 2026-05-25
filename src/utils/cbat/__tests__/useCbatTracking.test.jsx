import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockCapture = vi.hoisted(() => vi.fn())
const mockRecordCbatStart = vi.hoisted(() => vi.fn())
const mockUseAuth = vi.hoisted(() => vi.fn(() => ({
  apiFetch: vi.fn(),
  API: 'http://api.test',
})))

vi.mock('../../../lib/posthog', () => ({ captureEvent: mockCapture }))
vi.mock('../recordStart', () => ({ recordCbatStart: mockRecordCbatStart }))
vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

import { useCbatTracking } from '../useCbatTracking'

describe('useCbatTracking', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    mockCapture.mockClear()
    mockRecordCbatStart.mockClear()
  })

  it('start fires game_started and records server-side start', () => {
    const { result } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('act') })

    expect(mockCapture).toHaveBeenCalledWith('game_started', { gameKey: 'act' })
    expect(mockRecordCbatStart).toHaveBeenCalledWith('act', expect.any(Function), 'http://api.test')
  })

  it('markCompleted fires game_completed with duration + extra props', () => {
    const { result } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('angles') })
    act(() => { vi.advanceTimersByTime(7500) })
    act(() => { result.current.markCompleted({ score: 12 }) })

    expect(mockCapture).toHaveBeenCalledWith('game_completed', {
      gameKey: 'angles',
      durationMs: 7500,
      score: 12,
    })
  })

  it('markCompleted includes last setRound value when no round in extra', () => {
    const { result } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('act') })
    act(() => { result.current.setRound(3) })
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => { result.current.markCompleted({}) })

    expect(mockCapture).toHaveBeenLastCalledWith('game_completed', {
      gameKey: 'act',
      durationMs: 2000,
      round: 3,
    })
  })

  it('unmount fires game_abandoned when not completed', () => {
    const { result, unmount } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('symbols') })
    act(() => { result.current.setRound(2) })
    act(() => { vi.advanceTimersByTime(4000) })
    unmount()

    expect(mockCapture).toHaveBeenCalledWith('game_abandoned', {
      gameKey: 'symbols',
      durationMs: 4000,
      reason: 'unmount',
      round: 2,
    })
  })

  it('unmount does NOT fire game_abandoned after markCompleted', () => {
    const { result, unmount } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('flag') })
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { result.current.markCompleted() })
    mockCapture.mockClear()
    unmount()

    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('pagehide fires game_abandoned with reason=pagehide, unmount does not double-fire', () => {
    const { result, unmount } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('dpt') })
    act(() => { vi.advanceTimersByTime(2500) })

    act(() => { window.dispatchEvent(new Event('pagehide')) })

    expect(mockCapture).toHaveBeenCalledWith('game_abandoned', expect.objectContaining({
      gameKey: 'dpt',
      durationMs: 2500,
      reason: 'pagehide',
    }))

    mockCapture.mockClear()
    unmount()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('markCompleted is a no-op if start was never called', () => {
    const { result } = renderHook(() => useCbatTracking())
    act(() => { result.current.markCompleted() })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('meta from start flows into started/completed/abandoned events', () => {
    const { result } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('plane-turn-3d', { mode: '3d' }) })
    expect(mockCapture).toHaveBeenCalledWith('game_started', { gameKey: 'plane-turn-3d', mode: '3d' })

    act(() => { vi.advanceTimersByTime(1500) })
    act(() => { result.current.markCompleted({ score: 42 }) })
    expect(mockCapture).toHaveBeenLastCalledWith('game_completed', {
      gameKey: 'plane-turn-3d',
      durationMs: 1500,
      mode: '3d',
      score: 42,
    })
  })

  it('meta is included on abandon', () => {
    const { result, unmount } = renderHook(() => useCbatTracking())
    act(() => { result.current.start('plane-turn-2d', { mode: '2d' }) })
    act(() => { vi.advanceTimersByTime(800) })
    unmount()
    expect(mockCapture).toHaveBeenCalledWith('game_abandoned', expect.objectContaining({
      gameKey: 'plane-turn-2d',
      mode: '2d',
      reason: 'unmount',
    }))
  })
})
