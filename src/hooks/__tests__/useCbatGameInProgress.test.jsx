import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

// "Mid-test" is the immersive chrome on a /cbat/ route and nothing else:
// the instructions and score screens of a game leave immersive, and other
// immersive pages (brief reader, quizzes) are not tests.

const route = vi.hoisted(() => ({ pathname: '/' }))
const chrome = vi.hoisted(() => ({ immersive: false }))
vi.mock('react-router-dom', () => ({ useLocation: () => route }))
vi.mock('../../context/GameChromeContext', () => ({ useGameChrome: () => chrome }))

import { useCbatGameInProgress } from '../useCbatGameInProgress'

const at = (pathname, immersive) => {
  route.pathname = pathname
  chrome.immersive = immersive
  return renderHook(() => useCbatGameInProgress()).result.current
}

describe('useCbatGameInProgress', () => {
  it('is true while a CBAT game is in its immersive play phase', () => {
    expect(at('/cbat/symbols', true)).toBe(true)
    expect(at('/cbat/act/hard', true)).toBe(true)
  })

  it('is false on a game page outside play (instructions, score screen)', () => {
    expect(at('/cbat/symbols', false)).toBe(false)
  })

  it('is false on the hub and on other immersive pages', () => {
    expect(at('/cbat', true)).toBe(false)
    expect(at('/briefs/abc', true)).toBe(false)
    expect(at('/', false)).toBe(false)
  })
})
