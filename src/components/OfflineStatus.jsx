import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isOnline, onNetworkChange } from '../lib/net'
import { onOutboxChange, pendingCount, flushOutbox } from '../lib/cbatOutbox'
import { onApiHealthChange, getApiHealth } from '../lib/apiHealth'
import { useGameChrome } from '../context/GameChromeContext'
import { useAuth } from '../context/AuthContext'

// Score-sync feedback for CBAT offline support.
//
// WHERE THIS MAY APPEAR — this is a hard rule, not a preference. CBAT games are
// timed, reaction-scored tasks; anything drawn over the play area corrupts the
// run. This banner previously mounted globally at bottom-centre, so a player
// with a queued score had a pill sitting on top of every game.
//
// So: hidden by default, shown only on the one screen listed below. An
// allowlist (not a blocklist of game routes) means a newly added route can
// never start overlaying gameplay by accident. `immersive` is the app's own
// "mid-play" flag and vetoes everything regardless.
//
// FOUR STATES, and the distinction matters — see lib/apiHealth.js:
//   • offline            — their network. Scores are queued and safe.
//   • can't reach us     — our fault or the network's; they can't fix it, so
//                          don't tell them to "check your connection".
//   • signed out         — the only state they can actually resolve.
//   • syncing            — transient, while the queue drains.
//
// ONE SCREEN: the CBAT menu. Not the landing page or /home (a signed-out
// visitor there has nothing at stake — every game is behind RequireAuth), not
// leaderboards, and not the post-game score screen, which is still inside a
// game and where a fixed pill costs space at the worst moment. The menu is the
// screen a player crosses between runs, so a queued score is seen on the way to
// the next game — which is also the only place they can act on it.
const ALLOWED_EXACT = new Set(['/cbat'])

export function canShowSyncStatus(pathname, { immersive } = {}) {
  if (immersive) return false            // never over live gameplay
  return ALLOWED_EXACT.has(pathname)
}

export default function OfflineStatus() {
  const [online, setOnline]   = useState(isOnline())
  const [pending, setPending] = useState(0)
  const [health, setHealth]   = useState(getApiHealth)
  const { immersive } = useGameChrome()
  const { apiFetch, API, user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => onNetworkChange(setOnline), [])
  useEffect(() => onApiHealthChange(setHealth), [])

  // Re-counted when the user changes: the count is owner-scoped, so signing in
  // or out changes how many of the queued scores are actually ours to send.
  const userId = user?._id ?? null
  useEffect(() => {
    let active = true
    const refresh = () => { Promise.resolve(pendingCount(userId)).then((n) => { if (active) setPending(n) }) }
    refresh()
    const off = onOutboxChange(refresh)
    return () => { active = false; off() }
  }, [userId])

  // Re-check the pending count when connectivity flips (a flush may have run).
  useEffect(() => {
    if (!online) return
    const t = setTimeout(() => { Promise.resolve(pendingCount(userId)).then(setPending) }, 1500)
    return () => clearTimeout(t)
  }, [online, userId])

  if (!canShowSyncStatus(pathname, { immersive })) return null

  // A dead session is what apiHealth reports; simply having no user covers the
  // rest (logged out on purpose, never signed in). Both mean the same thing to
  // the queue: flushOutbox is gated on a signed-in user, so nothing moves until
  // they sign in. Without this the fallback branch claimed "Syncing 1 score…"
  // at someone who had logged out, and nothing was syncing.
  const sessionDied = health.status === 'signedOut'
  const noSession   = sessionDied || !user
  const unreachable = health.status === 'unreachable'

  // Nothing queued: only a session that *died* is worth a word, because that's
  // the one case where the user thinks they're signed in and isn't. A visitor
  // who never signed in has nothing at stake and shouldn't be alarmed.
  if (pending === 0 && !sessionDied) return null

  const scores = `${pending} score${pending === 1 ? '' : 's'}`

  let text, action, tone
  if (!online && pending > 0) {
    // Offline outranks being signed out: reconnecting is the precondition for
    // either, and a "Sign in" button they can't use is worse than no button.
    text = `${scores} saved — will sync when you reconnect`
    tone = 'waiting'
  } else if (noSession) {
    // With nothing queued there is nothing being lost: every game route is
    // behind RequireAuth, so a signed-out user is bounced to /login the moment
    // they pick one. Saying "your scores aren't being saved" described a state
    // they can't actually be in. What they need to know is that the session
    // ended and they can't play until they sign back in.
    text = pending > 0
      ? `You're signed out — ${scores} saved. Sign in to upload them.`
      : `You're signed out — sign in to keep playing.`
    action = { label: 'Sign in', onClick: () => navigate('/login') }
    tone = 'alert'
  } else if (unreachable) {
    text = `Can't reach Skywatch — ${scores} saved on this device`
    action = { label: 'Try again', onClick: () => flushOutbox({ apiFetch, API, userId }) }
    tone = 'alert'
  } else {
    text = `Syncing ${scores}…`
    tone = 'ok'
  }

  const accent = tone === 'ok' ? '#5baaff' : '#f59e0b'

  return (
    <div
      role="status"
      aria-live="polite"
      className="sync-status-pill"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '16px',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        maxWidth: 'calc(100vw - 24px)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 14px',
        borderRadius: '9999px',
        fontSize: '13px',
        fontWeight: 600,
        color: '#ddeaf8',
        background: tone === 'ok' ? 'rgba(16,32,64,0.95)' : 'rgba(12,24,41,0.97)',
        border: `1px solid ${tone === 'ok' ? '#5baaff' : 'rgba(245,158,11,0.55)'}`,
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span
        aria-hidden="true"
        className="sync-status-dot"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '9999px',
          background: accent,
          flex: '0 0 auto',
        }}
      />
      {text}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginLeft: '4px',
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 700,
            color: '#06101e',
            background: accent,
            border: 'none',
            cursor: 'pointer',
            flex: '0 0 auto',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
