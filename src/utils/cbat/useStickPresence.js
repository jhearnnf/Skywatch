import { useEffect, useState } from 'react'
import { listPads, pickPad } from './gamepad'

// Is a joystick plugged in right now?
//
// StickSetup already knows this, but it learns it inside its own frame loop and
// the PAGE needs the answer too: a steering control belongs in the joystick
// panel when there is a stick to steer with, and on the instructions card when
// there is not. So the question is asked once here, cheaply, and answered to
// whoever needs it.
//
// A quarter-second poll rather than a rAF: nothing about this needs frame
// accuracy, and a stick appears at human speed. The gamepadconnected event
// would be cheaper still, but browsers do not fire it until the pad has been
// USED, and they drop the pad entirely while the page is unfocused — polling is
// what actually tracks the thing.
//
// The state only changes when the answer changes, so a page that re-renders on
// this is re-rendering because a stick genuinely came or went.

export const STICK_POLL_MS = 250

export function useStickPresence(pollMs = STICK_POLL_MS) {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      const pad = pickPad(listPads())
      setConnected(prev => (prev === !!pad ? prev : !!pad))
    }, pollMs)
    return () => clearInterval(id)
  }, [pollMs])

  return connected
}

export default useStickPresence
