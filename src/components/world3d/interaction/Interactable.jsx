import { useEffect, useId } from 'react'
import { registerInteractable, unregisterInteractable } from './interactables'

// Declarative interactable wrapper. Renders nothing of its own — keeps the
// scene graph free of accidental DOM. Children are the visual representation.
//
// Props:
//   id?       — optional stable ID. Defaults to React useId() (per-mount).
//   x, z      — world position
//   range     — activation radius (units)
//   label     — prompt text ("Play Target", "Read brief", "Sit down")
//   disabled? — if true, never becomes "closest" (broken cabinets, gated entries)
//   onActivate — called when player presses E / taps action while closest

export default function Interactable({
  id: idProp, x, z, range = 2, label, disabled = false, onActivate, children,
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  useEffect(() => {
    registerInteractable(id, { x, z, range, label, disabled, onActivate })
    return () => unregisterInteractable(id)
  }, [id, x, z, range, label, disabled, onActivate])
  return children ?? null
}
