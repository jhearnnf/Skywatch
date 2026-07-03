import { describe, it, expect } from 'vitest'
import { cbatLastRankKey } from '../storageKeys'

describe('cbatLastRankKey', () => {
  it('namespaces the remembered weekly rank per game key', () => {
    expect(cbatLastRankKey('target')).toBe('sw_cbat_last_rank_target')
    expect(cbatLastRankKey('plane-turn-2d')).toBe('sw_cbat_last_rank_plane-turn-2d')
  })

  it('produces a distinct key for each game so ranks never collide', () => {
    expect(cbatLastRankKey('angles')).not.toBe(cbatLastRankKey('sat'))
  })
})
