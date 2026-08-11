import { useState } from 'react'
import { agentLabel, formatRelative } from '../format'

// The green dot. Exported because the DM rows and the message avatars draw the
// same mark, and three hand-rolled circles would drift apart on the first tweak.
export function OnlineDot({ className = '', title = 'Online now' }) {
  return (
    <span
      className={`rounded-full bg-emerald-600 ${className}`}
      // Falsy title = no tooltip, for the dots inside the strip: there the word
      // "Online" is already next to them, and a hover label repeating it would
      // fire on every row of the list.
      title={title || undefined}
      // The dot is decoration next to a name that is already on screen; the
      // accessible answer lives in the strip's "N online", not in a dot per row.
      aria-hidden="true"
    />
  )
}

// "Online · N", pinned at the top of the community rail. Admin only.
//
// Pinned rather than placed in the scrolling column, and above Direct messages
// rather than below it: DMs is the one section of the rail that grows without
// limit, so anything under it sinks further out of reach the more threads an
// admin accumulates. Presence is the most time-sensitive thing here and would
// have ended up needing the most scrolling.
//
// Count first, list on demand. A permanent expanded list spends the top of the
// rail on names, and on a quiet morning it spends it on "nobody" — a strip
// reading "Online · 0" says the same thing in one line without making the
// community area look abandoned every time it is opened.
export default function PresenceStrip({ online = [], count = 0 }) {
  const [open, setOpen] = useState(false)

  // What the list can actually show, which is not always `count` — the endpoint
  // caps the list and reports the true total, so a busy day says "62 online" and
  // lists 50. Saying so is better than letting an admin count the rows and find
  // twelve missing.
  const hidden = Math.max(0, count - online.length)

  return (
    <div className="border-b border-slate-200 bg-slate-50/50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors text-left"
      >
        <OnlineDot title={null} className={`w-2 h-2 shrink-0 ${count === 0 ? 'opacity-30' : ''}`} />
        <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
          Online
        </span>
        <span className="text-[11px] font-bold text-slate-700">{count}</span>
        <span aria-hidden="true" className="ml-auto text-[10px] text-slate-400">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="max-h-64 overflow-y-auto pb-1">
          {online.length === 0 ? (
            <p className="text-[11px] text-slate-400 px-3 pb-2">
              Nobody has been active in the last 10 minutes.
            </p>
          ) : (
            <>
              {online.map(u => (
                <div key={u._id} className="flex items-start gap-2 px-3 py-1">
                  <OnlineDot title={null} className="w-1.5 h-1.5 shrink-0 mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-600 truncate">
                        {agentLabel(u)}
                      </span>
                      {u.isSelf && (
                        <span className="text-[9px] font-semibold text-slate-400 shrink-0">You</span>
                      )}
                      {u.isAdmin && !u.isSelf && (
                        <span className="text-[9px] font-semibold text-brand-600 shrink-0">Staff</span>
                      )}
                      {/* Presence is a 10-minute window, not a live wire —
                          someone counted as online may have shut the lid eight
                          minutes ago. The last-seen time is what separates "here
                          now" from "here recently", and an admin deciding
                          whether to expect a reply needs the difference. */}
                      <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                        {formatRelative(u.lastSeen)}
                      </span>
                    </div>
                    {/* Where they are. Absent for the viewer's own row, and for
                        anyone on a route with no label — a missing line is the
                        honest rendering of "we do not know", where a filler like
                        "Somewhere else" would be a claim. */}
                    {u.location && (
                      <p className="text-[10px] text-slate-400 truncate">{u.location}</p>
                    )}
                  </div>
                </div>
              ))}
              {hidden > 0 && (
                <p className="text-[10px] text-slate-400 px-3 pt-1">
                  and {hidden} more
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
