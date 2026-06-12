import { useEffect, useState } from 'react'
import { isOnline, onNetworkChange } from '../lib/net'
import { onOutboxChange, pendingCount } from '../lib/cbatOutbox'

// Score-sync feedback for CBAT offline support. The persistent "OFFLINE" state
// is owned by the badge next to the logo (OfflineBadge); this banner only
// surfaces when there are queued scores, so the two never say the same thing:
//   • Offline + pending → "N score(s) saved — will sync when you reconnect".
//   • Back online + pending → transient "syncing N score(s)" while it drains.
// Self-contained styling using the dark RAF theme tokens; mounted once globally.
export default function OfflineStatus() {
  const [online, setOnline]   = useState(isOnline())
  const [pending, setPending] = useState(0)

  useEffect(() => onNetworkChange(setOnline), [])

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

  // Pure-offline state is shown by OfflineBadge; this banner is sync feedback.
  if (pending === 0) return null

  const text = online
    ? `Syncing ${pending} score${pending === 1 ? '' : 's'}…`
    : `${pending} score${pending === 1 ? '' : 's'} saved — will sync when you reconnect`

  return (
    <div
      role="status"
      aria-live="polite"
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
        background: online ? 'rgba(16,32,64,0.95)' : 'rgba(12,24,41,0.97)',
        border: `1px solid ${online ? '#5baaff' : 'rgba(91,170,255,0.4)'}`,
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '9999px',
          background: online ? '#5baaff' : '#f59e0b',
          flex: '0 0 auto',
        }}
      />
      {text}
    </div>
  )
}
