import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Overlay from '../../../components/ui/Overlay'
import BotBadge from '../../../components/BotBadge'
import { agentLabel } from '../format'

// Tapping a name in a channel opens this. It is the only route into a DM, by
// design: you can message someone you have actually seen posting, rather than
// searching the user base for strangers.
//
// Overlay portals to document.body, so the chat panel's `overflow-hidden`
// cannot clip the card.
export default function UserCard({ userId, onClose, onOpenDm, onBlockChanged }) {
  const { API, apiFetch } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  // Blocking asks first. It is not destructive — unblocking is one tap in
  // Profile — but it silently removes someone from every channel you read, and
  // a mis-tap that does that with no warning is hard to even diagnose.
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`${API}/api/chat/users/${userId}/card`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setProfile(d?.data?.user ?? null); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [API, apiFetch, userId])

  const startDm = async () => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/dm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not open a direct message')
      onOpenDm(d.data.conversation._id)
    } catch (e) {
      setErr(e.message || 'Could not open a direct message')
      setBusy(false)
    }
  }

  // POST to block, DELETE to unblock. The card closes afterwards rather than
  // re-rendering in place: the thread behind it is about to lose (or regain)
  // every message from this agent, and leaving the card open over a list that
  // just changed under it reads as a glitch.
  const setBlocked = async (blocked) => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API}/api/chat/users/${userId}/block`, {
        method: blocked ? 'POST' : 'DELETE',
        credentials: 'include',
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not update that block')
      onBlockChanged?.(blocked)
      onClose()
    } catch (e) {
      setErr(e.message || 'Could not update that block')
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      <div className="w-full max-w-xs bg-surface rounded-2xl border border-slate-200 card-shadow p-5 text-center">
        {loading ? (
          <p className="text-sm text-slate-400 py-4">Loading…</p>
        ) : !profile ? (
          <p className="text-sm text-slate-400 py-4">That agent is no longer available.</p>
        ) : (
          <>
            {/* A bot gets its own face here too, so the card you open from a
                channel matches the avatar you tapped to open it. */}
            {profile.isBot ? (
              <BotBadge
                botKey={profile.botKey}
                size={40}
                title={profile.displayName}
                className="mx-auto mb-2"
              />
            ) : (
              <div className="text-3xl mb-2">🎖️</div>
            )}
            <p className="text-base font-extrabold text-slate-800 truncate">{agentLabel(profile)}</p>
            {profile.agentNumber && (
              <p className="text-[11px] text-slate-400 mt-0.5">Agent #{profile.agentNumber}</p>
            )}
            {profile.isAdmin && (
              <p className="text-[11px] font-semibold text-brand-600 mt-1">SkyWatch staff</p>
            )}
            {/* Spelled out in full here rather than abbreviated to the pill:
                this is the card you opened to find out who someone is, and it
                has the room. Matches the staff line above it. */}
            {profile.cbatPassed && (
              <p className="text-[11px] font-semibold text-emerald-600 mt-1">Passed the CBAT</p>
            )}

            {err && <p className="text-xs text-red-600 mt-3">{err}</p>}

            {confirming ? (
              <div className="mt-4">
                <p className="text-xs text-slate-500 mb-3">
                  You will stop seeing their messages in every channel, and neither of you will be
                  able to send the other a direct message. They are not told. You can undo this in
                  your profile.
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setBlocked(true)}
                    disabled={busy}
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    {busy ? 'Blocking…' : 'Block this agent'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="w-full px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {!profile.isSelf && !profile.isBlocked && (
                  <button
                    type="button"
                    onClick={startDm}
                    disabled={busy}
                    className="w-full px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors"
                  >
                    Message
                  </button>
                )}
                {profile.canBlock && (
                  <button
                    type="button"
                    onClick={() => (profile.isBlocked ? setBlocked(false) : setConfirming(true))}
                    disabled={busy}
                    className="w-full px-4 py-2 text-red-600 hover:text-red-700 border border-slate-200 hover:bg-slate-100 disabled:opacity-50 font-bold rounded-xl text-sm transition-colors"
                  >
                    {profile.isBlocked ? 'Unblock' : 'Block'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Overlay>
  )
}
