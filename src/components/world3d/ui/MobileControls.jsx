import { useEffect, useState } from 'react'
import VirtualJoystick from './VirtualJoystick'
import ActionButton from './ActionButton'
import { isTouchDevice } from './isTouchDevice'

// Render-only-on-touch gate. We don't want a phantom joystick on desktops
// even if the layout would allow it; reading capabilities at mount and
// caching keeps the check cheap.

export default function MobileControls() {
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(isTouchDevice()) }, [])
  if (!show) return null
  return (
    <>
      <VirtualJoystick />
      <ActionButton />
    </>
  )
}
