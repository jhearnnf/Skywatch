import Overlay from '../../../components/ui/Overlay'
import { agentLabel } from '../format'

// Who is in one CBAT cohort room. Admin-only: the members list comes from
// /api/chat/cbat-groups/:id, which only an admin can call, so a member's own
// view of the room never has anything to open this with.
//
// Opened from the "N members" count in the room strip rather than listed in
// the strip itself, so the admin's drill-down looks like the room the members
// see and the names are one tap away when they are wanted.
export default function GroupMembersDialog({ title, members = [], onClose, onOpenUser }) {
  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4" data-testid="group-members-dialog">
      <div className="w-full max-w-xs bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <p className="text-sm font-semibold text-slate-700 truncate">{title}</p>
        </div>

        <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Members</p>
          <p className="text-[10px] text-slate-400" data-testid="group-members-count">
            {members.length} {members.length === 1 ? 'agent' : 'agents'}
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto px-4 pb-2">
          {members.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No members currently assigned.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {members.map(m => (
                <li key={m._id} className="flex items-baseline justify-between gap-3 py-2">
                  {/* A name opens the same card a name in the thread does. */}
                  <button
                    type="button"
                    onClick={() => onOpenUser?.(String(m._id))}
                    className="text-sm text-slate-700 hover:text-brand-600 truncate text-left transition-colors"
                  >
                    {agentLabel(m)}
                  </button>
                  {m.cbatPassed && (
                    <span className="text-[10px] font-semibold text-emerald-600 shrink-0">Passed</span>
                  )}
                  {m.supporter && (
                    <span className="text-[10px] font-semibold text-amber-600 shrink-0">Supporter</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Overlay>
  )
}
