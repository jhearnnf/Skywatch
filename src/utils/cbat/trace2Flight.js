import * as THREE from 'three'

// Climb rounds share this fixed-step recording between scoring, live flight and
// replay. Rendering frame rate must never change which aircraft wins.
export function recordTrace2Flight(spec, durationMs, turnDefs) {
  const target = new THREE.Quaternion(...spec.initialQuat)
  const current = target.clone()
  const pos = new THREE.Vector3(...spec.startPos)
  const nose = new THREE.Vector3(-1, 0, 0)
  const forward = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const axes = { up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(0, 0, -1) }
  const halfTan = Math.tan(55 * Math.PI / 360)
  const samples = []
  let turnIndex = 0, started = false, entryHalf = 1, minY = Infinity, climbGain = 0
  const sample = t => {
    const half = halfTan * (10 - pos.z)
    // Preserve the replay counter's entry-height convention, and include all
    // onward flight through the end of the watched round.
    if (!started && Math.abs((pos.y - 4.5) / half) < 1) {
      started = true
      entryHalf = half
    }
    if (started) {
      minY = Math.min(minY, pos.y)
      climbGain = Math.max(climbGain, (pos.y - minY) / entryHalf)
    }
    samples.push({ t, p: pos.toArray(), q: current.toArray(), climbGain })
  }
  sample(0)
  let previous = 0
  for (let frame = 1; previous < durationMs; frame++) {
    const t = Math.min(frame * 1000 / 60, durationMs)
    const dt = (t - previous) / 1000
    const flying = t >= (spec.startDelayMs || 0)
    while (flying && turnIndex < spec.turns.length && t >= spec.turns[turnIndex].tMs) {
      const def = turnDefs[spec.turns[turnIndex++].turnKey]
      target.multiply(rotation.setFromAxisAngle(axes[def.axis], def.angle)).normalize()
    }
    current.slerp(target, Math.min(0.3, dt * 9))
    if (flying) pos.addScaledVector(forward.copy(nose).applyQuaternion(current), spec.speed * dt)
    sample(t)
    previous = t
  }
  return samples
}

export const trace2ClimbFeet = gain => Math.round(Math.max(0, gain) * 100) * 100
