import { useState, useRef, useEffect, Suspense, Component } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'

// Error boundary for catching useGLTF load failures
class ErrorCatcher extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    this.props.onError?.()
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function AircraftModel({ url, angle, onReady }) {
  const { scene } = useGLTF(url)
  const meshRef = useRef()
  const targetAngleRef = useRef(angle)
  const currentAngleRef = useRef(angle)
  const bankRef = useRef(0)

  // Fire onReady once the GLB is resolved and this component mounts
  useEffect(() => {
    onReady?.()
  }, [onReady])

  // Update target when angle prop changes
  useEffect(() => {
    const prev = targetAngleRef.current
    const delta = angle - prev
    if (delta !== 0) {
      bankRef.current = Math.sign(delta) * 0.3
    }
    targetAngleRef.current = angle
  }, [angle])

  useFrame(() => {
    if (!meshRef.current) return

    const target = targetAngleRef.current
    const current = currentAngleRef.current
    const diff = target - current

    // Snap if close enough, otherwise lerp
    if (Math.abs(diff) < 0.5) {
      currentAngleRef.current = target
    } else {
      currentAngleRef.current += diff * 0.15
    }

    meshRef.current.rotation.y = -currentAngleRef.current * (Math.PI / 180) - Math.PI / 2

    // Decay bank
    bankRef.current *= 0.92
    if (Math.abs(bankRef.current) < 0.001) bankRef.current = 0
    meshRef.current.rotation.z = bankRef.current
  })

  return <primitive ref={meshRef} object={scene.clone()} scale={[2, 2, 2]} />
}

export default function PlaneModel3D({ modelUrl, angle, onError, onReady }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    onError?.()
    return null
  }

  return (
    <Canvas
      camera={{ position: [0, 20, 0], fov: 30, near: 0.1, far: 50 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <ambientLight intensity={1.5} />
      <directionalLight position={[0, 10, 0]} intensity={2} color="#ffffff" />
      <pointLight position={[2, 8, 2]} intensity={1.5} color="#5baaff" />
      <pointLight position={[-2, 6, -1]} intensity={1} color="#ffffff" />
      <Suspense fallback={null}>
        <ErrorCatcher onError={() => setFailed(true)}>
          <AircraftModel key={modelUrl} url={modelUrl} angle={angle} onReady={onReady} />
        </ErrorCatcher>
      </Suspense>
    </Canvas>
  )
}
