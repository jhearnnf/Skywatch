import { cloneElement } from 'react'
import { render } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import CbatProgressChart from '../CbatProgressChart'

// ResponsiveContainer measures its parent, which is 0×0 in jsdom, so the chart renders nothing.
// It normally hands measured width/height down to its child; do that with fixed numbers so the
// marks and ticks actually reach the DOM.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => cloneElement(children, { width: 600, height: 240 }),
  }
})

const DAY = 86400000

// `days` = how many days ago each run happened (so the series reads oldest → newest).
const seriesOverDays = (days, score = 10) =>
  days.map(d => ({ score, time: 30, at: new Date(Date.now() - d * DAY).toISOString() }))

const renderFull = (series, props = {}) =>
  render(<CbatProgressChart series={series} variant="full" height={240} {...props} />)

const textIn = (container, selector) =>
  [...container.querySelectorAll(`${selector} text`)].map(t => t.textContent.trim()).filter(Boolean)

// Scoped per axis on purpose: a value-axis tick of "100" would satisfy a month-label regex, so
// asserting over every <text> in the chart would give false passes.
// Recharts 3 renders tick labels into their own z-index layer rather than inside the axis group,
// so these target *-tick-labels; '.recharts-xAxis text' matches nothing.
const xTicks = (container) => textIn(container, '.recharts-xAxis-tick-labels')
const yTicks = (container) => textIn(container, '.recharts-yAxis-tick-labels')
const allText = (container) =>
  [...container.querySelectorAll('text')].map(t => t.textContent.trim()).filter(Boolean)

describe('CbatProgressChart', () => {
  it('renders nothing without any runs', () => {
    const { container } = renderFull([])
    expect(container.firstChild).toBeNull()
  })

  describe('date axis', () => {
    // The axis used to read "#1 #2 #3", which tells nobody anything.
    it('labels a short history with day-level dates, not attempt numbers', () => {
      const { container } = renderFull(seriesOverDays([6, 4, 2, 0]))
      const labels = xTicks(container)

      expect(labels.some(l => /^\d+ \w{3}$/.test(l))).toBe(true)   // e.g. "12 Jul"
      expect(labels.some(l => l.startsWith('#'))).toBe(false)
    })

    // Past ~3 weeks, a tick per day would be unreadable.
    it('drops to month labels once the history spans more than three weeks', () => {
      const { container } = renderFull(seriesOverDays([120, 90, 60, 30, 0]))
      const labels = xTicks(container)

      // Month names only — no day-of-month component.
      const monthish = labels.filter(l => /^\w{3}( \d{2})?$/.test(l))
      expect(monthish.length).toBeGreaterThan(0)
      expect(labels.some(l => /^\d+ \w{3}$/.test(l))).toBe(false)
    })

    // Eight runs in one evening should produce one date tick, not eight identical ones.
    it('shows a repeated date only once', () => {
      const { container } = renderFull(seriesOverDays([1, 1, 1, 1, 1, 1, 1, 1]))
      const dateLabels = xTicks(container).filter(l => /^\d+ \w{3}$/.test(l))

      expect(dateLabels).toHaveLength(1)
    })

    it('marks each distinct day once when several runs share days', () => {
      // Three runs on one day, two on another, one on a third.
      const { container } = renderFull(seriesOverDays([5, 5, 5, 3, 3, 1]))
      const dateLabels = xTicks(container).filter(l => /^\d+ \w{3}$/.test(l))

      expect(dateLabels).toHaveLength(3)
      expect(new Set(dateLabels).size).toBe(3)
    })
  })

  // The best run is just the highest point on the chart (the axis is reversed for lower-is-better
  // games, so that holds everywhere) — a marker for it only added ink.
  it('draws no personal-best marker', () => {
    const { container } = renderFull(seriesOverDays([3, 2, 1]))
    expect(allText(container)).not.toContain('Best')
    expect(container.querySelectorAll('.recharts-reference-line')).toHaveLength(0)
  })

  // The chart deliberately carries no gridlines or smoothed-average overlay: the "Trend" stat
  // beside it already states the direction in words.
  it('stays sparse — one line for the runs, no rolling-average overlay', () => {
    const { container } = renderFull(seriesOverDays([5, 4, 3, 2, 1]))

    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1)
    expect(container.querySelectorAll('.recharts-cartesian-grid')).toHaveLength(0)
  })

  describe('value axis', () => {
    it('formats ticks with the game\'s own score format', () => {
      const { container } = renderFull(seriesOverDays([3, 2, 1], 10), {
        formatScore: (s) => `${s}/15`,
      })
      expect(yTicks(container).some(l => l.includes('/15'))).toBe(true)
    })

    // The drawn domain is padded past the data so the line doesn't touch the frame. Ticks must NOT
    // follow it there: labelling the padding invented scores that can't exist, and formatScore
    // rendered them as nonsense — a 15-question game showing a "16/15" gridline.
    it('never labels a score beyond what the game allows', () => {
      const series = seriesOverDays([4, 3, 2, 1], 10).map((p, i) => ({ ...p, score: [7, 9, 12, 15][i] }))
      const { container } = render(
        <CbatProgressChart series={series} variant="full" height={240} formatScore={(s) => `${s}/15`} />
      )
      const values = yTicks(container).map(l => Number(l.split('/')[0]))

      expect(Math.max(...values)).toBe(15)   // the real best, not the padded ceiling
      expect(Math.min(...values)).toBe(7)    // the real worst, not the padded floor
    })

    it('still labels a flat run without inventing a range', () => {
      const { container } = renderFull(seriesOverDays([3, 2, 1], 10))
      expect(yTicks(container)).toEqual(['10'])
    })
  })

  describe('lower-is-better games', () => {
    // Trace Practise scores rotations. Reversing the axis keeps "up = better" true everywhere,
    // which is what makes the sparkline readable at a glance without an axis to consult.
    const yOf = (container) =>
      [...container.querySelectorAll('.recharts-line-dot')].map(d => Number(d.getAttribute('cy')))

    it('puts a lower score higher up the chart', () => {
      // Improving player: 40 rotations → 10. Should trend UP.
      const series = seriesOverDays([3, 2, 1]).map((p, i) => ({ ...p, score: [40, 25, 10][i] }))
      const { container } = render(
        <CbatProgressChart series={series} variant="spark" lowerIsBetter={true} />
      )
      const ys = yOf(container)

      // SVG y grows downward, so "better" = smaller cy. Each run should sit above the last.
      expect(ys[0]).toBeGreaterThan(ys[1])
      expect(ys[1]).toBeGreaterThan(ys[2])
    })

    it('puts a higher score higher up for a normal game', () => {
      const series = seriesOverDays([3, 2, 1]).map((p, i) => ({ ...p, score: [10, 25, 40][i] }))
      const { container } = render(
        <CbatProgressChart series={series} variant="spark" lowerIsBetter={false} />
      )
      const ys = yOf(container)

      expect(ys[0]).toBeGreaterThan(ys[1])
      expect(ys[1]).toBeGreaterThan(ys[2])
    })
  })
})
