import { useEffect } from 'react'
import { updateHangarMusic } from '../../utils/world3d/hangarMusic'

// Drives the hangar lobby soundtrack from a single place. World3D mounts this
// once, so the track loops for exactly as long as the 3D Hangar world is on
// screen and stops when the user leaves it (walking into a CBAT game, or any
// other navigation, unmounts World3D).
export default function HangarMusic() {
  useEffect(() => {
    updateHangarMusic('lobby')
    return () => updateHangarMusic(null)
  }, [])

  return null
}
