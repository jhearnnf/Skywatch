import { describe, it, expect } from 'vitest'
import { GAME_DEMO_POOL, pickGameDemos, takeWithHeavyCap } from '../gameDemoPool'

// Deterministic rng so a failure is reproducible.
function seededRng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const heavyCount = (picks) => picks.filter((p) => p.heavy).length

describe('pickGameDemos', () => {
  it('fills the requested number of cards with no repeats', () => {
    const picks = pickGameDemos({}, { count: 9, rng: seededRng(7) })
    expect(picks).toHaveLength(9)
    expect(new Set(picks.map((p) => p.id)).size).toBe(9)
  })

  it('rations canvas-backed games when there is room to', () => {
    // Six cards can be filled without going near the pool's limits, so the cap
    // holds exactly.
    for (let seed = 1; seed <= 25; seed++) {
      const picks = pickGameDemos({}, { count: 6, maxHeavy: 2, rng: seededRng(seed) })
      expect(heavyCount(picks)).toBe(2)
    }
  })

  it('never lets a nine-card grid fill up with canvases', () => {
    // Half the pool is heavy, so nine cards must include some — but a visit
    // should never land on six or seven at once.
    for (let seed = 1; seed <= 25; seed++) {
      const picks = pickGameDemos({}, { count: 9, maxHeavy: 4, rng: seededRng(seed) })
      expect(picks).toHaveLength(9)
      expect(heavyCount(picks)).toBeLessThanOrEqual(5)
    }
  })

  it('shuffles — successive picks are not always the same nine', () => {
    const a = pickGameDemos({}, { count: 9, rng: seededRng(3) }).map((p) => p.id).join()
    const b = pickGameDemos({}, { count: 9, rng: seededRng(99) }).map((p) => p.id).join()
    expect(a).not.toBe(b)
  })

  it('drops games an admin has disabled', () => {
    const settings = { cbatGameEnabled: { sat: false, cut: false, symbols: false } }
    const picks = pickGameDemos(settings, { count: 9, rng: seededRng(5) })
    const ids = picks.map((p) => p.id)
    expect(ids).not.toContain('sat')
    expect(ids).not.toContain('cut')
    expect(ids).not.toContain('symbols')
  })

  it('never returns more cards than the pool has left', () => {
    const cbatGameEnabled = Object.fromEntries(
      GAME_DEMO_POOL.slice(2).map((g) => [g.gameKey, false]),
    )
    const picks = pickGameDemos({ cbatGameEnabled }, { count: 9, rng: seededRng(2) })
    expect(picks.length).toBeLessThanOrEqual(2)
  })

  it('lets heavy games over the cap back in rather than leaving gaps', () => {
    // Disable every light game: the grid still fills from the heavy ones.
    const cbatGameEnabled = Object.fromEntries(
      GAME_DEMO_POOL.filter((g) => !g.heavy).map((g) => [g.gameKey, false]),
    )
    const picks = pickGameDemos({ cbatGameEnabled }, { count: 9, maxHeavy: 2, rng: seededRng(11) })
    expect(picks.length).toBe(GAME_DEMO_POOL.filter((g) => g.heavy).length)
  })

})

describe('takeWithHeavyCap', () => {
  const light = (id) => ({ id, heavy: false })
  const heavy = (id) => ({ id, heavy: true })

  it('holds the cap while there are light games to take', () => {
    const list = [heavy('a'), heavy('b'), heavy('c'), light('d'), light('e'), light('f')]
    const out = takeWithHeavyCap(list, 4, 2)
    expect(out.map((g) => g.id)).toEqual(['a', 'b', 'd', 'e'])
  })

  it('backfills over the cap rather than leaving the grid short', () => {
    const list = [heavy('a'), heavy('b'), heavy('c'), light('d')]
    const out = takeWithHeavyCap(list, 4, 1)
    expect(out).toHaveLength(4)
  })

  it('is a stable subset of what it was given', () => {
    // The grid derives its mobile six from the desktop nine, so mobile can
    // never show a game desktop didn't pick.
    const picks = pickGameDemos({}, { count: 9, rng: seededRng(21) })
    const mobile = takeWithHeavyCap(picks, 6, 2)
    expect(mobile).toHaveLength(6)
    for (const g of mobile) expect(picks).toContain(g)
  })
})

describe('GAME_DEMO_POOL', () => {
  it('covers the twelve games the wall advertises', () => {
    expect(GAME_DEMO_POOL).toHaveLength(12)
    expect(new Set(GAME_DEMO_POOL.map((g) => g.id)).size).toBe(12)
  })

  it('gives every entry a poster, a path and a game key', () => {
    for (const g of GAME_DEMO_POOL) {
      expect(g.poster, g.id).toBeTruthy()
      expect(g.path, g.id).toMatch(/^\/cbat\//)
      expect(g.gameKey, g.id).toBeTruthy()
    }
  })
})
