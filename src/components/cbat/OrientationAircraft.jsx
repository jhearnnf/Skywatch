import { useMemo, useState, lazy, Suspense, Component } from 'react'
import { aircraftPolygons, polygonPoints, HORIZON_Y } from '../../utils/cbat/orientationScene'
import { useCbatTheme } from '../../hooks/useCbatTheme'

// One aircraft picture for Instruments Orientation: the aircraft at the given
// attitude, as seen from behind an aircraft flying north, in a landscape
// frame like the real test's.
//
// Two looks, picked by theme, same fixed camera in both so the answer to a
// question never depends on the theme:
//   • Real CBAT — the real test's picture as closely as we can draw it: a red
//     Hawk on a grey tunnel of nested rectangles, no horizon at all.
//     Everything is read off the aircraft against the frame.
//   • SkyWatch — the Typhoon over a neon-blue horizon and grid.
// Both fly a GLB in a WebGL canvas; the flat shaded silhouette in
// orientationScene.js is the fallback if WebGL or the model fails, and the
// placeholder until a canvas has drawn its first frame.

// The real test's frame is wider than it is tall.
export const FRAME_W = 150
export const FRAME_H = 100

// Lazy so the three.js bundle only loads when a picture is on screen, and
// every page test can mock it away.
const OrientationAircraft3D = lazy(() => import('./OrientationAircraft3D'))

// A canvas that cannot get a WebGL context throws from inside Canvas itself,
// outside anything the 3D component can catch; this is what turns that into
// the flat picture instead of a blank card.
class CanvasErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.failed ? null : this.props.children }
}

// The real test's backdrop: grey rectangles stepping darker towards the
// centre, like looking down a square tunnel. No horizon, no ground.
function TunnelBackdrop() {
  const steps = 9
  return (
    <>
      {Array.from({ length: steps }, (_, i) => {
        const t = i / (steps - 1)
        const grey = Math.round(214 - t * 110)
        const inset = t * 0.42
        return (
          <rect
            key={i}
            x={FRAME_W * inset / 2}
            y={FRAME_H * inset / 2}
            width={FRAME_W * (1 - inset)}
            height={FRAME_H * (1 - inset)}
            fill={`rgb(${grey},${grey},${grey})`}
          />
        )
      })}
    </>
  )
}

// The SkyWatch backdrop: the same horizon, in the site's electric blue. Sky
// is a deep blue falling to the horizon, the ground a darker navy with a
// perspective grid running away to it, and the horizon itself glows.
function NeonBackdrop() {
  const cx = FRAME_W / 2
  const converging = [-200, -150, -100, -65, -35, -12, 12, 35, 65, 100, 150, 200]
  const rows = [HORIZON_Y + 4, HORIZON_Y + 10, HORIZON_Y + 19, HORIZON_Y + 32, HORIZON_Y + 50]
  return (
    <>
      <defs>
        <linearGradient id="orientSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#06101e" />
          <stop offset="1" stopColor="#123a6e" />
        </linearGradient>
        <linearGradient id="orientGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c1f3c" />
          <stop offset="1" stopColor="#06101e" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={FRAME_W} height={HORIZON_Y} fill="url(#orientSky)" />
      <rect x="0" y={HORIZON_Y} width={FRAME_W} height={FRAME_H - HORIZON_Y} fill="url(#orientGround)" />
      <g stroke="#5baaff" strokeWidth="0.35" opacity="0.28">
        {converging.map(x => (
          <line key={x} x1={cx} y1={HORIZON_Y} x2={cx + x} y2={FRAME_H} />
        ))}
        {rows.map(y => (
          <line key={y} x1="0" y1={y} x2={FRAME_W} y2={y} />
        ))}
      </g>
      <line x1="0" y1={HORIZON_Y} x2={FRAME_W} y2={HORIZON_Y} stroke="#5baaff" strokeWidth="1.2" opacity="0.35" />
      <line x1="0" y1={HORIZON_Y} x2={FRAME_W} y2={HORIZON_Y} stroke="#bfe0ff" strokeWidth="0.5" />
    </>
  )
}

// The flat shaded silhouette. `fill` overrides the shading for the
// placeholder; `stroke` is the outline colour.
export function FlatAircraft({ attitude, fill, stroke = '#0b1520' }) {
  const polygons = useMemo(() => aircraftPolygons(attitude, { width: FRAME_W }), [attitude])
  return polygons.map((p, i) => (
    <polygon
      key={i}
      points={polygonPoints(p.points)}
      fill={fill ?? p.fill}
      stroke={stroke}
      strokeWidth="0.6"
      strokeLinejoin="round"
    />
  ))
}

const VARIANTS = {
  cbat: {
    Backdrop: TunnelBackdrop,
    render: 'hawk',
    placeholder: { fill: '#b81c1c', stroke: '#5a0d0d' },
    wrapperClass: '',
    craftClass: '',
  },
  skywatch: {
    Backdrop: NeonBackdrop,
    render: 'typhoon',
    placeholder: { fill: '#1d3d66', stroke: '#5baaff' },
    wrapperClass: 'cbat-orientation-neon',
    craftClass: 'cbat-orientation-neon-craft',
  },
}

function Frame({ attitude, className, render, children }) {
  return (
    <div
      className={`relative w-full aspect-[3/2] overflow-hidden pointer-events-none ${className}`.trim()}
      aria-hidden="true"
      data-testid="orientation-aircraft"
      data-render={render}
      data-heading={attitude.heading}
      data-pitch={attitude.pitch}
      data-bank={attitude.bank}
    >
      {children}
    </div>
  )
}

// The flat picture on the theme's backdrop. Used on its own when WebGL is
// not available.
export function OrientationAircraftFlat({ attitude, className = '', variant = 'cbat' }) {
  const { Backdrop } = VARIANTS[variant]
  return (
    <Frame attitude={attitude} className={className} render="flat">
      <svg viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} className="absolute inset-0 w-full h-full">
        <Backdrop />
        <FlatAircraft attitude={attitude} />
      </svg>
    </Frame>
  )
}

function OrientationAircraft3DCard({ attitude, className = '', variant }) {
  const { Backdrop, render, placeholder, wrapperClass, craftClass } = VARIANTS[variant]
  const [failed, setFailed] = useState(false)
  // Until the canvas has drawn its first frame (context up, shaders built,
  // model in) the card shows the silhouette, so the first question never
  // opens on four empty frames.
  const [drawn, setDrawn] = useState(false)
  if (failed) return <OrientationAircraftFlat attitude={attitude} className={className} variant={variant} />
  return (
    <Frame attitude={attitude} className={`${wrapperClass} ${className}`.trim()} render={render}>
      <svg viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} className="absolute inset-0 w-full h-full">
        <Backdrop />
        {!drawn && <g opacity="0.7"><FlatAircraft attitude={attitude} fill={placeholder.fill} stroke={placeholder.stroke} /></g>}
      </svg>
      <div className={`absolute inset-0 ${craftClass}`.trim()} data-drawn={drawn ? '1' : '0'}>
        <CanvasErrorBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <OrientationAircraft3D
              attitude={attitude}
              variant={variant}
              onError={() => setFailed(true)}
              onFirstFrame={() => setDrawn(true)}
            />
          </Suspense>
        </CanvasErrorBoundary>
      </div>
      {variant === 'skywatch' && <div className="absolute inset-0 cbat-orientation-neon-overlay" />}
    </Frame>
  )
}

export default function OrientationAircraft({ attitude, className = '' }) {
  const cbat = useCbatTheme()
  return <OrientationAircraft3DCard attitude={attitude} className={className} variant={cbat ? 'cbat' : 'skywatch'} />
}
