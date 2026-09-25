import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import MapCanvas from '../MapCanvas'
import geo from '../../../data/caseFiles/theatreGeo.json'
import { countryContains, fitProjection } from '../../../utils/caseFiles/mapProjection'

// jsdom has no canvas, so the LED layer quietly draws nothing; everything the
// player reads or clicks is SVG and is exercised here.

const BOUNDS = { south: 44, west: 22, north: 53, east: 40 }

const HOTSPOTS = [
  { id: 'bel', label: 'Belgorod', lat: 50.6, lng: 36.6, kind: 'staging',   tooltip: 'Russian staging area north of Kharkiv.' },
  { id: 'kyv', label: 'Kyiv',     lat: 50.4, lng: 30.5, kind: 'capital'   },
  { id: 'kha', label: 'Kharkiv',  lat: 49.9, lng: 36.2, kind: 'logistics' },
]

const AXES = [
  { id: 'ax1', fromHotspotId: 'bel', toHotspotId: 'kyv' },
]

describe('MapCanvas — the tactical map', () => {
  it('renders the map container at the requested height', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} height="400px" />)
    expect(screen.getByTestId('map-container').style.height).toBe('400px')
  })

  it('labels every hotspot on the map itself', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} />)
    expect(screen.getByText('Belgorod')).toBeDefined()
    expect(screen.getByText('Kyiv')).toBeDefined()
    expect(screen.getByText('Kharkiv')).toBeDefined()
  })

  it('renders with no hotspots and no bounds', () => {
    render(<MapCanvas />)
    expect(screen.getByTestId('map-container')).toBeDefined()
  })

  it('draws the country borders from the baked geography', () => {
    const { container } = render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} />)
    expect(container.querySelectorAll('path').length).toBeGreaterThan(20)
  })

  it('calls onHotspotClick with the id, by click and by keyboard', () => {
    const onHotspotClick = vi.fn()
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} onHotspotClick={onHotspotClick} />)
    fireEvent.click(screen.getByTestId('map-hotspot-kyv'))
    expect(onHotspotClick).toHaveBeenCalledWith('kyv')
    fireEvent.keyDown(screen.getByTestId('map-hotspot-bel'), { key: 'Enter' })
    expect(onHotspotClick).toHaveBeenCalledWith('bel')
  })

  it('makes hotspots buttons only when they can be clicked', () => {
    const { rerender } = render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} />)
    expect(screen.getByTestId('map-hotspot-kyv').getAttribute('role')).toBeNull()
    rerender(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} onHotspotClick={() => {}} focusedHotspotId="kyv" />)
    expect(screen.getByTestId('map-hotspot-kyv').getAttribute('role')).toBe('button')
    expect(screen.getByTestId('map-hotspot-kyv').getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a hotspot tooltip while the pointer is over it', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('map-hotspot-bel'))
    expect(screen.getByRole('tooltip').textContent).toMatch(/staging area north of Kharkiv/)
    fireEvent.mouseLeave(screen.getByTestId('map-hotspot-bel'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('keys the hotspot kinds that are on the map, and only those', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} />)
    const legend = screen.getByTestId('map-legend').textContent
    expect(legend).toMatch(/Staging area/)
    expect(legend).toMatch(/Capital/)
    expect(legend).toMatch(/Logistics hub/)
    expect(legend).not.toMatch(/Naval base/)
  })

  it('gives an animated axis the flow class and a dash pattern to march', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} axes={[{ ...AXES[0], animated: true }]} />)
    const line = screen.getByTestId('map-axis-line')
    expect(line.getAttribute('class')).toBe('cf-axis-flow')
    expect(line.getAttribute('stroke-dasharray')).toBe('10 12')
  })

  it('leaves a plain axis unanimated', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} axes={AXES} />)
    expect(screen.getByTestId('map-axis-line').getAttribute('class')).toBeNull()
  })

  it('skips an axis whose hotspot is missing', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} axes={[{ id: 'x', fromHotspotId: 'bel', toHotspotId: 'nope' }]} />)
    expect(screen.queryByTestId('map-axis-line')).toBeNull()
  })

  it('rings each unit at the hotspot it has reached', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} units={[{ side: 'ru', kind: 'armour', fromHotspotId: 'kha' }]} />)
    expect(screen.getAllByTestId('map-unit')).toHaveLength(1)
  })

  it('plays the movements it is given over the top of the map', () => {
    render(
      <MapCanvas
        bounds={BOUNDS}
        hotspots={HOTSPOTS}
        movements={[{ id: 'm1', side: 'ru', kind: 'missile', fromHotspotId: 'bel', toHotspotId: 'kyv' }]}
      />
    )
    expect(screen.getByTestId('map-motion-layer')).toBeDefined()
    expect(screen.getByTestId('map-motion-m1')).toBeDefined()
  })

  it('adds no motion layer when there are no movements', () => {
    render(<MapCanvas bounds={BOUNDS} hotspots={HOTSPOTS} />)
    expect(screen.queryByTestId('map-motion-layer')).toBeNull()
  })

  it('can suppress the movement labels', () => {
    render(
      <MapCanvas
        bounds={BOUNDS}
        hotspots={HOTSPOTS}
        movements={[{ id: 'm1', side: 'ru', kind: 'missile', fromHotspotId: 'bel', toHotspotId: 'kyv' }]}
        showMovementLabels={false}
      />
    )
    expect(screen.queryByText('Missile strike')).toBeNull()
  })
})

describe('theatre geography', () => {
  const byName = (name) => geo.countries.find((c) => c.name === name)

  // The internationally recognised border, and the UK's position. Natural
  // Earth's default data draws Crimea inside Russia; the build script moves it.
  it('draws Crimea as part of Ukraine', () => {
    expect(countryContains(byName('Ukraine'), 34.1, 44.95)).toBe(true)
    expect(countryContains(byName('Russia'), 34.1, 44.95)).toBe(false)
  })

  it('covers the places the cases are set in', () => {
    expect(countryContains(byName('Ukraine'), 30.5, 50.45)).toBe(true)   // Kyiv
    expect(countryContains(byName('Israel'), 34.8, 32.1)).toBe(true)     // Tel Aviv
    expect(countryContains(byName('Iran'), 51.4, 35.7)).toBe(true)       // Tehran
  })
})

describe('fitProjection', () => {
  it('puts the centre of the bounds at the centre of the box, north up', () => {
    const { project } = fitProjection(BOUNDS, 800, 600)
    const north = project(53, 31)
    const south = project(44, 31)
    expect(north.y).toBeLessThan(south.y)
    const west = project(48, 22)
    const east = project(48, 40)
    expect(east.x).toBeGreaterThan(west.x)
    expect((west.x + east.x) / 2).toBeCloseTo(400, 0)
  })

  it('round-trips a point through invert', () => {
    const { project, invert } = fitProjection(BOUNDS, 800, 600)
    const p = project(50.45, 30.52)
    const back = invert(p.x, p.y)
    expect(back.lat).toBeCloseTo(50.45, 5)
    expect(back.lng).toBeCloseTo(30.52, 5)
  })
})
