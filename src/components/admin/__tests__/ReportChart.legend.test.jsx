import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('ReportChart toggleable line legend', () => {
  const lineData = [
    { date: '2026-09-01', count: 20, signups: 3, cbatDates: 1 },
    { date: '2026-09-02', count: 25, signups: 0, cbatDates: 0 },
  ]
  const renderLine = () => render(
    <ReportChart
      type="line"
      data={lineData}
      keys={['count', 'signups', 'cbatDates']}
      labels={{ count: 'Active users', signups: 'Sign-ups', cbatDates: 'CBAT dates' }}
      markerKeys={['cbatDates']}
      toggleable
      showLegend
    />,
  )

  it('renders one pressed toggle button per series', () => {
    renderLine()
    for (const name of ['Active users', 'Sign-ups', 'CBAT dates']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('switches a series off and back on when its legend entry is clicked', () => {
    renderLine()
    const btn = screen.getByRole('button', { name: 'Sign-ups' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.style.opacity).toBe('0.3')
    // Other series are untouched.
    expect(screen.getByRole('button', { name: 'Active users' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('adds a Weekends switch when weekend shading is on', () => {
    render(
      <ReportChart
        type="line"
        data={lineData}
        keys={['count']}
        labels={{ count: 'Active users' }}
        toggleable
        shadeWeekends
        showLegend
      />,
    )
    const btn = screen.getByRole('button', { name: 'Weekends' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('has no Weekends switch without weekend shading', () => {
    renderLine()
    expect(screen.queryByRole('button', { name: 'Weekends' })).toBeNull()
  })
})
