import { useEffect, useId } from 'react'
import { registerCollider, unregisterCollider } from './colliders'

export function useCollider(rect, enabled = true) {
  const id = useId()
  useEffect(() => {
    if (!enabled) return
    registerCollider(id, rect)
    return () => unregisterCollider(id)
  }, [id, enabled, rect.x, rect.z, rect.halfX, rect.halfZ])
}
