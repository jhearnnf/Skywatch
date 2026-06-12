import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import BaseScene from './scene/BaseScene'
import HudOverlay from './hud/HudOverlay'
import MobileControls from './ui/MobileControls'
import ModalLayer from './ui/ModalLayer'
import { useBodyLock } from './state/useBodyLock'
import { useKeyboardInput } from './character/useKeyboardInput'
import { usePointerLookInput } from './character/usePointerLookInput'
import { input } from './character/inputStore'

// Top-level shell for the 3D World. Wraps a full-viewport Canvas with the
// scene graph, the DOM HUD overlay, and (on touch devices) the on-screen
// joystick + action button. Pause the frameloop while the tab is hidden so
// Capacitor / browser tabs don't burn battery in the background.

export default function World3D() {
  const containerRef = useRef(null)
  const [hidden, setHidden] = useState(false)
  useBodyLock('world3d-locked')
  useKeyboardInput()
  usePointerLookInput(containerRef)

  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Ensure stale input doesn't keep the agent walking after unmount.
  useEffect(() => () => {
    input.move.x = 0
    input.move.z = 0
    input.lookDeltaX = 0
    input.lookDeltaY = 0
    input.pointerLocked = false
    if (document.pointerLockElement) document.exitPointerLock?.()
  }, [])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-20 bg-bg overflow-hidden"
      style={{ cursor: 'grab' }}
    >
      <Canvas
        dpr={1}
        frameloop={hidden ? 'demand' : 'always'}
        camera={{ position: [0, 7, 12], fov: 50, near: 0.1, far: 200 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#06101e' }}
      >
        <BaseScene />
      </Canvas>
      <HudOverlay />
      <MobileControls />
      <ModalLayer />
    </div>
  )
}
