import { Suspense, Component, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import Stickman3D from './Stickman3D';

// Brief-reel stage uses a 1920×1080 SVG viewBox. The 3D overlay is a separate
// React tree (R3F Canvas) positioned absolutely over the SVG with identical
// dimensions, so its `aspect` matches and we can map SVG (x,y) → world (x,y)
// using a one-to-one orthographic projection. World units = SVG user units,
// centred on the viewBox centre; the ortho camera spans VB_W × VB_H.

const VB_W = 1920;
const VB_H = 1080;
const GROUND_Y = 920;
const STICKMAN_WORLD_H = 320;  // target visual height of the model in world units

const POSITION_X = { left: 460, centre: 960, right: 1460 };
const POSITION_X_OFFSTAGE_LEFT  = -300;
const POSITION_X_OFFSTAGE_RIGHT = VB_W + 300;

function positionToX(p) {
  if (p === 'offstage') return POSITION_X_OFFSTAGE_LEFT;
  return POSITION_X[p] ?? POSITION_X.centre;
}

// Convert SVG (x,y) (origin top-left, Y-down, viewBox space) to world (x,y,z)
// (origin centre, Y-up). The model's pivot is at its feet, so we anchor the
// world Y at GROUND_Y from the SVG side.
function actorWorld(actor) {
  const svgX = positionToX(actor.position);
  // Centre around stage midpoint, Y-up
  const worldX = svgX - VB_W / 2;
  const worldY = (VB_H / 2) - GROUND_Y;
  return [worldX, worldY, 0];
}

class ErrorCatcher extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err) {
    console.warn('[BriefReel3D] failed to load 3D stage, falling back to SVG:', err?.message);
    this.props.onError?.();
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

export default function Stage3DOverlay({ actors, modelUrl, onError }) {
  const onstage = useMemo(
    () => actors.filter(a => a.position && a.position !== 'offstage'),
    [actors],
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        // Let pointer events fall through to the SVG (which owns
        // click-to-pause). Without this the canvas swallows taps.
        pointerEvents: 'none',
      }}
      data-brief-reel-3d-overlay
    >
      <Canvas
        orthographic
        // left/right/top/bottom let the ortho camera span the full stage
        // in world units, so a world position (x, y) maps to the same
        // SVG pixel coordinate after centring.
        camera={{
          position: [0, 0, 500],
          near: 1,
          far: 2000,
          left:   -VB_W / 2,
          right:   VB_W / 2,
          top:     VB_H / 2,
          bottom: -VB_H / 2,
          zoom: 1,
        }}
        gl={{ alpha: true, antialias: true }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        <ambientLight intensity={1.3} />
        <directionalLight position={[200, 400, 300]} intensity={2} color="#ffffff" />
        <pointLight position={[0, 200, 200]} intensity={1.2} color="#5baaff" />
        <Suspense fallback={null}>
          <ErrorCatcher onError={onError}>
            {onstage.map(actor => (
              <group
                key={actor.id}
                // Scale the model so its visual height ≈ STICKMAN_WORLD_H
                // user units. Mixamo defaults are roughly 1.7m, so we
                // scale by STICKMAN_WORLD_H / 1.7 to land in the right size.
                scale={[STICKMAN_WORLD_H / 1.7, STICKMAN_WORLD_H / 1.7, STICKMAN_WORLD_H / 1.7]}
                position={actorWorld(actor)}
              >
                <Stickman3D
                  url={modelUrl}
                  position={[0, 0, 0]}
                  mode={actor.mode}
                  faction={actor.faction}
                  isSpeaking={!!actor.speech}
                  pointing={!!actor.pointingAt}
                  pulseCount={actor.pulseCount || 0}
                />
              </group>
            ))}
          </ErrorCatcher>
        </Suspense>
      </Canvas>
    </div>
  );
}
