import { Link } from 'react-router-dom'
import { isCbatGuideUrl, prepareGuideChrome } from '../../utils/guideHref'
import BotBadge from '../../components/BotBadge'
import AdminDmSearch from './components/AdminDmSearch'
import PresenceStrip, { OnlineDot } from './components/PresenceStrip'
import { formatRelative, SUPPORT_LABEL } from './format'
import { badgeLabel, supportQueueLabel } from '../../utils/chatBadge'
import CountBadge from '../../components/ui/CountBadge'

function Row({
  to, icon, title, subtitle, preview, unread, timestamp, active,
  online = false, personalUnread = 0,
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 transition-colors
        ${active ? 'bg-brand-100' : 'hover:bg-slate-100'}`}
    >
      {/* The dot hangs off the icon rather than sitting beside the name, so it
          cannot be mistaken for the red unread dot that lives there. */}
      <div className="text-lg leading-none pt-0.5 shrink-0 relative">
        {icon}
        {online && <OnlineDot className="absolute -right-0.5 -bottom-0.5 w-2 h-2 ring-1 ring-surface" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`text-sm truncate ${unread ? 'font-extrabold text-slate-800' : 'font-bold text-slate-700'}`}>
            {title}
          </p>
          {/* The count is what the navbar badge was counting, broken down per
              conversation — so a "3" up there resolves into the three rows that
              actually want you. A row you are merely behind on keeps the dot. */}
          {personalUnread > 0
            ? <CountBadge count={personalUnread} label={badgeLabel(personalUnread)} />
            : unread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
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

// Support and the guides are not channels, and the rail used to say they were:
// same flat row, same hairline divider, same column as General and your DMs.
// The two things a newcomer needs first were therefore the two things that
// looked most like something to scroll past.
//
// So they get their own zone at the top — inset cards on a tinted panel, each
// with its icon in a tile and a plain label for what tapping it does ("Message
// the team", "Read"). The message list starts below a solid rule, and the
// distinction is legible before a single word is read: cards are things you
// open, rows are conversations you keep up with.
function ResourceCard({ as: As = 'div', tone = 'slate', active = false, children, ...props }) {
  const tones = {
    brand: 'bg-brand-100 border-brand-200 hover:border-brand-300',
    slate: 'bg-slate-100 border-slate-200 hover:border-slate-300',
  }
  return (
    <As
      {...props}
      className={`w-full flex items-start gap-2.5 text-left px-2.5 py-2.5 rounded-xl border
        transition-colors ${tones[tone]} ${active ? 'ring-2 ring-brand-400' : ''}`}
    >
      {children}
    </As>
  )
}

// The tile is what separates a card's icon from a row's bare emoji at a glance.
function CardIcon({ children, online = false }) {
  return (
    <div className="w-8 h-8 rounded-lg bg-surface border border-slate-200 shrink-0
      flex items-center justify-center text-base leading-none relative">
      {children}
      {online && <OnlineDot className="absolute -right-0.5 -bottom-0.5 w-2 h-2 ring-1 ring-surface" />}
    </div>
  )
}

// Says what the card does, not what it is. A guide that only carried a title
// and a book emoji still read as a channel called "CBAT Guide".
function CardAction({ children }) {
  return (
    <span className="text-[10px] font-bold text-brand-600 shrink-0 pt-0.5">{children}</span>
  )
}

// A guide is one of three things, and each needs a different link.
//
//   • an app route ("/rankings")            → react-router Link
//   • a document on our domain              → plain anchor: a static file like
//     ("/cbat-guide.html")                    public/cbat-guide.html is outside
//                                             the SPA, so routing to it with
//                                             Link would just render the 404
//   • anywhere off-site                     → anchor, new tab, and an ↗, since
//                                             a card that silently leaves the
//                                             site is a small trap
//
// A trailing file extension is what separates the first two. No unread dot or
// timestamp on any of them: nothing here to keep up with.
// A guide staged for review. Only admins are ever sent these rows, so the badge
// does not gate anything; it answers the question an admin asks on seeing an
// unfamiliar card in their own rail, which is "can everyone else see this?".
// Amber rather than red: this is a draft, not a fault.
function AdminOnlyBadge() {
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase
      tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
      Admin only
    </span>
  )
}

function GuideCard({ guide }) {
  const onSite   = guide.url?.startsWith('/')
  const internal = onSite && !/\.[a-z0-9]+$/i.test(guide.url)
  const body = (
    <>
      <CardIcon>{guide.emoji || '📖'}</CardIcon>
      <div className="min-w-0 flex-1">
        {/* The badge sits on the title row rather than after the description,
            so it is read before the card is opened rather than after. The title
            keeps `truncate` and the badge keeps its width, so a long title
            shortens instead of pushing the badge off the card. */}
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">{guide.title}</p>
          {guide.adminOnly && <AdminOnlyBadge />}
        </div>
        {guide.description && (
          <p className="text-[11px] text-slate-500 truncate mt-0.5">{guide.description}</p>
        )}
      </div>
      <CardAction>{onSite ? 'Read' : 'Read ↗'}</CardAction>
    </>
  )

  if (internal) return <ResourceCard as={Link} to={guide.url}>{body}</ResourceCard>
  // The CBAT guide is a cream document and the app paints light status-bar text
  // for its dark theme, so leaving for it needs the same handover the landing
  // page and the CBAT menu do. Guarded by URL: the rail's rows come from the
  // database and any other document is not ours to restyle for.
  if (onSite)   return (
    <ResourceCard
      as="a"
      href={guide.url}
      onClick={isCbatGuideUrl(guide.url) ? prepareGuideChrome : undefined}
    >{body}</ResourceCard>
  )
  return (
    <ResourceCard as="a" href={guide.url} target="_blank" rel="noopener noreferrer">
      {body}
    </ResourceCard>
  )
}

function SectionLabel({ children, className = 'px-3 pt-3 pb-1.5' }) {
  return (
    <p className={`${className} text-[10px] font-bold text-slate-500 uppercase tracking-wider`}>
      {children}
    </p>
  )
}

// The persistent left rail: support, channels and DMs in one scrolling column.
//
// Purely presentational — ChatShell owns the data and the polling, so the rail
// re-renders from props rather than holding a second copy of the overview.
export default function ChatSidebar({
  support, guides = [], channels = [], dms = [], bots = [], viewer, activeId, isAdmin,
  loading = false, onStartSupport, onOpenBot, onOpenDm, supportQueueUnread = 0,
  // Admin-only presence. Empty for everyone else — ChatShell does not even fetch
  // it — so the strip and the dots simply never appear rather than needing a
  // second permission check per call site.
  presence = null,
}) {
  // "No channels yet" and "Loading…" are different claims, and an empty prop
  // cannot tell them apart on its own. Only a cold rail ever sees this — once
  // anything has been fetched, the shell renders the last copy while it
  // refreshes rather than emptying the sections out.
  const placeholder = 'text-[11px] text-slate-400 px-3 pb-3'

  return (
    <div className="flex-1 flex flex-col bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
      {viewer?.chatBanned && (
        <div className="px-3 py-2.5 bg-red-50 border-b border-red-200">
          <p className="text-xs font-bold text-red-700">You cannot post in chat</p>
          <p className="text-[11px] text-red-600 mt-0.5">
            {viewer.chatBanReason || 'A moderator has restricted your chat access.'}
            {' '}You can still read, and you can still message the SkyWatch team.
          </p>
        </div>
      )}

      {/* Outside the scrolling column on purpose: presence is the one thing here
          that changes minute to minute, so it stays put rather than scrolling
          away behind a long channel list. */}
      {presence?.enabled && (
        <PresenceStrip online={presence.online} count={presence.count} />
      )}

      <div className="flex-1 overflow-y-auto">
        {/* The help zone. Support and the guides sit together on one tinted
            panel above a solid rule, so the rail reads as "get help, or read
            up" and then "conversations" — rather than as one undifferentiated
            list where the guide is the fourth thing that looks like a channel.
            Both of these are things you dip into once; everything below the
            rule is something you come back to. */}
        <div className="p-2 pt-2.5 space-y-1.5 bg-slate-100/40">
          <SectionLabel className="px-1 pb-0.5">Get help</SectionLabel>
          {support ? (
            <ResourceCard
              as={Link}
              tone="brand"
              to={`/chat/${support._id}`}
              aria-current={String(activeId) === String(support._id) ? 'page' : undefined}
              active={String(activeId) === String(support._id)}
            >
              <CardIcon>🛟</CardIcon>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${support.unread ? 'font-extrabold text-slate-900' : 'font-bold text-slate-800'}`}>
                    {SUPPORT_LABEL}
                  </p>
                  {support.personalUnread > 0
                    ? <CountBadge count={support.personalUnread} label={badgeLabel(support.personalUnread)} />
                    : support.unread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                  <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                    {formatRelative(support.lastMessageAt)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  {support.status === 'closed' ? 'Closed' : 'Usually replies within a few hours'}
                </p>
                {support.preview && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {support.preview.senderDisplayName ? `${support.preview.senderDisplayName}: ` : ''}
                    {support.preview.body}
                  </p>
                )}
              </div>
            </ResourceCard>
          ) : loading ? (
            // Offering "start a chat" before the rail has loaded would invite
            // someone with an open support thread to start a second one.
            <p className="text-[11px] text-slate-400 px-1 pb-1">Loading…</p>
          ) : (
            <ResourceCard as="button" type="button" tone="brand" onClick={onStartSupport}>
              <CardIcon>🛟</CardIcon>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">{SUPPORT_LABEL}</p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  A private thread with the SkyWatch team
                </p>
              </div>
              <CardAction>Message</CardAction>
            </ResourceCard>
          )}

          {/* Nothing to show when the team has not added any — an empty section
              with a "coming soon" line would be noise above every channel. */}
          {guides.length > 0 && (
            <>
              <SectionLabel className="px-1 pt-2 pb-0.5">Guides</SectionLabel>
              {guides.map(g => <GuideCard key={g._id} guide={g} />)}
            </>
          )}
        </div>

        {/* The rule between reading and talking. */}
        <div className="border-b-2 border-slate-200" />

        <SectionLabel>Channels</SectionLabel>
        {channels.length === 0 ? (
          <p className={placeholder}>
            {loading
              ? 'Loading…'
              : 'No channels yet. The SkyWatch team will open some soon.'}
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
              ? [c.description, 'SkyWatch team only'].filter(Boolean).join(' · ')
              : c.description}
            preview={c.preview}
            unread={c.unread}
            personalUnread={c.personalUnread}
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
                  // The same face it posts under in the thread — a generic 🤖
                  // next to "Guide Bot" made every bot look interchangeable.
                  icon={<BotBadge botKey={b.botKey} size={20} title={b.title} />}
                  title={b.title}
                  subtitle={b.description}
                  unread={b.unread}
                  personalUnread={b.personalUnread}
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
                  <BotBadge botKey={b.botKey} size={20} title={b.title} />
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

        {/* Admins can start a thread with anyone, not just people who have
            posted somewhere they can tap a name. */}
        {isAdmin && <AdminDmSearch onOpenDm={onOpenDm} />}

        {dms.length === 0 ? (
          <p className={placeholder}>
            {loading
              ? 'Loading…'
              : <>No direct messages. Tap someone&rsquo;s name in a channel to message them.</>}
          </p>
        ) : dms.map(d => (
          <Row
            key={d._id}
            to={`/chat/${d._id}`}
            icon="✉️"
            title={d.title}
            preview={d.preview}
            unread={d.unread}
            personalUnread={d.personalUnread}
            timestamp={d.lastMessageAt}
            active={String(activeId) === String(d._id)}
            online={Boolean(d.otherUser && presence?.onlineIds?.has(String(d.otherUser._id)))}
          />
        ))}
      </div>

      {isAdmin && (
        <div className="border-t border-slate-200 p-2">
          <Link
            to="/chat/admin"
            className="flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-bold text-brand-600 hover:text-brand-700 border border-brand-200 hover:bg-brand-100 rounded-lg transition-colors"
          >
            Community console
            {/* The support queue lives behind this link and nowhere else. An
                admin whose navbar badge is counting waiting support threads
                would otherwise arrive at a rail with nothing unread in it and
                conclude the badge was lying. */}
            <CountBadge
              count={supportQueueUnread}
              label={supportQueueLabel(supportQueueUnread)}
            />
          </Link>
        </div>
      )}
    </div>
  )
}
