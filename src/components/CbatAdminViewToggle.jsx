// Admin-only switch on the CBAT hub: flip between the admin view of the boards
// (every row shows the player's email) and the agent view every other user gets
// (display name / agent number). Lets an admin check what players actually see
// without signing out, and keeps emails off a shared or streamed screen.
//
// Styled as a small tab that docks onto the top edge of the Recent Scores card —
// border-b-0 plus the -mb-px overlap makes the two read as one piece of chrome,
// which is what says "this is a setting for that panel". Deliberately quiet: it's
// a tool for one person, sitting beside content everyone else is here for.
//
// The preference is persisted and read by every CBAT surface that lists other
// people — see src/utils/cbatAdminView.js.

import { useCbatAdminView, setCbatAdminView } from '../utils/cbatAdminView'

export default function CbatAdminViewToggle() {
  const on = useCbatAdminView()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Admin view"
      onClick={() => setCbatAdminView(!on)}
      title={on
        ? 'Boards show player emails. Switch to see them as a player does.'
        : 'Boards show agent names, as a player sees them. Switch back to admin view.'}
      className="relative z-10 -mb-px inline-flex items-center gap-1.5 px-2.5 py-1 cursor-pointer
        rounded-t-lg border border-b-0 border-[#1a3a5c] bg-[#0a1628]
        hover:bg-[#102040] transition-colors group"
    >
      <span
        aria-hidden="true"
        className={`relative w-6 h-3 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-[#1a3a5c]'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full transition-transform
            ${on ? 'translate-x-3 bg-white' : 'bg-slate-500'}`}
        />
      </span>
      <span className={`text-[10px] font-extrabold uppercase tracking-wide transition-colors
        ${on ? 'text-brand-600' : 'text-slate-500 group-hover:text-slate-700'}`}
      >
        {on ? 'Admin view' : 'Agent view'}
      </span>
    </button>
  )
}
