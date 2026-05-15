import { Suspense, Component, useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

// FlybyOverlay — short 3D flyby of two RAF airframes across the brief-reel
// stage. Mounts when world.flyby is non-null (set by a 'flyby' action) and
// stays mounted for FLY_DURATION_MS before the parent clears it (or sooner
// if the next beat begins). Uses real GLB models the app already ships
// for the CBAT games, so no new assets are needed.
//
// The Canvas sits absolutely-positioned over the SVG stage, like the actor
// 3D overlay, and uses a perspective camera to give the planes natural
// foreshortening as they bank past. pointer-events: none so click-to-
// pause on the SVG still receives taps.
//
// Each plane gets a slightly different lane (Y offset, Z offset, scale,
// bank angle) so they read as separate aircraft rather than a mirrored
// pair. Direction-of-travel is encoded in start/end X — the GLB rotates
// to face that direction.

export const FLY_DURATION_MS = 3000;

class ErrorCatcher extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err) {
    console.warn('[BriefReel flyby] aircraft GLB failed to load:', err?.message);
    this.props.onError?.();
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

function FlybyPlane({ url, startX, endX, y, z, scale, bank, durationMs = FLY_DURATION_MS }) {
  const { scene } = useGLTF(url);
  // Clone the scene once per instance so two flybys of the same airframe
  // don't share a single Object3D and overwrite each other's position.
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef();
  const t0Ref = useRef(null);

  useFrame(() => {
    if (!groupRef.current) return;
    if (t0Ref.current === null) t0Ref.current = performance.now();
    const t = Math.min((performance.now() - t0Ref.current) / durationMs, 1);
    // Ease the cross slightly so the plane doesn't enter/exit at full speed —
    // gives a subtle slow-in, slow-out feel even though physically planes
    // would maintain speed; reads better at this scale.
    const eased = t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;
    groupRef.current.position.x = startX + (endX - startX) * eased;
  });

  // Face the direction of travel. GLB models in /public/models/ are oriented
  // along +X by default (the CBAT 3D scenes assume this); flip yaw by 180°
  // when flying left so the nose still leads.
  const yaw = endX < startX ? Math.PI : 0;

  return (
    <group ref={groupRef} position={[startX, y, z]} rotation={[0, yaw, bank]}>
      <primitive object={cloned} scale={[scale, scale, scale]} />
    </group>
  );
}

export default function FlybyOverlay({ aircraft, onError }) {
  // Defer mount slightly so the parent's setWorld commit doesn't race the
  // useGLTF cache check on first render — useGLTF reads from a module-level
  // cache and is safe to call during render, but the first-time fetch
  // suspends; mounting after one paint gives the player a chance to settle.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!aircraft || aircraft.length < 2 || !mounted) return null;
  const [urlA, urlB] = aircraft;

  return (
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      data-brief-reel-flyby
    >
      <Canvas
        camera={{ position: [0, 4, 55], fov: 38, near: 0.1, far: 300 }}
        gl={{ alpha: true, antialias: true }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[12, 18, 14]} intensity={2.5} color="#ffffff" />
        <pointLight position={[-8, 6, 10]}  intensity={1.2} color="#5baaff" />
        <pointLight position={[ 8, -4, 8]}  intensity={0.7} color="#f5c542" />
        <Suspense fallback={null}>
          <ErrorCatcher onError={onError}>
            {/* Upper lane: left-to-right, slightly closer to camera */}
            <FlybyPlane
              url={urlA}
              startX={-55} endX={55}
              y={6}  z={-2}
              scale={0.55}
              bank={0.22}
            />
            {/* Lower lane: right-to-left, slightly further so the two read as
                distinct depth planes rather than a mirrored pair */}
            <FlybyPlane
              url={urlB}
              startX={55} endX={-55}
              y={-2} z={-12}
              scale={0.50}
              bank={-0.18}
            />
          </ErrorCatcher>
        </Suspense>
      </Canvas>
    </div>
  );
}

// Pre-load every aircraft GLB at module level so the first flyby doesn't
// stall on a cold fetch. The drei useGLTF cache is shared across renders,
// so calling preload here once is sufficient.
const FLYBY_AIRCRAFT_PATHS = [
  '/models/eurofighter typhoon fgr4.glb',
  '/models/f-35b lightning ii.glb',
  '/models/hawk t2.glb',
  '/models/a400m atlas c1.glb',
  '/models/c-17a globemaster iii.glb',
  '/models/chinook hc6 6a.glb',
  '/models/e-7a wedgetail.glb',
  '/models/p-8a poseidon mra1.glb',
];
FLYBY_AIRCRAFT_PATHS.forEach(p => useGLTF.preload(p));
