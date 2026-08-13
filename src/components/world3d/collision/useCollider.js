import { useEffect, useId } from 'react'
import { registerCollider, unregisterCollider } from './colliders'

// Registers one collider shape for the life of the component. Accepts either
// shape colliders.js understands: a rect ({ halfX, halfZ }) or a circle ({ r }).
// All four size fields are in the dependency list so a shape that changes kind,
// or a circle that changes radius, re-registers rather than going stale.
export function useCollider(shape, enabled = true) {
  const id = useId()
  // Destructured so the effect depends on the numbers rather than on the
  // identity of a shape object that callers rebuild every render.
  const { x, z, halfX, halfZ, r } = shape
  useEffect(() => {
    if (!enabled) return
    registerCollider(id, { x, z, halfX, halfZ, r })
    return () => unregisterCollider(id)
  }, [id, enabled, x, z, halfX, halfZ, r])
}
