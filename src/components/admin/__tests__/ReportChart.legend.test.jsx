import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReportChart from '../ReportChart'

// The bar-chart legend is drawn outside the Recharts container so a long
// series list (Daily CBAT Sessions has ~30) cannot eat the plot height on a
// phone. jsdom gives ResponsiveContainer no size, so the SVG is not asserted
// on — only the legend, which is plain DOM.
const data = [
  { date: '2026-09-01', ant: 3, dpt: 1, 'ant-tutorial': 2 },
  { date: '2026-09-02', ant: 0, dpt: 4, 'ant-tutorial': 0 },
]

describe('ReportChart bar legend', () => {
  it('renders one legend entry per series as a list beneath the chart', () => {
    const { container } = render(
      <ReportChart
        type="stackedBar"
        data={data}
        keys={['ant', 'dpt', 'ant-tutorial']}
        labels={{ ant: 'ANT', dpt: 'DPT', 'ant-tutorial': 'ANT tutorial' }}
        dimLabels={['ANT tutorial']}
        showLegend
      />,
    )
    const items = container.querySelectorAll('ul li')
    expect(items).toHaveLength(3)
    expect(screen.getByText('ANT')).toBeTruthy()
    expect(screen.getByText('DPT')).toBeTruthy()
    // Practice series are greyed, live ones are not.
    const dim = screen.getByText('ANT tutorial').closest('li')
    expect(dim.style.opacity).toBe('0.3')
    expect(screen.getByText('ANT').closest('li').style.opacity).toBe('1')
    // The legend is a sibling of the chart wrapper, not inside it.
    expect(container.querySelector('.recharts-responsive-container ul')).toBeNull()
  })

  it('adds the previous-period line to the same legend when comparing', () => {
    render(
      <ReportChart
        type="stackedBar"
        data={data.map(d => ({ ...d, _prevTotal: 2 }))}
        keys={['ant', 'dpt']}
        showLegend
        compareKey="_prevTotal"
        compareLabel="Prev period total"
      />,
    )
    expect(screen.getByText('Prev period total')).toBeTruthy()
  })

  it('renders no legend list when showLegend is off', () => {
    const { container } = render(
      <ReportChart type="bar" data={data} keys={['ant']} />,
    )
    expect(container.querySelector('ul')).toBeNull()
  })
})
