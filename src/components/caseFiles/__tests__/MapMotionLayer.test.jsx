import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import MapMotionLayer from '../MapMotionLayer'

// ── Leaflet mock ──────────────────────────────────────────────────────────────
// Only useMap is needed: the layer projects lat/lng itself and touches no other
// Leaflet API. The projection below is a plain linear one, which is enough for
// the geometry assertions and keeps the expected pixel values readable.

const map = {
  getSize: () => ({ x: 600, y: 400 }),
  latLngToContainerPoint: ([lat, lng]) => ({ x: lng * 10, y: (60 - lat) * 10 }),
}

vi.mock('react-leaflet', () => ({
  useMap: () => map,
}))

const HOTSPOTS = [
  { id: 'hs_crimea',  label: 'Crimea',  lat: 45, lng: 34 },
  { id: 'hs_kherson', label: 'Kherson', lat: 46, lng: 32 },
  { id: 'hs_kyiv',    label: 'Kyiv',    lat: 50, lng: 30 },
]

const MOVEMENTS = [
  { id: 'u1', side: 'ru', kind: 'missile',  fromHotspotId: 'hs_crimea', toHotspotId: 'hs_kherson', animationMs: 1500 },
  { id: 'u2', side: 'ru', kind: 'airborne', fromHotspotId: 'hs_crimea', toHotspotId: 'hs_kyiv',    animationMs: 2200 },
]

describe('MapMotionLayer', () => {
  it('renders one animated group per movement', () => {
    render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} />)
    expect(screen.getByTestId('map-motion-layer')).toBeDefined()
    expect(screen.getByTestId('map-motion-u1')).toBeDefined()
    expect(screen.getByTestId('map-motion-u2')).toBeDefined()
  })

  it('renders nothing when there is nothing moving', () => {
    render(<MapMotionLayer movements={[]} hotspots={HOTSPOTS} />)
    expect(screen.queryByTestId('map-motion-layer')).toBeNull()
  })

  it('skips a movement whose hotspots are not on the map', () => {
    render(
      <MapMotionLayer
        movements={[{ id: 'ghost', side: 'ru', kind: 'missile', fromHotspotId: 'nope', toHotspotId: 'hs_kyiv' }]}
        hotspots={HOTSPOTS}
      />
    )
    expect(screen.queryByTestId('map-motion-layer')).toBeNull()
  })

  it('draws each route between its two hotspots once the loop has run a frame', async () => {
    const { container } = render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} />)
    await waitFor(() => {
      const track = container.querySelector('[data-testid="map-motion-u1"] path')
      expect(track.getAttribute('d')).toBeTruthy()
    })
    const d = container.querySelector('[data-testid="map-motion-u1"] path').getAttribute('d')
    // Crimea (45, 34) → x 340, y 150. Kherson (46, 32) → x 320, y 140.
    expect(d.startsWith('M 340 150')).toBe(true)
    expect(d.endsWith('320 140')).toBe(true)
  })

  it('sizes the overlay to the Leaflet container', async () => {
    render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} />)
    await waitFor(() => {
      expect(screen.getByTestId('map-motion-layer').getAttribute('width')).toBe('600')
    })
    expect(screen.getByTestId('map-motion-layer').getAttribute('height')).toBe('400')
  })

  it('labels each route in plain English when labels are on', () => {
    render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} showLabels />)
    // Drawn twice per route: a dark halo copy under the coloured one.
    expect(screen.getAllByText('Missile strike')).toHaveLength(2)
    expect(screen.getAllByText('Airborne assault')).toHaveLength(2)
  })

  it('omits the labels when they are turned off', () => {
    render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} showLabels={false} />)
    expect(screen.queryByText('Missile strike')).toBeNull()
  })

  it('stops its animation frame when unmounted', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} />)
    unmount()
    expect(cancel).toHaveBeenCalled()
    cancel.mockRestore()
  })

  it('survives a projection that throws mid-flight', async () => {
    const throwing = vi.spyOn(map, 'latLngToContainerPoint').mockImplementation(() => {
      throw new Error('map not ready')
    })
    render(<MapMotionLayer movements={MOVEMENTS} hotspots={HOTSPOTS} />)
    await waitFor(() => {
      expect(screen.getByTestId('map-motion-layer')).toBeDefined()
    })
    throwing.mockRestore()
  })
})
