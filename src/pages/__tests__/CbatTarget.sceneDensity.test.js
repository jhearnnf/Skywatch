import { describe, it, expect, vi } from 'vitest'

// Pure planner test; stub the page's heavy imports as scanPick does.
vi.mock('react-router-dom', () => ({ Link: () => null }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({}) }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({}) }))
vi.mock('../../context/GameChromeContext', () => ({ useGameChrome: () => ({}) }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/AircraftTopDown', () => ({ default: () => null }))
vi.mock('../../data/aircraftModels', () => ({
  getModelUrl: () => null,
  hasWorkingCloseupModel: () => true,
}))
vi.mock('framer-motion', () => ({
  motion: { div: () => null, button: () => null },
  AnimatePresence: ({ children }) => children,
}))

import { planGame, SCENE_DENSITY, SCENE_HIT_POINTS } from '../CbatTarget'

const matching = (plan) => plan.shapes.filter(s =>
  !s.fake && s.kind !== 'unknown' &&
  plan.targets.some(t => t.kind === s.kind && t.color === s.color && t.damaged === s.damaged && t.highPriority === s.highPriority))

// The Real CBAT field is packed with small marks like the real test. Finds are
// slower there, so it plants more matches and pays more for each one.
describe('planGame — scene density', () => {
  it('fills the Real CBAT scene with far more shapes than SkyWatch', () => {
    for (let i = 0; i < 20; i++) {
      const sky = planGame(SCENE_DENSITY.skywatch)
      const cbat = planGame(SCENE_DENSITY.cbat)
      const fakes = (p) => p.shapes.filter(s => s.fake).length
      expect(fakes(cbat)).toBeGreaterThan(fakes(sky) * 2)
    }
  })

  it('plants more matches per target under Real CBAT', () => {
    expect(SCENE_DENSITY.cbat.match[0]).toBeGreaterThan(SCENE_DENSITY.skywatch.match[0])
    expect(SCENE_DENSITY.cbat.match[1]).toBeGreaterThan(SCENE_DENSITY.skywatch.match[1])
  })

  it('pays more for a scene find under Real CBAT, keeping SkyWatch at 13', () => {
    expect(SCENE_HIT_POINTS.skywatch).toBe(13)
    expect(SCENE_HIT_POINTS.cbat).toBeGreaterThan(SCENE_HIT_POINTS.skywatch)
  })

  it('offers a far bigger scene total under Real CBAT', () => {
    // Points on offer = every match and diamond found. Averaged over many plans.
    const onOffer = (density, pts) => {
      let sum = 0
      for (let i = 0; i < 50; i++) {
        const p = planGame(density)
        sum += (matching(p).length + p.shapes.filter(s => s.kind === 'unknown').length) * pts
      }
      return sum / 50
    }
    expect(onOffer(SCENE_DENSITY.cbat, SCENE_HIT_POINTS.cbat))
      .toBeGreaterThan(onOffer(SCENE_DENSITY.skywatch, SCENE_HIT_POINTS.skywatch) * 1.5)
  })

  it('puts more on screen from the start under Real CBAT', () => {
    const atStart = (p) => p.shapes.filter(s => s.spawnAt === 0).length
    expect(atStart(planGame(SCENE_DENSITY.cbat))).toBeGreaterThan(atStart(planGame(SCENE_DENSITY.skywatch)) * 2)
  })

  it('keeps every shape inside the padded canvas', () => {
    const { pad } = SCENE_DENSITY.cbat
    for (const s of planGame(SCENE_DENSITY.cbat).shapes) {
      expect(s.x).toBeGreaterThanOrEqual(pad)
      expect(s.x).toBeLessThanOrEqual(1000 - pad)
      expect(s.y).toBeGreaterThanOrEqual(pad)
      expect(s.y).toBeLessThanOrEqual(800 - pad)
    }
  })

  it('still plants matching shapes for the targets', () => {
    expect(matching(planGame(SCENE_DENSITY.cbat)).length).toBeGreaterThan(0)
  })

  it('defaults to the SkyWatch density', () => {
    const p = planGame()
    expect(p.shapes.filter(s => s.fake).length).toBeLessThanOrEqual(SCENE_DENSITY.skywatch.fakes[1])
  })
})
