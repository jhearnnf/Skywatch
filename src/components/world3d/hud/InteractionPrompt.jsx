import { useClosestInteractable } from '../interaction/useClosestInteractable'
import { isTouchDevice } from '../ui/isTouchDevice'

// Center-bottom prompt that mirrors the closest interactable's label. Hidden
// when nothing is in range. The "Press E" / "Tap" affordance is chosen via a
// runtime touch-capability check so dual-input devices favour keyboard.

export default function InteractionPrompt() {
  const entry = useClosestInteractable()
  if (!entry) return null
  const hint = isTouchDevice() ? 'Tap action' : 'Press E'
  return (
    <div className="pointer-events-none select-none flex items-center gap-3 px-4 py-2 rounded-full border border-brand-300 bg-brand-50/85 backdrop-blur-sm shadow-lg">
      <kbd className="text-[10px] font-bold uppercase tracking-wider text-brand-700 bg-brand-100 border border-brand-200 px-2 py-0.5 rounded">{hint}</kbd>
      <span className="text-sm font-semibold text-brand-800">{entry.label}</span>
    </div>
  )
}
