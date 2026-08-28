import { Fragment, useEffect, useRef, useState } from 'react'
import ProfileBadge from '../../../components/ProfileBadge'
import { formatTime, SUPPORT_LABEL } from '../format'
import { nameColour } from '../nameColour'
import { REACTION_EMOJI } from '../reactionEmoji'
import { splitMentions, mentionsMe } from '../mentions'
import { OnlineDot } from './PresenceStrip'

// Discord-style rows rather than chat bubbles. Bubbles alternate sides and
// carry a lot of padding, which is fine for two people and unreadable once a
// channel has eight — you lose the scan-down-the-left-edge of who is speaking,
// and fit maybe a third as many messages on screen. Rows are left-aligned,
// tight, and grouped into runs.
const AVATAR_PX = 30

// Existing reactions, plus a picker. In a bot feed this is the only way to
// interact at all, so it is always visible rather than hover-only once a
// message has any.
//
// On a touch device the picker button is always visible too. It is faint, and
// one faint glyph per message is a fair price: Tailwind compiles `hover:` into
// `@media (hover: hover)`, so a hover-only control on a phone is not awkward,
// it is absent — there would be no way to react at all on a message nobody had
// reacted to yet.
function Reactions({ message, onReact }) {
  const [picking, setPicking] = useState(false)
  const list = message.reactions ?? []
  if (!onReact && !list.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {list.map(r => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onReact?.(message, r.emoji)}
          disabled={!onReact}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] border transition-colors
            ${r.mine
              ? 'bg-brand-100 border-brand-400 text-brand-700'
              : 'bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-300'}`}
          aria-label={`${r.emoji} ${r.count}`}
          aria-pressed={r.mine}
        >
          <span>{r.emoji}</span>
          <span className="font-semibold">{r.count}</span>
        </button>
      ))}

      {onReact && (
        <span className="relative">
          <button
            type="button"
            onClick={() => setPicking(p => !p)}
            className={`px-1.5 py-0.5 rounded-md text-[11px] border border-slate-200 text-slate-400
              hover:text-slate-600 hover:border-slate-300 transition-colors
              ${list.length ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100'}`}
            aria-label="Add a reaction"
          >
            ☺+
          </button>
          {picking && (
            <span className="absolute z-10 bottom-full left-0 mb-1 flex gap-0.5 bg-surface border border-slate-200 rounded-lg px-1 py-1 card-shadow">
              {REACTION_EMOJI.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { setPicking(false); onReact(message, e) }}
                  className="px-1 py-0.5 rounded hover:bg-slate-100 text-sm"
                >
                  {e}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

// Podium places hung off the base of the avatar.
//
// The medals OVERLAP heavily — each sits two-thirds on top of the one before,
// like a tight stack of coins. At most three are shown; anything beyond that is
// counted as "+N".
//
// Overlapping is not decoration: three medals laid end to end plus a counter
// would be wider than the avatar and start shoving the message text around.
// Only a sliver of each lower medal shows, which is enough — they are told
// apart by colour, not by detail.
//
// The best medal is drawn on top (descending z-index), so a gold is never the
// one tucked behind — the ones partly covered are always the lesser ones.
const MEDAL_FACE = { 1: '🥇', 2: '🥈', 3: '🥉' }
const MEDAL_WORD = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' }
const MEDAL_PX   = 12   // rendered width of one medal glyph
const OVERLAP_PX = 8    // how much of the previous medal each one covers (of 12)
const MAX_MEDALS = 3

function MedalBar({ medals = [] }) {
  const shown = medals.slice(0, MAX_MEDALS)
  if (!shown.length) return null
  const extra = medals.length - shown.length

  return (
    <span
      className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center pointer-events-none"
      style={{ lineHeight: 1 }}
    >
      {shown.map((m, i) => (
        <span
          key={`${m.gameKey}-${m.rank}`}
          className="text-[10px]"
          style={{
            marginLeft: i === 0 ? 0 : -OVERLAP_PX,
            zIndex: shown.length - i,
            position: 'relative',
          }}
          title={`${MEDAL_WORD[m.rank] ?? 'Podium'} — ${m.gameLabel}`}
        >
          {MEDAL_FACE[m.rank] ?? '🎖️'}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="text-[8px] font-bold text-slate-500 ml-0.5"
          style={{ position: 'relative', zIndex: 0 }}
          title={`${extra} more`}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

function Avatar({ profile, show, support, online = false }) {
  if (!show) {
    // Reserved gutter, not a conditional render: without it every message after
    // the first in a run slides left under the avatar.
    return <span className="shrink-0" style={{ width: AVATAR_PX }} aria-hidden="true" />
  }
  if (support) {
    return (
      <span
        className="shrink-0 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs mt-0.5"
        style={{ width: AVATAR_PX, height: AVATAR_PX }}
        title={SUPPORT_LABEL}
      >
        🛟
      </span>
    )
  }
  // The medal bar overflows the avatar circle, so the positioning context is a
  // wrapper — putting it on the circle itself would clip the medals against its
  // own `overflow-hidden`.
  return (
    <span className="shrink-0 relative mt-0.5" style={{ width: AVATAR_PX, height: AVATAR_PX }}>
      <span
        className="block rounded-full bg-brand-200/60 border border-brand-400/50 overflow-hidden"
        style={{ width: AVATAR_PX, height: AVATAR_PX, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <ProfileBadge
          user={profile}
          size={
            profile?.selectedBadge?.cutoutUrl ? AVATAR_PX
              // The bot mark is a ring, so it wants to sit just inside the
              // circle's border rather than float in the middle of it like a
              // rank badge does.
              : profile?.isBot ? AVATAR_PX - 4
                : AVATAR_PX - 12
          }
        />
      </span>
      <MedalBar medals={profile?.medals} />
      {/* Top-right, because the medal bar already owns the bottom of the circle
          and the two would overlap on anyone who has placed. */}
      {online && (
        <OnlineDot className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 ring-2 ring-surface" />
      )}
    </span>
  )
}

// The quoted parent above a reply. Renders from the snapshot stored on the
// message, so it still shows when the parent has been removed or is simply not
// in the loaded page.
function ReplyQuote({ replyTo, onJump }) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(replyTo.messageId)}
      className="flex items-center gap-1.5 mb-0.5 text-left w-full min-w-0 group/quote"
    >
      <span className="text-slate-400 text-[10px] shrink-0">↰</span>
      <span className="text-[11px] font-semibold text-slate-500 shrink-0">
        {replyTo.displayName || 'Unknown agent'}
      </span>
      <span className="text-[11px] text-slate-400 truncate group-hover/quote:text-slate-500">
        {replyTo.excerpt || 'message unavailable'}
      </span>
    </button>
  )
}

// Message text with any @mentions picked out. A mention OF YOU is loud (it is
// the thing you came back to the channel for); a mention of someone else is
// just tinted, so a busy channel does not turn into confetti.
function MessageBody({ message, senders, currentUserId }) {
  const mentioned = (message.mentions ?? [])
    .map(id => senders[String(id)])
    .filter(Boolean)

  if (!mentioned.length) return <>{message.body}</>

  return splitMentions(message.body, mentioned).map((run, i) => {
    if (!run.user) return <span key={i}>{run.text}</span>
    const isMe = String(run.user._id) === String(currentUserId)
    return (
      <span
        key={i}
        className={`rounded px-1 font-semibold ${isMe
          ? 'bg-brand-200/70 text-brand-800'
          : 'text-brand-600'}`}
      >
        {run.text}
      </span>
    )
  })
}

// "Guide Bot is typing…" — a model call takes seconds, and without this the
// channel just sits there. That ambiguity matters more here than it would
// elsewhere, because the bot deciding to ignore you IS a real outcome: silence
// is how it answers an injection attempt or a bare mention.
function TypingIndicator({ name }) {
  return (
    <div className="flex items-center gap-2 mt-2 px-2 text-[11px] text-slate-400">
      <span className="flex gap-0.5" aria-hidden="true">
        <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '120ms' }} />
        <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '240ms' }} />
      </span>
      <span>{name} is typing…</span>
    </div>
  )
}

// The Discord line: where you got up to last time. Rendered above the first
// message you have not seen, and frozen for the whole visit — it must not creep
// down the screen as the poll marks things read underneath you.
function NewMessagesDivider() {
  return (
    <div className="flex items-center gap-2 mt-3 mb-1" aria-label="New messages">
      <span className="flex-1 h-px bg-red-400/60" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">New</span>
      <span className="flex-1 h-px bg-red-400/60" />
    </div>
  )
}

// Module scope, not nested — a component defined inside another's render
// remounts its whole subtree on every parent render.
function MessageRow({
  message, startsRun, profile, isSupportIdentity, mine, online,
  viewerIsAdmin, onOpenUser, onReport, onDelete, onEdit, onReply, onReact, onSeenBy,
  onJump, highlighted, senders, currentUserId,
  // Whether this row's actions are pinned open, and how to ask for that. Held
  // by the list rather than the row so only one row can be open at a time.
  actionsOpen, onToggleActions,
}) {
  const m = message
  const name = isSupportIdentity
    ? SUPPORT_LABEL
    : (m.senderDisplayName || 'Unknown agent')
  const colour = isSupportIdentity ? '#94a3b8' : nameColour(m.senderUserId)

  const canOpenUser = Boolean(onOpenUser) && !mine && m.senderUserId && !isSupportIdentity
  const canReport   = Boolean(onReport)   && !mine && !m.deleted
  const canDelete   = Boolean(onDelete)   && viewerIsAdmin && !m.deleted
  const canEdit     = Boolean(onEdit)     && viewerIsAdmin && !m.deleted
  const canReply    = Boolean(onReply)    && !m.deleted
  // Admins can inspect any message, including one they removed — "who saw this
  // before I took it down" is a moderation question, and the endpoint already
  // serves them the deleted ones. Everyone else gets it on their own live
  // messages only.
  const canSeenBy   = Boolean(onSeenBy)   && (viewerIsAdmin || (mine && !m.deleted))
  const hasActions  = canSeenBy || canReply || canEdit || canReport || canDelete

  // On a pointer device the bar disappears the moment you move off the row, so
  // nothing has to dismiss it. Where it was opened by tap it does, or it would
  // sit over the conversation until another row was touched.
  const act = (fn) => () => { onToggleActions?.(null); fn() }

  // Inline edit, admin only. Kept local to the row rather than lifted, so
  // typing a correction does not re-render the whole thread on every keystroke.
  const [draft,  setDraft]  = useState(null)   // null = not editing
  const [saving, setSaving] = useState(false)

  const saveEdit = async () => {
    const next = draft.trim()
    if (!next || next === m.body) { setDraft(null); return }
    setSaving(true)
    try {
      await onEdit(m, next)
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      id={`msg-${m._id}`}
      className={`group relative flex gap-2.5 px-2 -mx-2 rounded transition-colors
        ${startsRun ? 'mt-2' : 'mt-0'}
        ${highlighted ? 'bg-brand-100/60'
          // A message addressed to you keeps a standing tint, so it is still
          // findable after the jump banner has been dismissed.
          : mentionsMe(m, currentUserId) ? 'bg-amber-100/40 hover:bg-amber-100/60'
            : 'hover:bg-slate-100/60'}`}
    >
      <Avatar profile={profile} show={startsRun} support={isSupportIdentity} online={online} />

      <div className="min-w-0 flex-1 py-0.5">
        {m.replyTo && <ReplyQuote replyTo={m.replyTo} onJump={onJump} />}

        {startsRun && (
          <div className="flex items-baseline gap-2">
            {canOpenUser ? (
              <button
                type="button"
                onClick={() => onOpenUser(m.senderUserId)}
                className="text-[13px] font-bold hover:underline"
                style={{ color: colour }}
              >
                {name}
              </button>
            ) : (
              <span className="text-[13px] font-bold" style={{ color: colour }}>{name}</span>
            )}
            {profile?.isBot && (
              <span className="text-[9px] font-bold px-1 py-px rounded bg-brand-200/60 text-brand-700 uppercase tracking-wide">
                Bot
              </span>
            )}
            <span className="text-[10px] text-slate-400">{formatTime(m.createdAt)}</span>
          </div>
        )}

        {draft !== null ? (
          <div className="mt-0.5">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
              }}
              rows={2}
              autoFocus
              maxLength={4000}
              className="w-full text-sm text-slate-800 bg-slate-100 border border-slate-300 rounded-lg px-2 py-1.5 resize-y focus:outline-none focus:border-brand-400"
              aria-label="Edit message"
            />
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="text-[11px] font-bold px-2 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <span className="text-[10px] text-slate-400">Enter saves, Shift+Enter for a new line</span>
            </div>
          </div>
        ) : (
          <p className={`text-sm text-slate-800 whitespace-pre-wrap break-words ${m.deleted ? 'line-through opacity-60' : ''}`}>
            <MessageBody message={m} senders={senders} currentUserId={currentUserId} />
            {m.edited && !m.deleted && (
              <span className="text-[10px] text-slate-400 ml-1.5" title="Edited by a moderator">(edited)</span>
            )}
          </p>
        )}
        {/* Admin-only: users never receive a removed message. */}
        {m.deleted && (
          <p className="text-[10px] italic text-slate-400">Removed by a moderator</p>
        )}

        {!m.deleted && <Reactions message={m} onReact={onReact} />}
      </div>

      {/* The tap target that stands in for hovering. Only rendered where hover
          does not exist, and only until the bar it opens is up. */}
      {hasActions && !actionsOpen && (
        <button
          type="button"
          onClick={() => onToggleActions?.(m._id)}
          aria-label="Message actions"
          aria-expanded="false"
          className="absolute right-1 top-0 hidden touch:block px-1.5 py-0.5 text-[13px] leading-none text-slate-400"
        >
          ⋯
        </button>
      )}

      {/* Hover actions, floated so they never take layout space per row. Shown
          on hover where there is a pointer, and on tap where there is not. */}
      <div
        data-testid="message-actions"
        data-open={actionsOpen ? 'true' : 'false'}
        className={`absolute right-1 -top-2 ${actionsOpen ? 'flex' : 'hidden'} group-hover:flex items-center gap-1 bg-surface border border-slate-200 rounded-lg px-1 py-0.5 card-shadow`}
      >
        {canSeenBy && (
          <button type="button" onClick={act(() => onSeenBy(m))} title="Seen by"
            className="text-[11px] px-1.5 py-0.5 text-slate-500 hover:text-slate-700">👁</button>
        )}
        {canReply && (
          <button type="button" onClick={act(() => onReply(m))} title="Reply"
            className="text-[11px] px-1.5 py-0.5 text-slate-500 hover:text-slate-700">↰</button>
        )}
        {canEdit && (
          <button type="button" onClick={act(() => setDraft(m.body ?? ''))} title="Edit"
            className="text-[11px] px-1.5 py-0.5 text-slate-500 hover:text-slate-700">✎</button>
        )}
        {canReport && (
          <button type="button" onClick={act(() => onReport(m))} title="Report"
            className="text-[11px] px-1.5 py-0.5 text-slate-500 hover:text-slate-700">⚑</button>
        )}
        {canDelete && (
          <button type="button" onClick={act(() => onDelete(m))} title="Delete"
            className="text-[11px] px-1.5 py-0.5 text-red-600 hover:text-red-700">✕</button>
        )}
        {/* Only where the bar had to be opened deliberately. */}
        <button
          type="button"
          onClick={() => onToggleActions?.(null)}
          aria-label="Close message actions"
          className="hidden touch:block text-[11px] px-1.5 py-0.5 text-slate-400"
        >
          ⌄
        </button>
      </div>
    </div>
  )
}

// Who a message appears to come from, for grouping. Usually the sender id, but
// in support every admin collapses to one "SkyWatch Support" identity — so two
// admins replying in a row is still one run, exactly as the user sees it.
function identityKey(m, collapseAdmins) {
  if (collapseAdmins && m.senderRole === 'admin') return 'support'
  return String(m.senderUserId ?? 'unknown')
}

export default function MessageList({
  messages,
  currentUserId,
  conversationType = 'support',
  viewerIsAdmin = false,
  senders = {},
  // Set of user ids currently online, or null. Admin-only and supplied by
  // ChatShell; every other caller passes nothing and gets no dots.
  onlineIds = null,
  onOpenUser,
  onReport,
  onDelete,
  onEdit,
  onReply,
  onReact,
  onSeenBy,
  // Runs collapse consecutive messages from one sender under a single avatar,
  // name and timestamp. That is right for a conversation and wrong for a feed:
  // in the medals channel every message is from the same bot, so grouping them
  // would hide the time each one was posted behind whichever came first. Feeds
  // pass false and get one self-contained entry per message.
  groupRuns = true,
  highlightId = null,
  // Where this viewer got up to last time, frozen at entry by ChatThread. Null
  // means "never been here", which draws no line — a first visit is not a pile
  // of unread messages.
  dividerAfter = null,
  // Name of the bot currently composing a reply, or null.
  typingName = null,
  emptyLabel = 'No messages yet — say hi to get started.',
}) {
  const scrollRef = useRef(null)
  // Which row has its actions pinned open, on a device with no hover. Held
  // here rather than per row so opening one closes the last.
  const [openActionsId, setOpenActionsId] = useState(null)
  const toggleActions = (id) =>
    setOpenActionsId(cur => (id === null || cur === id ? null : String(id)))

  // Also scrolls when the indicator appears, so it is not left below the fold.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, typingName])

  const collapseAdmins = conversationType === 'support' && !viewerIsAdmin

  // Removed messages leave no trace for users — the server withholds them, and
  // this drops any that arrive from a cached response. Grouping runs after the
  // filter, so a removal closes the gap rather than splitting a run.
  const visible = viewerIsAdmin
    ? messages
    : messages.filter(m => !(m.deleted && m.body === null))

  const jumpTo = (messageId) => {
    const el = document.getElementById(`msg-${messageId}`)
    if (el) el.scrollIntoView({ block: 'center' })
  }

  // The first message the viewer had not seen last time they were here. Found
  // once per render pass rather than tested per row, so the line can only ever
  // be drawn in one place.
  const firstUnseen = dividerAfter
    ? visible.find(m => new Date(m.createdAt) > new Date(dividerAfter))
    : null

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
      {visible.length === 0 && (
        <p className="text-center text-xs text-slate-400 py-8">{emptyLabel}</p>
      )}
      {visible.map((m, i) => {
        const divider = firstUnseen && firstUnseen._id === m._id
          ? <NewMessagesDivider key={`divider-${m._id}`} />
          : null

        if (m.senderRole === 'system') {
          return (
            <Fragment key={m._id}>
              {divider}
              <div className="flex justify-center py-1 mt-2">
                <span className="text-[11px] text-slate-400 italic px-2 py-1 rounded-full bg-slate-100">
                  {m.body}
                </span>
              </div>
            </Fragment>
          )
        }

        // Indexes into `visible`, not `messages` — a removed message must not
        // influence grouping it is no longer part of. A reply always heads its
        // own run, so the quote is never orphaned above someone else's name.
        const prev = visible[i - 1]
        const startsRun =
          !groupRuns ||
          !prev ||
          prev.senderRole === 'system' ||
          Boolean(m.replyTo) ||
          identityKey(prev, collapseAdmins) !== identityKey(m, collapseAdmins)

        return (
          <Fragment key={m._id}>
          {divider}
          <MessageRow
            message={m}
            startsRun={startsRun}
            mine={String(m.senderUserId) === String(currentUserId)}
            // Not on your own messages — a dot telling you that you are online
            // is noise on every run you post. Not in a collapsed support
            // identity either: that avatar is the team's face, and a dot on it
            // would say which staff member is at their desk.
            online={Boolean(
              onlineIds
              && !(collapseAdmins && m.senderRole === 'admin')
              && String(m.senderUserId) !== String(currentUserId)
              && onlineIds.has(String(m.senderUserId)),
            )}
            profile={senders[String(m.senderUserId)]}
            senders={senders}
            currentUserId={currentUserId}
            isSupportIdentity={collapseAdmins && m.senderRole === 'admin'}
            viewerIsAdmin={viewerIsAdmin}
            onOpenUser={conversationType === 'channel' ? onOpenUser : undefined}
            onReport={conversationType === 'support' ? undefined : onReport}
            onDelete={onDelete}
            onEdit={onEdit}
            onReply={onReply}
            onReact={onReact}
            // Support collapses every admin into one identity for the user, so
            // "who has read this" there would hand them a list of staff. An
            // admin already sees who replied, so the concern does not apply.
            onSeenBy={conversationType === 'support' && !viewerIsAdmin ? undefined : onSeenBy}
            onJump={jumpTo}
            highlighted={String(highlightId) === String(m._id)}
            actionsOpen={openActionsId === String(m._id)}
            onToggleActions={toggleActions}
          />
          </Fragment>
        )
      })}
      {typingName && <TypingIndicator name={typingName} />}
    </div>
  )
}
