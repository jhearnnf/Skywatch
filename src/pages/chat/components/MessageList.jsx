import { useEffect, useRef } from 'react'
import ProfileBadge from '../../../components/ProfileBadge'
import { formatTime, SUPPORT_LABEL } from '../format'

// Avatar column width. The gutter is reserved on every message so that a run of
// messages from one sender stays aligned under the one avatar that heads it.
const AVATAR_PX = 28

function Avatar({ profile, show }) {
  if (!show) {
    // Invisible spacer, not a conditional render — without it the second and
    // subsequent messages in a run would slide left under the avatar.
    return <span className="shrink-0" style={{ width: AVATAR_PX }} aria-hidden="true" />
  }
  return (
    <span
      className="shrink-0 rounded-full bg-brand-200/60 border border-brand-400/50 flex items-center justify-center overflow-hidden"
      style={{ width: AVATAR_PX, height: AVATAR_PX }}
    >
      <ProfileBadge
        user={profile}
        size={profile?.selectedBadge?.cutoutUrl ? AVATAR_PX : AVATAR_PX - 10}
      />
    </span>
  )
}

// Support replies present as one team identity, so they get a fixed mark rather
// than the individual admin's badge.
function SupportAvatar({ show }) {
  if (!show) return <span className="shrink-0" style={{ width: AVATAR_PX }} aria-hidden="true" />
  return (
    <span
      className="shrink-0 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs"
      style={{ width: AVATAR_PX, height: AVATAR_PX }}
      title={SUPPORT_LABEL}
    >
      🛟
    </span>
  )
}

// Kept at module scope rather than nested in MessageList — a component defined
// inside another's render remounts its whole subtree on every parent render.
function MessageBubble({
  message, mine, startsRun, profile, isSupportIdentity,
  viewerIsAdmin, onOpenUser, onReport, onDelete,
}) {
  const m = message
  const bubble = mine
    ? 'bg-brand-600 text-white'
    : 'bg-slate-100 text-slate-800 border border-slate-200'

  const canOpenUser = Boolean(onOpenUser) && !mine && m.senderUserId && !isSupportIdentity
  const canReport   = Boolean(onReport)   && !mine && !m.deleted
  const canDelete   = Boolean(onDelete)   && viewerIsAdmin && !m.deleted

  const avatar = isSupportIdentity
    ? <SupportAvatar show={startsRun} />
    : <Avatar profile={profile} show={startsRun} />

  return (
    <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${startsRun ? 'mt-2' : 'mt-0.5'}`}>
      {/* Own messages sit on the right, so their avatar mirrors to that side. */}
      {!mine && avatar}

      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${bubble}`}>
        {startsRun && !mine && (
          canOpenUser ? (
            <button
              type="button"
              onClick={() => onOpenUser(m.senderUserId)}
              className="text-[10px] font-semibold opacity-70 mb-0.5 hover:opacity-100 hover:underline"
            >
              {m.senderDisplayName || 'Unknown agent'}
            </button>
          ) : (
            <p className="text-[10px] font-semibold opacity-70 mb-0.5">
              {m.senderDisplayName || 'Unknown agent'}
            </p>
          )
        )}

        <p className={`whitespace-pre-wrap break-words ${m.deleted ? 'line-through opacity-60' : ''}`}>
          {m.body}
        </p>
        {/* Admin-only: users never receive a removed message, so this label is
            only ever seen inside the moderation view. */}
        {m.deleted && (
          <p className="text-[10px] italic opacity-70 mt-0.5">Removed by a moderator</p>
        )}

        <div className="flex items-center gap-2 mt-1">
          <p className={`text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>
            {formatTime(m.createdAt)}
          </p>
          {canReport && (
            <button
              type="button"
              onClick={() => onReport(m)}
              className="text-[10px] text-slate-400 hover:text-slate-600 underline"
            >
              Report
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(m)}
              className="text-[10px] text-red-600 hover:text-red-700 underline"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {mine && avatar}
    </div>
  )
}

// Who a message appears to come from, for grouping purposes. Usually the sender
// id, but in a support thread every admin collapses to one "Skywatch Support"
// identity — so two different admins replying in a row is still one run, and
// gets one avatar, exactly as the user sees it.
function identityKey(m, collapseAdmins) {
  if (collapseAdmins && m.senderRole === 'admin') return 'support'
  return String(m.senderUserId ?? 'unknown')
}

export default function MessageList({
  messages,
  currentUserId,
  // 'support' collapses admin replies to one identity and hides sender names;
  // channels and DMs show who said what.
  conversationType = 'support',
  viewerIsAdmin = false,
  senders = {},
  onOpenUser,
  onReport,
  onDelete,
  emptyLabel = 'No messages yet — say hi to get started.',
}) {
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const collapseAdmins = conversationType === 'support' && !viewerIsAdmin

  // A removed message leaves no trace for users — the server already withholds
  // them, and this drops any that reach us from a cached or in-flight response
  // so nothing ever flashes up before the next poll. Run grouping is computed
  // after this, so a removal closes the gap rather than splitting a run.
  const visible = viewerIsAdmin
    ? messages
    : messages.filter(m => !(m.deleted && m.body === null))

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
      {visible.length === 0 && (
        <p className="text-center text-xs text-slate-400 py-8">{emptyLabel}</p>
      )}
      {visible.map((m, i) => {
        if (m.senderRole === 'system') {
          return (
            <div key={m._id} className="flex justify-center py-1 mt-2">
              <span className="text-[11px] text-slate-400 italic px-2 py-1 rounded-full bg-slate-100">
                {m.body}
              </span>
            </div>
          )
        }

        // A run is consecutive messages from the same identity. Only the first
        // of a run carries the avatar and the sender name; the rest indent to
        // match. A system message in between always breaks the run.
        // Indexes into `visible`, not `messages` — otherwise a removed message
        // would still influence grouping it is no longer part of.
        const prev = visible[i - 1]
        const startsRun =
          !prev ||
          prev.senderRole === 'system' ||
          identityKey(prev, collapseAdmins) !== identityKey(m, collapseAdmins)

        const mine = String(m.senderUserId) === String(currentUserId)
        const isSupportIdentity = collapseAdmins && m.senderRole === 'admin'

        return (
          <MessageBubble
            key={m._id}
            message={m}
            mine={mine}
            startsRun={startsRun}
            profile={senders[String(m.senderUserId)]}
            isSupportIdentity={isSupportIdentity}
            viewerIsAdmin={viewerIsAdmin}
            onOpenUser={conversationType === 'channel' ? onOpenUser : undefined}
            onReport={conversationType === 'support' ? undefined : onReport}
            onDelete={onDelete}
          />
        )
      })}
    </div>
  )
}
