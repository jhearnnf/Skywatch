import { useEffect } from 'react'
import { input } from './inputStore'
import { pause } from '../state/pauseStore'

// Pointer-lock mouse-look. Click anywhere on the canvas container to lock the
// pointer; mousemove deltas accumulate into input.lookDeltaX (yaw) and
// input.lookDeltaY (pitch), both consumed each frame by CharacterController.
// Escape releases the lock; we restore the cursor and stop reading deltas.
//
// canvasContainerRef — ref to the parent DIV that wraps the <Canvas>. Clicks
// on this element trigger requestPointerLock.

export function usePointerLookInput(canvasContainerRef) {
  useEffect(() => {
    const el = canvasContainerRef?.current
    if (!el) return

    const onClick = () => {
      // Don't grab the pointer back out from under the pause menu — its own
      // buttons and slider sit inside this container.
      if (pause.get()) return
      if (document.pointerLockElement !== el) {
        el.requestPointerLock?.()
      }
    }
    const onLockChange = () => {
      input.pointerLocked = document.pointerLockElement === el
    }
    const onMove = (e) => {
      if (!input.pointerLocked) return
      input.lookDeltaX += e.movementX
      input.lookDeltaY += e.movementY
    }

    el.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMove)
    return () => {
      el.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMove)
      if (document.pointerLockElement === el) document.exitPointerLock?.()
    }
  }, [canvasContainerRef])
}
