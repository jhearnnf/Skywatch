import { describe, it, expect } from 'vitest'
import { rollingAverage } from '../ImprovementChart'

// The smoothing is the one place the landing wall transforms a player's data, so
// it is pinned: it must calm the noise without inventing, exaggerating or
// reversing the improvement the card claims in words.

describe('rollingAverage', () => {
  it('returns one point per run', () => {
    expect(rollingAverage([1, 2, 3, 4, 5], 3)).toHaveLength(5)
  })

  it('leaves a flat history flat — it cannot manufacture a climb', () => {
    expect(rollingAverage([100, 100, 100, 100, 100], 3)).toEqual([100, 100, 100, 100, 100])
  })

  it('averages each point with its neighbours', () => {
    // Middle point of [0, 30, 60] with a window of 3 is 30.
    expect(rollingAverage([0, 30, 60], 3)[1]).toBe(30)
  })

  it('slides the window inward at the ends instead of shrinking it', () => {
    // Every drawn point averages the same number of runs, so the two ends are no
    // noisier than the middle.
    expect(rollingAverage([10, 20, 30, 40, 50], 3)[0]).toBe(20)  // mean of 10,20,30
    expect(rollingAverage([10, 20, 30, 40, 50], 3)[4]).toBe(40)  // mean of 30,40,50
  })

  // The invariant the card's credibility rests on: the line must start and end
  // on the same two averages the badge and footer quote. A 2-run endpoint once
  // put a visibly falling line under a "+52%" badge.
  it('starts and ends on the first-five and last-five averages', () => {
    const scores = [100, 100, 100, 100, 100, 900, 200, 200, 200, 200, 200, 20]
    const smoothed = rollingAverage(scores)

    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
    expect(smoothed[0]).toBe(mean(scores.slice(0, 5)))
    expect(smoothed[smoothed.length - 1]).toBe(mean(scores.slice(-5)))
  })

  it('does not let one bad final run drag the line down against the claim', () => {
    // Improving player whose very last run was a disaster. The badge compares
    // five-run averages and still says "better", so the line must too.
    const scores = [100, 100, 100, 100, 100, 300, 300, 300, 300, 300, 0]
    const smoothed = rollingAverage(scores)
    expect(smoothed[smoothed.length - 1]).toBeGreaterThan(smoothed[0])
  })

  it('never smooths past the true range of the runs', () => {
    const scores = [400, 900, 500, 1000, 600, 1100]
    const smoothed = rollingAverage(scores, 3)
    expect(Math.min(...smoothed)).toBeGreaterThanOrEqual(Math.min(...scores))
    expect(Math.max(...smoothed)).toBeLessThanOrEqual(Math.max(...scores))
  })

  it('keeps the direction of travel — a rising history still rises', () => {
    const smoothed = rollingAverage([100, 120, 90, 140, 160, 150, 200, 210], 3)
    expect(smoothed[smoothed.length - 1]).toBeGreaterThan(smoothed[0])
  })

  it('keeps a falling history falling', () => {
    const smoothed = rollingAverage([200, 210, 180, 150, 160, 120, 100], 3)
    expect(smoothed[smoothed.length - 1]).toBeLessThan(smoothed[0])
  })

  it('widens the window on a longer history', () => {
    // 60 runs default to a window of 12, which smooths a spike far harder than
    // the 3-run window a short history gets.
    const spiky = Array.from({ length: 60 }, (_, i) => (i === 30 ? 1000 : 100))
    const [wide] = [rollingAverage(spiky)[30]]
    const narrow = rollingAverage(spiky, 3)[30]
    expect(wide).toBeLessThan(narrow)
  })
})
