import { describe, it, expect, vi } from 'vitest'

// The page's module-level imports drag in R3F, framer-motion and the app
// contexts; none of that matters to a pure picker, so stub the lot.
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

import { pickScanPanelAircraft } from '../CbatTarget'

const ROSTER = ['p8', 'a400m', 'typhoon', 'f35'].map(briefId => ({ briefId }))
const TARGET = ROSTER[2]

describe('pickScanPanelAircraft', () => {
  it('returns the target when the match roll succeeds', () => {
    const rng = vi.fn().mockReturnValueOnce(0.1)
    expect(pickScanPanelAircraft(ROSTER, TARGET, rng)).toBe(TARGET)
  })

  it('never returns the target on the miss branch', () => {
    // The old picker drew the miss from the whole roster, so with four
    // aircraft roughly half of every panel was still the target.
    for (let i = 0; i < 200; i++) {
      const rng = vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(Math.random())
      expect(pickScanPanelAircraft(ROSTER, TARGET, rng)).not.toBe(TARGET)
    }
  })

  it('can reach every non-target aircraft', () => {
    const seen = new Set()
    for (let i = 0; i < 300; i++) {
      const rng = vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(Math.random())
      seen.add(pickScanPanelAircraft(ROSTER, TARGET, rng).briefId)
    }
    expect([...seen].sort()).toEqual(['a400m', 'f35', 'p8'])
  })

  it('falls back to the target when it is the only aircraft', () => {
    const rng = vi.fn().mockReturnValueOnce(0.99)
    expect(pickScanPanelAircraft([TARGET], TARGET, rng)).toBe(TARGET)
  })

  it('draws from the whole roster when there is no target yet', () => {
    // No target means no match roll, so the only rng call is the index draw.
    const rng = vi.fn().mockReturnValueOnce(0)
    expect(pickScanPanelAircraft(ROSTER, null, rng)).toBe(ROSTER[0])
    expect(rng).toHaveBeenCalledTimes(1)
  })
})
