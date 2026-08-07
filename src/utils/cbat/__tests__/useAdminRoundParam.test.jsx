import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAdminRoundParam } from '../useAdminRoundParam'

// AuthContext pulls in fetch, PostHog and a provider tree that has nothing to
// do with the behaviour under test, so only useAuth is stubbed. Nothing from
// react-router-dom is needed at all — see the note in the hook about why it
// reads window.location rather than useLocation.
const mockUser = vi.fn()
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser() }),
}))

const setUrl = (search) => window.history.replaceState({}, '', `/cbat/dpt${search}`)

const setup = ({ search = '?round=5', admin = true, ready = true, totalRounds = 8 } = {}) => {
  mockUser.mockReturnValue(admin ? { isAdmin: true } : { isAdmin: false })
  setUrl(search)
  const onJump = vi.fn()
  const view = renderHook(
    ({ ready: r }) => useAdminRoundParam({ totalRounds, ready: r, onJump }),
    { initialProps: { ready } },
  )
  return { onJump, ...view }
}

beforeEach(() => { mockUser.mockReset() })
afterEach(() => { window.history.replaceState({}, '', '/') })

describe('useAdminRoundParam', () => {
  it('jumps to the requested round once the game is ready', () => {
    const { onJump } = setup()
    expect(onJump).toHaveBeenCalledExactlyOnceWith(5)
  })

  // The whole point of `ready`: the arena mounts behind an intro curtain, and a
  // jump landed then is overwritten when the game actually starts.
  it('waits for the game rather than jumping on mount', () => {
    const { onJump, rerender } = setup({ ready: false })
    expect(onJump).not.toHaveBeenCalled()

    rerender({ ready: true })
    expect(onJump).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('jumps once, not on every render', () => {
    const { onJump, rerender } = setup()
    rerender({ ready: true })
    rerender({ ready: true })
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  // A game that flips out of and back into its playing phase — ACT does
  // exactly this, because jumping sets phase to 'callsign' — must not
  // re-trigger and wipe the run it just started.
  it('does not re-jump when the game leaves and re-enters the ready phase', () => {
    const { onJump, rerender } = setup()
    rerender({ ready: false })
    rerender({ ready: true })
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a non-admin', () => {
    const { onJump } = setup({ admin: false })
    expect(onJump).not.toHaveBeenCalled()
  })

  it('does nothing when there is no round parameter', () => {
    const { onJump } = setup({ search: '' })
    expect(onJump).not.toHaveBeenCalled()
  })

  it('does nothing for a round the game does not have', () => {
    const { onJump } = setup({ search: '?round=9', totalRounds: 8 })
    expect(onJump).not.toHaveBeenCalled()
  })

  it('leaves other query parameters alone', () => {
    const { onJump } = setup({ search: '?mode=3d&round=4' })
    expect(onJump).toHaveBeenCalledExactlyOnceWith(4)
  })

  // An inline arrow is a fresh function identity every render; the ref is what
  // stops that counting as a reason to jump again.
  it('is not retriggered by a caller passing a new callback each render', () => {
    mockUser.mockReturnValue({ isAdmin: true })
    setUrl('?round=3')
    const seen = []
    const { rerender } = renderHook(() =>
      useAdminRoundParam({ totalRounds: 8, ready: true, onJump: (r) => seen.push(r) }))
    rerender()
    rerender()
    expect(seen).toEqual([3])
  })
})
