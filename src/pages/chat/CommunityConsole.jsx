import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AdminChatView from './AdminChatView'
import ChatChannelsEditor from '../admin/ChatChannelsEditor'
import ChatBotEditor from '../admin/ChatBotEditor'
import CommunitySoundEditor from '../admin/CommunitySoundEditor'
import { useAuth } from '../../context/AuthContext'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'

// Everything that administers Community, in one place.
//
// These controls used to be split between Admin › Settings (channels, bot) and
// a separate "moderation console" (transcripts, bans). Splitting them by
// implementation rather than by task meant configuring a channel and moderating
// it were two different pages — so this gathers them under one roof and the
// Settings sections now just link here.
//
// "Console" rather than "moderation": moderation is one tab of four now.
const TABS = [
  { id: 'conversations', label: 'Conversations', hint: 'Read any thread, moderate, ban' },
  { id: 'channels',      label: 'Channels',      hint: 'Create, order, who can post' },
  { id: 'bots',          label: 'Bots',          hint: 'The guide the bot answers from' },
  { id: 'sound',         label: 'Sound',         hint: 'The Community soundtrack' },
]

export default function CommunityConsole() {
  const { API } = useAuth()
  const [searchParams] = useSearchParams()
  // A deep link from a chat report lands on a specific transcript, so it must
  // open the tab that shows one.
  const deepLinked = searchParams.get('conversationId') || searchParams.get('userId')
  const [tab, setTab] = useState(deepLinked ? 'conversations' : 'conversations')

  useGameBodyClass('chat-wide')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          to="/chat"
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors"
        >
          ← Community
        </Link>
        <h1 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
          Community console
        </h1>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.hint}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
              ${tab === t.id
                ? 'bg-brand-600 text-white'
                : 'bg-surface border border-slate-200 text-slate-600 hover:border-brand-400'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conversations keeps its own full-height two-pane layout, so it is not
          wrapped in a card the way the settings tabs are. */}
      {tab === 'conversations' && <AdminChatView />}

      {tab === 'channels' && (
        <div className="bg-surface rounded-2xl border border-slate-200 card-shadow p-4">
          <ChatChannelsEditor API={API} />
        </div>
      )}

      {tab === 'bots' && (
        <div className="bg-surface rounded-2xl border border-slate-200 card-shadow p-4">
          <ChatBotEditor API={API} />
        </div>
      )}

      {tab === 'sound' && (
        <div className="bg-surface rounded-2xl border border-slate-200 card-shadow p-4">
          <CommunitySoundEditor API={API} />
        </div>
      )}
    </div>
  )
}
