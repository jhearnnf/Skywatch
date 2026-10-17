import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReportChart, { ChartSkeleton } from '../ReportChart'
import { blankBeforeFirstValue } from '../blankBeforeFirstValue'

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

  it('keeps one legend across both panels when some series sit in the lower panel', () => {
    render(
      <ReportChart
        type="line"
        data={lineData}
        keys={['count', 'signups', 'cbatDates']}
        labels={{ count: 'Active users', signups: 'Sign-ups', cbatDates: 'CBAT dates' }}
        markerKeys={['cbatDates']}
        lowerKeys={['signups']}
        toggleable
        shadeWeekends
        showLegend
      />,
    )
    for (const name of ['Active users', 'Sign-ups', 'CBAT dates', 'Weekends']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(1)
    }
    // A lower-panel series is a bar, so its key is a square swatch, not a line.
    const swatch = screen.getByRole('button', { name: 'Sign-ups' }).querySelector('span[aria-hidden]')
    expect(swatch.className).toContain('h-2.5')
    const btn = screen.getByRole('button', { name: 'Sign-ups' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('has no Weekends switch without weekend shading', () => {
    renderLine()
    expect(screen.queryByRole('button', { name: 'Weekends' })).toBeNull()
  })
})

describe('ChartSkeleton', () => {
  it('mirrors a two-panel chart with its legend row', () => {
    const { container } = render(
      <ChartSkeleton height={200} lowerHeight={100} legend={['Active users', 'Sign-ups', 'Weekends']} />,
    )
    const blocks = [...container.querySelectorAll('.animate-pulse.flex.items-end')]
    // Top panel at full height; the lower one gives up the 4px gap above it.
    expect(blocks.map(b => b.style.height)).toEqual(['200px', '96px'])
    expect(screen.getByText('Sign-ups')).toBeTruthy()
    expect(screen.getByText('Weekends')).toBeTruthy()
  })

  it('is a single block when given only a height', () => {
    const { container } = render(<ChartSkeleton height={200} />)
    expect(container.querySelectorAll('.animate-pulse.flex.items-end')).toHaveLength(1)
  })
})

describe('blankBeforeFirstValue', () => {
  const rows = [
    { date: '2026-03-01', count: 0, messages: 0, signups: 2 },
    { date: '2026-03-02', count: 3, messages: 0, signups: 0 },
    { date: '2026-03-03', count: 0, messages: 4, signups: 1 },
  ]

  it('blanks each line before its own first value, and keeps zeros after it', () => {
    const out = blankBeforeFirstValue(rows, ['count', 'messages'])
    expect(out.map(r => r.count)).toEqual([null, 3, 0])
    expect(out.map(r => r.messages)).toEqual([null, null, 4])
    // Keys it wasn't asked about are untouched.
    expect(out.map(r => r.signups)).toEqual([2, 0, 1])
  })

  it('leaves a series that is never above zero as it is', () => {
    const out = blankBeforeFirstValue(rows, ['missing'])
    expect(out).toEqual(rows)
  })
})
