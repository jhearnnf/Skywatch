import { useEffect, useState } from 'react'
import { isOnline, onNetworkChange } from '../../lib/net'

// Persistent "OFFLINE" badge shown next to the logo whenever connectivity is
// lost, so it's always obvious the app is in offline mode (CBAT still playable;
// scores sync on reconnect). Self-contained styling — red to read as a clear
// "disconnected" state against the dark top bar.
export default function OfflineBadge() {
  const [online, setOnline] = useState(isOnline())
  useEffect(() => onNetworkChange(setOnline), [])

  if (online) return null

  return (
    <span
      role="status"
      aria-live="polite"
      title="You're offline — CBAT games still work; scores sync when you reconnect"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1.4,
        color: '#fca5a5',
        background: 'rgba(220,38,38,0.14)',
        border: '1px solid rgba(248,113,113,0.5)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: '6px', height: '6px', borderRadius: '9999px', background: '#f87171', flex: '0 0 auto' }}
      />
      Offline
    </span>
  )
}
