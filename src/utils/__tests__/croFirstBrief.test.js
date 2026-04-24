import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  setCroFirstBrief,
  isCroFirstBriefActive,
  clearCroFirstBrief,
  CRO_FIRST_BRIEF_KEY,
} from '../storageKeys'

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CRO first-brief session marker', () => {
  it('isCroFirstBriefActive returns false when nothing is set', () => {
    expect(isCroFirstBriefActive()).toBe(false)
  })

  it('setCroFirstBrief writes a numeric timestamp under the expected key', () => {
    setCroFirstBrief()
    const raw = sessionStorage.getItem(CRO_FIRST_BRIEF_KEY)
    expect(raw).not.toBeNull()
    expect(Number.isFinite(Number(raw))).toBe(true)
    expect(isCroFirstBriefActive()).toBe(true)
  })

  it('clearCroFirstBrief removes the marker', () => {
    setCroFirstBrief()
    expect(isCroFirstBriefActive()).toBe(true)
    clearCroFirstBrief()
    expect(sessionStorage.getItem(CRO_FIRST_BRIEF_KEY)).toBeNull()
    expect(isCroFirstBriefActive()).toBe(false)
  })

  it('returns false and clears the marker once the TTL (30 min) has elapsed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T10:00:00Z'))
    setCroFirstBrief()
    expect(isCroFirstBriefActive()).toBe(true)

    // Advance past 30 minutes
    vi.setSystemTime(new Date('2026-04-24T10:31:00Z'))
    expect(isCroFirstBriefActive()).toBe(false)
    expect(sessionStorage.getItem(CRO_FIRST_BRIEF_KEY)).toBeNull()
  })

  it('treats a non-numeric stored value as inactive', () => {
    sessionStorage.setItem(CRO_FIRST_BRIEF_KEY, 'not-a-number')
    expect(isCroFirstBriefActive()).toBe(false)
  })
})
