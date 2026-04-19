import { Suspense, Component, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'

class ErrorCatcher extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.hasError ? null : this.props.children }
}

function Model({ url }) {
  const { scene } = useGLTF(url)
  const ref = useRef()
  // Slow idle rotation so the silhouette reads as "alive" on radar.
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.4
  })
  return <primitive ref={ref} object={scene.clone()} scale={[2, 2, 2]} />
}

// Radar-fuzz overlay: conic sweep + faint grid + blur on the Canvas beneath.
function RadarOverlay() {
  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, transparent 40%, rgba(6,16,30,0.55) 100%), ' +
            'repeating-linear-gradient(0deg, rgba(91,170,255,0.08) 0 1px, transparent 1px 6px), ' +
            'repeating-linear-gradient(90deg, rgba(91,170,255,0.08) 0 1px, transparent 1px 6px)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        className="radar-sweep"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'conic-gradient(from 0deg, rgba(91,170,255,0.35) 0deg, rgba(91,170,255,0) 40deg, rgba(91,170,255,0) 360deg)',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
          animation: 'radar-sweep 2.6s linear infinite',
          borderRadius: '50%',
        }}
      />
    </>
  )
}

export default function AircraftTopDown({ modelUrl, onError, partial = false, offsetX = 0, offsetZ = 0, clear = false }) {
  if (!modelUrl) return null
  // Partial view: camera sits much closer and is offset horizontally, so only a
  // fragment of the aircraft lands in frame — forces the user to identify the
  // plane from a slice rather than the whole silhouette.
  const camPos = partial ? [offsetX, 8, offsetZ] : [0, 13, 0]
  const camFov = partial ? 34 : 30
  const innerFilter = clear ? 'none' : 'blur(1.6px) contrast(1.1)'
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 8, background: '#020a18' }}>
      <div style={{ position: 'absolute', inset: 0, filter: innerFilter }}>
        <Canvas
          camera={{ position: camPos, fov: camFov, near: 0.1, far: 50 }}
          gl={{ alpha: true, antialias: true }}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          onCreated={({ camera }) => camera.lookAt(offsetX, 0, offsetZ)}
        >
          <ambientLight intensity={1.4} />
          <directionalLight position={[0, 10, 0]} intensity={1.8} color="#5baaff" />
          <pointLight position={[2, 8, 2]} intensity={1.2} color="#ffffff" />
          <Suspense fallback={null}>
            <ErrorCatcher onError={onError}>
              <Model url={modelUrl} />
            </ErrorCatcher>
          </Suspense>
        </Canvas>
      </div>
      {!clear && <RadarOverlay />}
    </div>
  )
}
