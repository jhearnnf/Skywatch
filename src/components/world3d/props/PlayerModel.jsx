import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import { playerState } from '../state/playerState'

const MODEL_URL = '/models/character.glb'

// Normalise the character to this height (world units) regardless of the scale
// it was authored at, with feet planted at y=0. The hangar reads large (~12u
// tall ceiling), so the player needs to be a few units to feel in-scale.
const TARGET_HEIGHT = 2.6

// Our movement yaw (atan2(dx, dz)) already points the model in its travel
// direction, so no extra spin is needed. (Set to Math.PI if it ever moonwalks.)
const MODEL_YAW = 0

const FADE = 0.18

// Animated Mixamo player. The forwarded ref is the outer group whose position +
// yaw are driven each frame by CharacterController; an inner group carries the
// auto-fit scale, feet offset, and facing correction. The active clip is chosen
// from playerState.anim and cross-faded so transitions don't snap.
const PlayerModel = forwardRef(function PlayerModel({ position = [0, 0, 0] }, ref) {
  const inner = useRef(null)
  // Use the loaded scene directly — a single player instance, so no clone is
  // needed. (scene.clone(true) breaks skinned-mesh skeleton binding, which
  // leaves the mesh stuck in T-pose at the origin.)
  const { scene, animations } = useGLTF(MODEL_URL)
  const { actions } = useAnimations(animations, inner)
  const currentClip = useRef(null)

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1
    return {
      scale,
      // centre horizontally, drop feet (box min Y) to 0
      offset: [-center.x * scale, -box.min.y * scale, -center.z * scale],
    }
    // TARGET_HEIGHT in deps so HMR re-fits live when the value is edited.
  }, [scene, TARGET_HEIGHT])

  useFrame(() => {
    if (!actions) return
    const want = playerState.anim
    if (want === currentClip.current) return
    const next = actions[want] || actions.Idle
    if (!next) return
    const prev = currentClip.current && actions[currentClip.current]
    if (want === 'Jump') {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity)
    }
    next.reset().fadeIn(FADE).play()
    if (prev && prev !== next) prev.fadeOut(FADE)
    currentClip.current = want
  })

  return (
    <group ref={ref} position={position}>
      <group ref={inner} scale={fit.scale} position={fit.offset} rotation={[0, MODEL_YAW, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  )
})

export default PlayerModel

useGLTF.preload(MODEL_URL)
