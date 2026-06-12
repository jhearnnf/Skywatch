import { Suspense, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { resolveMove } from '../collision/colliders'
import { scanClosest, activateClosest } from '../interaction/interactables'
import { input } from './inputStore'
import { playerState } from '../state/playerState'
import PlayerModel from '../props/PlayerModel'

const WALK_SPEED = 2.5
const RUN_SPEED = 5
const RADIUS = 0.45
const MOUSE_SENS = 0.0025
const CAM_LERP = 0.12
const YAW_AUTO_LERP = 0.08
const CAM_OFFSET = new THREE.Vector3(0, 7, 5)
const LOOK_AT_HEIGHT = 1.1
// Pitch is clamped so the orbiting camera never dips below the floor (look up)
// or flips overhead (look down). Tuned against CAM_OFFSET's 7-up / 5-back pose.
const PITCH_MIN = -0.4
const PITCH_MAX = 0.6
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
// Vertical jump arc: apex ≈ JUMP_V² / (2·|GRAVITY|) ≈ 0.6 units, ~0.5s airtime.
const GRAVITY = -20
const JUMP_V = 5

// Third-person controller. When pointer is locked, yaw follows the mouse;
// otherwise it auto-tracks the agent's most-recent movement direction (mobile
// case + idle). Movement is integrated per-frame and resolved against the
// shared AABB collider registry, then the closest interactable is scanned for
// the HUD prompt.

export default function CharacterController({ spawn = [0, 0, 0] }) {
  const agentRef = useRef(null)
  const posRef = useRef({ x: spawn[0], z: spawn[2] })
  const yawRef = useRef(0)
  const pitchRef = useRef(0.15)
  const facingRef = useRef(0)
  const heightRef = useRef(0) // feet height above floor (jump arc)
  const vyRef = useRef(0)
  const camTarget = useRef(new THREE.Vector3())
  const lookTarget = useRef(new THREE.Vector3())
  const { camera } = useThree()

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)

    if (input.pointerLocked) {
      if (input.lookDeltaX !== 0) yawRef.current -= input.lookDeltaX * MOUSE_SENS
      if (input.lookDeltaY !== 0) {
        // Mouse up (negative movementY) → look up.
        pitchRef.current = THREE.MathUtils.clamp(
          pitchRef.current - input.lookDeltaY * MOUSE_SENS,
          PITCH_MIN,
          PITCH_MAX,
        )
      }
    }
    input.lookDeltaX = 0
    input.lookDeltaY = 0

    // Local input → world delta via camera yaw
    const cosY = Math.cos(yawRef.current)
    const sinY = Math.sin(yawRef.current)
    const localX = input.move.x
    const localZ = input.move.z
    const worldDx = localX * cosY + localZ * sinY
    const worldDz = -localX * sinY + localZ * cosY

    const running = input.run
    const step = (running ? RUN_SPEED : WALK_SPEED) * dt
    const next = resolveMove(
      posRef.current,
      { x: worldDx * step, z: worldDz * step },
      RADIUS,
    )
    posRef.current = next

    // Vertical jump arc. Jump only fires from the ground; gravity integrates
    // the rest. Buffered if pressed mid-air so it triggers on landing.
    const grounded = heightRef.current <= 0.0001 && vyRef.current <= 0
    if (grounded && input.consumeJump()) vyRef.current = JUMP_V
    vyRef.current += GRAVITY * dt
    heightRef.current += vyRef.current * dt
    if (heightRef.current <= 0) {
      heightRef.current = 0
      vyRef.current = 0
    }

    if (agentRef.current) {
      agentRef.current.position.x = next.x
      agentRef.current.position.y = heightRef.current
      agentRef.current.position.z = next.z
      if (Math.hypot(worldDx, worldDz) > 0.01) {
        facingRef.current = Math.atan2(worldDx, worldDz)
        // Auto-follow yaw when mouse isn't driving it
        if (!input.pointerLocked) {
          const delta = ((facingRef.current - yawRef.current + Math.PI) % (Math.PI * 2)) - Math.PI
          yawRef.current += delta * YAW_AUTO_LERP
        }
      }
      agentRef.current.rotation.y = facingRef.current
    }

    // Drive the player animation: airborne → Jump, moving → Run/Walk, else Idle.
    const airborne = heightRef.current > 0.001 || vyRef.current > 0.001
    const moving = Math.hypot(worldDx, worldDz) > 0.01
    playerState.anim = airborne ? 'Jump' : moving ? (running ? 'Run' : 'Walk') : 'Idle'

    // Orbit the camera: pitch around the right axis, then yaw around up. The
    // jump height feeds both the camera target and look-at so the view rises
    // with the player instead of staying pinned to the floor.
    const offset = CAM_OFFSET.clone()
      .applyAxisAngle(X_AXIS, pitchRef.current)
      .applyAxisAngle(Y_AXIS, yawRef.current)
    camTarget.current.set(next.x + offset.x, heightRef.current + offset.y, next.z + offset.z)
    camera.position.lerp(camTarget.current, CAM_LERP)
    lookTarget.current.set(next.x, heightRef.current + LOOK_AT_HEIGHT, next.z)
    camera.lookAt(lookTarget.current)

    scanClosest(next)
    if (input.consumeAction()) activateClosest()
  })

  return (
    <Suspense fallback={null}>
      <PlayerModel ref={agentRef} position={spawn} />
    </Suspense>
  )
}
