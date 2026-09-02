import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGameBodyClass } from '../../hooks/useGameBodyClass'
import SEO from '../../components/SEO'
import ChatShell from './ChatShell'
import CommunityConsole from './CommunityConsole'

const DESCRIPTION = 'Channels and direct messages for SkyWatch agents.'

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
