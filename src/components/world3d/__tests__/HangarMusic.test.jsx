import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const updateHangarMusic = vi.fn()
vi.mock('../../../utils/world3d/hangarMusic', () => ({
  updateHangarMusic: (...a) => updateHangarMusic(...a),
}))

import HangarMusic from '../HangarMusic'

beforeEach(() => updateHangarMusic.mockClear())
afterEach(cleanup)

describe('<HangarMusic>', () => {
  it('starts the lobby soundtrack while mounted', () => {
    render(<HangarMusic />)
    expect(updateHangarMusic).toHaveBeenCalledWith('lobby')
  })

  it('stops the soundtrack on unmount (leaving the hangar)', () => {
    const { unmount } = render(<HangarMusic />)
    updateHangarMusic.mockClear()
    unmount()
    expect(updateHangarMusic).toHaveBeenCalledWith(null)
  })
})
