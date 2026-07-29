import { render } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import Visualisation3DShape, {
  VisualisationShapeCanvas, DOT_RADIUS, DOT_GHOST_RADIUS, DOT_GHOST_OPACITY,
} from '../Visualisation3DShape'
import { COMPOSITES } from '../../../utils/cbat/visualisation3DPuzzle'

// These tests pin the single-WebGL-context architecture. Mounting one <Canvas>
// per shape (the old design) exceeded mobile browsers' concurrent-context cap
// and rendered surplus shapes as the "context lost" sad-face placeholder. The
// fix routes every shape through drei's <View> into ONE shared <Canvas>, so:
//   • a shape must NOT render its own Canvas, and
//   • the page must render exactly one Canvas (the shared host).

// Stub the WebGL layer: jsdom has no GL context. We record how many <Canvas>
// and <View> elements each render produces.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }) => <div data-testid="webgl-canvas">{children}</div>,
}))
vi.mock('@react-three/drei', () => ({
  View: Object.assign(
    ({ children, style }) => (
      <div data-testid="view" style={style}>{children}</div>
    ),
    { Port: () => <div data-testid="view-port" /> },
  ),
}))

const someComposite = Object.keys(COMPOSITES)[0]

describe('Visualisation3DShape — single shared WebGL context', () => {
  it('renders a tracking View, not its own Canvas', () => {
    const { queryByTestId, getByTestId } = render(
      <Visualisation3DShape composite={someComposite} size={72} />,
    )
    expect(getByTestId('view')).toBeTruthy()
    // The whole point of the fix: an individual shape owns no WebGL context.
    expect(queryByTestId('webgl-canvas')).toBeNull()
  })

  it('sizes the tracking div from the size prop', () => {
    const { getByTestId } = render(
      <Visualisation3DShape composite={someComposite} size={120} />,
    )
    const view = getByTestId('view')
    expect(view.style.width).toBe('120px')
    expect(view.style.height).toBe('120px')
  })

  it('returns null for an unknown composite (no View, no context)', () => {
    const { queryByTestId } = render(
      <Visualisation3DShape composite="__nope__" />,
    )
    expect(queryByTestId('view')).toBeNull()
  })

  it('many shapes still produce zero canvases on their own', () => {
    const { queryAllByTestId } = render(
      <>
        {Array.from({ length: 12 }, (_, i) => (
          <Visualisation3DShape key={i} composite={someComposite} size={72} />
        ))}
      </>,
    )
    expect(queryAllByTestId('view')).toHaveLength(12)
    expect(queryAllByTestId('webgl-canvas')).toHaveLength(0)
  })
})

describe('VisualisationShapeCanvas — the one host context', () => {
  it('renders exactly one Canvas hosting the View.Port', () => {
    const { queryAllByTestId, getByTestId } = render(<VisualisationShapeCanvas />)
    expect(queryAllByTestId('webgl-canvas')).toHaveLength(1)
    expect(getByTestId('view-port')).toBeTruthy()
  })
})

// The corner dot is drawn twice — a depth-tested solid over a depth-ignoring
// ghost — so a marked corner is readable whether it faces the camera or not.
// That only works while the solid is the larger of the two: a ghost poking out
// around the solid would ring every FRONT corner in translucent red.
describe('Visualisation3DShape — corner dot', () => {
  it('keeps the ghost inside the solid dot', () => {
    expect(DOT_GHOST_RADIUS).toBeLessThan(DOT_RADIUS)
  })

  it('stays small enough to sit on a corner rather than cover it', () => {
    // Shapes are unit-ish primitives, so a dot much past ~0.1 stops reading as
    // a point on the corner.
    expect(DOT_RADIUS).toBeLessThanOrEqual(0.08)
  })

  it('keeps the back-corner ghost visible', () => {
    expect(DOT_GHOST_OPACITY).toBeGreaterThan(0.35)
  })
})
