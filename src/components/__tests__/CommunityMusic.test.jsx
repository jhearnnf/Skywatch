import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockUpdate   = vi.hoisted(() => vi.fn())
const mockPathname = vi.hoisted(() => ({ value: '/' }))
const mockNative   = vi.hoisted(() => ({ value: false }))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname.value }),
}))
vi.mock('../../utils/communityMusic', () => ({ updateCommunityMusic: mockUpdate }))
vi.mock('../../utils/appMode', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, get NATIVE_APP() { return mockNative.value } }
})

import CommunityMusic from '../CommunityMusic'

const zoneFor = (pathname) => {
  mockPathname.value = pathname
  mockUpdate.mockClear()
  render(<CommunityMusic />)
  return mockUpdate.mock.calls.at(-1)?.[0]
}

describe('CommunityMusic', () => {
  beforeEach(() => { mockUpdate.mockClear(); mockNative.value = false })

  it('plays across every Community surface', () => {
    // One zone for all of them, so moving list -> thread -> console keeps the
    // same track running instead of restarting it on each navigation.
    for (const p of ['/chat', '/chat/admin', '/chat/507f1f77bcf86cd799439011']) {
      expect(zoneFor(p)).toBe('community')
    }
  })

  it('is silent everywhere else', () => {
    for (const p of ['/', '/cbat', '/profile', '/rankings']) {
      expect(zoneFor(p)).toBeNull()
    }
  })

  it('does not let /chat swallow a similarly-named route', () => {
    expect(zoneFor('/chatter')).toBeNull()
  })

  it('is silent inside the native app, where Community does not exist', () => {
    mockNative.value = true
    expect(zoneFor('/chat')).toBeNull()
  })

  it('stops the track when it unmounts', () => {
    mockPathname.value = '/chat'
    const { unmount } = render(<CommunityMusic />)
    mockUpdate.mockClear()
    unmount()
    expect(mockUpdate).toHaveBeenCalledWith(null)
  })
})
