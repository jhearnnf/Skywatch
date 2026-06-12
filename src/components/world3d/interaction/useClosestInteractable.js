import { useSyncExternalStore } from 'react'
import { subscribeClosest, getClosestEntry } from './interactables'

export function useClosestInteractable() {
  return useSyncExternalStore(subscribeClosest, getClosestEntry, () => null)
}
