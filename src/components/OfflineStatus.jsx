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
// So: hidden by default, shown only on the screens listed below. An allowlist
// (not a blocklist of game routes) means a newly added route can never start
// overlaying gameplay by accident. `immersive` is the app's own "mid-play"
// flag and vetoes everything regardless.
//
// FOUR STATES, and the distinction matters — see lib/apiHealth.js:
//   • offline            — their network. Scores are queued and safe.
//   • can't reach us     — our fault or the network's; they can't fix it, so
//                          don't tell them to "check your connection".
//   • signed out         — the only state they can actually resolve.
//   • syncing            — transient, while the queue drains.
const ALLOWED_EXACT = new Set(['/', '/home', '/cbat'])
const isLeaderboard = (path) => /^\/cbat\/[^/]+\/leaderboard\/?$/.test(path)

export function canShowSyncStatus(pathname, { immersive, gameOver }) {
  if (immersive) return false            // never over live gameplay
  if (gameOver) return true              // score screen: they've stopped playing
  return ALLOWED_EXACT.has(pathname) || isLeaderboard(pathname)
}

export default function OfflineStatus() {
  const [online, setOnline]   = useState(isOnline())
  const [pending, setPending] = useState(0)
  const [health, setHealth]   = useState(getApiHealth)
  const { immersive, gameOver } = useGameChrome()
  const { apiFetch, API } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => onNetworkChange(setOnline), [])
  useEffect(() => onApiHealthChange(setHealth), [])

  useEffect(() => {
    let active = true
    const refresh = () => { Promise.resolve(pendingCount()).then((n) => { if (active) setPending(n) }) }
    refresh()
    const off = onOutboxChange(refresh)
    return () => { active = false; off() }
  }, [])

  // Re-check the pending count when connectivity flips (a flush may have run).
  useEffect(() => {
    if (!online) return
    const t = setTimeout(() => { Promise.resolve(pendingCount()).then(setPending) }, 1500)
    return () => clearTimeout(t)
  }, [online])

  if (!canShowSyncStatus(pathname, { immersive, gameOver })) return null

  const signedOut = health.status === 'signedOut'
  const unreachable = health.status === 'unreachable'

  // Being signed out matters even with nothing queued — it means nothing they
  // do from here will be saved. Every other state is only worth raising if
  // there's actually something waiting to go.
  if (pending === 0 && !signedOut) return null

  const scores = `${pending} score${pending === 1 ? '' : 's'}`

  let text, action, tone
  if (signedOut) {
    text = pending > 0
      ? `You're signed out — ${scores} saved. Sign in to upload them.`
      : `You're signed out — your scores aren't being saved.`
    action = { label: 'Sign in', onClick: () => navigate('/login') }
    tone = 'alert'
  } else if (unreachable) {
    text = `Can't reach Skywatch — ${scores} saved on this device`
    action = { label: 'Try again', onClick: () => flushOutbox({ apiFetch, API }) }
    tone = 'alert'
  } else if (!online) {
    text = `${scores} saved — will sync when you reconnect`
    tone = 'waiting'
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
