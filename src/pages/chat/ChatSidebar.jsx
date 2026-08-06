import { Link } from 'react-router-dom'
import { formatRelative, SUPPORT_LABEL } from './format'

function Row({ to, icon, title, subtitle, preview, unread, timestamp, active }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 transition-colors
        ${active ? 'bg-brand-100' : 'hover:bg-slate-100'}`}
    >
      <div className="text-lg leading-none pt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`text-sm truncate ${unread ? 'font-extrabold text-slate-800' : 'font-bold text-slate-700'}`}>
            {title}
          </p>
          {unread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
          <span className="ml-auto text-[10px] text-slate-400 shrink-0">
            {formatRelative(timestamp)}
          </span>
        </div>
        {subtitle && <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>}
        {preview && (
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {preview.senderDisplayName ? `${preview.senderDisplayName}: ` : ''}{preview.body}
          </p>
        )}
      </div>
    </Link>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
      {children}
    </p>
  )
}

// The persistent left rail: support, channels and DMs in one scrolling column.
//
// Purely presentational — ChatShell owns the data and the polling, so the rail
// re-renders from props rather than holding a second copy of the overview.
export default function ChatSidebar({
  support, channels = [], dms = [], bots = [], viewer, activeId, isAdmin,
  onStartSupport, onOpenBot,
}) {
  return (
    <div className="flex-1 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
      {viewer?.chatBanned && (
        <div className="px-3 py-2.5 bg-red-50 border-b border-red-200">
          <p className="text-xs font-bold text-red-700">You cannot post in chat</p>
          <p className="text-[11px] text-red-600 mt-0.5">
            {viewer.chatBanReason || 'A moderator has restricted your chat access.'}
            {' '}You can still read, and you can still message the Skywatch team.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <SectionLabel>Support</SectionLabel>
        {support ? (
          <Row
            to={`/chat/${support._id}`}
            icon="🛟"
            title={SUPPORT_LABEL}
            subtitle={support.status === 'closed' ? 'Closed' : 'Usually replies within a few hours'}
            preview={support.preview}
            unread={support.unread}
            timestamp={support.lastMessageAt}
            active={String(activeId) === String(support._id)}
          />
        ) : (
          <button
            type="button"
            onClick={onStartSupport}
            className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-100 transition-colors text-left"
          >
            <div className="text-lg leading-none shrink-0">🛟</div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-700">{SUPPORT_LABEL}</p>
              <p className="text-[11px] text-slate-400">Start a chat with the Skywatch team</p>
            </div>
          </button>
        )}

        <SectionLabel>Channels</SectionLabel>
        {channels.length === 0 ? (
          <p className="text-[11px] text-slate-400 px-3 pb-3">
            No channels yet. The Skywatch team will open some soon.
          </p>
        ) : channels.map(c => (
          <Row
            key={c._id}
            to={`/chat/${c._id}`}
            icon={c.emoji || '#️⃣'}
            title={c.name}
            // Say up front that it is a noticeboard, so nobody types a reply
            // into a channel that will refuse it.
            subtitle={c.adminOnly
              ? [c.description, 'Skywatch team only'].filter(Boolean).join(' · ')
              : c.description}
            preview={c.preview}
            unread={c.unread}
            timestamp={c.lastMessageAt}
            active={String(activeId) === String(c._id)}
          />
        ))}

        {/* Bots are admin-only for now and kept out of Direct messages: a
            tool you query is not a person you are talking to, and mixing them
            would bury real conversations. */}
        {bots.length > 0 && (
          <>
            <SectionLabel>Bots</SectionLabel>
            {bots.map(b => (
              b.conversationId ? (
                <Row
                  key={b.userId}
                  to={`/chat/${b.conversationId}`}
                  icon="🤖"
                  title={b.title}
                  subtitle={b.description}
                  unread={b.unread}
                  timestamp={b.lastMessageAt}
                  active={String(activeId) === String(b.conversationId)}
                />
              ) : (
                <button
                  key={b.userId}
                  type="button"
                  onClick={() => onOpenBot?.(b.userId)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-100 transition-colors text-left"
                >
                  <div className="text-lg leading-none shrink-0">🤖</div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700">{b.title}</p>
                    <p className="text-[11px] text-slate-400">{b.description}</p>
                  </div>
                </button>
              )
            ))}
          </>
        )}

        <SectionLabel>Direct messages</SectionLabel>
        {dms.length === 0 ? (
          <p className="text-[11px] text-slate-400 px-3 pb-3">
            No direct messages. Tap someone&rsquo;s name in a channel to message them.
          </p>
        ) : dms.map(d => (
          <Row
            key={d._id}
            to={`/chat/${d._id}`}
            icon="✉️"
            title={d.title}
            preview={d.preview}
            unread={d.unread}
            timestamp={d.lastMessageAt}
            active={String(activeId) === String(d._id)}
          />
        ))}
      </div>

      {isAdmin && (
        <div className="border-t border-slate-200 p-2">
          <Link
            to="/chat/admin"
            className="block text-center px-3 py-1.5 text-[11px] font-bold text-brand-600 hover:text-brand-700 border border-brand-200 hover:bg-brand-100 rounded-lg transition-colors"
          >
            Community console
          </Link>
        </div>
      )}
    </div>
  )
}
