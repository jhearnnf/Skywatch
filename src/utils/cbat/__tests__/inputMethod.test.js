import { describe, it, expect } from 'vitest'
import {
  INPUT_METHODS, INPUT_METHOD_LABEL, INPUT_METHOD_ICON,
  INPUT_JOYSTICK, INPUT_KEYBOARD_MOUSE, INPUT_TOUCH,
  createInputTally, addInput, mergeInputTallies, dominantInput, normalizeInputMethod,
} from '../inputMethod'
import { CBAT_INPUT_METHODS } from '../../../../backend/constants/cbatInputMethods'

describe('input method vocabulary', () => {
  it('matches the backend list exactly — the server nulls anything else', () => {
    expect(INPUT_METHODS).toEqual(CBAT_INPUT_METHODS)
  })

  it('names and marks every method, with no em dashes on screen', () => {
    for (const m of INPUT_METHODS) {
      expect(typeof INPUT_METHOD_LABEL[m]).toBe('string')
      expect(INPUT_METHOD_LABEL[m]).not.toMatch(/—/)
      expect(typeof INPUT_METHOD_ICON[m]).toBe('string')
    }
  })
})

describe('input tally', () => {
  it('starts with nothing steering and reports no method', () => {
    expect(dominantInput(createInputTally())).toBeNull()
    expect(dominantInput(null)).toBeNull()
  })

  it('labels a run with whichever control did most of the steering', () => {
    const t = createInputTally()
    addInput(t, INPUT_KEYBOARD_MOUSE, 3)
    addInput(t, INPUT_JOYSTICK, 40)
    addInput(t, INPUT_TOUCH, 2)
    expect(dominantInput(t)).toBe(INPUT_JOYSTICK)
  })

  it('counts one unit when no weight is given', () => {
    const t = createInputTally()
    addInput(t, INPUT_TOUCH)
    addInput(t, INPUT_TOUCH)
    addInput(t, INPUT_KEYBOARD_MOUSE)
    expect(t[INPUT_TOUCH]).toBe(2)
    expect(dominantInput(t)).toBe(INPUT_TOUCH)
  })

  it('ignores unknown methods and non-positive weights', () => {
    const t = createInputTally()
    addInput(t, 'gamepad', 10)
    addInput(t, INPUT_JOYSTICK, 0)
    addInput(t, INPUT_JOYSTICK, -5)
    addInput(t, INPUT_JOYSTICK, NaN)
    expect(t).toEqual(createInputTally())
  })

  // ACT keeps one tally per round; the run is the sum of them.
  it('merges per-round tallies, skipping rounds that recorded none', () => {
    const a = addInput(createInputTally(), INPUT_KEYBOARD_MOUSE, 10)
    const b = addInput(createInputTally(), INPUT_JOYSTICK, 8)
    const c = addInput(createInputTally(), INPUT_JOYSTICK, 8)
    const merged = mergeInputTallies([a, undefined, b, null, c])
    expect(merged[INPUT_KEYBOARD_MOUSE]).toBe(10)
    expect(merged[INPUT_JOYSTICK]).toBe(16)
    expect(dominantInput(merged)).toBe(INPUT_JOYSTICK)
  })

  it('breaks an exact tie toward the joystick', () => {
    const t = createInputTally()
    addInput(t, INPUT_TOUCH, 5)
    addInput(t, INPUT_JOYSTICK, 5)
    expect(dominantInput(t)).toBe(INPUT_JOYSTICK)
  })

  it('normalises wire values to the three or null', () => {
    expect(normalizeInputMethod('touch')).toBe('touch')
    expect(normalizeInputMethod('gamepad')).toBeNull()
    expect(normalizeInputMethod(undefined)).toBeNull()
  })
})
