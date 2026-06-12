import { describe, it, expect, beforeEach } from 'vitest'
import {
  _reset, registerInteractable, unregisterInteractable,
  scanClosest, getClosestId, getClosestEntry, activateClosest, subscribeClosest,
} from '../interaction/interactables'

beforeEach(() => _reset())

describe('interactables registry', () => {
  it('finds the closest in-range entry', () => {
    registerInteractable('a', { x:  3, z: 0, range: 5, label: 'A' })
    registerInteractable('b', { x:  1, z: 0, range: 5, label: 'B' })
    registerInteractable('c', { x:  6, z: 0, range: 5, label: 'C' })
    scanClosest({ x: 0, z: 0 })
    expect(getClosestId()).toBe('b')
  })

  it('returns null when nothing is within range', () => {
    registerInteractable('a', { x: 100, z: 0, range: 2, label: 'A' })
    scanClosest({ x: 0, z: 0 })
    expect(getClosestId()).toBeNull()
  })

  it('skips disabled entries even when closer', () => {
    registerInteractable('a', { x: 0.5, z: 0, range: 5, disabled: true, label: 'A' })
    registerInteractable('b', { x: 2,   z: 0, range: 5, label: 'B' })
    scanClosest({ x: 0, z: 0 })
    expect(getClosestId()).toBe('b')
  })

  it('clears closest when the entry is unregistered', () => {
    registerInteractable('a', { x: 1, z: 0, range: 5, label: 'A' })
    scanClosest({ x: 0, z: 0 })
    expect(getClosestId()).toBe('a')
    unregisterInteractable('a')
    expect(getClosestId()).toBeNull()
  })

  it('notifies subscribers when the closest changes', () => {
    const calls = []
    const unsubscribe = subscribeClosest(() => calls.push(getClosestId()))
    registerInteractable('a', { x: 1, z: 0, range: 5, label: 'A' })
    scanClosest({ x: 0, z: 0 })
    scanClosest({ x: 0, z: 0 }) // unchanged — should NOT re-notify
    registerInteractable('b', { x: 0.2, z: 0, range: 5, label: 'B' })
    scanClosest({ x: 0, z: 0 })
    unsubscribe()
    expect(calls).toEqual(['a', 'b'])
  })

  it('activateClosest calls the closest entry\'s onActivate', () => {
    let fired = 0
    registerInteractable('a', { x: 1, z: 0, range: 5, label: 'A', onActivate: () => fired++ })
    scanClosest({ x: 0, z: 0 })
    activateClosest()
    activateClosest()
    expect(fired).toBe(2)
  })

  it('exposes the full entry via getClosestEntry', () => {
    registerInteractable('a', { x: 1, z: 0, range: 5, label: 'Hello' })
    scanClosest({ x: 0, z: 0 })
    expect(getClosestEntry()?.label).toBe('Hello')
  })
})
