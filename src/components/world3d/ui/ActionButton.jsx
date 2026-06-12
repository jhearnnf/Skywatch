import { input } from '../character/inputStore'
import { useClosestInteractable } from '../interaction/useClosestInteractable'

// Mobile action button. Lights up when something is in range; dim when not.
// Tapping queues an action that CharacterController consumes on the next
// frame — same path the keyboard 'E' handler uses, so behaviour is identical
// across inputs.

export default function ActionButton() {
  const entry = useClosestInteractable()
  const active = !!entry
  return (
    <button
      type="button"
      aria-label={active ? entry.label : 'Action'}
      onPointerDown={(e) => { e.stopPropagation(); input.setAction() }}
      className={
        'fixed bottom-44 right-12 w-16 h-16 rounded-full pointer-events-auto select-none touch-none ' +
        'flex items-center justify-center text-white font-bold text-2xl shadow-lg transition-all ' +
        (active
          ? 'bg-brand-500 border-2 border-brand-300 scale-100'
          : 'bg-slate-300/40 border-2 border-slate-400/50 scale-95 text-slate-500')
      }
    >
      A
    </button>
  )
}
