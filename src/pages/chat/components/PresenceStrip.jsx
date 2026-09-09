import { useState } from 'react'
import { agentLabel, formatRelative } from '../format'

// Green for at-the-keyboard, amber for stepped-away. The two differ in luminance
// as well as hue (see the note on the joystick palette in main.css), so the pair
// survives colour blindness — and every dot carries a title saying which it is,
// for the places where one sits on its own with no list around it to explain it.
const TONES = {
  online: { bg: 'bg-emerald-600', title: 'Online now' },
  away:   { bg: 'bg-amber-600',   title: 'Away' },
}

// The presence dot. Exported because the DM rows and the message avatars draw
// the same mark, and three hand-rolled circles would drift apart on the first
// tweak.
//
// `status` is 'online' | 'away' | null, straight off the map the presence hook
// builds. Null renders nothing at all rather than a grey dot: someone outside
// the ten-minute window is not a third state to draw, they are simply not here.
export function PresenceDot({ status, className = '', title }) {
  const tone = TONES[status]
  if (!tone) return null

  return (
    <span
      className={`rounded-full ${tone.bg} ${className}`}
      // Falsy title = no tooltip, for the dots inside the strip: there the word
      // "Online" or "Away" is already next to them, and a hover label repeating
      // it would fire on every row of the list.
      title={title === undefined ? tone.title : (title || undefined)}
      // The dot is decoration next to a name that is already on screen; the
      // accessible answer lives in the strip's counts, not in a dot per row.
      aria-hidden="true"
    />
  )
}

// One half of the header: a dot, a number and a word.
function Tally({ status, count, label }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <PresenceDot
        status={status}
        title={null}
        className={`w-2 h-2 shrink-0 ${count === 0 ? 'opacity-30' : ''}`}
      />
      <span className="text-[11px] font-bold text-slate-700">{count}</span>
      <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">{label}</span>
    </span>
  )
}

// A group heading inside the expanded list. Only drawn when both groups are on
// screen — with one group the strip's own header already names it, and a lone
// "ONLINE" label under a header reading "3 online" is a line spent twice.
function GroupHeading({ children, hint }) {
  return (
    <p
      title={hint}
      className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 pt-2 pb-1"
    >
      {children}
    </p>
  )
}

function PersonRow({ u }) {
  const away = u.status === 'away'

  return (
    <div className="flex items-start gap-2 px-3 py-1">
      <PresenceDot
        status={away ? 'away' : 'online'}
        title={null}
        className="w-1.5 h-1.5 shrink-0 mt-1.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* Away rows sit a shade back, so the people who would answer a
              message right now are the ones the eye lands on. */}
          <span className={`text-[11px] truncate ${away ? 'text-slate-500' : 'text-slate-600'}`}>
            {agentLabel(u)}
          </span>
          {u.isSelf && (
            <span className="text-[9px] font-semibold text-slate-400 shrink-0">You</span>
          )}
          {u.isAdmin && !u.isSelf && (
            <span className="text-[9px] font-semibold text-brand-600 shrink-0">Staff</span>
          )}
          {/* Presence is a window, not a live wire. The group says which side of
              three minutes someone is on; this says how far — the difference
              between an away agent who stepped out just now and one who is a
              minute from dropping off the list entirely. */}
          <span className="ml-auto text-[10px] text-slate-400 shrink-0">
            {formatRelative(u.lastSeen)}
          </span>
        </div>
        {/* Where they are. Absent for the viewer's own row, and for anyone on a
            route with no label — a missing line is the honest rendering of "we
            do not know", where a filler like "Somewhere else" would be a
            claim. */}
        {u.location && (
          <p className="text-[10px] text-slate-400 truncate">{u.location}</p>
        )}
      </div>
    </div>
  )
}

// "Online · N, Away · N", pinned at the top of the community rail. Admin only.
//
// Pinned rather than placed in the scrolling column, and above Direct messages
// rather than below it: DMs is the one section of the rail that grows without
// limit, so anything under it sinks further out of reach the more threads an
// admin accumulates. Presence is the most time-sensitive thing here and would
// have ended up needing the most scrolling.
//
// Count first, list on demand. A permanent expanded list spends the top of the
// rail on names, and on a quiet morning it spends it on "nobody" — a strip
// reading "0 Online" says the same thing in one line without making the
// community area look abandoned every time it is opened.
//
// The split is the server's (GET /api/chat/presence): online means a heartbeat
// inside the last three minutes, which the client only sends while the tab is
// visible and being used. Away is the rest of the ten-minute window — tab
// hidden, gone idle, or walked away from the desk. Both belong here, but they
// answer different questions, and one number covering both let an admin message
// someone who left nine minutes ago and then wait on a reply.
export default function PresenceStrip({ online = [], count = 0, onlineCount, awayCount }) {
  const [open, setOpen] = useState(false)

  // The counts are the server's, taken over the whole window rather than the
  // capped list. Defaulted off `count` for the case where they are missing
  // entirely — a backend that has not shipped the split yet — which reads as
  // everyone online, exactly as this strip did before.
  const onlineN = onlineCount ?? count
  const awayN   = awayCount ?? 0

  const listedOnline = online.filter(u => u.status !== 'away')
  const listedAway   = online.filter(u => u.status === 'away')

  // What the list can actually show, which is not always the count — the
  // endpoint caps the list at 50 and reports the true totals, so a busy day says
  // "62" and lists 50. Saying so is better than letting an admin count the rows
  // and find twelve missing. Counted per group, because the cap bites the away
  // half first: the list arrives sorted by recency, so the rows it drops are the
  // oldest ones.
  const hiddenOnline = Math.max(0, onlineN - listedOnline.length)
  const hiddenAway   = Math.max(0, awayN - listedAway.length)

  // With one group on screen the header has already named it and a heading would
  // only repeat it. With both, the headings are what stop the amber rows reading
  // as a continuation of the green ones.
  const grouped = listedOnline.length > 0 && listedAway.length > 0

  return (
    <div className="border-b border-slate-200 bg-slate-50/50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        // The counts are two dots and two numbers on screen; spelled out here so
        // a screen reader gets the same answer without them.
        aria-label={`Who is around: ${onlineN} online, ${awayN} away`}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-100 transition-colors text-left"
      >
        <Tally status="online" count={onlineN} label="Online" />
        {/* Hidden at zero rather than shown as "0 Away". On a quiet rail the
            second half would be a line about nobody, and the strip's job at that
            moment is to be one short line. */}
        {awayN > 0 && <Tally status="away" count={awayN} label="Away" />}
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
              {grouped && <GroupHeading hint="Active in the last 3 minutes">Online</GroupHeading>}
              {listedOnline.map(u => <PersonRow key={u._id} u={u} />)}
              {hiddenOnline > 0 && (
                <p className="text-[10px] text-slate-400 px-3 pt-1">
                  and {hiddenOnline} more
                </p>
              )}

              {grouped && (
                <GroupHeading hint="Last active 3 to 10 minutes ago">Away</GroupHeading>
              )}
              {listedAway.map(u => <PersonRow key={u._id} u={u} />)}
              {hiddenAway > 0 && (
                <p className="text-[10px] text-slate-400 px-3 pt-1">
                  and {hiddenAway} more away
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
