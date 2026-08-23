import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'
import { NATIVE_APP } from '../../utils/appMode'
import SEO from '../../components/SEO'
import ChatShell from './ChatShell'
import CommunityConsole from './CommunityConsole'

const DESCRIPTION = 'Channels and direct messages for SkyWatch agents.'

const COMMUNITY_URL = 'https://skywatch.academy/chat'

function Shell({ children }) {
  return (
    <div className="px-2 py-2 overflow-hidden">
      <SEO title="Chat" description={DESCRIPTION} />
      {children}
    </div>
  )
}

function Unavailable({ heading, detail }) {
  return (
    <div className="max-w-md mx-auto text-center py-12">
      <SEO title="Chat" description={DESCRIPTION} />
      <div className="text-4xl mb-4">💬</div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-2">{heading}</h1>
      <p className="text-sm text-slate-500">{detail}</p>
    </div>
  )
}

// What the native app shows in place of Community. A deep link, a stale route
// or an old notification used to bounce silently to /cbat, which read as a
// broken link rather than a deliberate absence — so say where Community lives
// instead.
//
// The address is copyable text, not a link, and that is the point: following a
// link here would load the messages inside the Capacitor WebView, putting
// user-to-user content back in the store binary — the exact thing the NATIVE_APP
// gate exists to prevent. Same shape as the native subscribe prompt in
// UpgradePrompt for that same reason.
function NativeCommunity() {
  // 'idle' | 'copied' | 'failed'. The failure branch is not defensive padding:
  // the Clipboard API is unavailable or blocked often enough in a WebView that
  // a bare .then() leaves a dead button and no explanation. When it fails the
  // address is still on screen and selectable (.user-selectable in main.css),
  // so the message points at that instead.
  const [copyState, setCopyState] = useState('idle')

  const copyLink = () => {
    // The write is issued synchronously on click; the try/catch is for a
    // navigator.clipboard that is absent altogether, which throws before any
    // promise exists, and the .catch() is for one that exists and refuses.
    try {
      navigator.clipboard.writeText(COMMUNITY_URL)
        .then(() => {
          setCopyState('copied')
          setTimeout(() => setCopyState('idle'), 2500)
        })
        .catch(() => setCopyState('failed'))
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <div className="max-w-md mx-auto text-center py-12">
      <SEO title="Community" description={DESCRIPTION} />
      <div className="text-4xl mb-4">💬</div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Community is on the website</h1>
      <p className="text-sm text-slate-500 mb-6">
        Channels and direct messages between agents are not part of the app. Open SkyWatch in your
        browser to read them and join in.
      </p>
      <div className="flex flex-col items-center gap-3">
        <p className="text-xs text-slate-400">Visit</p>
        <p className="text-sm font-bold text-brand-600 user-selectable">skywatch.academy/chat</p>
        <button
          onClick={copyLink}
          className="inline-block bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-2xl text-sm transition-colors"
          style={{ boxShadow: '0 0 20px rgba(91,170,255,0.25)' }}
        >
          {copyState === 'copied' ? '✓ Copied!' : 'Copy Link'}
        </button>
        {copyState === 'failed' && (
          <p className="text-xs text-slate-400 max-w-[16rem]">
            Copying did not work on this device. Press and hold the address above to select it, then
            copy it by hand.
          </p>
        )}
      </div>
    </div>
  )
}

// Shared gate for every chat route. `view` picks which surface renders once the
// gate passes, so the native/feature-flag/auth checks live in exactly one place.
function ChatRoute({ view }) {
  const { user } = useAuth()
  const { settings, loading: settingsLoading } = useAppSettings()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  // Admins can select text anywhere in Community — see the rule in main.css.
  // Applied here rather than in ChatShell because this gate is common to the
  // channel list, threads and the admin console, and moderation reads all
  // three. Called before the early returns below, as a hook must be.
  useGameBodyClass('community-selectable', Boolean(user?.isAdmin))

  // Community is not part of the native app: user-to-user messaging with a
  // potentially under-18 audience is a store-policy problem on both Play and
  // the App Store. The nav entry is hidden there too, but a deep link or a
  // stale route must not slip past it — those land on the explainer above
  // rather than being redirected, so the link reads as answered, not broken.
  // Deliberately before the admin branch: the console shows the same messages.
  if (NATIVE_APP) return <NativeCommunity />

  if (settingsLoading) return null

  if (settings && settings.chatEnabled === false) {
    return <Unavailable heading="Chat is unavailable" detail="The chat feature is currently disabled." />
  }

  if (!user) return null

  if (view === 'admin') {
    if (!user.isAdmin) return <Navigate to="/chat" replace />
    return <Shell><CommunityConsole /></Shell>
  }
  // /chat and /chat/:conversationId render the same two-pane shell — which pane
  // is visible on mobile follows from the route param. See ChatShell.
  return <Shell><ChatShell /></Shell>
}

// /chat and /chat/:conversationId both render this same component — see the
// note on the routes in App.jsx. ChatShell reads the param itself and decides
// which pane to show.
export default function Chat()   { return <ChatRoute view="list" /> }
export function ChatAdminRoute() { return <ChatRoute view="admin" /> }
